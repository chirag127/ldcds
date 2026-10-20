import type { ChartResult, ChartSpec, Loan, ViewContext } from './types';
import type { SegmentStat } from './metrics';
import {
  DIMENSIONS,
  aggregate,
  categoryStats,
  correlationMatrix,
  forwardProjection,
  groupRows,
  isActive,
  isClosed,
  isNpa,
  monthlyStats,
  numericSeries,
  portfolioXirr,
  scenarioProfit,
} from './metrics';
import {
  barOption,
  boxOption,
  COLORS,
  comboOption,
  corrOption,
  ecdfOption,
  fanOption,
  funnelOption,
  gaugeOption,
  heatmapOption,
  histOption,
  liftOption,
  lineOption,
  lorenzOption,
  pieOption,
  radarOption,
  rocOption,
  scatterOption,
  SERIES_COLORS,
  treemapOption,
  waterfallOption,
} from './charts';
import { histogram, linearRegression, lorenz, mean, percentile, quantile, round, sum, xirr } from './stats';
import { inrCompact, num, pct } from './format';
import {
  contributionInsight,
  corrInsight,
  distInsight,
  fmtVal,
  plain,
  rankInsight,
  shareInsight,
  trendInsight,
  withCoverage,
  type Kind,
} from './insights';

export interface MetricDef {
  label: string;
  kind: Kind;
  higherIsBetter: boolean;
  get: (s: SegmentStat) => number;
  risk?: boolean;
}

export const METRICS: Record<string, MetricDef> = {
  lent: { label: 'capital invested', kind: 'money', higherIsBetter: true, get: (s) => s.lent },
  n: { label: 'loan count', kind: 'num', higherIsBetter: true, get: (s) => s.n },
  pos: { label: 'principal outstanding', kind: 'money', higherIsBetter: true, get: (s) => s.pos },
  profit: { label: 'profit', kind: 'money', higherIsBetter: true, get: (s) => s.profit },
  loss: { label: 'expected loss', kind: 'money', higherIsBetter: false, get: (s) => s.loss, risk: true },
  npaRate: { label: 'NPA rate', kind: 'percent', higherIsBetter: false, get: (s) => s.npaRate, risk: true },
  badRate: { label: 'impairment rate', kind: 'percent', higherIsBetter: false, get: (s) => s.badRate, risk: true },
  anr: { label: 'median reported ANR', kind: 'percent', higherIsBetter: true, get: (s) => s.medianAnr },
  // categoryStats/portfolioXirr already return percent, so don't treat as a ratio.
  xirr: { label: 'money-weighted XIRR', kind: 'percent', higherIsBetter: true, get: (s) => s.xirr ?? 0 },
  ticket: { label: 'average ticket', kind: 'money', higherIsBetter: true, get: (s) => s.avgTicket },
  rate: { label: 'borrower APR', kind: 'percent', higherIsBetter: true, get: (s) => s.avgRate },
  tenure: { label: 'average tenure', kind: 'num', higherIsBetter: false, get: (s) => s.avgTenure, risk: true },
  score: { label: 'average LDC score', kind: 'num', higherIsBetter: true, get: (s) => s.avgScore },
  bureau: { label: 'average bureau score', kind: 'num', higherIsBetter: true, get: (s) => s.avgBureau },
  age: { label: 'average borrower age', kind: 'num', higherIsBetter: true, get: (s) => s.avgAge },
  prepay: { label: 'prepayment rate', kind: 'percent', higherIsBetter: true, get: (s) => s.prepayRate },
  repeat: { label: 'repeat-borrower share', kind: 'percent', higherIsBetter: true, get: (s) => s.repeatShare },
  recovery: { label: 'recovery rate', kind: 'ratio', higherIsBetter: true, get: (s) => s.recoveryRate },
  severity: { label: 'loss severity', kind: 'ratio', higherIsBetter: false, get: (s) => s.lossSeverity, risk: true },
  holding: { label: 'average holding days', kind: 'num', higherIsBetter: true, get: (s) => s.avgHoldingDays },
  share: { label: 'capital share', kind: 'percent', higherIsBetter: true, get: (s) => s.share },
  ciHigh: { label: 'bad-rate upper bound', kind: 'percent', higherIsBetter: false, get: (s) => s.ciHigh, risk: true },
  medianAnr: { label: 'median ANR', kind: 'percent', higherIsBetter: true, get: (s) => s.medianAnr },
  hazard: { label: 'defaults per 1,000 loan-months', kind: 'num', higherIsBetter: false, get: (s) => s.npaPer1000LoanMonths, risk: true },
  hazardAnnual: { label: 'annualised default rate', kind: 'percent', higherIsBetter: false, get: (s) => s.annualisedNpaRate, risk: true },
  lossRate: { label: 'loss per ₹1,000 lent-month', kind: 'num', higherIsBetter: false, get: (s) => s.lossPer1000RupeeMonths, risk: true },
  capitalTime: { label: 'capital-time return', kind: 'percent', higherIsBetter: true, get: (s) => s.capitalTime },
  per100: { label: 'profit per ₹100 lent', kind: 'percent', higherIsBetter: true, get: (s) => s.per100 },
};

export type MetricKey = keyof typeof METRICS;

export function metricColor(key: string): string {
  const def = METRICS[key];
  if (!def) return COLORS.cyan;
  if (def.risk) return COLORS.rose;
  if (key === 'lent' || key === 'n' || key === 'pos') return COLORS.cyan;
  return COLORS.emerald;
}

export function toDisplay(value: number, kind: Kind): number {
  if (!Number.isFinite(value)) return 0;
  return kind === 'ratio' ? round(value * 100, 2) : value;
}

function axisFormat(kind: Kind): 'money' | 'percent' | 'num' {
  if (kind === 'money') return 'money';
  if (kind === 'num') return 'num';
  return 'percent';
}

export function chart(
  id: string,
  title: string,
  section: string,
  build: ChartSpec['build'],
  extra: Partial<ChartSpec> = {},
): ChartSpec {
  return { id, title, section, build, height: 260, ...extra };
}

// ---------------------------------------------------------------------------
// Dimension charts
// ---------------------------------------------------------------------------
export interface DimBarOptions {
  id: string;
  title: string;
  section: string;
  dim: string;
  metric: MetricKey;
  subtitle?: string;
  note?: string;
  span?: 1 | 2 | 3 | 4;
  height?: number;
  limit?: number;
  minN?: number;
  filter?: (loan: Loan) => boolean;
  horizontal?: boolean;
  table?: boolean;
  label?: boolean;
  sortBy?: keyof SegmentStat;
}

export function dimBar(o: DimBarOptions): ChartSpec {
  const meta = METRICS[o.metric];
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, {
        limit: o.limit,
        minN: o.minN,
        sortBy: (o.sortBy ?? o.metric) as keyof SegmentStat,
        filter: o.filter,
        xirr: o.metric === 'xirr',
      });
      const values = stats.map((s) => toDisplay(meta.get(s), meta.kind));
      const horizontal = o.horizontal ?? (stats.length > 8 || Math.max(...stats.map((s) => s.label.length), 0) > 11);
      const option = barOption({
        categories: stats.map((s) => s.label),
        series: [{ name: meta.label, data: values, color: metricColor(o.metric) }],
        horizontal,
        yFormat: axisFormat(meta.kind),
        label: o.label ?? false,
      });
      const insight = withCoverage(
        rankInsight(
          stats.map((s) => ({ label: s.label, value: meta.get(s), n: s.n })),
          { metric: meta.label, kind: meta.kind, higherIsBetter: meta.higherIsBetter, minN: o.minN ?? 25, subject: DIMENSIONS[o.dim].label.toLowerCase() + ' groups' },
        ),
        rows.length,
      );
      return {
        option,
        insight,
        table: o.table
          ? {
              columns: [
                { key: 'label', label: DIMENSIONS[o.dim].label },
                { key: 'n', label: 'Loans', align: 'right', type: 'int' },
                { key: 'lent', label: 'Invested', align: 'right', type: 'money' },
                { key: 'npaRate', label: 'NPA %', align: 'right', type: 'percent' },
                { key: 'medianAnr', label: 'ANR % (median)', align: 'right', type: 'percent' },
                { key: 'xirr', label: 'XIRR', align: 'right', type: 'percent' },
              ],
              rows: stats.map((s) => ({
                label: s.label,
                n: s.n,
                lent: s.lent,
                npaRate: s.npaRate,
                medianAnr: s.medianAnr,
                xirr: s.xirr,
              })),
            }
          : undefined,
      };
    },
    {
      subtitle: o.subtitle ?? (o.metric === 'xirr'
        ? 'All cash flows in the group, including projected receipts on active loans'
        : undefined),
      note: o.note,
      span: o.span,
      height: o.height ?? 260,
    },
  );
}

export function dimPie(o: {
  id: string;
  title: string;
  section: string;
  dim: string;
  metric?: 'lent' | 'n';
  subtitle?: string;
  span?: 1 | 2;
  limit?: number;
  height?: number;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const metric = o.metric ?? 'lent';
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, {
        sortBy: metric,
        xirr: false,
        limit: o.limit ?? 8,
      });
      const parts = stats.map((s) => ({ name: s.label, value: metric === 'lent' ? s.lent : s.n }));
      const total = parts.reduce((s, p) => s + p.value, 0);
      const option = pieOption({
        data: parts,
        valueFormat: metric === 'lent' ? 'money' : 'num',
        centerText: {
          value: metric === 'lent' ? inrCompact(total) : num(total),
          label: metric === 'lent' ? 'invested' : 'loans',
        },
      });
      return {
        option,
        insight: shareInsight(parts, metric === 'lent' ? 'capital' : 'loans', metric === 'lent' ? 'money' : 'num'),
      };
    },
    { subtitle: o.subtitle ?? 'Share of the filtered book', span: o.span ?? 1, height: o.height ?? 280 },
  );
}

export function dimLine(o: {
  id: string;
  title: string;
  section: string;
  dim: string;
  metric: MetricKey;
  subtitle?: string;
  span?: 1 | 2;
  height?: number;
  area?: boolean;
  filter?: (loan: Loan) => boolean;
}): ChartSpec {
  const meta = METRICS[o.metric];
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, {
        sortBy: (o.dim === 'month' ? 'lent' : 'n') as keyof SegmentStat,
        filter: o.filter,
        xirr: o.metric === 'xirr',
      });
      const ordered = DIMENSIONS[o.dim].order
        ? stats
        : [...stats].sort((a, b) => a.label.localeCompare(b.label));
      const values = ordered.map((s) => toDisplay(meta.get(s), meta.kind));
      const option = lineOption({
        x: ordered.map((s) => s.label),
        series: [{ name: meta.label, data: values, color: metricColor(o.metric), area: o.area }],
        yFormat: axisFormat(meta.kind),
        showLegend: false,
      });
      return {
        option,
        insight: trendInsight(
          ordered.map((s) => s.label),
          values,
          meta.label,
          meta.kind,
          meta.higherIsBetter,
        ),
      };
    },
    {
      subtitle: o.subtitle ?? (o.metric === 'xirr'
        ? 'All cash flows in the group, including projected receipts on active loans'
        : undefined),
      span: o.span ?? 2,
      height: o.height ?? 260,
    },
  );
}

