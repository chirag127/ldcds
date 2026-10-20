import { inrCompact, num, pct } from './format';
import type { Insight } from './types';

export type Kind = 'money' | 'percent' | 'ratio' | 'num';

/** Format a metric value for prose. `percent` = already ×100, `ratio` = 0–1. */
export function fmtVal(value: number, kind: Kind, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  switch (kind) {
    case 'money':
      return inrCompact(value);
    case 'percent':
      return pct(value, decimals);
    case 'ratio':
      return pct(value * 100, decimals);
    default:
      return num(value, decimals);
  }
}

export function plain(
  tone: Insight['tone'],
  headline: string,
  detail: string,
  action?: Insight['action'],
): Insight {
  return { tone, headline, detail, action };
}

export interface RankedPoint {
  label: string;
  value: number;
  n: number;
}

export interface RankOptions {
  metric: string;
  kind: Kind;
  higherIsBetter: boolean;
  /** Minimum loans per group before a leader can be trusted. */
  minN?: number;
  /** Optional title-cased subject used in the recommendation sentence. */
  subject?: string;
}

/**
 * Builds a "prefer / avoid" insight from an ordered segment comparison.
 * Chooses the best and worst groups with enough loans, then states the gap.
 */
export function rankInsight(points: RankedPoint[], opts: RankOptions): Insight {
  const minN = opts.minN ?? 25;
  const usable = points.filter((p) => p.n >= minN && Number.isFinite(p.value));
  const subject = opts.subject ?? 'segments';
  if (usable.length < 2) {
    return plain(
      'neutral',
      `Not enough depth to rank ${subject}`,
      `Need at least two ${subject} with ${minN}+ loans each. Widen the filters to compare reliably.`,
      'INFO',
    );
  }
  const sorted = [...usable].sort((a, b) => (opts.higherIsBetter ? b.value - a.value : a.value - b.value));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const gap = Math.abs(best.value - worst.value);
  const bestText = fmtVal(best.value, opts.kind);
  const worstText = fmtVal(worst.value, opts.kind);
  const tone: Insight['tone'] = gap === 0 ? 'neutral' : opts.higherIsBetter ? 'positive' : 'warning';
  // Gap in points for rates, absolute otherwise; the relative multiple is only
  // meaningful when both sides share a sign and the ratio is readable.
  const gapText = opts.kind === 'percent' ? `${gap.toFixed(1)} points` : fmtVal(gap, opts.kind);
  const sameSign = best.value !== 0 && worst.value !== 0 && Math.sign(best.value) === Math.sign(worst.value);
  const ratio = sameSign ? Math.abs(best.value / worst.value) : null;
  const ratioText = ratio !== null && ratio >= 1.05 && ratio <= 20 ? `, ${ratio.toFixed(1)}× the weaker group` : '';
  return {
    tone,
    headline: `${best.label} leads on ${opts.metric} at ${bestText}`,
    detail:
      `${best.label} (${num(best.n)} loans) beats ${worst.label} (${num(worst.n)} loans, ${worstText}) by ` +
      `${gapText} on ${opts.metric}${ratioText}. ` +
      (opts.higherIsBetter
        ? `Prefer ${best.label.toLowerCase()}; treat ${worst.label.toLowerCase()} as the drag.`
        : `Prefer ${best.label.toLowerCase()}; avoid or reprice ${worst.label.toLowerCase()}.`),
    action: opts.higherIsBetter ? 'PREFER' : 'AVOID',
  };
}

