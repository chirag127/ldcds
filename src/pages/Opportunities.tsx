import { useMemo, useState } from 'react';
import type { PageConfig } from '../lib/types';
import { useStore } from '../data/store';
import { DataTable } from '../components/DataTable';
import { PageHero, ChartSections } from './PageView';
import { categoryStats, DIMENSIONS, isClosed, isNpa } from '../lib/metrics';
import { inr, inrCompact, num, pct, titleCase } from '../lib/format';

function bandOf(score: number): string {
  if (score < 720) return '700–719';
  if (score < 740) return '720–739';
  if (score < 760) return '740–759';
  if (score < 780) return '760–779';
  if (score < 800) return '780–799';
  return '800+';
}

export function Opportunities({ page }: { page: PageConfig }) {
  const { rows, ctx, meta } = useStore();
  const [minScore, setMinScore] = useState(740);
  const [maxTenure, setMaxTenure] = useState(6);
  const [minRate, setMinRate] = useState(0);
  const [openOnly, setOpenOnly] = useState(true);

  const bandStats = useMemo(() => {
    const stats = categoryStats(rows, ctx.scenario, DIMENSIONS.scoreBand, meta.recoveryRate, { xirr: false });
    const map = new Map(stats.map((s) => [s.label, s]));
    return map;
  }, [rows, ctx.scenario, meta.recoveryRate]);

  const overallBad = useMemo(() => {
    const closed = rows.filter(isClosed);
    return closed.length ? closed.filter(isNpa).length / closed.length : 0.04;
  }, [rows]);

  const live = useMemo(() => {
    return meta.availableLoans
      .filter((l) => (openOnly ? l.remainingAmount > 0 : true))
      .filter((l) => l.score >= minScore && l.tenure <= maxTenure && l.rate >= minRate)
      .map((l) => {
        const stat = bandStats.get(bandOf(l.score));
        const pd = stat && stat.closed > 0 ? stat.npa / Math.max(1, stat.closed) : overallBad;
        const expected = l.rate * (1 - pd) - pd * meta.lgd * 100 - (1.5 * (12 / Math.max(1, l.tenure)));
        return {
          ...l,
          name: titleCase(l.name),
          pd: pd * 100,
          expected,
          decision: expected > 18 ? 'STRONG' : expected > 8 ? 'OK' : 'WEAK',
        };
      })
      .sort((a, b) => b.expected - a.expected);
  }, [meta.availableLoans, meta.lgd, minScore, maxTenure, minRate, openOnly, bandStats, overallBad]);

  const table = useMemo(
    () => ({
      columns: [
        { key: 'name', label: 'Borrower' },
        { key: 'loanAmount', label: 'Loan', align: 'right' as const, type: 'money' as const },
        { key: 'remainingPct', label: 'Open', align: 'right' as const, type: 'percent' as const },
        { key: 'score', label: 'Score', align: 'right' as const, type: 'int' as const },
        { key: 'tenure', label: 'Tenure', align: 'right' as const, type: 'int' as const },
        { key: 'rate', label: 'APR', align: 'right' as const, type: 'percent' as const },
        { key: 'pd', label: 'Band NPA', align: 'right' as const, type: 'percent' as const },
        { key: 'expected', label: 'Est. annual', align: 'right' as const, type: 'percent' as const },
        { key: 'decision', label: 'Fit' },
      ],
      rows: live,
    }),
    [live],
  );

  const avgExpected = live.length ? live.reduce((s, l) => s + l.expected, 0) / live.length : 0;

  return (
    <div className="page">
      <PageHero page={page} />

      <section className="panel">
        <header className="panel-head">
          <h3>Screen the marketplace</h3>
          <span className="pill info">{num(meta.availableLoans.length)} captured</span>
        </header>
        <div className="screen-row">
          <label>
            <span>Min score</span>
            <input type="range" min={700} max={820} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            <em>{minScore}</em>
          </label>
          <label>
            <span>Max tenure</span>
            <input type="range" min={1} max={12} step={1} value={maxTenure} onChange={(e) => setMaxTenure(Number(e.target.value))} />
            <em>{maxTenure}M</em>
          </label>
          <label>
            <span>Min APR</span>
            <input type="range" min={0} max={55} step={1} value={minRate} onChange={(e) => setMinRate(Number(e.target.value))} />
            <em>{minRate}%</em>
          </label>
          <label className="switch">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            <span>Open for funding only</span>
          </label>
        </div>

        <div className="result-grid four">
          <div>
            <span>Matches</span>
            <strong>{num(live.length)}</strong>
            <em>of {num(meta.availableLoans.length)}</em>
          </div>
          <div>
            <span>Median APR</span>
            <strong>{live.length ? pct(live.map((l) => l.rate).sort((a, b) => a - b)[Math.floor(live.length / 2)]) : '—'}</strong>
            <em>matching loans</em>
          </div>
          <div>
            <span>Average score</span>
            <strong>{live.length ? num(live.reduce((s, l) => s + l.score, 0) / live.length) : '—'}</strong>
            <em>band {live.length ? bandOf(live[0].score) : '—'}</em>
          </div>
          <div>
            <span>Estimated annual</span>
            <strong className={avgExpected > 15 ? 'good' : 'warn'}>{live.length ? pct(avgExpected) : '—'}</strong>
            <em>after band NPA and fees</em>
          </div>
        </div>

        <DataTable data={table} pageSize={20} exportName="ldc-opportunities" initialSort="expected" />
        <p className="muted small">
          Estimated annual return uses the observed NPA rate of the matching score band, the 55% loss-given-default assumption, and a
          1.5% one-time fee amortised over the tenure. It is a screening number, not a promise.
        </p>
      </section>

      <section className="callout">
        <h3>How to use this tab</h3>
        <p>
          Set the score floor and tenure cap from the policy you are comfortable with, then rank by estimated annual return. Prefer
          loans that are already partially funded — they close sooner and reduce idle cash. Skip anything where the remaining amount
          is a large fraction of the borrower&apos;s sanctioned loan if you cannot see the full underwriting file.
        </p>
        <p className="muted small">
          Snapshot from the last scrape on {meta.asOf}; {inrCompact(meta.availableLoans.reduce((s, l) => s + l.remainingAmount, 0))} was
          still open. The marketplace changes continuously, so refresh before acting.
        </p>
      </section>

      <ChartSections page={page} />
      <p className="footnote">
        Total sanctioned across captured live loans: {inr(meta.availableLoans.reduce((s, l) => s + l.loanAmount, 0))}.
      </p>
    </div>
  );
}