export function dimStack(o: {
  id: string;
  title: string;
  section: string;
  dim: string;
  metric?: 'count' | 'lent';
  subtitle?: string;
  span?: 1 | 2 | 3 | 4;
  height?: number;
  limit?: number;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const byCategory = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, {
        sortBy: 'lent',
        xirr: false,
        limit: o.limit,
      });
      const categories = byCategory.map((s) => s.label);
      const seg = (label: string, test: (l: Loan) => boolean) =>
        categories.map((cat) => {
          const group = rows.filter((l) => String(DIMENSIONS[o.dim].get(l)) === cat && test(l));
          return o.metric === 'lent' ? round(sum(group, (l) => l.amount), 2) : group.length;
        });
      const option = barOption({
        categories,
        series: [
          { name: 'On-time active', data: seg('a', (l) => isActive(l) && !l.impaired), color: COLORS.cyan },
          { name: 'Overdue active', data: seg('b', (l) => isActive(l) && l.impaired === 1), color: COLORS.amber },
          { name: 'Closed clean', data: seg('c', (l) => isClosed(l) && !isNpa(l)), color: COLORS.emerald },
          { name: 'NPA', data: seg('d', (l) => isNpa(l)), color: COLORS.rose },
        ],
        stack: true,
        showLegend: true,
        yFormat: o.metric === 'lent' ? 'money' : 'num',
      });
      const npaShare = rows.length ? (rows.filter(isNpa).length / rows.length) * 100 : 0;
      return {
        option,
        insight: plain(
          npaShare > 4 ? 'warning' : 'neutral',
          `Outcome mix across ${num(categories.length)} ${DIMENSIONS[o.dim].label.toLowerCase()} groups`,
          `Book-wide NPA is ${pct(npaShare)} of loans. Stacking outcomes shows whether a group's volume is clean business or just a larger pile of eventual write-offs.`,
          'INFO',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Outcome composition, not just volume', span: o.span ?? 2, height: o.height ?? 280 },
  );
}

// ---------------------------------------------------------------------------
// Numeric distributions
// ---------------------------------------------------------------------------
export function histField(o: {
  id: string;
  title: string;
  section: string;
  label: string;
  get: (loan: Loan) => number | null;
  kind?: Kind;
  bins?: number;
  subtitle?: string;
  span?: 1 | 2;
  height?: number;
  filter?: (loan: Loan) => boolean;
  color?: string;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const source = o.filter ? rows.filter(o.filter) : rows;
      const values = numericSeries(source, o.get);
      const bins = histogram(values, o.bins ?? 22);
      const option = histOption({
        bins,
        xName: o.label,
        xFormat: o.kind === 'money' ? 'money' : o.kind === 'ratio' ? 'ratio' : o.kind === 'percent' ? 'percent' : 'num',
        color: o.color ?? COLORS.violet,
      });
      return { option, insight: distInsight(values, o.label, o.kind ?? 'num') };
    },
    { subtitle: o.subtitle, span: o.span ?? 1, height: o.height ?? 260 },
  );
}

export function boxDim(o: {
  id: string;
  title: string;
  section: string;
  dim: string;
  label: string;
  get: (loan: Loan) => number | null;
  kind?: Kind;
  subtitle?: string;
  span?: 1 | 2;
  height?: number;
  limit?: number;
  filter?: (loan: Loan) => boolean;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, {
        sortBy: 'lent',
        xirr: false,
        limit: o.limit ?? 10,
      });
      const values: (number[] | null)[] = [];
      const medians: number[] = [];
      for (const s of stats) {
        const group = rows.filter((l) => String(DIMENSIONS[o.dim].get(l)) === s.label);
        const series = numericSeries(o.filter ? group.filter(o.filter) : group, o.get);
        if (series.length < 5) {
          values.push(null);
          continue;
        }
        const sorted = [...series].sort((a, b) => a - b);
        values.push([
          round(percentile(sorted, 2), 2),
          round(percentile(sorted, 25), 2),
          round(percentile(sorted, 50), 2),
          round(percentile(sorted, 75), 2),
          round(percentile(sorted, 98), 2),
        ]);
        medians.push(percentile(sorted, 50));
      }
      const option = boxOption({
        categories: stats.map((s) => s.label),
        data: values,
        yName: o.label,
        yFormat: o.kind === 'money' ? 'money' : o.kind === 'ratio' ? 'percent' : 'num',
      });
      const spread = medians.length > 1 ? Math.max(...medians) - Math.min(...medians) : 0;
      return {
        option,
        insight: plain(
          spread > 0 ? 'warning' : 'neutral',
          `${o.label} median spread of ${fmtVal(spread, o.kind ?? 'num')} across groups`,
          `Boxes show p2–p98 whiskers with p25–p75 bodies. Overlap means segment averages hide wide dispersion — size positions on the tail, not the median.`,
          'INFO',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Distribution, not just the average', span: o.span ?? 2, height: o.height ?? 280 },
  );
}

export function ecdfField(o: {
  id: string;
  title: string;
  section: string;
  label: string;
  get: (loan: Loan) => number | null;
  kind?: Kind;
  subtitle?: string;
  color?: string;
  span?: 1 | 2;
  filter?: (loan: Loan) => boolean;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const source = o.filter ? rows.filter(o.filter) : rows;
      const values = numericSeries(source, o.get).sort((a, b) => a - b);
      const points = values.length
        ? values.filter((_, i) => i % Math.max(1, Math.floor(values.length / 160)) === 0).map((v, i) => ({ x: v, y: (i * Math.max(1, Math.floor(values.length / 160)) + 1) / values.length }))
        : [];
      const option = ecdfOption({ points, xName: o.label, color: o.color ?? COLORS.emerald, xFormat: o.kind === 'money' ? 'money' : o.kind === 'num' ? 'num' : 'percent' });
      const median = values.length ? percentile(values, 50) : 0;
      return {
        option,
        insight: plain(
          'neutral',
          `Half the filtered book sits below ${fmtVal(median, o.kind ?? 'num')} on ${o.label}`,
          `The curve is cumulative: read across to see what share of loans fall under any threshold. A steep middle means most loans cluster tightly; long flat tails mean outliers dominate the average.`,
          'INFO',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Cumulative distribution', span: o.span ?? 1, height: 260 },
  );
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------
export function scatterXY(o: {
  id: string;
  title: string;
  section: string;
  xLabel: string;
  yLabel: string;
  xGet: (loan: Loan) => number | null;
  yGet: (loan: Loan) => number | null;
  xKind?: Kind;
  yKind?: Kind;
  groupBy?: 'grade' | 'outcome' | 'status';
  subtitle?: string;
  max?: number;
  span?: 2 | 3 | 4;
  height?: number;
  filter?: (loan: Loan) => boolean;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const source = o.filter ? rows.filter(o.filter) : rows;
      const step = Math.max(1, Math.floor(source.length / (o.max ?? 900)));
      const sample = source.filter((_, i) => i % step === 0);
      const xs: number[] = [];
      const ys: number[] = [];
      const groupGet = o.groupBy === 'outcome'
        ? (l: Loan) => (isNpa(l) ? 'NPA' : isActive(l) ? (l.impaired ? 'Overdue active' : 'Active') : 'Closed clean')
        : o.groupBy === 'status'
          ? (l: Loan) => (isNpa(l) ? 'NPA' : isActive(l) ? 'Active' : 'Closed')
          : (l: Loan) => DIMENSIONS.grade.get(l) as string;
      const points: { x: number; y: number; group: string; color?: string }[] = [];
      for (const loan of sample) {
        const x = o.xGet(loan);
        const y = o.yGet(loan);
        if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        xs.push(x);
        ys.push(y);
        const group = groupGet(loan);
        points.push({
          x: round(x, 2),
          y: round(y, 2),
          group,
          color: group === 'NPA' ? COLORS.rose : group === 'Overdue active' ? COLORS.amber : undefined,
        });
      }
      const reg = linearRegression(xs, ys);
      const option = scatterOption({
        points,
        xName: o.xLabel,
        yName: o.yLabel,
        xFormat: o.xKind === 'money' ? 'money' : o.xKind === 'num' ? 'num' : 'percent',
        yFormat: o.yKind === 'money' ? 'money' : o.yKind === 'num' ? 'num' : 'percent',
        regression: reg,
        categories: o.groupBy === 'outcome' ? ['Closed clean', 'Active', 'Overdue active', 'NPA'] : undefined,
      });
      return {
        option,
        insight: withCoverage(corrInsight(reg.slope === 0 ? 0 : Math.sqrt(reg.r2), o.xLabel, o.yLabel), xs.length, 60),
      };
    },
    { subtitle: o.subtitle, span: o.span ?? 2, height: o.height ?? 300 },
  );
}

export function corrChart(o: {
  id: string;
  title: string;
  section: string;
  fields: { key: string; label: string; get: (loan: Loan) => number | null }[];
  subtitle?: string;
  span?: 2 | 3 | 4;
  height?: number;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const { labels, matrix } = correlationMatrix(rows, o.fields);
      const option = corrOption({ labels, matrix });
      const pairs = matrix.filter((m) => m.x < m.y).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      const top = pairs[0];
      const insight = top
        ? plain(
            Math.abs(top.value) > 0.5 ? 'warning' : 'neutral',
            `Strongest link: ${labels[top.x]} × ${labels[top.y]} at r = ${top.value.toFixed(2)}`,
            `Correlation runs from -1 to +1. The top pair explains roughly ${(top.value * top.value * 100).toFixed(0)}% of shared variance. Anything above |0.5| is a candidate for dropping from a model to avoid double counting.`,
            'INFO',
          )
        : plain('neutral', 'No correlation pairs', 'Add at least two numeric fields.', 'INFO');
      return { option, insight };
    },
    { subtitle: o.subtitle ?? 'Pearson correlation across loan features', span: o.span ?? 2, height: o.height ?? 340 },
  );
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------
export interface MonthMetric {
  label: string;
  kind: Kind;
  higherIsBetter: boolean;
  get: (m: ReturnType<typeof monthlyStats>[number]) => number;
}

export const MONTH_METRICS: Record<string, MonthMetric> = {
  lent: { label: 'capital disbursed', kind: 'money', higherIsBetter: true, get: (m) => m.lent },
  n: { label: 'loans disbursed', kind: 'num', higherIsBetter: true, get: (m) => m.n },
  profit: { label: 'profit', kind: 'money', higherIsBetter: true, get: (m) => m.profit },
  netProfit: { label: 'realised profit', kind: 'money', higherIsBetter: true, get: (m) => m.netProfit },
  npaRate: { label: 'NPA rate', kind: 'percent', higherIsBetter: false, get: (m) => m.npaRate },
  badRate: { label: 'impairment rate', kind: 'percent', higherIsBetter: false, get: (m) => m.badRate },
  avgAnr: { label: 'median reported ANR', kind: 'percent', higherIsBetter: true, get: (m) => m.medianAnr },
  avgTicket: { label: 'average ticket', kind: 'money', higherIsBetter: true, get: (m) => m.avgTicket },
  pos: { label: 'principal outstanding', kind: 'money', higherIsBetter: true, get: (m) => m.pos },
  received: { label: 'cash received', kind: 'money', higherIsBetter: true, get: (m) => m.received },
};

export function monthlyLine(o: {
  id: string;
  title: string;
  section: string;
  metric: keyof typeof MONTH_METRICS;
  subtitle?: string;
  span?: 1 | 2 | 3 | 4;
  height?: number;
  area?: boolean;
  window?: number;
}): ChartSpec {
  const meta = MONTH_METRICS[o.metric];
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const months = monthlyStats(rows, ctx.scenario);
      const labels = months.map((m) => m.label);
      const values = months.map((m) => toDisplay(meta.get(m), meta.kind));
      const option = lineOption({
        x: labels,
        series: [{ name: meta.label, data: values, color: meta.higherIsBetter ? COLORS.emerald : COLORS.rose, area: o.area }],
        yFormat: axisFormat(meta.kind),
        showLegend: false,
      });
      return {
        option,
        insight: withCoverage(trendInsight(labels, values, meta.label, meta.kind, meta.higherIsBetter), rows.length / Math.max(1, labels.length), 8),
      };
    },
    { subtitle: o.subtitle ?? 'By disbursement month', span: o.span ?? 2, height: o.height ?? 260 },
  );
}

export function monthlyCombo(o: {
  id: string;
  title: string;
  section: string;
  bar: keyof typeof MONTH_METRICS;
  line: keyof typeof MONTH_METRICS;
  subtitle?: string;
  span?: 2 | 3 | 4;
  height?: number;
}): ChartSpec {
  const barMeta = MONTH_METRICS[o.bar];
  const lineMeta = MONTH_METRICS[o.line];
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const months = monthlyStats(rows, ctx.scenario);
      const labels = months.map((m) => m.label);
      const bars = months.map((m) => round(toDisplay(barMeta.get(m), barMeta.kind), 2));
      const lines = months.map((m) => round(toDisplay(lineMeta.get(m), lineMeta.kind), 2));
      const option = comboOption({
        categories: labels,
        bars: [{ name: barMeta.label, data: bars, color: COLORS.cyan }],
        lines: [{ name: lineMeta.label, data: lines, color: COLORS.rose }],
        barFormat: barMeta.kind === 'money' ? 'money' : 'num',
        lineFormat: lineMeta.kind === 'money' ? 'money' : lineMeta.kind === 'num' ? 'num' : 'percent',
      });
      return {
        option,
        insight: trendInsight(labels, lines, lineMeta.label, lineMeta.kind, lineMeta.higherIsBetter),
      };
    },
    { subtitle: o.subtitle ?? 'Volume against quality by cohort month', span: o.span ?? 2, height: o.height ?? 280 },
  );
}

