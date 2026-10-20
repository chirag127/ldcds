import type { Filters, FlagKey, Loan, Rule } from './types';
import { DEFAULT_FILTERS } from './metrics';

export function cloneFilters(filters: Filters): Filters {
  return {
    ...filters,
    status: [...filters.status],
    grade: [...filters.grade],
    gender: [...filters.gender],
    profession: [...filters.profession],
    stay: [...filters.stay],
    cityTier: [...filters.cityTier],
    repay: [...filters.repay],
    listType: [...filters.listType],
    dpdBucket: [...filters.dpdBucket],
    score: [...filters.score] as [number, number],
    bureau: [...filters.bureau] as [number, number],
    tenure: [...filters.tenure] as [number, number],
    rate: [...filters.rate] as [number, number],
    amount: [...filters.amount] as [number, number],
    borrowerAmount: [...filters.borrowerAmount] as [number, number],
    age: [...filters.age] as [number, number],
    income: [...filters.income] as [number, number],
    foir: [...filters.foir] as [number, number],
    dti: [...filters.dti] as [number, number],
    vintage: [...filters.vintage] as [number, number],
    pos: [...filters.pos] as [number, number],
    months: [...filters.months],
    cities: [...filters.cities],
    states: [...filters.states],
    flags: { ...filters.flags },
  };
}

export function defaultFilters(): Filters {
  return cloneFilters(DEFAULT_FILTERS);
}

export function mergeFilters(base: Filters, patch: Partial<Filters>): Filters {
  const next = cloneFilters(base);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'flags' && value) {
      next.flags = { ...next.flags, ...(value as Filters['flags']) };
    } else if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number' && key !== 'status' && key !== 'grade' && key !== 'gender' && key !== 'profession' && key !== 'stay' && key !== 'cityTier' && key !== 'repay' && key !== 'listType' && key !== 'dpdBucket') {
      (next as unknown as Record<string, unknown>)[key] = [...value];
    } else if (Array.isArray(value)) {
      (next as unknown as Record<string, unknown>)[key] = [...value];
    } else {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  scenario?: 'contractual' | 'recovery' | 'strict';
  patch: Partial<Filters>;
  rules?: Omit<Rule, 'id'>[];
}

export const PRESETS: Preset[] = [
  {
    id: 'all',
    label: 'Entire book',
    description: 'No filters — all 5,567 loans',
    patch: defaultFilters(),
  },
  {
    id: 'prime-closed',
    label: 'Prime closed',
    description: 'AA grade, score 760+, tenure ≤4M, closed',
    patch: { status: [1], grade: [1], score: [760, 900], tenure: [1, 4] },
  },
  {
    id: 'high-yield',
    label: 'High yield',
    description: 'Score 740+, APR 46%+, tenure 2–6M',
    patch: { score: [740, 900], rate: [46, 60], tenure: [2, 6] },
  },
  {
    id: 'short-safe',
    label: 'Short & safe',
    description: '2–3M tenure, score 760+, closed',
    patch: { status: [1], tenure: [2, 3], score: [760, 900] },
  },
  {
    id: 'salaried-prime',
    label: 'Salaried prime',
    description: 'Salaried, score 760+, 2–4M',
    patch: { profession: [0], score: [760, 900], tenure: [2, 4] },
  },
  {
    id: 'self-employed',
    label: 'Self-employed',
    description: 'Business owners only',
    patch: { profession: [1] },
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
    description: 'Active loans with DPD > 0',
    patch: { status: [0], flags: { ...defaultFilters().flags, overdue: 'yes' } },
  },
  {
    id: 'impaired',
    label: 'Impaired book',
    description: 'NPA or any active delinquency',
    patch: { flags: { ...defaultFilters().flags, impaired: 'yes' } },
  },
  {
    id: 'npa',
    label: 'NPA autopsy',
    description: 'All 234 written-off loans',
    patch: { status: [2] },
  },
  {
    id: 'prepaid',
    label: 'Prepaid winners',
    description: 'Closed before maturity',
    patch: { status: [1], flags: { ...defaultFilters().flags, prepaid: 'yes' } },
  },
  {
    id: 'long-tenure',
    label: 'Long-tenure risk',
    description: '6M and 12M loans',
    patch: { tenure: [6, 12] },
  },
  {
    id: 'large-tickets',
    label: 'Large tickets',
    description: '₹1,000+ invested per loan',
    patch: { amount: [1000, 5000] },
  },
  {
    id: 'new-vintages',
    label: 'New vintages',
    description: 'Sep–Oct 2026 disbursements',
    patch: { months: ['2026-09', '2026-10'] },
  },
  {
    id: 'repeat',
    label: 'Repeat borrowers',
    description: 'Borrowers with 2+ loans',
    patch: { flags: { ...defaultFilters().flags, repeat: 'yes' } },
  },
  {
    id: 'low-score',
    label: 'Low score',
    description: 'LDC score 700–739',
    patch: { score: [700, 739] },
  },
  {
    id: 'missing-income',
    label: 'Missing income',
    description: 'No usable income data',
    patch: { flags: { ...defaultFilters().flags, incomeMissing: 'yes' } },
  },
  {
    id: 'metro',
    label: 'Metro only',
    description: 'Tier 1 cities',
    patch: { cityTier: [1] },
  },
  {
    id: 'tier3',
    label: 'Tier 3',
    description: 'Small-town borrowers',
    patch: { cityTier: [3] },
  },
  {
    id: 'female',
    label: 'Female borrowers',
    description: 'Gender = female',
    patch: { gender: [1] },
  },
  {
    id: 'daily',
    label: 'Daily EDI',
    description: 'Daily-repayment loans',
    patch: { repay: [1] },
  },
  {
    id: 'profitable',
    label: 'Profitable only',
    description: 'Scenario profit > 0',
    patch: { flags: { ...defaultFilters().flags, positiveProfit: 'yes' } },
  },
  {
    id: 'loss-makers',
    label: 'Loss makers',
    description: 'Scenario profit ≤ 0',
    patch: { flags: { ...defaultFilters().flags, positiveProfit: 'no' } },
  },
];

