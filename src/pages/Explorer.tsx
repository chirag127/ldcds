import { useMemo, useState } from 'react';
import type { Loan, PageConfig, TableData } from '../lib/types';
import { useStore } from '../data/store';
import { DataTable } from '../components/DataTable';
import { PageHero, ChartSections } from './PageView';
import { isActive, isNpa } from '../lib/metrics';
import { titleCase } from '../lib/format';

const LABELS = {
  status: (l: Loan) => (isNpa(l) ? 'NPA' : isActive(l) ? (l.impaired ? 'Overdue active' : 'Active') : 'Closed'),
  grade: (l: Loan) => ['A (High)', 'AA (Medium)', 'AAA (Low)'][l.grade] ?? '—',
  gender: (l: Loan) => ['Male', 'Female', 'Other', 'Unknown'][l.gender] ?? '—',
  profession: (l: Loan) => (l.profession === 1 ? 'Self-employed' : 'Salaried'),
  cityTier: (l: Loan) => ['Unknown', 'Tier 1', 'Tier 2', 'Tier 3'][l.cityTier] ?? '—',
  repay: (l: Loan) => (l.repay === 1 ? 'Daily EDI' : 'Monthly EMI'),
  stay: (l: Loan) => ['Unknown', 'Owned', 'Rented'][l.stay] ?? '—',
};

const DEFAULT_COLUMNS = [
  'id',
  'name',
  'statusLabel',
  'city',
  'state',
  'score',
  'bureau',
  'gradeLabel',
  'tenure',
  'rate',
  'amount',
  'pos',
  'disb',
  'maturity',
  'closure',
  'received',
  'netProfit',
  'reportedAnr',
  'xirrRecovery',
  'dpd',
];

export function Explorer({ page }: { page: PageConfig }) {
  const { rows, meta, openLoan } = useStore();
  const [selected, setSelected] = useState<string[]>(DEFAULT_COLUMNS);

  const allColumns = useMemo(() => {
    const base = meta.columns
      .filter((c) => c.type !== 'code' && c.type !== 'bool')
      .map((c) => ({ key: c.key, label: c.label, align: (['money', 'percent', 'ratio', 'int', 'score'].includes(c.type) ? 'right' : 'left') as 'left' | 'right', type: c.type }));
    const extra = [
      { key: 'statusLabel', label: 'Status', align: 'left' as const, type: 'text' as const },
      { key: 'gradeLabel', label: 'Grade', align: 'left' as const, type: 'text' as const },
      { key: 'genderLabel', label: 'Gender' as const, align: 'left' as const, type: 'text' as const },
      { key: 'professionLabel', label: 'Borrower type', align: 'left' as const, type: 'text' as const },
      { key: 'tierLabel', label: 'City tier', align: 'left' as const, type: 'text' as const },
      { key: 'repayLabel', label: 'Repayment', align: 'left' as const, type: 'text' as const },
      { key: 'stayLabel', label: 'Residence', align: 'left' as const, type: 'text' as const },
    ];
    return [...base, ...extra];
  }, [meta.columns]);

  const table = useMemo<TableData>(() => {
    const cols = allColumns.filter((c) => selected.includes(c.key));
    return {
      columns: cols,
      rows: rows.map((l) => ({
        ...l,
        name: titleCase(l.name),
        statusLabel: LABELS.status(l),
        gradeLabel: LABELS.grade(l),
        genderLabel: LABELS.gender(l),
        professionLabel: LABELS.profession(l),
        tierLabel: LABELS.cityTier(l),
        repayLabel: LABELS.repay(l),
        stayLabel: LABELS.stay(l),
        xirrRecovery: l.xirrRecovery === null ? null : (l.xirrRecovery as number),
        xirrContractual: l.xirrContractual === null ? null : (l.xirrContractual as number),
        xirrStrict: l.xirrStrict === null ? null : (l.xirrStrict as number),
      })),
    };
  }, [rows, allColumns, selected]);

  const onRowClick = (row: Record<string, unknown>) => {
    const id = String(row.id ?? '');
    const loan = rows.find((l) => l.id === id);
    if (loan) openLoan(loan);
  };

  return (
    <div className="page no-nav">
      <PageHero page={page} />

      <section className="panel table-panel">
        <header className="panel-head">
          <h3>Loan explorer</h3>
          <div className="panel-actions">
            <button className="ghost-btn" onClick={() => setSelected(DEFAULT_COLUMNS)}>
              Default columns
            </button>
            <button className="ghost-btn" onClick={() => setSelected(allColumns.map((c) => c.key))}>
              All {allColumns.length}
            </button>
          </div>
        </header>

        <details className="column-picker">
          <summary>{selected.length} of {allColumns.length} columns shown</summary>
          <div className="check-grid">
            {allColumns.map((c) => (
              <label key={c.key} className={selected.includes(c.key) ? 'on' : ''}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.key)}
                  onChange={() =>
                    setSelected((prev) =>
                      prev.includes(c.key) ? prev.filter((k) => k !== c.key) : [...prev, c.key],
                    )
                  }
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </details>

        <DataTable data={table} pageSize={25} onRowClick={onRowClick} exportName="ldc-loans" initialSort="amount" />
        <p className="muted small">Click any row for the full loan record. CSV exports exactly the filtered rows and visible columns.</p>
      </section>

      <ChartSections page={page} />
    </div>
  );
}