export function cumulativeChart(o: {
  id: string;
  title: string;
  section: string;
  subtitle?: string;
  span?: 2 | 3;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const months = monthlyStats(rows, ctx.scenario);
      let lent = 0;
      let received = 0;
      let profit = 0;
      const lentSeries: number[] = [];
      const recSeries: number[] = [];
      const profitSeries: number[] = [];
      for (const m of months) {
        lent += m.lent;
        received += m.received;
        profit += m.netProfit;
        lentSeries.push(round(lent, 2));
        recSeries.push(round(received, 2));
        profitSeries.push(round(profit, 2));
      }
      const option = lineOption({
        x: months.map((m) => m.label),
        series: [
          { name: 'Cumulative invested', data: lentSeries, color: COLORS.cyan },
          { name: 'Cumulative received', data: recSeries, color: COLORS.emerald },
          { name: 'Cumulative realised profit', data: profitSeries, color: COLORS.amber },
        ],
        yFormat: 'money',
        showLegend: true,
      });
      const gap = lent ? (received / lent) * 100 : 0;
      return {
        option,
        insight: plain(
          gap > 80 ? 'positive' : 'warning',
          `${pct(gap)} of deployed capital has come back as cash`,
          `Invested ${inrCompact(lent)}, received ${inrCompact(received)}, realised ${inrCompact(profit)}. A widening gap between invested and received means the book is still young or exits are slow.`,
          gap > 80 ? 'PREFER' : 'WATCH',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Cash in versus cash back', span: o.span ?? 2, height: 300 },
  );
}

// ---------------------------------------------------------------------------
// Composition / flow
// ---------------------------------------------------------------------------
export function waterfallProfit(o: {
  id: string;
  title: string;
  section: string;
  subtitle?: string;
  span?: 2 | 3;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const tot = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
      const totalProfit = tot.profit;
      const items: { name: string; value: number; type?: 'total' | 'delta' }[] = [
        { name: 'Interest', value: round(tot.interestReceived, 2) },
        { name: 'Fees', value: -round(tot.fee, 2) },
        { name: 'Realised NPA', value: -round(tot.npaAmount, 2) },
        { name: 'Future interest', value: round(tot.futureInterest - sum(rows.filter(isActive), (l) => l.futureFee), 2) },
        { name: 'Forward losses', value: -round(tot.loss, 2) },
        { name: 'Total profit', value: round(totalProfit, 2), type: 'total' },
      ];
      const option = waterfallOption({ items });
      return {
        option,
        insight: contributionInsight(items.filter((i) => i.type !== 'total'), 'scenario profit'),
      };
    },
    { subtitle: o.subtitle ?? 'From interest received to net profit under the selected scenario', span: o.span ?? 2, height: 300 },
  );
}

export function outcomeFunnel(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const total = rows.length;
      const disbursed = rows.reduce((s, l) => s + l.amount, 0);
      const active = rows.filter(isActive).length;
      const closed = rows.filter(isClosed).length;
      const clean = rows.filter((l) => isClosed(l) && !isNpa(l)).length;
      const npa = rows.filter(isNpa).length;
      const option = funnelOption({
        data: [
          { name: `Disbursed ${num(total)}`, value: total, color: COLORS.cyan },
          { name: `Active ${num(active)}`, value: active, color: COLORS.blue },
          { name: `Closed ${num(closed)}`, value: closed, color: COLORS.emerald },
          { name: `Clean exit ${num(clean)}`, value: clean, color: COLORS.lime },
          { name: `NPA ${num(npa)}`, value: npa, color: COLORS.rose },
        ],
        valueFormat: 'num',
      });
      return {
        option,
        insight: plain(
          npa / Math.max(1, total) > 0.05 ? 'warning' : 'positive',
          `${pct((clean / Math.max(1, total)) * 100)} of loans left the book cleanly`,
          `${num(npa)} loans turned NPA on ${inrCompact(disbursed)} deployed. The funnel is a stock view at ${ctxText(rows.length)}; cohorts still inside their tenure have not had time to fail.`,
          npa / Math.max(1, total) > 0.05 ? 'WATCH' : 'PREFER',
        ),
      };
    },
    { subtitle: 'Lifecycle of the filtered book', span: o.span ?? 1, height: 320 },
  );
}

function ctxText(n: number): string {
  return `${num(n)} loans`;
}