export interface FieldMeta {
  key: keyof Loan;
  label: string;
  type: 'money' | 'percent' | 'ratio' | 'int' | 'score' | 'text';
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export const RULE_FIELDS: FieldMeta[] = [
  { key: 'amount', label: 'Invested amount', type: 'money', min: 0, max: 5000, step: 50 },
  { key: 'pos', label: 'Principal outstanding', type: 'money', min: 0, max: 5000, step: 50 },
  { key: 'rate', label: 'Borrower APR', type: 'percent', min: 0, max: 60, step: 0.1 },
  { key: 'tenure', label: 'Tenure (months)', type: 'int', min: 1, max: 12, step: 1 },
  { key: 'score', label: 'LDC score', type: 'score', min: 700, max: 900, step: 1 },
  { key: 'bureau', label: 'Bureau score', type: 'score', min: 300, max: 900, step: 1 },
  { key: 'age', label: 'Borrower age', type: 'int', min: 18, max: 70, step: 1 },
  { key: 'income', label: 'Monthly income', type: 'money', min: 0, max: 2500000, step: 5000 },
  { key: 'borrowerAmount', label: 'Borrower loan amount', type: 'money', min: 0, max: 300000, step: 1000 },
  { key: 'foir', label: 'FOIR', type: 'ratio', min: 0, max: 2, step: 0.01 },
  { key: 'loanToAnnualIncome', label: 'Loan / annual income', type: 'ratio', min: 0, max: 2, step: 0.01 },
  { key: 'dpd', label: 'Days past due', type: 'int', min: 0, max: 300, step: 1 },
  { key: 'holdingDays', label: 'Holding days', type: 'int', min: 0, max: 400, step: 1 },
  { key: 'vintageDays', label: 'Vintage days', type: 'int', min: 0, max: 400, step: 1 },
  { key: 'netProfit', label: 'Net profit', type: 'money', min: -5000, max: 5000, step: 10 },
  { key: 'reportedAnr', label: 'Reported ANR', type: 'percent', min: -100, max: 100, step: 1 },
  { key: 'fee', label: 'Fee', type: 'money', min: 0, max: 200, step: 1 },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'state', label: 'State', type: 'text' },
  { key: 'name', label: 'Borrower name', type: 'text' },
  { key: 'id', label: 'Loan ID', type: 'text' },
];

export const FILTER_TOGGLES: { key: FlagKey; label: string; hint: string }[] = [
  { key: 'overdue', label: 'Overdue', hint: 'DPD > 0' },
  { key: 'npa', label: 'NPA', hint: 'Platform NPA' },
  { key: 'prepaid', label: 'Prepaid', hint: 'Closed before maturity' },
  { key: 'repeat', label: 'Repeat borrower', hint: '2+ loans' },
  { key: 'matured', label: 'Matured', hint: 'Past contractual maturity' },
  { key: 'incomeMissing', label: 'Income missing', hint: 'No usable income' },
  { key: 'bureauMissing', label: 'Bureau missing', hint: 'No bureau score' },
  { key: 'impaired', label: 'Impaired', hint: 'NPA or DPD > 0' },
  { key: 'positiveProfit', label: 'Positive profit', hint: 'Scenario profit > 0' },
];

export function topCities(loans: Loan[], limit = 80): string[] {
  const counts = new Map<string, number>();
  for (const loan of loans) {
    if (!loan.city || loan.city === 'Unknown') continue;
    counts.set(loan.city, (counts.get(loan.city) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([city]) => city);
}

export function allMonths(loans: Loan[]): string[] {
  return [...new Set(loans.map((l) => l.disbMonth).filter(Boolean))].sort();
}

export function allStates(loans: Loan[]): string[] {
  return [...new Set(loans.map((l) => l.state).filter((s) => s && s !== 'Other' && s !== 'Unknown'))].sort();
}

export const RANGE_FILTERS: {
  key: keyof Filters;
  label: string;
  min: number;
  max: number;
  step: number;
  format: 'money' | 'percent' | 'ratio' | 'int' | 'score';
}[] = [
  { key: 'score', label: 'LDC score', min: 700, max: 900, step: 1, format: 'score' },
  { key: 'bureau', label: 'Bureau score', min: 0, max: 900, step: 1, format: 'score' },
  { key: 'tenure', label: 'Tenure (months)', min: 1, max: 12, step: 1, format: 'int' },
  { key: 'rate', label: 'Borrower APR', min: 0, max: 60, step: 0.1, format: 'percent' },
  { key: 'amount', label: 'Invested ticket', min: 0, max: 5000, step: 50, format: 'money' },
  { key: 'borrowerAmount', label: 'Borrower loan amount', min: 0, max: 300000, step: 1000, format: 'money' },
  { key: 'age', label: 'Borrower age', min: 18, max: 70, step: 1, format: 'int' },
  { key: 'income', label: 'Monthly income', min: 0, max: 2500000, step: 5000, format: 'money' },
  { key: 'foir', label: 'FOIR', min: 0, max: 2, step: 0.01, format: 'ratio' },
  { key: 'dti', label: 'Loan / annual income', min: 0, max: 2, step: 0.01, format: 'ratio' },
  { key: 'vintage', label: 'Vintage days', min: 0, max: 400, step: 5, format: 'int' },
  { key: 'pos', label: 'Outstanding principal', min: 0, max: 5000, step: 50, format: 'money' },
];
