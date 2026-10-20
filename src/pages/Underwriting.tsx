import { useMemo, useState } from 'react';
import type { PageConfig, Loan } from '../lib/types';
import { useStore } from '../data/store';
import { DEFAULT_POLICY, evaluatePolicy, scoreLoan } from '../lib/metrics';
import type { PolicyRules } from '../lib/metrics';
import { inr, inrCompact, num, pct } from '../lib/format';
import { PageHero, ChartSections } from './PageView';

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="sim-slider">
      <span>
        {label}
        <em>{format ? format(value) : value}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Underwriting({ page }: { page: PageConfig }) {
  const { rows, ctx, scenario, meta, model } = useStore();
  const [rules, setRules] = useState<PolicyRules>({ ...DEFAULT_POLICY });
  const [manual, setManual] = useState({
    score: 760,
    bureau: 720,
    tenure: 3,
    rate: 46,
    borrowerAmount: 20000,
    amount: 1000,
    income: 35000,
    foir: 0.4,
    age: 34,
    profession: 0,
    cityTier: 2,
    gender: 0,
    stay: 1,
    grade: 1,
  });

  const result = useMemo(() => evaluatePolicy(rows, scenario, rules), [rows, scenario, rules]);
  const baseline = useMemo(
    () => evaluatePolicy(rows, scenario, { ...DEFAULT_POLICY, minScore: 700, maxTenure: 12, maxFoir: 10, minRate: 0, maxTicket: 100000 }),
    [rows, scenario],
  );

  const manualLoan = useMemo<Loan | null>(() => {
    const template = rows[0] ?? ctx.allLoans[0];
    if (!template) return null;
    return {
      ...template,
      id: 'SIMULATED',
      name: 'Simulated borrower',
      city: 'Manual entry',
      state: 'Manual entry',
      borrowerAmount: manual.borrowerAmount,
      amount: manual.amount,
      tenure: manual.tenure,
      rate: manual.rate,
      score: manual.score,
      bureau: manual.bureau,
      income: manual.income,
      foir: manual.foir,
      loanToAnnualIncome: manual.income > 0 ? (manual.borrowerAmount / (manual.income * 12)) : null,
      age: manual.age,
      profession: manual.profession,
      cityTier: manual.cityTier,
      gender: manual.gender,
      stay: manual.stay,
      grade: manual.grade,
      repay: 0,
      status: 0,
      dpd: 0,
      dpdBucket: 0,
      overdue: 0,
      npa: 0,
      impaired: 0,
      prepaid: 0,
      pos: manual.amount,
      received: 0,
      netProfit: 0,
      npaAmount: 0,
      futureInterest: 0,
      futureFee: 0,
    };
  }, [rows, ctx.allLoans, manual]);

  const scored = useMemo(
    () =>
      manualLoan
        ? scoreLoan(manualLoan, model, { minScore: rules.minScore, maxTenure: rules.maxTenure, maxFoir: rules.maxFoir })
        : null,
    [manualLoan, model, rules.minScore, rules.maxTenure, rules.maxFoir],
  );

  const policyPass = useMemo(() => {
    if (!manualLoan) return { pass: false, reasons: ['No data'] };
    const reasons: string[] = [];
    if (manualLoan.score < rules.minScore) reasons.push(`Score ${manualLoan.score} below floor ${rules.minScore}`);
    if (manualLoan.tenure > rules.maxTenure) reasons.push(`Tenure ${manualLoan.tenure}M above cap ${rules.maxTenure}M`);
    if (manualLoan.foir !== null && manualLoan.foir > rules.maxFoir) reasons.push(`FOIR ${(manualLoan.foir * 100).toFixed(0)}% above ${(rules.maxFoir * 100).toFixed(0)}%`);
    if (manualLoan.rate < rules.minRate) reasons.push(`APR ${manualLoan.rate}% below floor ${rules.minRate}%`);
    if (manualLoan.amount > rules.maxTicket) reasons.push(`Ticket ${inr(manualLoan.amount)} above cap ${inr(rules.maxTicket)}`);
    if (rules.profession === 'salaried' && manualLoan.profession !== 0) reasons.push('Not salaried');
    if (rules.profession === 'self' && manualLoan.profession !== 1) reasons.push('Not self-employed');
    if (rules.requireBureau && manualLoan.bureau === null) reasons.push('Bureau required but missing');
    if (rules.requireIncome && manualLoan.income === null) reasons.push('Income required but missing');
    return { pass: reasons.length === 0, reasons };
  }, [manualLoan, rules]);

  const passRate = result.count ? 100 : 0;

  return (
    <div className="page">
      <PageHero page={page} />

      <section className="lab">
        <header className="section-head">
          <h2>Policy simulator</h2>
          <p>
            Rules are replayed on the closed book inside your current filter set. Every approved loan is a real historical loan with
            a real outcome, so the NPA rate is observed rather than modelled.
          </p>
        </header>

        <div className="lab-grid">
          <div className="panel sim-panel">
            <div className="panel-head">
              <h3>Rules</h3>
              <button className="link-btn" onClick={() => setRules({ ...DEFAULT_POLICY })}>
                reset
              </button>
            </div>
            <Slider
              label="Minimum LDC score"
              value={rules.minScore}
              min={700}
              max={820}
              step={5}
              onChange={(v) => setRules({ ...rules, minScore: v })}
            />
            <Slider
              label="Maximum tenure"
              value={rules.maxTenure}
              min={1}
              max={12}
              step={1}
              onChange={(v) => setRules({ ...rules, maxTenure: v })}
              format={(v) => `${v} months`}
            />
            <Slider
              label="Maximum FOIR"
              value={rules.maxFoir}
              min={0.2}
              max={1.2}
              step={0.05}
              onChange={(v) => setRules({ ...rules, maxFoir: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Minimum APR"
              value={rules.minRate}
              min={0}
              max={55}
              step={1}
              onChange={(v) => setRules({ ...rules, minRate: v })}
              format={(v) => `${v}%`}
            />
            <Slider
              label="Maximum ticket"
              value={rules.maxTicket}
              min={250}
              max={5000}
              step={250}
              onChange={(v) => setRules({ ...rules, maxTicket: v })}
              format={(v) => inr(v)}
            />
            <label className="sim-select">
              <span>Borrower type</span>
              <select
                value={rules.profession}
                onChange={(e) => setRules({ ...rules, profession: e.target.value as PolicyRules['profession'] })}
              >
                <option value="all">Any</option>
                <option value="salaried">Salaried only</option>
                <option value="self">Self-employed only</option>
              </select>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={rules.requireBureau}
                onChange={(e) => setRules({ ...rules, requireBureau: e.target.checked })}
              />
              <span>Require bureau score</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={rules.requireIncome}
                onChange={(e) => setRules({ ...rules, requireIncome: e.target.checked })}
              />
              <span>Require declared income</span>
            </label>
            <p className="muted small">
              Replaying {num(rows.filter((l) => l.status !== 0).length)} closed loans in the current view. Change the top-bar filters
              to test the policy on a segment.
            </p>
          </div>

          <div className="panel result-panel">
            <div className="panel-head">
              <h3>Replay result</h3>
              <span className={`pill ${result.npaRate <= 4 ? 'prefer' : result.npaRate <= 8 ? 'watch' : 'avoid'}`}>
                {result.npaRate <= 4 ? 'tight' : result.npaRate <= 8 ? 'workable' : 'risky'}
              </span>
            </div>
            <div className="result-grid">
              <div>
                <span>Approved</span>
                <strong>{num(result.count)}</strong>
                <em>{pct(result.approvalRate)} of closed</em>
              </div>
              <div>
                <span>NPA rate</span>
                <strong className="bad">{pct(result.npaRate)}</strong>
                <em>95% upper {pct(result.npaUpper95)}</em>
              </div>
              <div>
                <span>Capital approved</span>
                <strong>{inrCompact(result.lent)}</strong>
                <em>{inrCompact(result.avgProfit)} avg profit</em>
              </div>
              <div>
                <span>Realised XIRR</span>
                <strong className="good">{result.xirr === null ? '—' : pct(result.xirr)}</strong>
                <em>money-weighted</em>
              </div>
              <div>
                <span>Rejected NPA</span>
                <strong>{pct(result.rejectedNpaRate)}</strong>
                <em>{num(result.rejectedCount)} loans removed</em>
              </div>
              <div>
                <span>Lift</span>
                <strong>{result.npaRate > 0 ? `${(result.rejectedNpaRate / result.npaRate).toFixed(1)}×` : '—'}</strong>
                <em>rejected vs approved bad rate</em>
              </div>
            </div>
            <div className="progress-compare">
              <div>
                <span>Approval</span>
                <div className="bar">
                  <i style={{ width: `${Math.min(100, passRate)}%` }} />
                </div>
                <em>{pct(result.approvalRate)}</em>
              </div>
              <div>
                <span>Book baseline NPA</span>
                <div className="bar bad">
                  <i style={{ width: `${Math.min(100, baseline.npaRate * 2)}%` }} />
                </div>
                <em>{pct(baseline.npaRate)}</em>
              </div>
              <div>
                <span>Policy NPA</span>
                <div className="bar good">
                  <i style={{ width: `${Math.min(100, result.npaRate * 2)}%` }} />
                </div>
                <em>{pct(result.npaRate)}</em>
              </div>
            </div>
            <p className="muted small">
              The closed book is survivorship-biased: loans that never closed are absent. Treat the improvement as an upper bound on
              what the rule can do, not a forecast.
            </p>
          </div>
        </div>
      </section>

      <section className="lab">
        <header className="section-head">
          <h2>Manual loan evaluator</h2>
          <p>
            Score a hypothetical loan with the logistic model trained on {num(model.observations)} closed loans. The PD is a ranking
            signal, not a calibrated probability — use the decision and the reasons, not the third decimal.
          </p>
        </header>

        <div className="lab-grid">
          <div className="panel sim-panel">
            <div className="panel-head">
              <h3>Loan inputs</h3>
              <span className="pill info">live</span>
            </div>
            <div className="field-grid">
              <label>
                <span>LDC score</span>
                <input type="number" value={manual.score} min={700} max={900} onChange={(e) => setManual({ ...manual, score: Number(e.target.value) })} />
              </label>
              <label>
                <span>Bureau score</span>
                <input type="number" value={manual.bureau} min={300} max={900} onChange={(e) => setManual({ ...manual, bureau: Number(e.target.value) })} />
              </label>
              <label>
                <span>Tenure (months)</span>
                <input type="number" value={manual.tenure} min={1} max={12} onChange={(e) => setManual({ ...manual, tenure: Number(e.target.value) })} />
              </label>
              <label>
                <span>Borrower APR %</span>
                <input type="number" value={manual.rate} min={0} max={60} step={0.1} onChange={(e) => setManual({ ...manual, rate: Number(e.target.value) })} />
              </label>
              <label>
                <span>Borrower loan (₹)</span>
                <input type="number" value={manual.borrowerAmount} min={0} step={1000} onChange={(e) => setManual({ ...manual, borrowerAmount: Number(e.target.value) })} />
              </label>
              <label>
                <span>Your investment (₹)</span>
                <input type="number" value={manual.amount} min={250} step={250} onChange={(e) => setManual({ ...manual, amount: Number(e.target.value) })} />
              </label>
              <label>
                <span>Monthly income (₹)</span>
                <input type="number" value={manual.income} min={0} step={1000} onChange={(e) => setManual({ ...manual, income: Number(e.target.value) })} />
              </label>
              <label>
                <span>FOIR</span>
                <input type="number" value={manual.foir} min={0} max={2} step={0.05} onChange={(e) => setManual({ ...manual, foir: Number(e.target.value) })} />
              </label>
              <label>
                <span>Age</span>
                <input type="number" value={manual.age} min={18} max={70} onChange={(e) => setManual({ ...manual, age: Number(e.target.value) })} />
              </label>
              <label>
                <span>Borrower type</span>
                <select value={manual.profession} onChange={(e) => setManual({ ...manual, profession: Number(e.target.value) })}>
                  <option value={0}>Salaried</option>
                  <option value={1}>Self-employed</option>
                </select>
              </label>
              <label>
                <span>City tier</span>
                <select value={manual.cityTier} onChange={(e) => setManual({ ...manual, cityTier: Number(e.target.value) })}>
                  <option value={1}>Tier 1 metro</option>
                  <option value={2}>Tier 2</option>
                  <option value={3}>Tier 3</option>
                  <option value={0}>Unknown</option>
                </select>
              </label>
              <label>
                <span>Grade</span>
                <select value={manual.grade} onChange={(e) => setManual({ ...manual, grade: Number(e.target.value) })}>
                  <option value={2}>AAA (Low)</option>
                  <option value={1}>AA (Medium)</option>
                  <option value={0}>A (High)</option>
                </select>
              </label>
            </div>
          </div>

          <div className="panel result-panel">
            <div className="panel-head">
              <h3>Decision</h3>
              {scored ? <span className={`pill ${scored.decision === 'APPROVE' ? 'prefer' : scored.decision === 'REVIEW' ? 'watch' : 'avoid'}`}>{scored.decision}</span> : null}
            </div>
            {scored ? (
              <>
                <div className="result-grid">
                  <div>
                    <span>Model PD</span>
                    <strong className={scored.pd > 0.12 ? 'bad' : scored.pd > 0.05 ? 'warn' : 'good'}>{(scored.pd * 100).toFixed(1)}%</strong>
                    <em>{scored.confidence} confidence</em>
                  </div>
                  <div>
                    <span>Model score</span>
                    <strong>{scored.modelScore}</strong>
                    <em>100 = safest</em>
                  </div>
                  <div>
                    <span>Expected annual return</span>
                    <strong className={scored.expectedAnnualReturn > 15 ? 'good' : 'warn'}>{pct(scored.expectedAnnualReturn)}</strong>
                    <em>{inr(scored.expectedProfit)} expected profit</em>
                  </div>
                  <div>
                    <span>Policy test</span>
                    <strong className={policyPass.pass ? 'good' : 'bad'}>{policyPass.pass ? 'PASS' : 'FAIL'}</strong>
                    <em>{policyPass.pass ? 'meets every rule' : `${policyPass.reasons.length} breaches`}</em>
                  </div>
                </div>

                <div className="reason-list">
                  <h4>Model flags</h4>
                  {scored.reasons.length ? (
                    <ul>
                      {scored.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">No model or policy flags on this input.</p>
                  )}
                  {!policyPass.pass ? (
                    <>
                      <h4>Policy breaches</h4>
                      <ul>
                        {policyPass.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>

                <p className="muted small">
                  PD is derived from {model.coefficients.length} standardised features with mean imputation for missing values.
                  {scored.missing ? ` ${scored.missing} feature${scored.missing === 1 ? '' : 's'} were missing on this input.` : ' All model features were supplied.'}
                </p>
              </>
            ) : (
              <p>Load the dataset to score a loan.</p>
            )}
          </div>
        </div>
      </section>

      <ChartSections page={page} />
      <p className="footnote">
        Model trained on {num(model.observations)} closed loans with {num(model.events)} events; AUC {model.metrics.auc.toFixed(3)},
        CV AUC {model.metrics.cvAuc.toFixed(3)}. Recovery assumption {pct(meta.recoveryRate * 100)}.
      </p>
    </div>
  );
}
