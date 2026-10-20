import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { backtestPolicy, derivePolicy, policySummary } from '../lib/policy';
import { num, pct } from '../lib/format';

const RULE_COUNTS = [10, 15, 20];
const SAMPLE_STEPS = [20, 100, 300];
const LEVELS = [
  { id: 'wide', emoji: '🪶', label: 'Wide' },
  { id: 'core', emoji: '⭐', label: 'Core' },
  { id: 'strict', emoji: '🛡️', label: 'Strict' },
] as const;

export function PolicyBoard() {
  const { rows } = useStore();
  const [ruleCount, setRuleCount] = useState(20);
  const [minSample, setMinSample] = useState(20);
  const [level, setLevel] = useState<'wide' | 'core' | 'strict'>('core');

  const criteria = useMemo(() => derivePolicy(rows), [rows]);
  const backtest = useMemo(() => backtestPolicy(rows, criteria, level), [rows, criteria, level]);

  const visible = useMemo(
    () =>
      criteria
        .filter((c) => c.sample >= minSample)
        .sort((a, b) => b.impactValue - a.impactValue || a.n - b.n)
        .slice(0, ruleCount),
    [criteria, minSample, ruleCount],
  );

  const summary = useMemo(() => policySummary(criteria), [criteria]);
  const closed = rows.filter((l) => l.status !== 0).length;

  return (
    <section className="panel policy-board">
      <header className="panel-head">
        <h3>📜 The lending policy: 20 rules</h3>
        <span className="pill info">{num(visible.length)} of {num(criteria.length)} rules shown · {level} preset</span>
      </header>

      <p className="policy-summary">🎯 {summary}</p>

      <div className="policy-controls">
        <div className="policy-control">
          <span>🎚️ Preset</span>
          <div className="seg">
            {LEVELS.map((l) => (
              <button key={l.id} className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)} title={l.label}>
                {l.emoji} {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="policy-control">
          <span>📏 Rules shown</span>
          <div className="seg">
            {RULE_COUNTS.map((count) => (
              <button key={count} className={ruleCount === count ? 'on' : ''} onClick={() => setRuleCount(count)}>
                {count}
              </button>
            ))}
          </div>
        </div>
        <div className="policy-control">
          <span>🧾 Minimum evidence</span>
          <div className="seg">
            {SAMPLE_STEPS.map((step) => (
              <button key={step} className={minSample === step ? 'on' : ''} onClick={() => setMinSample(step)}>
                {num(step)} loans
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          Rules are ranked by how much they move the outcome. Raise the evidence floor to keep only the rules with the most
          loans behind them; lower it to add thinner rules. Every number is recomputed from the book you are looking at. ✅ = give,
          🚫 = gate that blocks a loan, ⚠️ = caution.
        </p>
      </div>

      <div className="result-grid four">
        <div>
          <span>🎚️ {LEVELS.find((l) => l.id === level)?.emoji} {LEVELS.find((l) => l.id === level)?.label} preset approves</span>
          <strong>
            {pct(backtest.approvalRate)}
          </strong>
          <em>{num(backtest.approved)} of {num(closed)} closed loans</em>
        </div>
        <div>
          <span>🚨 NPA on approved</span>
          <strong className={backtest.npaRate < backtest.npaRateBook ? 'good' : 'warn'}>{pct(backtest.npaRate)}</strong>
          <em>book average {pct(backtest.npaRateBook)}</em>
        </div>
        <div>
          <span>⏱️ Capital-time return</span>
          <strong className={backtest.capitalTime > backtest.capitalTimeBook ? 'good' : 'warn'}>{pct(backtest.capitalTime)}</strong>
          <em>book average {pct(backtest.capitalTimeBook)}</em>
        </div>
        <div>
          <span>💰 Profit per ₹100</span>
          <strong className={backtest.profitPer100 > backtest.profitPer100Book ? 'good' : 'warn'}>{pct(backtest.profitPer100)}</strong>
          <em>book average {pct(backtest.profitPer100Book)}</em>
        </div>
      </div>

      <ol className="rule-list">
        {visible.map((rule) => (
          <li key={rule.id} className={rule.gateAt !== 'none' ? 'gate' : ''}>
            <span className="rule-n">{rule.n}</span>
            <div className="rule-body">
              <h4>
                {rule.emoji} {rule.title}
                {rule.gateAt !== 'none' ? <em className="rule-tag">{rule.gateAt} gate</em> : null}
              </h4>
              <p className="rule-action">👉 {rule.action}</p>
              <p className="rule-why">{rule.why}</p>
              <p className="rule-meta">
                <span className="rule-impact">{rule.impact}</span>
                <span className="muted">evidence from {num(rule.sample)} loans</span>
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="footnote">
        🧪 Replay: applying the gates to the {num(backtest.approved)} approved closed loans returns {pct(backtest.capitalTime)}{' '}
        capital-time and {pct(backtest.profitPer100)} per ₹100 lent, against {pct(backtest.capitalTimeBook)} and{' '}
        {pct(backtest.profitPer100Book)} for the whole book. The rules are guidance for the next bid — they are not applied to
        any live loan.
      </p>
    </section>
  );
}