export function scenarioProfitBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const strict = aggregate(rows, 'strict', ctx.meta.recoveryRate);
      const recovery = aggregate(rows, 'recovery', ctx.meta.recoveryRate);
      const contractual = aggregate(rows, 'contractual', ctx.meta.recoveryRate);
      const option = barOption({
        categories: ['Strict write-off', 'Recovery 45%', 'Contractual'],
        series: [{ name: 'Profit', data: [strict.profit, recovery.profit, contractual.profit], color: COLORS.emerald }],
        yFormat: 'money',
        showLegend: false,
        label: true,
      });
      const downside = contractual.profit - strict.profit;
      return {
        option,
        insight: plain(
          'neutral',
          `Book profit ranges ${inrCompact(strict.profit)} to ${inrCompact(contractual.profit)}`,
          `The ${inrCompact(downside)} spread is entirely the treatment of active delinquency and unrecovered NPA. Quote the recovery case as the base and the strict case as the floor — never the contractual case alone.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Same book, three loss assumptions', span: o.span ?? 1, height: 280 },
  );
}

export function treemapDim(o: {
  id: string;
  title: string;
  section: string;
  dim: string;
  metric?: 'lent' | 'n';
  subtitle?: string;
  span?: 2 | 3;
  height?: number;
  limit?: number;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, {
        sortBy: o.metric ?? 'lent',
        xirr: false,
        limit: o.limit ?? 22,
      });
      const option = treemapOption({
        data: stats.map((s) => ({ name: s.label, value: o.metric === 'n' ? s.n : s.lent })),
        valueFormat: o.metric === 'n' ? 'num' : 'money',
        height: (o.height ?? 320) - 40,
      });
      return {
        option,
        insight: shareInsight(
          stats.map((s) => ({ name: s.label, value: o.metric === 'n' ? s.n : s.lent })),
          o.metric === 'n' ? 'loans' : 'capital',
          o.metric === 'n' ? 'num' : 'money',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Area is proportional to exposure', span: o.span ?? 2, height: o.height ?? 320 },
  );
}

export function paretoDim(o: {
  id: string;
  title: string;
  section: string;
  dim: string;
  subtitle?: string;
  span?: 2 | 3;
  height?: number;
  limit?: number;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, {
        sortBy: 'lent',
        xirr: false,
        limit: o.limit ?? 14,
      });
      const total = sum(stats, (s) => s.lent);
      let running = 0;
      const cumulative = stats.map((s) => {
        running += s.lent;
        return round((running / Math.max(1, total)) * 100, 2);
      });
      const option = comboOption({
        categories: stats.map((s) => s.label),
        bars: [{ name: 'Capital invested', data: stats.map((s) => s.lent), color: COLORS.cyan }],
        lines: [{ name: 'Cumulative share', data: cumulative, color: COLORS.amber, yAxisIndex: 1 }],
        barFormat: 'money',
        lineFormat: 'percent',
      });
      const firstAbove80 = cumulative.findIndex((v) => v >= 80);
      return {
        option,
        insight: plain(
          firstAbove80 >= 0 && firstAbove80 < 5 ? 'warning' : 'positive',
          firstAbove80 >= 0
            ? `${firstAbove80 + 1} groups cover 80% of capital`
            : 'Capital stays spread across the listed groups',
          `Pareto view of ${DIMENSIONS[o.dim].label.toLowerCase()}. Fewer groups to reach 80% means more concentration risk, but also a shorter list to fix.`,
          'INFO',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Concentration curve', span: o.span ?? 2, height: o.height ?? 280 },
  );
}

export function lorenzChart(o: { id: string; title: string; section: string; dim: string; subtitle?: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const groups = [...groupRows(rows, (l) => String(DIMENSIONS[o.dim].get(l))).values()].map((g) => sum(g, (l) => l.amount));
      const points = lorenz(groups);
      const giniValue = points.length ? 1 - 2 * points.reduce((s, p) => s + p.y, 0) / points.length : 0;
      const option = lorenzOption({ points, giniValue: Math.abs(giniValue) });
      return {
        option,
        insight: plain(
          Math.abs(giniValue) > 0.6 ? 'warning' : 'positive',
          `Gini ${Math.abs(giniValue).toFixed(2)} on ${DIMENSIONS[o.dim].label.toLowerCase()} exposure`,
          `0 is perfectly even, 1 is total concentration. Above 0.6 means a handful of ${DIMENSIONS[o.dim].label.toLowerCase()} groups carry the book, so a single shock hits the whole portfolio.`,
          Math.abs(giniValue) > 0.6 ? 'AVOID' : 'INFO',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Capital equality across groups', span: o.span ?? 1, height: 280 },
  );
}

export function gaugeChart(o: {
  id: string;
  title: string;
  section: string;
  label: string;
  value: (rows: Loan[], ctx: ViewContext) => number;
  max?: number;
  color?: string;
  subtitle?: string;
  span?: 1;
  height?: number;
  insight: (value: number) => { tone: 'positive' | 'warning' | 'negative' | 'neutral'; headline: string; detail: string; action?: 'PREFER' | 'AVOID' | 'WATCH' | 'INFO' };
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const value = o.value(rows, ctx);
      const option = gaugeOption({ value, max: o.max ?? 100, label: o.label, color: o.color ?? COLORS.emerald });
      return { option, insight: o.insight(value) };
    },
    { subtitle: o.subtitle, span: 1, height: o.height ?? 240 },
  );
}

export function heatMatrix(o: {
  id: string;
  title: string;
  section: string;
  xGet: (loan: Loan) => string;
  yGet: (loan: Loan) => string;
  value: 'badRate' | 'npaRate' | 'count' | 'lent' | 'avgAnr';
  subtitle?: string;
  span?: 2 | 3 | 4;
  height?: number;
  xName?: string;
  yName?: string;
  filter?: (loan: Loan) => boolean;
  yLimit?: number;
  xLimit?: number;
}): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const source = o.filter ? rows.filter(o.filter) : rows;
      let xLabels = [...new Set(source.map(o.xGet))].filter(Boolean);
      let yLabels = [...new Set(source.map(o.yGet))].filter(Boolean);
      if (o.xLimit) xLabels = xLabels.slice(0, o.xLimit);
      if (o.yLimit) yLabels = yLabels.slice(0, o.yLimit);
      const cells: { x: number; y: number; value: number; label?: string }[] = [];
      for (let yi = 0; yi < yLabels.length; yi += 1) {
        for (let xi = 0; xi < xLabels.length; xi += 1) {
          const group = source.filter((l) => o.xGet(l) === xLabels[xi] && o.yGet(l) === yLabels[yi]);
          if (!group.length) continue;
          const closed = group.filter(isClosed);
          const npa = group.filter(isNpa);
          let value = 0;
          if (o.value === 'badRate') value = (group.filter((l) => isNpa(l) || l.impaired).length / group.length) * 100;
          else if (o.value === 'npaRate') value = closed.length ? (npa.length / closed.length) * 100 : 0;
          else if (o.value === 'lent') value = sum(group, (l) => l.amount);
          else if (o.value === 'avgAnr') {
            const anr = group.map((l) => l.reportedAnr ?? NaN).filter(Number.isFinite);
            value = anr.length ? mean(anr, (v) => v) : 0;
          } else value = group.length;
          cells.push({ x: xi, y: yi, value: round(value, 2) });
        }
      }
      const option = heatmapOption({
        xLabels,
        yLabels,
        cells,
        valueFormat: o.value === 'lent' ? 'money' : o.value === 'count' ? 'num' : 'percent',
        xName: o.xName,
        yName: o.yName,
      });
      const worst = cells.reduce((a, b) => (b.value > a.value ? b : a), cells[0] ?? { x: 0, y: 0, value: 0 });
      return {
        option,
        insight: plain(
          'warning',
          `Hottest cell: ${yLabels[worst.y] ?? '—'} × ${xLabels[worst.x] ?? '—'}`,
          `Read the matrix for combinations, not just averages. ${o.value === 'count' || o.value === 'lent' ? 'Volume concentration' : 'Risk concentration'} in one cell is where a policy change pays for itself fastest.`,
          'WATCH',
        ),
      };
    },
    { subtitle: o.subtitle ?? 'Two-way interaction', span: o.span ?? 3, height: o.height ?? 340 },
  );
}

export function radarBook(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const gradeStats = categoryStats(rows, ctx.scenario, DIMENSIONS.grade, ctx.meta.recoveryRate, { xirr: false });
      const indicators = [
        { name: 'ANR', max: 45 },
        { name: 'Recovery', max: 100 },
        { name: 'Prepay', max: 100 },
        { name: 'Score', max: 820 },
        { name: 'Inverse NPA', max: 100 },
      ];
      const series = gradeStats.slice(0, 3).map((s) => ({
        name: s.label,
        value: [s.medianAnr, s.recoveryRate * 100, s.prepayRate, s.avgScore, 100 - s.npaRate],
        color: s.npaRate < 2 ? COLORS.emerald : s.npaRate < 5 ? COLORS.amber : COLORS.rose,
      }));
      const option = radarOption({ indicators, series });
      return {
        option,
        insight: plain(
          'neutral',
          'Grade radar: return and safety move together',
          'Compare shapes, not area. A wide ANR with a narrow recovery wedge means the extra yield is being paid for with losses.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Return, safety and behaviour by grade', span: o.span ?? 1, height: 300 },
  );
}

export function tenorBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS.tenure, ctx.meta.recoveryRate, { xirr: false });
      const option = barOption({
        categories: stats.map((s) => s.label),
        series: [
          { name: 'NPA rate', data: stats.map((s) => s.npaRate), color: COLORS.rose },
          { name: 'Prepay rate', data: stats.map((s) => s.prepayRate), color: COLORS.emerald },
        ],
        yFormat: 'percent',
      });
      return {
        option,
        insight: rankInsight(
          stats.map((s) => ({ label: s.label, value: s.npaRate, n: s.n })),
          { metric: 'NPA rate', kind: 'percent', higherIsBetter: false, subject: 'tenures' },
        ),
      };
    },
    { subtitle: 'Tenure drives both risk and exit speed', span: o.span ?? 2, height: 280 },
  );
}

export function loanScatterByOutcome(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const sample = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 800)) === 0);
      const points = sample.map((l) => ({
        x: l.score,
        y: l.rate,
        group: isNpa(l) ? 'NPA' : isActive(l) ? 'Active' : 'Closed clean',
        color: isNpa(l) ? COLORS.rose : undefined,
        value: l.amount,
      }));
      const option = scatterOption({
        points,
        xName: 'LDC score',
        yName: 'Borrower APR %',
        xFormat: 'num',
        yFormat: 'percent',
        categories: ['Closed clean', 'Active', 'NPA'],
      });
      return {
        option,
        insight: plain(
          'neutral',
          'NPA dots are not confined to the low-score corner',
          'High-score, high-APR loans still fail. Score is a filter, not a guarantee; the rate premium has to be sized against the observed default rate in each score band.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Score versus pricing, coloured by outcome', span: o.span ?? 2, height: 320 },
  );
}

export function activeMaturityLadder(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const active = rows.filter(isActive);
      const months = [...new Set(active.map((l) => (l.maturityMonth || '').slice(0, 7)))].filter(Boolean).sort();
      const principal = months.map((m) => round(sum(active.filter((l) => (l.maturityMonth || '').slice(0, 7) === m), (l) => l.pos), 2));
      const interest = months.map((m) => round(sum(active.filter((l) => (l.maturityMonth || '').slice(0, 7) === m), (l) => Math.max(0, l.futureInterest - l.futureFee)), 2));
      let running = 0;
      const cumulative = principal.map((p) => {
        running += p;
        return round(running, 2);
      });
      const option = lineOption({
        x: months,
        series: [
          { name: 'Principal maturing', data: principal, color: COLORS.cyan, area: true },
          { name: 'Interest due', data: interest, color: COLORS.emerald },
          { name: 'Cumulative principal', data: cumulative, color: COLORS.violet, dashed: true },
        ],
        yFormat: 'money',
      });
      const total = principal.reduce((s, v) => s + v, 0);
      const front = months.length ? (principal[0] / Math.max(1, total)) * 100 : 0;
      return {
        option,
        insight: plain(
          front > 40 ? 'warning' : 'positive',
          `${pct(front)} of outstanding principal matures in ${months[0] ?? 'the first month'}`,
          `Total active principal ${inrCompact(total)} across ${num(months.length)} maturity months. Lumpy maturities create reinvestment risk: cash returns all at once and sits idle if there is no pipeline.`,
          front > 40 ? 'WATCH' : 'INFO',
        ),
      };
    },
    { subtitle: 'When the active book turns back into cash', span: o.span ?? 2, height: 300 },
  );
}

export function dpsBucketBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const buckets = ['0 DPD', '1–30 DPD', '31–60 DPD', '61–90 DPD', '90+ DPD'];
      const active = rows.filter(isActive);
      const counts = buckets.map((_, i) => active.filter((l) => l.dpdBucket === i).length);
      const pos = buckets.map((_, i) => round(sum(active.filter((l) => l.dpdBucket === i), (l) => l.pos), 2));
      const option = barOption({
        categories: buckets,
        series: [
          { name: 'Loans', data: counts, color: COLORS.cyan },
          { name: 'Principal', data: pos, color: COLORS.amber, type: 'line', yAxisIndex: 0 },
        ],
        yFormat: 'num',
        label: true,
      });
      const overdue = counts.slice(1).reduce((s, v) => s + v, 0);
      return {
        option,
        insight: plain(
          overdue > active.length * 0.05 ? 'warning' : 'positive',
          `${num(overdue)} of ${num(active.length)} active loans sit past due`,
          `Delinquency buckets are the early-warning system. Anything rolling from 1–30 into 31–60 is the leading indicator of next quarter's NPA, so watch the migration, not the stock.`,
          overdue > active.length * 0.05 ? 'WATCH' : 'INFO',
        ),
      };
    },
    { subtitle: 'Active book delinquency buckets', span: o.span ?? 1, height: 280 },
  );
}

export function monthlyNpaStack(o: { id: string; title: string; section: string; span?: 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const months = monthlyStats(rows, ctx.scenario);
      const option = barOption({
        categories: months.map((m) => m.label),
        series: [
          { name: 'Closed', data: months.map((m) => m.closed), color: COLORS.emerald },
          { name: 'Active', data: months.map((m) => m.active), color: COLORS.cyan },
          { name: 'NPA', data: months.map((m) => m.npa), color: COLORS.rose },
        ],
        stack: true,
        yFormat: 'num',
      });
      const recent = months.slice(-3);
      const recentNpa = recent.reduce((s, m) => s + m.npa, 0);
      return {
        option,
        insight: plain(
          recentNpa > 20 ? 'warning' : 'neutral',
          `${num(recentNpa)} NPAs came from the last three cohorts`,
          'Young cohorts look clean because they have not seasoned. Judge mix by closed loans per cohort, and never compare a 2-month-old vintage with a 12-month-old one on raw NPA rate.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Cohort composition by outcome', span: o.span ?? 2, height: 300 },
  );
}

export function roiTimeline(o: { id: string; title: string; section: string; span?: 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const months = monthlyStats(rows, ctx.scenario, true);
      const values = months.map((m) => (m.xirr === null ? 0 : round(m.xirr, 2)));
      const option = lineOption({
        x: months.map((m) => m.label),
        series: [{ name: 'Money-weighted XIRR', data: values, color: COLORS.emerald, area: true }],
        yFormat: 'percent',
        showLegend: false,
      });
      return {
        option,
        insight: withCoverage(
          trendInsight(months.map((m) => m.label), values, 'cohort XIRR', 'percent', true),
          rows.length / Math.max(1, months.length),
          12,
        ),
      };
    },
    { subtitle: 'XIRR by disbursement cohort', span: o.span ?? 2, height: 280 },
  );
}

export function feeChart(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const months = monthlyStats(rows, ctx.scenario);
      const fee = months.map((m) => round(sum(rows.filter((l) => l.disbMonth === m.month), (l) => l.fee), 2));
      const interest = months.map((m) => round(sum(rows.filter((l) => l.disbMonth === m.month), (l) => l.interestRec), 2));
      const option = lineOption({
        x: months.map((m) => m.label),
        series: [
          { name: 'Fees paid', data: fee, color: COLORS.orange, area: true },
          { name: 'Interest received', data: interest, color: COLORS.emerald },
        ],
        yFormat: 'money',
      });
      const totalFee = fee.reduce((s, v) => s + v, 0);
      const totalInterest = interest.reduce((s, v) => s + v, 0);
      return {
        option,
        insight: plain(
          totalInterest > totalFee ? 'positive' : 'warning',
          `Fees equal ${pct((totalFee / Math.max(1, totalInterest)) * 100)} of interest received`,
          `Platform fees cost ${inrCompact(totalFee)} against ${inrCompact(totalInterest)} of interest. Fees are charged up front, so they hit short tenures hardest and drag annualised return even when the loan performs.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Platform cost against interest earned', span: o.span ?? 2, height: 280 },
  );
}

export function returnMethodsBar(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const rm = ctx.meta.returnMethods.recomputed;
      const labels = ['Platform ANR', 'Capital-time', 'Closed XIRR', 'Naive loan mean'];
      const values = [ctx.meta.returnMethods.officialClosedAnr, rm.closedCapitalTimeAnnualPct, (rm.closedPortfolioXirr ?? 0), rm.closedNaiveMeanAnr];
      const option = barOption({
        categories: labels,
        series: [{ name: 'Annualised return %', data: values.map((v) => round(v, 2)), color: COLORS.emerald }],
        yFormat: 'percent',
        showLegend: false,
        label: true,
      });
      const spread = Math.max(...values) - Math.min(...values);
      return {
        option,
        insight: plain(
          'warning',
          `Four defensible answers span ${pct(spread)}`,
          `Platform ANR ${pct(values[0])} is the booked number, capital-time ${pct(values[1])} accounts for idle cash, XIRR ${pct(values[2])} weights actual timing, and the naive mean ${pct(values[3])} overweights small loans. Use XIRR for decisions.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Why "return" needs a definition', span: o.span ?? 2, height: 280 },
  );
}

export function opportunityTable(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const loans = ctx.meta.availableLoans.slice(0, 12);
      return {
        option: {},
        insight: plain(
          'positive',
          `${num(ctx.meta.availableLoans.length)} live marketplace loans were captured`,
          'Use the Opportunities tab to filter by score, tenure and remaining amount, then size positions against the policy limits tested on this book.',
          'PREFER',
        ),
        table: {
          columns: [
            { key: 'name', label: 'Borrower' },
            { key: 'loanAmount', label: 'Loan', align: 'right', type: 'money' },
            { key: 'remainingPct', label: 'Open %', align: 'right', type: 'percent' },
            { key: 'score', label: 'Score', align: 'right', type: 'int' },
            { key: 'tenure', label: 'Tenure', align: 'right', type: 'int' },
            { key: 'rate', label: 'APR', align: 'right', type: 'percent' },
          ],
          rows: loans.map((l) => ({ ...l })),
        },
      };
    },
    { subtitle: 'Snapshot from the last scrape', span: o.span ?? 2, height: 300 },
  );
}

