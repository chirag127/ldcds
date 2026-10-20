import { useEffect } from 'react';
import { useStore } from '../data/store';
import { dateLabel, inr, inrCompact, num, pct, pctRatio, titleCase } from '../lib/format';
import { isActive, isNpa } from '../lib/metrics';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawer-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function LoanDrawer() {
  const { selected, drawerOpen, closeLoan, patchFilters, setSearch } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLoan();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeLoan]);

  if (!drawerOpen || !selected) return null;
  const loan = selected;
  const status = isNpa(loan) ? 'NPA' : isActive(loan) ? (loan.impaired ? 'Overdue active' : 'Active') : 'Closed';

  return (
    <div className="drawer-wrap">
      <div className="scrim" onClick={closeLoan} />
      <aside className="drawer">
        <header>
          <div>
            <span className="eyebrow">{status}</span>
            <h2>{titleCase(loan.name)}</h2>
            <p className="mono">{loan.id}</p>
          </div>
          <button className="icon-btn" onClick={closeLoan}>
            ✕
          </button>
        </header>

        <div className="drawer-kpis">
          <div>
            <span>Invested</span>
            <strong>{inr(loan.amount)}</strong>
          </div>
          <div>
            <span>Outstanding</span>
            <strong>{inr(loan.pos)}</strong>
          </div>
          <div>
            <span>Net profit</span>
            <strong className={loan.netProfit >= 0 ? 'good' : 'bad'}>{inr(loan.netProfit)}</strong>
          </div>
          <div>
            <span>ANR</span>
            <strong>{pct(loan.reportedAnr)}</strong>
          </div>
          <div>
            <span>Recovery XIRR</span>
            <strong>{pct(loan.xirrRecovery ?? 0)}</strong>
          </div>
          <div>
            <span>DPD</span>
            <strong className={loan.dpd > 0 ? 'bad' : 'good'}>{num(loan.dpd)}</strong>
          </div>
        </div>

        <div className="drawer-body">
          <section>
            <h3>Borrower</h3>
            <dl>
              <Row label="Age" value={num(loan.age)} />
              <Row label="Gender" value={['Male', 'Female', 'Other', 'Unknown'][loan.gender] ?? '—'} />
              <Row label="City" value={loan.city || '—'} />
              <Row label="State" value={loan.state || '—'} />
              <Row label="City tier" value={['Unknown', 'Tier 1 metro', 'Tier 2 city', 'Tier 3 / other'][loan.cityTier]} />
              <Row label="Borrower type" value={loan.profession === 1 ? 'Self-employed' : 'Salaried'} />
              <Row label="Residence" value={['Unknown', 'Self-owned', 'Rented'][loan.stay]} />
              <Row label="Monthly income" value={loan.income === null ? 'missing' : inr(loan.income)} />
              <Row label="Bureau score" value={loan.bureau === null ? 'missing' : num(loan.bureau)} />
              <Row label="LDC score" value={num(loan.score)} />
              <Row label="Grade" value={['A (High)', 'AA (Medium)', 'AAA (Low)'][loan.grade]} />
              <Row label="Loans with this borrower" value={num(loan.repeatCount)} />
            </dl>
          </section>

          <section>
            <h3>Loan terms</h3>
            <dl>
              <Row label="Borrower loan" value={inr(loan.borrowerAmount)} />
              <Row label="Invested share" value={inr(loan.amount)} />
              <Row label="Tenure" value={`${loan.tenure} months`} />
              <Row label="Borrower APR" value={pct(loan.rate)} />
              <Row label="Repayment" value={loan.repay === 1 ? 'Daily EDI' : 'Monthly EMI'} />
              <Row label="EMI" value={loan.emi === null ? '—' : inr(loan.emi)} />
              <Row label="FOIR" value={loan.foir === null ? 'missing' : pctRatio(loan.foir)} />
              <Row label="Loan / annual income" value={loan.loanToAnnualIncome === null ? 'missing' : pctRatio(loan.loanToAnnualIncome)} />
              <Row label="Platform list" value={loan.listType === 0 ? 'Open' : 'Closed'} />
            </dl>
          </section>

          <section>
            <h3>Cash flows</h3>
            <dl>
              <Row label="Disbursed" value={dateLabel(loan.disb)} />
              <Row label="Maturity" value={dateLabel(loan.maturity)} />
              <Row label="Closed" value={loan.closure ? dateLabel(loan.closure) : 'still open'} />
              <Row label="Holding days" value={num(loan.holdingDays)} />
              <Row label="Cash received" value={inr(loan.received)} />
              <Row label="Principal received" value={inr(loan.principalRec)} />
              <Row label="Interest received" value={inr(loan.interestRec)} />
              <Row label="Platform fee" value={inr(loan.fee)} />
              <Row label="NPA amount" value={loan.npaAmount ? inr(loan.npaAmount) : '—'} />
              <Row label="Future interest" value={inr(loan.futureInterest)} />
              <Row label="Expected returns" value={inr(loan.expReturns)} />
            </dl>
          </section>

          <section>
            <h3>Scenario outcomes</h3>
            <dl>
              <Row label="Contractual profit" value={inr(loan.profitContractual)} />
              <Row label="Recovery profit (45%)" value={inr(loan.profitRecovery)} />
              <Row label="Strict profit" value={inr(loan.profitStrict)} />
              <Row label="Contractual XIRR" value={pct(loan.xirrContractual ?? 0)} />
              <Row label="Recovery XIRR" value={pct(loan.xirrRecovery ?? 0)} />
              <Row label="Strict XIRR" value={pct(loan.xirrStrict ?? 0)} />
            </dl>
          </section>
        </div>

        <footer className="drawer-foot">
          <button
            className="ghost-btn"
            onClick={() => {
              setSearch(loan.name);
              closeLoan();
            }}
          >
            Find this borrower
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              patchFilters({ cities: [loan.city], states: [] });
              closeLoan();
            }}
          >
            Filter to {loan.city}
          </button>
          <a className="ghost-btn" href="https://github.com/chirag127/ldcds" target="_blank" rel="noreferrer">
            About the data
          </a>
        </footer>
      </aside>
    </div>
  );
}