export function distInsight(values: number[], label: string, kind: Kind): Insight {
  if (!values.length) {
    return plain('neutral', `No ${label} data in this slice`, 'The current filters exclude every loan with a usable value.', 'INFO');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const spread = at(0.9) - at(0.1);
  const skew = Math.abs(mean - at(0.5)) > spread * 0.25;
  return {
    tone: skew ? 'warning' : 'neutral',
    headline: `${label}: median ${fmtVal(at(0.5), kind)} across ${num(values.length)} loans`,
    detail:
      `Middle 80% runs ${fmtVal(at(0.1), kind)} to ${fmtVal(at(0.9), kind)}; mean ${fmtVal(mean, kind)}. ` +
      (skew
        ? 'Distribution is skewed, so the mean overstates the typical loan — underwrite on the median.'
        : 'Distribution is tight enough that the average is representative of the typical loan.'),
    action: 'INFO',
  };
}

export function trendInsight(
  labels: string[],
  values: number[],
  label: string,
  kind: Kind,
  higherIsBetter = true,
): Insight {
  const paired = values
    .map((v, i) => ({ label: labels[i], v }))
    .filter((p) => Number.isFinite(p.v) && p.label);
  if (paired.length < 2) {
    return plain('neutral', `Not enough months to trend ${label}`, 'At least two disbursement months are needed.', 'INFO');
  }
  const first = paired[0];
  const last = paired[paired.length - 1];
  const peak = paired.reduce((a, b) => (b.v > a.v ? b : a));
  const trough = paired.reduce((a, b) => (b.v < a.v ? b : a));
  const delta = last.v - first.v;
  const improving = higherIsBetter ? delta >= 0 : delta <= 0;
  // Money series have no natural direction of travel — a bigger average ticket
  // is neither good nor bad on its own, so do not grade it.
  const judged = kind !== 'money';
  return {
    tone: !judged ? 'neutral' : improving ? 'positive' : 'negative',
    headline: `${label} ${delta >= 0 ? 'rose' : 'fell'} from ${fmtVal(first.v, kind)} to ${fmtVal(last.v, kind)}`,
    detail:
      `Peak ${fmtVal(peak.v, kind)} in ${peak.label}, trough ${fmtVal(trough.v, kind)} in ${trough.label}. ` +
      (!judged
        ? 'Read the level, not the direction — pair it with the quality series before acting.'
        : improving
          ? 'Direction of travel is favourable; the latest cohorts are not deteriorating.'
          : 'Direction of travel is adverse — tighten the front book before the trend compounds.'),
    action: !judged ? 'INFO' : improving ? 'PREFER' : 'WATCH',
  };
}

export function corrInsight(r: number, xLabel: string, yLabel: string): Insight {
  const strength = Math.abs(r);
  const word = strength > 0.6 ? 'strong' : strength > 0.35 ? 'moderate' : strength > 0.15 ? 'weak' : 'negligible';
  return {
    tone: strength > 0.35 ? 'warning' : 'neutral',
    headline: `${word} ${r >= 0 ? 'positive' : 'negative'} link between ${xLabel} and ${yLabel} (r = ${r.toFixed(2)})`,
    detail:
      strength > 0.35
        ? `The two move together, so ${xLabel} is partly a proxy for ${yLabel}. Do not double-count both in a scorecard.`
        : `Little linear signal here; ${xLabel} adds information that ${yLabel} does not already carry.`,
    action: 'INFO',
  };
}

export function shareInsight(
  parts: { name: string; value: number }[],
  label: string,
  kind: Kind = 'money',
): Insight {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!parts.length || !total) {
    return plain('neutral', `No ${label} to split`, 'Filters removed every loan in this chart.', 'INFO');
  }
  const sorted = [...parts].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const topShare = (top.value / total) * 100;
  return {
    tone: topShare > 45 ? 'negative' : topShare > 30 ? 'warning' : 'positive',
    headline: `${top.name} holds ${topShare.toFixed(1)}% of ${label}`,
    detail:
      `${top.name} accounts for ${fmtVal(top.value, kind)} of ${fmtVal(total, kind)} across ${num(parts.length)} groups. ` +
      (topShare > 45
        ? 'That is dangerous single-name concentration — cap it before adding more exposure.'
        : topShare > 30
          ? 'Concentration is meaningful; watch it as the book grows.'
          : 'Spread is healthy, with no group dominating the book.'),
    action: topShare > 45 ? 'AVOID' : 'INFO',
  };
}

/** Combine a chart-specific insight with a coverage caveat when sample is thin. */
export function withCoverage(insight: Insight, n: number, minN = 30): Insight {
  if (n >= minN) return insight;
  return {
    ...insight,
    tone: insight.tone === 'positive' ? 'neutral' : insight.tone,
    detail: `${insight.detail} Caveat: only ${num(n)} loans in this cut, so treat the signal as directional.`,
  };
}

export function contributionInsight(
  items: { name: string; value: number }[],
  label: string,
): Insight {
  const positives = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const negatives = items.filter((i) => i.value < 0).sort((a, b) => a.value - b.value);
  const top = positives[0];
  const drag = negatives[0];
  if (!top && !drag) return plain('neutral', `No ${label} movement`, 'Every component nets to zero.', 'INFO');
  return {
    tone: drag ? 'warning' : 'positive',
    headline: top ? `${top.name} adds ${fmtVal(top.value, 'money')} to ${label}` : `${label} is net negative`,
    detail:
      (drag ? `${drag.name} takes ${fmtVal(Math.abs(drag.value), 'money')} back. ` : '') +
      `Gross positives ${fmtVal(positives.reduce((s, i) => s + i.value, 0), 'money')}, negatives ${fmtVal(negatives.reduce((s, i) => s + i.value, 0), 'money')}. ` +
      (drag ? 'Fix the largest drag first — it is bigger than any single improvement you can make elsewhere.' : 'Keep the mix that produced this.'),
    action: drag ? 'WATCH' : 'PREFER',
  };
}