// ---------------------------------------------------------------------------
// Small helpers used by page configs
// ---------------------------------------------------------------------------
export function topBorrowersTable(o: { id: string; title: string; section: string; span?: 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const groups = groupRows(rows, (l) => l.borrowerKey);
      const list = [...groups.entries()]
        .map(([key, group]) => ({
          key,
          name: group[0].name,
          city: group[0].city,
          loans: group.length,
          lent: round(sum(group, (l) => l.amount), 2),
          profit: round(sum(group, (l) => scenarioProfit(l, ctx.scenario)), 2),
          npa: group.filter(isNpa).length,
        }))
        .sort((a, b) => b.lent - a.lent)
        .slice(0, 15);
      return {
        option: {},
        insight: plain(
          list.length && list[0].lent > 20000 ? 'warning' : 'neutral',
          list.length ? `${list[0].name} is the largest borrower exposure at ${inrCompact(list[0].lent)}` : 'No borrowers in this slice',
          `Names are published as requested; PAN, phone, email and agreement links are stripped. Repeat exposure is the hidden concentration risk — a borrower with five loans is one default, not five independent bets.`,
          'INFO',
        ),
        table: {
          columns: [
            { key: 'name', label: 'Borrower' },
            { key: 'city', label: 'City' },
            { key: 'loans', label: 'Loans', align: 'right', type: 'int' },
            { key: 'lent', label: 'Invested', align: 'right', type: 'money' },
            { key: 'profit', label: 'Profit', align: 'right', type: 'money' },
            { key: 'npa', label: 'NPA', align: 'right', type: 'int' },
          ],
          rows: list,
        },
      };
    },
    { subtitle: 'Largest exposures, name published by design', span: o.span ?? 2, height: 320 },
  );
}

// ---------------------------------------------------------------------------
// Exposure-adjusted risk: raw NPA beside the annualised rate
// ---------------------------------------------------------------------------
export function hazardBars(o: { id: string; title: string; section: string; dim: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const stats = categoryStats(rows, 'recovery', DIMENSIONS[o.dim], 0.45, { sortBy: 'n', minN: 20 });
      const option = barOption({
        categories: stats.map((s) => s.label),
        series: [
          { name: 'Raw NPA %', data: stats.map((s) => s.npaRate), color: COLORS.rose },
          { name: 'Annualised default rate %', data: stats.map((s) => s.annualisedNpaRate), color: COLORS.amber },
        ],
        yFormat: 'percent',
      });
      const worst = [...stats].sort((a, b) => b.annualisedNpaRate - a.annualisedNpaRate)[0];
      const rawWorst = [...stats].sort((a, b) => b.npaRate - a.npaRate)[0];
      const flip = worst && rawWorst && worst.label !== rawWorst.label;
      return {
        option,
        insight: plain(
          worst && worst.annualisedNpaRate > 20 ? 'warning' : 'neutral',
          `Worst bucket: ${worst?.label ?? '—'} at ${worst?.annualisedNpaRate ?? 0}% a year`,
          `Raw NPA points at ${rawWorst?.label ?? '—'} (${rawWorst?.npaRate ?? 0}%), but the annualised rate points at ${worst?.label ?? '—'} (${worst?.annualisedNpaRate ?? 0}%)${flip ? ' — the ranking changes once time is accounted for, so trust the annualised number.' : '.'} Defaults per 1,000 loan-months: ${stats.map((s) => `${s.label} ${s.npaPer1000LoanMonths}`).join(' · ')}`,
          'AVOID',
        ),
      };
    },
    { subtitle: 'Raw NPA beside the same risk annualised to a common clock', span: o.span ?? 2, height: 300 },
  );
}

export function hazardLine(o: { id: string; title: string; section: string; dim: string; span?: 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const stats = categoryStats(rows, 'recovery', DIMENSIONS[o.dim], 0.45, { sortBy: 'n', minN: 20 });
      const option = lineOption({
        x: stats.map((s) => s.label),
        series: [
          { name: 'Defaults per 1,000 loan-months', data: stats.map((s) => s.npaPer1000LoanMonths), color: COLORS.rose, area: true },
        ],
        yFormat: 'num',
        showLegend: false,
      });
      const worst = [...stats].sort((a, b) => b.npaPer1000LoanMonths - a.npaPer1000LoanMonths)[0];
      const best = [...stats].sort((a, b) => a.npaPer1000LoanMonths - b.npaPer1000LoanMonths)[0];
      const ratio = worst && best && best.npaPer1000LoanMonths > 0 ? Math.round(worst.npaPer1000LoanMonths / best.npaPer1000LoanMonths) : null;
      return {
        option,
        insight: plain(
          'neutral',
          `Best to worst: ${ratio ? `${ratio}×` : '—'} spread across this dimension`,
          `Lowest exposure risk is ${best?.label ?? '—'} at ${best?.npaPer1000LoanMonths ?? 0} defaults per 1,000 loan-months, highest is ${worst?.label ?? '—'} at ${worst?.npaPer1000LoanMonths ?? 0}. Each unit is a month of principal at risk — multiply by 12 for a year.`,
          ratio && ratio >= 3 ? 'AVOID' : 'INFO',
        ),
      };
    },
    { subtitle: 'Defaults per 1,000 loan-months at risk', span: o.span ?? 2, height: 280 },
  );
}

export function seasoningHazard(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const months = [...new Set(rows.map((l) => l.disbMonth))].sort().slice(-9);
      const buckets = Array.from({ length: 9 }, (_, i) => Math.round((i + 1) * 30.44));
      const series = months.map((month) => {
        const group = rows.filter((l) => l.disbMonth === month);
        const data = buckets.map((limit) => {
          const inWindow = group.filter((l) => (l.status !== 0 ? l.holdingDays >= limit : l.vintageDays >= limit));
          if (!inWindow.length) return null;
          return round((inWindow.filter((l) => l.npa === 1).length / inWindow.length) * 100, 2);
        });
        return { name: month, data };
      });
      const option = lineOption({
        x: buckets.map((b) => `${Math.round(b / 30.44)}M`),
        series: series.map((s) => ({ ...s, data: s.data as (number | null)[] })),
        yFormat: 'percent',
        showLegend: months.length <= 5,
      });
      const seasoned = series.filter((s) => s.data.every((v) => v !== null));
      const first = seasoned[0];
      return {
        option,
        insight: plain(
          'neutral',
          `Cumulative default rate by seasoning month`,
          first
            ? `${first.name} reaches ${first.data[first.data.length - 1]}% NPA after ${Math.round(buckets[buckets.length - 1] / 30.44)} months; ${seasoned.length} cohorts are fully observable. This is the only honest way to compare a 2-month loan with a 12-month one — raw NPA by cohort always favours the short one.`
            : 'No fully observable cohort in this slice.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Cumulative NPA as each cohort ages, per seasoning month', span: o.span ?? 2, height: 300 },
  );
}

export function xirrSpread(o: { id: string; title: string; section: string; span?: 2 }): ChartSpec {  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const values = rows
        .filter((l) => isClosed(l) && l.holdingDays >= 30)
        .map((l) => (ctx.scenario === 'strict' ? l.xirrStrict : ctx.scenario === 'recovery' ? l.xirrRecovery : l.xirrContractual))
        .filter((v): v is number => v !== null && Number.isFinite(v) && v <= 300);
      const bins = histogram(values, 26);
      const option = histOption({ bins, xName: 'Loan-level XIRR %', xFormat: 'percent', color: COLORS.emerald });
      return { option, insight: distInsight(values, 'loan-level XIRR (30+ days held)', 'percent') };
    },
    { subtitle: 'Closed loans held ≥30 days; extreme annualised outliers above 300% excluded', span: o.span ?? 2, height: 280 },
  );
}

export function cohortCumulative(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const groups = groupRows(rows, (l) => l.disbMonth);
      const months = [...groups.keys()].sort();
      const series = months.slice(-6).map((month, idx) => {
        const group = groups.get(month) ?? [];
        const bySeason = [0, 1, 2, 3, 4, 5, 6].map((m) => {
          const inWindow = group.filter((l) => l.vintageDays >= m * 30);
          if (!inWindow.length) return null;
          const bad = inWindow.filter((l) => isNpa(l) || l.impaired).length;
          return round((bad / inWindow.length) * 100, 2);
        });
        return { name: month, data: bySeason, color: [COLORS.emerald, COLORS.cyan, COLORS.violet, COLORS.amber, COLORS.rose, COLORS.blue][idx % 6] };
      });
      const option = lineOption({
        x: ['0M', '1M', '2M', '3M', '4M', '5M', '6M'],
        series: series.map((s) => ({ ...s, data: s.data as (number | null)[] })),
        yFormat: 'percent',
        showLegend: true,
      });
      return {
        option,
        insight: plain(
          'warning',
          'Impairment accumulates with seasoning',
          `Each line is a disbursement cohort followed forward. Curves that start above zero were already delinquent at disbursement; curves that steepen after month 2 point to collection problems rather than selection.`,
          'WATCH',
        ),
      };
    },
    { subtitle: 'Bad rate by months since disbursement', span: o.span ?? 2, height: 300 },
  );
}

export function tenureHeat(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return heatMatrix({
    id: o.id,
    title: o.title,
    section: o.section,
    xGet: (l) => l.disbMonth,
    yGet: (l) => `${l.tenure}M`,
    value: 'badRate',
    span: o.span ?? 3,
    xName: 'Disbursement month',
    yName: 'Tenure',
    height: 360,
  });
}

export function policyFrontier(
  _selector: (ctx: ViewContext) => unknown,
  o: { id: string; title: string; section: string; span?: 2 | 3 },
): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const grid = ctx.model.policyGrid.filter((p) => p.loans >= 100);
      const points = grid.map((p) => ({
        x: round(p.npaRate * 100, 2),
        y: round(p.xirr ?? 0, 2),
        group: `${p.maxTenure}M cap`,
        value: p.loans,
        name: `score ≥${p.minScore}, tenure ≤${p.maxTenure}M`,
        color: p.npaRate <= 0.03 ? COLORS.emerald : p.npaRate <= 0.06 ? COLORS.amber : COLORS.rose,
      }));
      const option = scatterOption({
        points,
        xName: 'NPA rate %',
        yName: 'XIRR %',
        xFormat: 'percent',
        yFormat: 'percent',
        categories: [...new Set(points.map((p) => p.group))],
      });
      return {
        option,
        insight: plain(
          'neutral',
          `${num(grid.length)} policies on the risk-return frontier`,
          'Each dot is a full book replay. Upper-left is the sweet spot: high XIRR with low NPA. The vertical spread at any NPA level shows how much pricing and tenure matter beyond default avoidance.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Full book replay of every score × tenure policy', span: o.span ?? 2, height: 320 },
  );
}

export function percentileChart(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const sample = rows.filter(isClosed).filter((l) => l.npa !== 1);
      const values = sample.map((l) => l.reportedAnr ?? NaN).filter(Number.isFinite);
      const qs = [5, 10, 25, 50, 75, 90, 95];
      const data = qs.map((q) => round(percentile(values, q), 2));
      const option = barOption({
        categories: qs.map((q) => `p${q}`),
        series: [{ name: 'Reported ANR', data, color: COLORS.emerald, type: 'line' }],
        yFormat: 'percent',
        showLegend: false,
        label: true,
      });
      const avg = values.length ? mean(values, (v) => v) : 0;
      return {
        option,
        insight: plain(
          'neutral',
          `Closed-loan ANR runs from ${pct(data[0])} at p5 to ${pct(data[data.length - 1])} at p95`,
          `The median performing loan returned ${pct(data[3])} and the mean ${pct(avg)}. Defaulted loans are excluded here — they report a write-off, not a return — so this curve is the performing book only.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Percentiles of realised annualised return, performing loans only', span: o.span ?? 1, height: 280 },
  );
}

export function monthlyHeatCalendar(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const cells = rows.map((l) => [l.disb, l.amount] as [string, number]);
      const byDay = new Map<string, number>();
      for (const [date, amount] of cells) byDay.set(date, (byDay.get(date) ?? 0) + amount);
      const data = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
      const year = data.length ? data[0][0].slice(0, 4) : '2026';
      const option = {
        ...lineOption({ x: data.map((d) => d[0]), series: [{ name: 'Daily deployment', data: data.map((d) => round(d[1], 2)), color: COLORS.cyan, area: true }], yFormat: 'money', showLegend: false }),
        graphic: [
          {
            type: 'text',
            right: 16,
            top: 8,
            style: { text: `${year} deployment rhythm`, fill: '#7c8ba1', fontSize: 10, fontFamily: 'Manrope' },
          },
        ],
      };
      const peak = data.reduce((a, b) => (b[1] > a[1] ? b : a), data[0] ?? ['—', 0]);
      return {
        option,
        insight: plain(
          'neutral',
          `Largest single-day deployment ${inrCompact(peak[1])} on ${peak[0]}`,
          'Daily deployment spikes reveal bulk actions rather than organic origination. A ₹5.7L day is an operational event, not a credit signal — exclude it before reading trend lines.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Daily investment rhythm', span: o.span ?? 2, height: 280 },
  );
}

export function concentrationSummary(o: { id: string; title: string; section: string; span?: 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS.state, ctx.meta.recoveryRate, { xirr: false, sortBy: 'lent' });
      const top = stats.slice(0, 10);
      const option = barOption({
        categories: top.map((s) => s.label),
        series: [
          { name: 'Capital', data: top.map((s) => s.lent), color: COLORS.cyan },
          { name: 'Expected loss', data: top.map((s) => s.loss), color: COLORS.rose },
        ],
        stack: false,
        yFormat: 'money',
      });
      const total = sum(stats, (s) => s.lent);
      const top3 = sum(top.slice(0, 3), (s) => s.lent);
      return {
        option,
        insight: plain(
          top3 / Math.max(1, total) > 0.55 ? 'warning' : 'positive',
          `Top three states hold ${pct((top3 / Math.max(1, total)) * 100)} of capital`,
          `Loss bars sit beside exposure so you can see whether a state is big or just bad. A small state with a tall loss bar is a pricing problem; a big state with a short bar is a capacity decision.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Exposure against expected loss by state', span: o.span ?? 2, height: 300 },
  );
}

export function forwardFan(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const proj = forwardProjection(rows, ctx.scenario, ctx.meta, ctx.model, 1200);
      const final = proj.months.length ? proj.months[proj.months.length - 1].cumulativeProfit : 0;
      const downside = Math.max(0, final - proj.monteCarlo.p10);
      const upside = Math.max(0, proj.monteCarlo.p90 - final);
      const p10: number[] = [];
      const p50: number[] = [];
      const p90: number[] = [];
      for (const m of proj.months) {
        const progress = final !== 0 ? Math.max(0, Math.min(1.2, m.cumulativeProfit / final)) : 0;
        p50.push(round(m.cumulativeProfit, 2));
        p10.push(round(m.cumulativeProfit - downside * progress, 2));
        p90.push(round(m.cumulativeProfit + upside * progress, 2));
      }
      const option = fanOption({ months: proj.months.map((m) => m.month), p10, p50, p90 });
      return {
        option,
        insight: plain(
          proj.futureProfit > 0 ? 'positive' : 'warning',
          `Forward profit ${inrCompact(proj.futureProfit)} on ${inrCompact(proj.pos)} outstanding`,
          `Monte Carlo over ${num(1200)} draws puts the p10–p90 band at ${inrCompact(proj.monteCarlo.p10)} to ${inrCompact(proj.monteCarlo.p90)}. The band widens with time because both defaults and recovery timing are uncertain.`,
          proj.futureProfit > 0 ? 'PREFER' : 'WATCH',
        ),
      };
    },
    { subtitle: 'Cumulative profit with a simulated uncertainty band', span: o.span ?? 2, height: 320 },
  );
}

export function monteCarloChart(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const proj = forwardProjection(rows, ctx.scenario, ctx.meta, ctx.model, 1500);
      const bins = proj.monteCarlo.histogram;
      const width = bins.length > 1 ? bins[1].x - bins[0].x : 1;
      const option = histOption({
        bins: bins.map((b) => ({ x: b.x, count: b.count, from: b.x - width / 2, to: b.x + width / 2 })),
        xName: 'Total book profit (₹)',
        xFormat: 'money',
        color: COLORS.violet,
      });
      const spread = proj.monteCarlo.p90 - proj.monteCarlo.p10;
      return {
        option,
        insight: plain(
          'neutral',
          `Simulated profit centres on ${inrCompact(proj.monteCarlo.p50)}`,
          `80% of draws land between ${inrCompact(proj.monteCarlo.p10)} and ${inrCompact(proj.monteCarlo.p90)}, a ${inrCompact(spread)} spread. If that range is uncomfortable, the fix is smaller tickets or shorter tenure, not a better forecast.`,
          'INFO',
        ),
      };
    },
    { subtitle: '1,500 draws with default and recovery shocks', span: o.span ?? 1, height: 300 },
  );
}

export function projectionBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const active = rows.filter(isActive);
      const vals = ['contractual', 'recovery', 'strict'].map((s) =>
        round(sum(active, (l) => futureProfitFor(l, s as 'contractual' | 'recovery' | 'strict')), 2),
      );
      const option = barOption({
        categories: ['Contractual', 'Recovery 45%', 'Strict'],
        series: [{ name: 'Forward profit', data: vals, color: COLORS.emerald }],
        yFormat: 'money',
        showLegend: false,
        label: true,
      });
      return {
        option,
        insight: plain(
          'neutral',
          `Forward profit ranges ${inrCompact(vals[2])} to ${inrCompact(vals[0])}`,
          `Active principal is ${inrCompact(sum(active, (l) => l.pos))}. The gap between contractual and strict is the delinquency you have not written off yet.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Remaining profit on the live book', span: o.span ?? 1, height: 280 },
  );
}

function futureProfitFor(loan: Loan, scenario: 'contractual' | 'recovery' | 'strict'): number {
  if (!isActive(loan)) return 0;
  const profit = scenario === 'strict' ? loan.profitStrict : scenario === 'recovery' ? loan.profitRecovery : loan.profitContractual;
  return round(profit - loan.netProfit, 2);
}

export function waterfallLoss(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows): ChartResult => {
      const npaRows = rows.filter(isNpa);
      const principal = round(sum(npaRows, (l) => l.amount), 2);
      const recovered = round(sum(npaRows, (l) => l.received), 2);
      const written = round(sum(npaRows, (l) => l.npaAmount), 2);
      const items = [
        { name: 'Principal in NPA', value: principal, type: 'total' as const },
        { name: 'Cash recovered', value: recovered },
        { name: 'Written off', value: -written },
        { name: 'Recovery rate', value: round(principal - written, 2), type: 'total' as const },
      ];
      const option = waterfallOption({ items });
      return {
        option,
        insight: plain(
          written / Math.max(1, principal) > 0.5 ? 'negative' : 'warning',
          `${pct((written / Math.max(1, principal)) * 100)} of NPA principal was written off`,
          `${inrCompact(principal)} went into ${num(npaRows.length)} loans that failed; ${inrCompact(recovered)} came back. Recovery is the difference between a bad loan and a total loss.`,
          'WATCH',
        ),
      };
    },
    { subtitle: 'Cash recovered against principal lost', span: o.span ?? 2, height: 280 },
  );
}

// ---------------------------------------------------------------------------
// Scorecard charts
// ---------------------------------------------------------------------------
export function rocChart(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const option = rocOption({ points: ctx.model.roc, auc: ctx.model.metrics.auc });
      return {
        option,
        insight: plain(
          ctx.model.metrics.auc > 0.7 ? 'positive' : 'warning',
          `AUC ${ctx.model.metrics.auc.toFixed(3)} on held-out data`,
          `At a 10% false-positive rate the model catches roughly ${pct((ctx.model.roc.find((p) => p.fpr >= 0.1)?.tpr ?? 0) * 100)} of bad loans. Cross-validated AUC is ${ctx.model.metrics.cvAuc.toFixed(3)}, so this is not a lucky split.`,
          ctx.model.metrics.auc > 0.7 ? 'PREFER' : 'WATCH',
        ),
      };
    },
    { subtitle: 'True positives against false positives', span: o.span ?? 1, height: 300 },
  );
}

export function liftChart(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const option = liftOption({ data: ctx.model.lift });
      const first = ctx.model.lift[0];
      const last = ctx.model.lift[ctx.model.lift.length - 1];
      return {
        option,
        insight: plain(
          'positive',
          `Worst decile fails ${first ? (first.badRate * 100).toFixed(1) : '—'}% against ${last ? (last.badRate * 100).toFixed(1) : '—'}% in the best`,
          `Lift of ${first ? first.lift.toFixed(1) : '—'}× in D1 means the model concentrates bad loans where it should. Use the top two deciles as a manual-review queue rather than an automatic reject.`,
          'PREFER',
        ),
      };
    },
    { subtitle: 'Bad rate and lift by score decile', span: o.span ?? 1, height: 300 },
  );
}

export function calibrationChart(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const bins = ctx.model.calibration;
      const option = lineOption({
        x: bins.map((b) => b.predicted.toFixed(2)),
        series: [
          { name: 'Actual', data: bins.map((b) => round(b.actual * 100, 2)), color: COLORS.emerald },
          { name: 'Predicted', data: bins.map((b) => round(b.predicted * 100, 2)), color: COLORS.amber, dashed: true },
        ],
        yFormat: 'percent',
        showLegend: true,
      });
      const gap = bins.reduce((s, b) => s + Math.abs(b.actual - b.predicted), 0) / Math.max(1, bins.length);
      return {
        option,
        insight: plain(
          gap < 0.04 ? 'positive' : 'warning',
          `Mean calibration gap ${pct(gap * 100)}`,
          `Points above the diagonal mean the model under-predicts risk; below means it over-predicts. Brier ${ctx.model.metrics.brier.toFixed(3)}. Probabilities are good enough to rank and rough-size, not to quote as exact PDs.`,
          gap < 0.04 ? 'INFO' : 'WATCH',
        ),
      };
    },
    { subtitle: 'Predicted PD against observed bad rate', span: o.span ?? 1, height: 300 },
  );
}

export function confusionHeat(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const c = ctx.model.metrics.confusion;
      const option = heatmapOption({
        xLabels: ['Predicted good', 'Predicted bad'],
        yLabels: ['Actual good', 'Actual bad'],
        cells: [
          { x: 0, y: 0, value: c.tn },
          { x: 1, y: 0, value: c.fp },
          { x: 0, y: 1, value: c.fn },
          { x: 1, y: 1, value: c.tp },
        ],
        valueFormat: 'num',
        max: Math.max(c.tn, c.fp, c.fn, c.tp),
      });
      return {
        option,
        insight: plain(
          c.fp > c.tp * 3 ? 'warning' : 'neutral',
          `${num(c.fp)} good loans flagged versus ${num(c.tp)} bad loans caught`,
          `At the default 0.5 cut-off the model is a recall tool, not a precision tool: it catches ${pct((c.tp / Math.max(1, c.tp + c.fn)) * 100)} of bad loans while rejecting a lot of good ones. That is why the policy uses a score floor, not the raw probability.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Threshold 0.5, held-out set', span: o.span ?? 1, height: 260 },
  );
}

export function metricsBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const m = ctx.model.metrics;
      const labels = ['Accuracy', 'Precision', 'Recall', 'F1', 'AUC', 'KS'];
      const values = [m.accuracy * 100, m.precision * 100, m.recall * 100, m.f1 * 100, m.auc * 100, m.ks * 100];
      const option = barOption({
        categories: labels,
        series: [{ name: 'Score', data: values.map((v) => round(v, 1)), color: COLORS.cyan }],
        yFormat: 'percent',
        showLegend: false,
        label: true,
      });
      return {
        option,
        insight: plain(
          'warning',
          `Recall ${pct(m.recall * 100)} but precision only ${pct(m.precision * 100)}`,
          'The model is deliberately tuned to catch bad loans. Every false positive is foregone interest, which is cheaper than a write-off but not free. Set the threshold from the business cost ratio, not from accuracy.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Held-out classification performance', span: o.span ?? 1, height: 280 },
  );
}

export function coefficientBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const coefs = [...ctx.model.coefficients].sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef));
      const option = barOption({
        categories: coefs.map((c) => c.label),
        series: [{ name: 'Standardised coefficient', data: coefs.map((c) => round(c.coef, 3)), color: COLORS.violet }],
        horizontal: true,
        showLegend: false,
      });
      const top = coefs[0];
      return {
        option,
        insight: plain(
          'neutral',
          `${top.label} carries the largest weight (${top.coef.toFixed(2)})`,
          `Positive coefficients raise PD. Because inputs are standardised, magnitudes are comparable. A sign that fights economic logic is a red flag even when AUC looks fine.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Positive raises default probability', span: o.span ?? 1, height: 320 },
  );
}

export function ivBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const groups = [...ctx.model.woe].sort((a, b) => b.iv - a.iv);
      const option = barOption({
        categories: groups.map((g) => g.label),
        series: [{ name: 'Information value', data: groups.map((g) => round(g.iv, 3)), color: COLORS.cyan }],
        horizontal: true,
        showLegend: false,
      });
      const strong = groups.filter((g) => g.iv >= 0.3).length;
      return {
        option,
        insight: plain(
          'neutral',
          `${strong} features clear the 0.30 IV bar`,
          'IV above 0.3 is strong, 0.1–0.3 is moderate, below 0.02 is noise. High IV can also mean leakage or a proxy for the outcome — check the bin logic before trusting it.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Univariate predictive strength', span: o.span ?? 1, height: 320 },
  );
}

export function woeChart(o: { id: string; title: string; section: string; feature: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const group = ctx.model.woe.find((g) => g.key === o.feature) ?? ctx.model.woe[0];
      if (!group) {
        return { option: {}, insight: plain('neutral', 'No weight-of-evidence data', 'The model file does not contain this feature.', 'INFO') };
      }
      const option = comboOption({
        categories: group.bins.map((b) => b.bin),
        bars: [{ name: 'Bad rate', data: group.bins.map((b) => round(b.badRate * 100, 2)), color: COLORS.rose }],
        lines: [{ name: 'WOE', data: group.bins.map((b) => round(b.woe, 2)), color: COLORS.cyan, yAxisIndex: 1 }],
        barFormat: 'num',
        lineFormat: 'num',
      });
      const worst = [...group.bins].sort((a, b) => b.badRate - a.badRate)[0];
      return {
        option,
        insight: plain(
          'warning',
          worst ? `${worst.bin} is the worst bin at ${pct(worst.badRate * 100)} bad` : 'No bins',
          `Weight of evidence converts each bin into a monotonic risk score. Monotonicity matters more than the raw spread: if the WOE jumps around, the binning is overfit. IV ${group.iv.toFixed(2)}.`,
          'INFO',
        ),
      };
    },
    { subtitle: 'Bad rate and weight of evidence by bin', span: o.span ?? 1, height: 300 },
  );
}

export function policyHeat(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const grid = ctx.model.policyGrid.filter((p) => p.loans >= 50);
      const scores = [...new Set(grid.map((p) => p.minScore))].sort((a, b) => a - b);
      const tenures = [...new Set(grid.map((p) => p.maxTenure))].sort((a, b) => a - b);
      const cells: { x: number; y: number; value: number }[] = [];
      for (let yi = 0; yi < scores.length; yi += 1) {
        for (let xi = 0; xi < tenures.length; xi += 1) {
          const p = grid.find((g) => g.minScore === scores[yi] && g.maxTenure === tenures[xi]);
          if (p) cells.push({ x: xi, y: yi, value: round(p.npaRate * 100, 2) });
        }
      }
      const option = heatmapOption({
        xLabels: tenures.map((t) => `≤${t}M`),
        yLabels: scores.map((s) => `≥${s}`),
        cells,
        valueFormat: 'percent',
        xName: 'Tenure cap',
        yName: 'Score floor',
      });
      return {
        option,
        insight: plain(
          'warning',
          'Tenure cap does more than the score floor in the middle of the grid',
          'Reading down a column shows the effect of raising the score floor; reading across a row shows the tenure effect. Blank cells were not tested because too few loans survived the rule.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Closed-book replay, NPA rate', span: o.span ?? 2, height: 320 },
  );
}

export function policyTable(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const grid = [...ctx.model.policyGrid].sort((a, b) => (b.xirr ?? -999) - (a.xirr ?? -999)).slice(0, 40);
      return {
        option: {},
        insight: plain(
          'neutral',
          `${num(ctx.model.policyGrid.length)} tested rule combinations`,
          'Sorted by XIRR. Every row is a full replay on the closed book, so it inherits survivorship and the assumption that history repeats. Use it to shortlist, not to certify.',
          'INFO',
        ),
        table: {
          columns: [
            { key: 'minScore', label: 'Score', align: 'right', type: 'int' },
            { key: 'maxTenure', label: 'Tenure', align: 'right', type: 'int' },
            { key: 'loans', label: 'Loans', align: 'right', type: 'int' },
            { key: 'approval', label: 'Approval', align: 'right', type: 'percent' },
            { key: 'npa', label: 'NPA', align: 'right', type: 'percent' },
            { key: 'anr', label: 'ANR', align: 'right', type: 'percent' },
            { key: 'xirr', label: 'XIRR', align: 'right', type: 'percent' },
          ],
          rows: grid.map((p) => ({
            minScore: p.minScore,
            maxTenure: p.maxTenure,
            loans: p.loans,
            approval: round(p.approvalRate * 100, 1),
            npa: round(p.npaRate * 100, 2),
            anr: p.avgReportedAnr,
            xirr: p.xirr,
          })),
        },
      };
    },
    { subtitle: 'Score floor × tenure cap, sorted by XIRR', span: o.span ?? 3, height: 360 },
  );
}

export function recommendedPolicies(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const rec = ctx.model.recommendedPolicies;
      const entries = [
        ['Balanced', rec.balanced],
        ['Highest XIRR', rec.highestXirr],
        ['Safest', rec.safest],
        ['Short tenure', rec.shortTenure],
      ].filter(([, p]) => p) as [string, NonNullable<typeof rec.balanced>][];
      const option = barOption({
        categories: entries.map(([name]) => name),
        series: [
          { name: 'XIRR %', data: entries.map(([, p]) => round(p.xirr ?? 0, 1)), color: COLORS.emerald },
          { name: 'NPA %', data: entries.map(([, p]) => round(p.npaRate * 100, 2)), color: COLORS.rose },
          { name: 'Approval %', data: entries.map(([, p]) => round(p.approvalRate * 100, 1)), color: COLORS.cyan },
        ],
        yFormat: 'percent',
      });
      const balanced = rec.balanced;
      return {
        option,
        insight: plain(
          'positive',
          balanced ? `Balanced policy approves ${pct(balanced.approvalRate * 100)} at ${pct(balanced.npaRate * 100)} NPA` : 'No balanced policy found',
          balanced
            ? `Score ≥${balanced.minScore}, tenure ≤${balanced.maxTenure}M on ${num(balanced.loans)} closed loans. Upper 95% bad rate is ${pct(balanced.npaUpper95 * 100)}, so even the unlucky case stays inside a workable band.`
            : 'The grid did not produce a candidate meeting the constraints.',
          'PREFER',
        ),
      };
    },
    { subtitle: 'Four candidates on return, risk and volume', span: o.span ?? 2, height: 300 },
  );
}

// ---------------------------------------------------------------------------
// Marketplace charts
// ---------------------------------------------------------------------------
export function availableScoreHist(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const values = ctx.meta.availableLoans.map((l) => l.score);
      const bins = histogram(values, 18);
      const option = histOption({ bins, xName: 'LDC score', xFormat: 'num', color: COLORS.cyan });
      return { option, insight: distInsight(values, 'live-loan score', 'num') };
    },
    { subtitle: 'Loans still listed in the last scrape', span: o.span ?? 1, height: 260 },
  );
}

export function availableRateHist(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const values = ctx.meta.availableLoans.map((l) => l.rate);
      const bins = histogram(values, 18);
      const option = histOption({ bins, xName: 'Borrower APR %', xFormat: 'percent', color: COLORS.amber });
      return { option, insight: distInsight(values, 'live-loan APR', 'percent') };
    },
    { subtitle: 'Pricing on the marketplace snapshot', span: o.span ?? 1, height: 260 },
  );
}

export function availableTenureBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const list = ctx.meta.availableLoans;
      const tenures = [...new Set(list.map((l) => l.tenure))].sort((a, b) => a - b);
      const counts = tenures.map((t) => list.filter((l) => l.tenure === t).length);
      const option = barOption({
        categories: tenures.map((t) => `${t}M`),
        series: [{ name: 'Loans', data: counts, color: COLORS.violet }],
        yFormat: 'num',
        showLegend: false,
        label: true,
      });
      const short = list.filter((l) => l.tenure <= 3).length;
      return {
        option,
        insight: plain(
          'positive',
          `${pct((short / Math.max(1, list.length)) * 100)} of live loans are 3 months or shorter`,
          'Short tenure recycles capital and reduces the window for delinquency. The trade-off is more frequent reinvestment decisions and more fee events.',
          'PREFER',
        ),
      };
    },
    { subtitle: 'Contractual length of live loans', span: o.span ?? 1, height: 260 },
  );
}

export function availableRemainingBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const list = ctx.meta.availableLoans;
      const buckets = ['Fully funded', '<25% left', '25–50% left', '50–75% left', '75–100% left'];
      const counts = [
        list.filter((l) => l.remainingPct <= 0).length,
        list.filter((l) => l.remainingPct > 0 && l.remainingPct < 25).length,
        list.filter((l) => l.remainingPct >= 25 && l.remainingPct < 50).length,
        list.filter((l) => l.remainingPct >= 50 && l.remainingPct < 75).length,
        list.filter((l) => l.remainingPct >= 75).length,
      ];
      const option = barOption({
        categories: buckets,
        series: [{ name: 'Loans', data: counts, color: COLORS.emerald }],
        yFormat: 'num',
        showLegend: false,
        label: true,
      });
      return {
        option,
        insight: plain(
          counts[0] > list.length * 0.5 ? 'warning' : 'positive',
          `${num(counts[0])} of ${num(list.length)} live loans are already fully funded`,
          'Funding progress is a liquidity signal. Loans near completion may close before you can size a position; fully open loans carry less competition but also less social proof.',
          'INFO',
        ),
      };
    },
    { subtitle: 'How much of each listing is still open', span: o.span ?? 1, height: 260 },
  );
}

export function availableScoreRate(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const points = ctx.meta.availableLoans.map((l) => ({
        x: l.score,
        y: l.rate,
        name: l.name,
        value: l.loanAmount,
      }));
      const option = scatterOption({
        points,
        xName: 'LDC score',
        yName: 'APR %',
        xFormat: 'num',
        yFormat: 'percent',
        size: 7,
        opacity: 0.7,
      });
      const high = ctx.meta.availableLoans.filter((l) => l.score >= 740 && l.tenure <= 6).length;
      return {
        option,
        insight: plain(
          'positive',
          `${num(high)} live loans clear score ≥740 and tenure ≤6M`,
          'That is the balanced policy footprint on the current marketplace. Screen for these first, then check funding progress and ticket size before committing.',
          'PREFER',
        ),
      };
    },
    { subtitle: 'Every listed loan, sized by sanctioned amount', span: o.span ?? 2, height: 320 },
  );
}

export function availableRiskMix(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const list = ctx.meta.availableLoans;
      const types = [...new Set(list.map((l) => l.riskType || 'Unknown'))];
      const counts = types.map((t) => list.filter((l) => (l.riskType || 'Unknown') === t).length);
      const option = pieOption({
        data: types.map((t, i) => ({ name: t, value: counts[i], color: SERIES_COLORS[i % SERIES_COLORS.length] })),
        valueFormat: 'num',
        centerText: { value: num(list.length), label: 'live loans' },
      });
      const top = [...types].sort((a, b) => counts[types.indexOf(b)] - counts[types.indexOf(a)])[0];
      return {
        option,
        insight: plain(
          'neutral',
          top ? `${top} is the most common live risk type` : 'No live loans',
          'Risk type is the platform label, not a validated grade. Check it against the score band and the historical NPA of that band before trusting the label.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Platform risk labels on the last scrape', span: o.span ?? 1, height: 280 },
  );
}

export function availableFundingBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const list = ctx.meta.availableLoans;
      const edges = [25, 50, 75, 100.01];
      const labels = ['0–25% funded', '25–50% funded', '50–75% funded', '75–100% funded'];
      const counts = labels.map((_, i) => {
        const lo = i === 0 ? -1 : edges[i - 1];
        return list.filter((l) => l.remainingPct > lo && l.remainingPct <= edges[i]).length;
      });
      const option = barOption({
        categories: labels,
        series: [{ name: 'Loans', data: counts, color: COLORS.emerald }],
        yFormat: 'num',
        showLegend: false,
        label: true,
      });
      const openShare = list.length ? (list.filter((l) => l.remainingAmount > 0).length / list.length) * 100 : 0;
      return {
        option,
        insight: plain(
          openShare > 60 ? 'warning' : 'neutral',
          `${pct(openShare)} of live loans still have an open balance`,
          'Funding progress is a liquidity signal, not a credit signal. A fully funded loan can still default; a barely funded one can vanish before you invest.',
          'WATCH',
        ),
      };
    },
    { subtitle: 'How much of each listing is still unfunded', span: o.span ?? 1, height: 280 },
  );
}

export function availableEligibility(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const list = ctx.meta.availableLoans;
      const rec = ctx.model.recommendedPolicies;
      const entries = Object.entries(rec).filter(([, p]) => !!p) as [string, NonNullable<(typeof rec)[keyof typeof rec]>][];
      const labels = entries.map(([key]) => key);
      const counts = entries.map(([, p]) => list.filter((l) => l.score >= p.minScore && l.tenure <= p.maxTenure).length);
      const option = barOption({
        categories: labels,
        series: [{ name: 'Live loans passing', data: counts, color: COLORS.cyan }],
        yFormat: 'num',
        showLegend: false,
        label: true,
      });
      const best = entries
        .map(([key, p], i) => ({ key, n: counts[i], npa: p.npaRate }))
        .sort((a, b) => b.n - a.n)[0];
      return {
        option,
        insight: plain(
          best && best.n > 0 ? 'positive' : 'warning',
          best ? `${best.n} live loans pass the ${best.key} policy` : 'No policy data',
          'Pass counts shrink fast as the score floor rises. Historically the tighter policy also had the lower NPA, so a smaller eligible list is not a loss — it is the filter doing its job.',
          'PREFER',
        ),
      };
    },
    { subtitle: 'Historical policy floors applied to the live snapshot', span: o.span ?? 2, height: 300 },
  );
}

export function availableTopTable(o: { id: string; title: string; section: string; span?: 2 | 3 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const list = [...ctx.meta.availableLoans].sort((a, b) => b.score - a.score).slice(0, 12);
      return {
        option: {},
        insight: plain(
          'neutral',
          list.length ? `Top live score is ${list[0].score} at ${pct(list[0].rate)} APR` : 'No live loans',
          'High score alone is not enough: check tenure, funding progress and ticket size. The table is sorted by score, not by expected return.',
          'INFO',
        ),
        table: {
          columns: [
            { key: 'name', label: 'Borrower' },
            { key: 'score', label: 'Score', align: 'right', type: 'int' },
            { key: 'rate', label: 'APR', align: 'right', type: 'percent' },
            { key: 'tenure', label: 'Tenure', align: 'right', type: 'int' },
            { key: 'loanAmount', label: 'Loan', align: 'right', type: 'money' },
            { key: 'remainingPct', label: 'Open %', align: 'right', type: 'percent' },
            { key: 'riskType', label: 'Risk type' },
          ],
          rows: list.map((l) => ({ ...l })),
        },
      };
    },
    { subtitle: 'Highest-scoring listings in the snapshot', span: o.span ?? 2, height: 320 },
  );
}

// ---------------------------------------------------------------------------
// Fee charts
// ---------------------------------------------------------------------------
export function feeByDim(o: { id: string; title: string; section: string; dim: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, { sortBy: 'lent', xirr: false });
      const fees = stats.map((s) => round(sum(rows.filter((l) => String(DIMENSIONS[o.dim].get(l)) === s.label), (l) => l.fee), 2));
      const option = barOption({
        categories: stats.map((s) => s.label),
        series: [{ name: 'Fees paid', data: fees, color: COLORS.orange }],
        yFormat: 'money',
        showLegend: false,
      });
      const total = fees.reduce((s, v) => s + v, 0);
      const top = stats[fees.indexOf(Math.max(...fees))];
      return {
        option,
        insight: plain(
          'neutral',
          `${top?.label ?? '—'} contributes ${inrCompact(Math.max(...fees, 0))} of ${inrCompact(total)} in fees`,
          'Fee totals follow volume, so compare against capital in the same group before concluding anything about cost efficiency.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Fee rupees by segment', span: o.span ?? 1, height: 260 },
  );
}

export function feeRateByDim(o: { id: string; title: string; section: string; dim: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (rows, ctx): ChartResult => {
      const stats = categoryStats(rows, ctx.scenario, DIMENSIONS[o.dim], ctx.meta.recoveryRate, { sortBy: 'lent', xirr: false });
      const rates = stats.map((s) => {
        const group = rows.filter((l) => String(DIMENSIONS[o.dim].get(l)) === s.label);
        const lent = sum(group, (l) => l.amount);
        return lent ? round((sum(group, (l) => l.fee) / lent) * 100, 2) : 0;
      });
      const option = barOption({
        categories: stats.map((s) => s.label),
        series: [{ name: 'Fee as % of capital', data: rates, color: COLORS.amber }],
        yFormat: 'percent',
        showLegend: false,
      });
      const maxRate = Math.max(...rates, 0);
      return {
        option,
        insight: plain(
          maxRate > 2 ? 'warning' : 'neutral',
          `Effective fee drag peaks at ${pct(maxRate)}`,
          'Fees are charged per loan, not per rupee, so small tickets and short tenures carry the highest proportional cost. That is also where headline ANR looks best — net it out before comparing.',
          'INFO',
        ),
      };
    },
    { subtitle: 'Fee cost relative to capital deployed', span: o.span ?? 1, height: 260 },
  );
}

// ---------------------------------------------------------------------------
// Methodology charts
// ---------------------------------------------------------------------------
export function dataQualityBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const q = ctx.meta.dataQuality;
      const labels = ['Income', 'Bureau', 'City', 'State', 'Stay', 'Purpose', 'Marital'];
      const values = [q.missingIncome, q.missingBureau, q.missingCity, q.missingState, q.missingStay, q.missingPurpose, q.missingMarital];
      const pctValues = values.map((v) => round((v / Math.max(1, ctx.meta.counts.loans)) * 100, 2));
      const option = barOption({
        categories: labels,
        series: [{ name: 'Missing %', data: pctValues, color: COLORS.rose }],
        yFormat: 'percent',
        showLegend: false,
        label: true,
      });
      const worst = labels[pctValues.indexOf(Math.max(...pctValues))];
      return {
        option,
        insight: plain(
          'warning',
          `${worst} is the weakest field at ${pct(Math.max(...pctValues))} missing`,
          'Missing data is not random: income is blank for borrowers who did not declare it, which correlates with the informal segment. Any model using income must impute and flag, never drop.',
          'WATCH',
        ),
      };
    },
    { subtitle: 'Share of loans with no usable value', span: o.span ?? 1, height: 280 },
  );
}

export function coverageBars(o: { id: string; title: string; section: string; span?: 1 | 2 }): ChartSpec {
  return chart(
    o.id,
    o.title,
    o.section,
    (_rows, ctx): ChartResult => {
      const q = ctx.meta.dataQuality;
      const labels = ['City mapped', 'State mapped', 'Income usable', 'Bureau usable', 'Stay known', 'Clean dates'];
      const values = [
        round(q.cityCoverage * 100, 2),
        round(q.stateCoverage * 100, 2),
        round((1 - q.incomeZeroShare) * 100, 2),
        round((1 - q.bureauZeroShare) * 100, 2),
        round((1 - q.missingStay / Math.max(1, ctx.meta.counts.loans)) * 100, 2),
        round(100 - (q.closureBeforeDisb + q.maturityBeforeDisb) / Math.max(1, ctx.meta.counts.loans) * 100, 2),
      ];
      const option = barOption({
        categories: labels,
        series: [{ name: 'Coverage %', data: values, color: COLORS.emerald }],
        yFormat: 'percent',
        showLegend: false,
        label: true,
      });
      return {
        option,
        insight: plain(
          'neutral',
          `Derived coverage ranges ${pct(Math.min(...values))} to ${pct(Math.max(...values))}`,
          'Every derived field is reproducible from the sanitised loan file. Where coverage is low, the dashboard shows the bucket as missing rather than silently reallocating it.',
          'INFO',
        ),
      };
    },
    { subtitle: 'How much of each derived field is populated', span: o.span ?? 1, height: 280 },
  );
}

export function quantilesOf(values: number[]): { q1: number; median: number; q3: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    q1: round(quantile(sorted, 0.25), 2),
    median: round(quantile(sorted, 0.5), 2),
    q3: round(quantile(sorted, 0.75), 2),
  };
}

