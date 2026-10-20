import type { Filters, Loan, Meta, ModelData, Rule, Scenario } from './types';
import {
  correlation,
  emi,
  hhi,
  lorenz,
  mean,
  median,
  percentile,
  round,
  safeDiv,
  sum,
  wilsonInterval,
  xirr,
  rng,
  betaSample,
  quantile,
} from './stats';
import { clamp } from './format';

export const DAY = 86_400_000;
export const ASOF = '2026-10-20';

export function isActive(loan: Loan): boolean {
  return loan.status === 0;
}
export function isClosed(loan: Loan): boolean {
  return loan.status !== 0;
}
export function isNpa(loan: Loan): boolean {
  return loan.status === 2 || loan.npa === 1;
}

export function scenarioProfit(loan: Loan, scenario: Scenario): number {
  if (scenario === 'strict') return loan.profitStrict;
  if (scenario === 'recovery') return loan.profitRecovery;
  return loan.profitContractual;
}

export function scenarioXirr(loan: Loan, scenario: Scenario): number | null {
  if (scenario === 'strict') return loan.xirrStrict;
  if (scenario === 'recovery') return loan.xirrRecovery;
  return loan.xirrContractual;
}

export function isBad(loan: Loan, scenario: Scenario): boolean {
  if (isNpa(loan)) return true;
  if (scenario === 'contractual') return false;
  return isActive(loan) && loan.impaired === 1;
}

export function isAtRisk(loan: Loan): boolean {
  return isActive(loan) && loan.impaired === 1;
}

export function effectiveStatus(loan: Loan, scenario: Scenario): 'ACTIVE' | 'CLOSED' | 'NPA' | 'IMPAIRED' {
  if (isNpa(loan)) return 'NPA';
  if (scenario !== 'contractual' && isActive(loan) && loan.impaired) return 'IMPAIRED';
  if (isActive(loan)) return 'ACTIVE';
  return 'CLOSED';
}

export function futureCash(loan: Loan, scenario: Scenario, recoveryRate = 0.45): number {
  if (!isActive(loan)) return 0;
  if (loan.impaired) {
    if (scenario === 'strict') return 0;
    if (scenario === 'recovery') return round(loan.pos * recoveryRate, 2);
  }
  return Math.max(0, round(loan.pos + loan.futureInterest - loan.futureFee, 2));
}

export function futureProfit(loan: Loan, scenario: Scenario): number {
  if (!isActive(loan)) return 0;
  return round(scenarioProfit(loan, scenario) - loan.netProfit, 2);
}

export function expectedLoss(loan: Loan, scenario: Scenario, recoveryRate = 0.45): number {
  if (isNpa(loan)) return loan.npaAmount;
  if (isActive(loan) && loan.impaired) {
    if (scenario === 'strict') return loan.pos;
    if (scenario === 'recovery') return loan.pos * (1 - recoveryRate);
  }
  return 0;
}

export function realizedAnr(loan: Loan): number | null {
  return loan.reportedAnr;
}

export function cashflowsFor(loan: Loan, scenario: Scenario, recoveryRate = 0.45): { time: number; amount: number }[] {
  const flows: { time: number; amount: number }[] = [];
  const disb = new Date(`${loan.disb || ASOF}T00:00:00Z`).getTime();
  flows.push({ time: disb, amount: -loan.amount });
  if (isActive(loan)) {
    if (loan.received > 0) flows.push({ time: new Date(`${ASOF}T00:00:00Z`).getTime(), amount: loan.received });
    const cash = futureCash(loan, scenario, recoveryRate);
    if (cash > 0) {
      const futureDate = loan.maturity && loan.maturity > ASOF ? loan.maturity : '2026-11-19';
      flows.push({ time: new Date(`${futureDate}T00:00:00Z`).getTime(), amount: cash });
    }
  } else if (loan.received > 0) {
    const close = loan.closure || loan.maturity || ASOF;
    flows.push({ time: new Date(`${close}T00:00:00Z`).getTime(), amount: loan.received });
  }
  return flows;
}

export function portfolioXirr(rows: Loan[], scenario: Scenario, recoveryRate = 0.45): number | null {
  const flows: { time: number; amount: number }[] = [];
  for (const loan of rows) {
    if (!loan.amount) continue;
    for (const flow of cashflowsFor(loan, scenario, recoveryRate)) flows.push(flow);
  }
  return xirr(flows);
}

export interface Totals {
  count: number;
  active: number;
  closed: number;
  npa: number;
  impaired: number;
  overdue: number;
  prepaid: number;
  lent: number;
  pos: number;
  received: number;
  principalReceived: number;
  interestReceived: number;
  fee: number;
  npaAmount: number;
  netProfit: number;
  profit: number;
  futureProfit: number;
  loss: number;
  badCount: number;
  npaRate: number;
  impairmentRate: number;
  badRate: number;
  avgTicket: number;
  avgTenure: number;
  avgRate: number;
  avgScore: number;
  avgBureau: number;
  avgAge: number;
  avgHoldingDays: number;
  avgAnr: number;
  medianAnr: number;
  portfolioXirr: number | null;
  roiPct: number;
  recoveryRate: number;
  lossSeverity: number;
  prepayRate: number;
  repeatShare: number;
  expectedReturns: number;
  futureInterest: number;
  ciLow: number;
  ciHigh: number;
}

export function aggregate(rows: Loan[], scenario: Scenario, recoveryRate = 0.45): Totals {
  const closedRows = rows.filter(isClosed);
  const activeRows = rows.filter(isActive);
  const npaRows = rows.filter(isNpa);
  const badRows = rows.filter((l) => isBad(l, scenario));
  const lent = sum(rows, (l) => l.amount);
  const profit = sum(rows, (l) => scenarioProfit(l, scenario));
  const netProfit = sum(rows, (l) => l.netProfit);
  const loss = sum(rows, (l) => expectedLoss(l, scenario, recoveryRate));
  const anrValues = closedRows.map((l) => l.reportedAnr).filter((v): v is number => Number.isFinite(v));
  const ci = wilsonInterval(badRows.length, rows.length);
  return {
    count: rows.length,
    active: activeRows.length,
    closed: closedRows.length,
    npa: npaRows.length,
    impaired: rows.filter((l) => isNpa(l) || (isActive(l) && l.impaired === 1)).length,
    overdue: activeRows.filter((l) => l.dpd > 0).length,
    prepaid: rows.filter((l) => l.prepaid === 1).length,
    lent: round(lent, 2),
    pos: round(sum(activeRows, (l) => l.pos), 2),
    received: round(sum(rows, (l) => l.received), 2),
    principalReceived: round(sum(rows, (l) => l.principalRec), 2),
    interestReceived: round(sum(rows, (l) => l.interestRec), 2),
    fee: round(sum(rows, (l) => l.fee), 2),
    npaAmount: round(sum(npaRows, (l) => l.npaAmount), 2),
    netProfit: round(netProfit, 2),
    profit: round(profit, 2),
    futureProfit: round(profit - netProfit, 2),
    loss: round(loss, 2),
    badCount: badRows.length,
    npaRate: closedRows.length ? round((npaRows.length / closedRows.length) * 100, 2) : 0,
    impairmentRate: rows.length ? round((badRows.length / rows.length) * 100, 2) : 0,
    badRate: rows.length ? round((badRows.length / rows.length) * 100, 2) : 0,
    avgTicket: rows.length ? round(lent / rows.length, 2) : 0,
    avgTenure: rows.length ? round(mean(rows, (l) => l.tenure), 2) : 0,
    avgRate: rows.length ? round(mean(rows, (l) => l.rate), 2) : 0,
    avgScore: rows.length ? round(mean(rows, (l) => l.score), 1) : 0,
    avgBureau: rows.length ? round(mean(rows.filter((l) => l.bureau !== null), (l) => l.bureau ?? 0), 1) : 0,
    avgAge: rows.length ? round(mean(rows, (l) => l.age), 1) : 0,
    avgHoldingDays: rows.length ? round(mean(rows, (l) => l.holdingDays), 1) : 0,
    avgAnr: anrValues.length ? round(mean(anrValues, (v) => v), 2) : 0,
    medianAnr: round(median(anrValues), 2),
    portfolioXirr: portfolioXirr(rows, scenario, recoveryRate),
    roiPct: lent ? round((profit / lent) * 100, 2) : 0,
    recoveryRate: round(
      safeDiv(
        sum(npaRows, (l) => l.amount) - sum(npaRows, (l) => l.npaAmount),
        sum(npaRows, (l) => l.amount),
        0,
      ),
      4,
    ),
    lossSeverity: round(
      safeDiv(sum(npaRows, (l) => l.npaAmount), sum(npaRows, (l) => l.amount), 0),
      4,
    ),
    prepayRate: closedRows.length ? round((rows.filter((l) => l.prepaid === 1).length / closedRows.length) * 100, 2) : 0,
    repeatShare: rows.length ? round((rows.filter((l) => l.repeatCount > 1).length / rows.length) * 100, 2) : 0,
    expectedReturns: round(sum(activeRows, (l) => l.expReturns), 2),
    futureInterest: round(sum(activeRows, (l) => l.futureInterest), 2),
    ciLow: round(ci.low * 100, 2),
    ciHigh: round(ci.high * 100, 2),
  };
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------
export interface Dimension {
  key: string;
  label: string;
  get: (loan: Loan) => string | number;
  order?: string[];
  sort?: 'label' | 'value' | 'count';
}

const band = (value: number | null, edges: number[], labels: string[]): string => {
  if (value === null || !Number.isFinite(value)) return labels[labels.length - 1];
  for (let i = 0; i < edges.length; i += 1) {
    if (value < edges[i]) return labels[i];
  }
  return labels[labels.length - 1];
};

export const DIMENSIONS: Record<string, Dimension> = {
  status: {
    key: 'status',
    label: 'Status',
    get: (l) => (isNpa(l) ? 'NPA' : l.status === 0 ? 'Active' : 'Closed'),
    order: ['Active', 'Closed', 'NPA'],
  },
  grade: {
    key: 'grade',
    label: 'Risk grade',
    get: (l) => ['A (High)', 'AA (Medium)', 'AAA (Low)'][l.grade] ?? 'Unknown',
    order: ['AAA (Low)', 'AA (Medium)', 'A (High)'],
  },
  gender: {
    key: 'gender',
    label: 'Gender',
    get: (l) => ['Male', 'Female', 'Other', 'Unknown'][l.gender] ?? 'Unknown',
  },
  profession: {
    key: 'profession',
    label: 'Borrower type',
    get: (l) => (l.profession === 1 ? 'Self-employed' : 'Salaried'),
  },
  stay: {
    key: 'stay',
    label: 'Residence',
    get: (l) => ['Unknown', 'Self-owned', 'Rented'][l.stay] ?? 'Unknown',
  },
  cityTier: {
    key: 'cityTier',
    label: 'City tier',
    get: (l) => ['Unknown', 'Tier 1 metro', 'Tier 2 city', 'Tier 3 / other'][l.cityTier] ?? 'Unknown',
    order: ['Tier 1 metro', 'Tier 2 city', 'Tier 3 / other', 'Unknown'],
  },
  repay: {
    key: 'repay',
    label: 'Repayment type',
    get: (l) => (l.repay === 1 ? 'Daily EDI' : 'Monthly EMI'),
  },
  listType: {
    key: 'listType',
    label: 'Platform list',
    get: (l) => (l.listType === 0 ? 'Open' : 'Closed'),
  },
  dpdBucket: {
    key: 'dpdBucket',
    label: 'DPD bucket',
    get: (l) => ['0 DPD', '1–30 DPD', '31–60 DPD', '61–90 DPD', '90+ DPD'][l.dpdBucket] ?? '0 DPD',
    order: ['0 DPD', '1–30 DPD', '31–60 DPD', '61–90 DPD', '90+ DPD'],
  },
  tenure: {
    key: 'tenure',
    label: 'Tenure',
    get: (l) => `${l.tenure}M`,
    order: ['1M', '2M', '3M', '4M', '5M', '6M', '7M', '8M', '9M', '10M', '11M', '12M'],
  },
  ageBand: {
    key: 'ageBand',
    label: 'Borrower age',
    get: (l) => band(l.age, [26, 31, 36, 41, 46, 51], ['21–25', '26–30', '31–35', '36–40', '41–45', '46–50', '51+']),
    order: ['21–25', '26–30', '31–35', '36–40', '41–45', '46–50', '51+'],
  },
  incomeBand: {
    key: 'incomeBand',
    label: 'Monthly income',
    get: (l) => band(l.income, [15_001, 25_001, 50_001, 100_001, 250_001], ['≤15k', '15–25k', '25–50k', '50k–1L', '1L–2.5L', '2.5L+ / missing']),
    order: ['≤15k', '15–25k', '25–50k', '50k–1L', '1L–2.5L', '2.5L+ / missing'],
  },
  scoreBand: {
    key: 'scoreBand',
    label: 'LDC score',
    get: (l) => band(l.score, [720, 740, 760, 780, 800], ['700–719', '720–739', '740–759', '760–779', '780–799', '800+']),
    order: ['700–719', '720–739', '740–759', '760–779', '780–799', '800+'],
  },
  bureauBand: {
    key: 'bureauBand',
    label: 'Bureau score',
    get: (l) => band(l.bureau, [550, 600, 650, 700, 750, 800], ['<550', '550–599', '600–649', '650–699', '700–749', '750–799', '800+ / missing']),
    order: ['<550', '550–599', '600–649', '650–699', '700–749', '750–799', '800+ / missing'],
  },
  rateBand: {
    key: 'rateBand',
    label: 'Borrower APR',
    get: (l) => band(l.rate, [35, 40, 44, 46, 48, 52], ['<35%', '35–39%', '40–43%', '44–45%', '46–47%', '48–51%', '52%+']),
    order: ['<35%', '35–39%', '40–43%', '44–45%', '46–47%', '48–51%', '52%+'],
  },
  amountBand: {
    key: 'amountBand',
    label: 'Invested ticket',
    get: (l) => band(l.amount, [251, 501, 1001, 2001], ['₹250', '₹251–500', '₹501–1,000', '₹1,001–2,000', '₹2,001+']),
    order: ['₹250', '₹251–500', '₹501–1,000', '₹1,001–2,000', '₹2,001+'],
  },
  borrowerAmountBand: {
    key: 'borrowerAmountBand',
    label: 'Borrower loan size',
    get: (l) => band(l.borrowerAmount, [5_001, 10_001, 25_001, 50_001, 100_001], ['≤5k', '5–10k', '10–25k', '25–50k', '50k–1L', '1L+']),
    order: ['≤5k', '5–10k', '10–25k', '25–50k', '50k–1L', '1L+'],
  },
  foirBand: {
    key: 'foirBand',
    label: 'FOIR',
    get: (l) => band(l.foir, [0.2, 0.35, 0.5, 0.7, 1], ['<0.20', '0.20–0.34', '0.35–0.49', '0.50–0.69', '0.70–0.99', '1.00+ / missing']),
    order: ['<0.20', '0.20–0.34', '0.35–0.49', '0.50–0.69', '0.70–0.99', '1.00+ / missing'],
  },
  vintageBand: {
    key: 'vintageBand',
    label: 'Vintage',
    get: (l) => band(l.vintageDays, [31, 61, 91, 151, 241], ['<1M', '1–2M', '2–3M', '3–5M', '5–8M', '8M+']),
    order: ['<1M', '1–2M', '2–3M', '3–5M', '5–8M', '8M+'],
  },
  repeat: {
    key: 'repeat',
    label: 'Repeat borrower',
    get: (l) => (l.repeatCount > 1 ? 'Repeat' : 'First-time'),
  },
  month: {
    key: 'disbMonth',
    label: 'Disbursement month',
    get: (l) => l.disbMonth,
  },
  maturityMonth: {
    key: 'maturityMonth',
    label: 'Maturity month',
    get: (l) => l.maturityMonth,
  },
  city: {
    key: 'city',
    label: 'City',
    get: (l) => l.city,
  },
  state: {
    key: 'state',
    label: 'State',
    get: (l) => l.state,
  },
  outcome: {
    key: 'outcome',
    label: 'Outcome',
    get: (l) => (isNpa(l) ? 'NPA' : l.status === 0 ? (l.impaired ? 'Overdue active' : 'On-time active') : 'Closed clean'),
    order: ['Closed clean', 'On-time active', 'Overdue active', 'NPA'],
  },
};

// ---------------------------------------------------------------------------
// Segment stats
// ---------------------------------------------------------------------------
export interface SegmentStat {
  key: string;
  label: string;
  n: number;
  closed: number;
  active: number;
  npa: number;
  bad: number;
  lent: number;
  pos: number;
  profit: number;
  netProfit: number;
  futureProfit: number;
  loss: number;
  npaRate: number;
  badRate: number;
  impairmentRate: number;
  avgAnr: number;
  medianAnr: number;
  xirr: number | null;
  avgTicket: number;
  avgRate: number;
  avgTenure: number;
  avgScore: number;
  avgBureau: number;
  avgAge: number;
  recoveryRate: number;
  lossSeverity: number;
  prepayRate: number;
  ciLow: number;
  ciHigh: number;
  share: number;
  repeatShare: number;
  avgHoldingDays: number;
}

export interface CategoryOptions {
  minN?: number;
  sortBy?: keyof SegmentStat;
  descending?: boolean;
  limit?: number;
  xirr?: boolean;
  filter?: (loan: Loan) => boolean;
}

export function categoryStats(
  rows: Loan[],
  scenario: Scenario,
  dimension: Dimension,
  recoveryRate = 0.45,
  options: CategoryOptions = {},
): SegmentStat[] {
  const source = options.filter ? rows.filter(options.filter) : rows;
  const groups = new Map<string, Loan[]>();
  for (const loan of source) {
    const raw = dimension.get(loan);
    const key = String(raw);
    const list = groups.get(key);
    if (list) list.push(loan);
    else groups.set(key, [loan]);
  }
  const totalLent = sum(source, (l) => l.amount);
  const stats: SegmentStat[] = [];
  for (const [key, group] of groups) {
    const closedGroup = group.filter(isClosed);
    const activeGroup = group.filter(isActive);
    const npaGroup = group.filter(isNpa);
    const badGroup = group.filter((l) => isBad(l, scenario));
    const lent = sum(group, (l) => l.amount);
    const anr = closedGroup.map((l) => l.reportedAnr).filter((v): v is number => Number.isFinite(v));
    const ci = wilsonInterval(badGroup.length, group.length);
    stats.push({
      key,
      label: key,
      n: group.length,
      closed: closedGroup.length,
      active: activeGroup.length,
      npa: npaGroup.length,
      bad: badGroup.length,
      lent: round(lent, 2),
      pos: round(sum(activeGroup, (l) => l.pos), 2),
      profit: round(sum(group, (l) => scenarioProfit(l, scenario)), 2),
      netProfit: round(sum(group, (l) => l.netProfit), 2),
      futureProfit: round(sum(group, (l) => scenarioProfit(l, scenario) - l.netProfit), 2),
      loss: round(sum(group, (l) => expectedLoss(l, scenario, recoveryRate)), 2),
      npaRate: closedGroup.length ? round((npaGroup.length / closedGroup.length) * 100, 2) : 0,
      badRate: group.length ? round((badGroup.length / group.length) * 100, 2) : 0,
      impairmentRate: group.length ? round((badGroup.length / group.length) * 100, 2) : 0,
      avgAnr: anr.length ? round(mean(anr, (v) => v), 2) : 0,
      medianAnr: round(median(anr), 2),
      xirr: options.xirr === false ? null : portfolioXirr(group, scenario, recoveryRate),
      avgTicket: group.length ? round(lent / group.length, 2) : 0,
      avgRate: round(mean(group, (l) => l.rate), 2),
      avgTenure: round(mean(group, (l) => l.tenure), 2),
      avgScore: round(mean(group, (l) => l.score), 1),
      avgBureau: round(mean(group.filter((l) => l.bureau !== null), (l) => l.bureau ?? 0), 1),
      avgAge: round(mean(group, (l) => l.age), 1),
      recoveryRate: round(
        safeDiv(
          sum(npaGroup, (l) => l.amount) - sum(npaGroup, (l) => l.npaAmount),
          sum(npaGroup, (l) => l.amount),
          0,
        ),
        4,
      ),
      lossSeverity: round(safeDiv(sum(npaGroup, (l) => l.npaAmount), sum(npaGroup, (l) => l.amount), 0), 4),
      prepayRate: closedGroup.length ? round((group.filter((l) => l.prepaid === 1).length / closedGroup.length) * 100, 2) : 0,
      ciLow: round(ci.low * 100, 2),
      ciHigh: round(ci.high * 100, 2),
      share: totalLent ? round((lent / totalLent) * 100, 2) : 0,
      repeatShare: group.length ? round((group.filter((l) => l.repeatCount > 1).length / group.length) * 100, 2) : 0,
      avgHoldingDays: round(mean(group, (l) => l.holdingDays), 1),
    });
  }
  const filtered = options.minN ? stats.filter((s) => s.n >= options.minN!) : stats;
  const sortBy = options.sortBy ?? 'lent';
  const descending = options.descending ?? true;
  filtered.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === 'number' && typeof bv === 'number') return descending ? bv - av : av - bv;
    return descending ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
  });
  let out = options.limit ? filtered.slice(0, options.limit) : filtered;
  if (dimension.order) {
    const idx = new Map(dimension.order.map((label, i) => [label, i]));
    out = out.sort((a, b) => (idx.get(a.label) ?? 999) - (idx.get(b.label) ?? 999));
  }
  return out;
}

export function groupRows(rows: Loan[], get: (loan: Loan) => string): Map<string, Loan[]> {
  const map = new Map<string, Loan[]>();
  for (const loan of rows) {
    const key = get(loan);
    const list = map.get(key);
    if (list) list.push(loan);
    else map.set(key, [loan]);
  }
  return map;
}

export function numericSeries(rows: Loan[], get: (loan: Loan) => number | null): number[] {
  return rows.map(get).filter((v): v is number => v !== null && Number.isFinite(v));
}

export interface NumericBin {
  label: string;
  from: number;
  to: number;
  n: number;
  lent: number;
  bad: number;
  badRate: number;
  avgAnr: number;
  profit: number;
  avgValue: number;
  ciLow: number;
  ciHigh: number;
}

export function numericBins(
  rows: Loan[],
  get: (loan: Loan) => number | null,
  bins = 8,
  scenario: Scenario = 'recovery',
  recoveryRate = 0.45,
): NumericBin[] {
  const values = numericSeries(rows, get);
  if (!values.length) return [];
  const lo = quantile(values, 0);
  const hi = quantile(values, 1);
  const width = (hi - lo) / bins || 1;
  const out: NumericBin[] = Array.from({ length: bins }, (_, i) => ({
    label: `${round(lo + width * i, 0)}–${round(lo + width * (i + 1), 0)}`,
    from: lo + width * i,
    to: lo + width * (i + 1),
    n: 0,
    lent: 0,
    bad: 0,
    badRate: 0,
    avgAnr: 0,
    profit: 0,
    avgValue: 0,
    ciLow: 0,
    ciHigh: 0,
  }));
  const anrBuckets: number[][] = Array.from({ length: bins }, () => []);
  for (const loan of rows) {
    const v = get(loan);
    if (v === null || !Number.isFinite(v)) continue;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    const bin = out[idx];
    bin.n += 1;
    bin.lent += loan.amount;
    if (isBad(loan, scenario)) bin.bad += 1;
    bin.profit += scenarioProfit(loan, scenario);
    if (Number.isFinite(loan.reportedAnr)) anrBuckets[idx].push(loan.reportedAnr as number);
  }
  for (let i = 0; i < bins; i += 1) {
    const bin = out[i];
    const ci = wilsonInterval(bin.bad, bin.n);
    bin.lent = round(bin.lent, 2);
    bin.profit = round(bin.profit, 2);
    bin.badRate = bin.n ? round((bin.bad / bin.n) * 100, 2) : 0;
    bin.avgAnr = anrBuckets[i].length ? round(mean(anrBuckets[i], (v) => v), 2) : 0;
    bin.avgValue = bin.n ? round((bin.from + bin.to) / 2, 2) : 0;
    bin.ciLow = round(ci.low * 100, 2);
    bin.ciHigh = round(ci.high * 100, 2);
  }
  return out.filter((b) => b.n > 0);
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------
export interface MonthStat {
  month: string;
  label: string;
  n: number;
  lent: number;
  pos: number;
  received: number;
  netProfit: number;
  profit: number;
  futureProfit: number;
  npa: number;
  bad: number;
  active: number;
  closed: number;
  badRate: number;
  npaRate: number;
  avgAnr: number;
  medianAnr: number;
  avgTicket: number;
  xirr: number | null;
}

export function monthlyStats(rows: Loan[], scenario: Scenario, diagnostics = false): MonthStat[] {
  const groups = groupRows(rows.filter((l) => l.disbMonth), (l) => l.disbMonth);
  const out: MonthStat[] = [];
  for (const [month, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const closed = group.filter(isClosed);
    const npa = group.filter(isNpa);
    const bad = group.filter((l) => isBad(l, scenario));
    const anr = closed.map((l) => l.reportedAnr).filter((v): v is number => Number.isFinite(v));
    out.push({
      month,
      label: month,
      n: group.length,
      lent: round(sum(group, (l) => l.amount), 2),
      pos: round(sum(group, (l) => l.pos), 2),
      received: round(sum(group, (l) => l.received), 2),
      netProfit: round(sum(group, (l) => l.netProfit), 2),
      profit: round(sum(group, (l) => scenarioProfit(l, scenario)), 2),
      futureProfit: round(sum(group, (l) => scenarioProfit(l, scenario) - l.netProfit), 2),
      npa: npa.length,
      bad: bad.length,
      active: group.filter(isActive).length,
      closed: closed.length,
      badRate: group.length ? round((bad.length / group.length) * 100, 2) : 0,
      npaRate: closed.length ? round((npa.length / closed.length) * 100, 2) : 0,
      avgAnr: anr.length ? round(mean(anr, (v) => v), 2) : 0,
      medianAnr: anr.length ? round(median(anr), 2) : 0,
      avgTicket: group.length ? round(sum(group, (l) => l.amount) / group.length, 2) : 0,
      xirr: diagnostics ? portfolioXirr(group, scenario) : null,
    });
  }
  return out;
}

export function cohortMatrix(rows: Loan[], metric: 'npaRate' | 'badRate' | 'avgAnr' | 'count' | 'lent'): {
  months: string[];
  tenures: string[];
  cells: { month: string; tenure: string; value: number; n: number }[];
  max: number;
} {
  const months = [...new Set(rows.map((l) => l.disbMonth).filter(Boolean))].sort();
  const tenures = [...new Set(rows.map((l) => l.tenure))].sort((a, b) => a - b);
  const cells: { month: string; tenure: string; value: number; n: number }[] = [];
  let max = 0;
  for (const month of months) {
    for (const tenure of tenures) {
      const group = rows.filter((l) => l.disbMonth === month && l.tenure === tenure);
      if (!group.length) continue;
      const closed = group.filter(isClosed);
      const npa = group.filter(isNpa);
      const anr = closed
        .filter((l) => l.npa !== 1)
        .map((l) => l.reportedAnr)
        .filter((v): v is number => Number.isFinite(v));
      let value = 0;
      if (metric === 'npaRate') value = closed.length ? (npa.length / closed.length) * 100 : 0;
      else if (metric === 'badRate') value = (npa.length / group.length) * 100;
      else if (metric === 'avgAnr') value = anr.length ? median(anr) : 0;
      else if (metric === 'lent') value = sum(group, (l) => l.amount);
      else value = group.length;
      max = Math.max(max, value);
      cells.push({ month, tenure: `${tenure}M`, value: round(value, 2), n: group.length });
    }
  }
  return { months, tenures: tenures.map((t) => `${t}M`), cells, max };
}

// ---------------------------------------------------------------------------
// Distributions / concentration
// ---------------------------------------------------------------------------
export function distributionStats(values: number[]): {
  n: number;
  mean: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  std: number;
  skew: number;
} {
  if (!values.length) return { n: 0, mean: 0, median: 0, p10: 0, p25: 0, p75: 0, p90: 0, min: 0, max: 0, std: 0, skew: 0 };
  const m = mean(values, (v) => v);
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
  const skew = sd ? values.reduce((s, v) => s + ((v - m) / sd) ** 3, 0) / values.length : 0;
  return {
    n: values.length,
    mean: round(m, 2),
    median: round(median(values), 2),
    p10: round(percentile(values, 10), 2),
    p25: round(percentile(values, 25), 2),
    p75: round(percentile(values, 75), 2),
    p90: round(percentile(values, 90), 2),
    min: round(Math.min(...values), 2),
    max: round(Math.max(...values), 2),
    std: round(sd, 2),
    skew: round(skew, 2),
  };
}

export function concentration(rows: Loan[], get: (loan: Loan) => string): {
  groups: number;
  hhi: number;
  topShare: number;
  topLabel: string;
  topLent: number;
  entropy: number;
} {
  const groups = groupRows(rows, get);
  const totals = [...groups.entries()].map(([label, group]) => ({ label, lent: sum(group, (l) => l.amount) }));
  const total = totals.reduce((s, g) => s + g.lent, 0);
  totals.sort((a, b) => b.lent - a.lent);
  const shares = totals.map((g) => g.lent);
  return {
    groups: totals.length,
    hhi: round(hhi(shares), 0),
    topShare: total ? round((totals[0]?.lent ?? 0) / total * 100, 2) : 0,
    topLabel: totals[0]?.label ?? '—',
    topLent: round(totals[0]?.lent ?? 0, 2),
    entropy: 0,
  };
}

export function lorenzSeries(rows: Loan[], get: (loan: Loan) => string): { x: number; y: number }[] {
  const values = [...groupRows(rows, get).values()].map((group) => sum(group, (l) => l.amount));
  return lorenz(values);
}

// ---------------------------------------------------------------------------
// Borrower aggregation
// ---------------------------------------------------------------------------
export interface BorrowerStat {
  key: string;
  name: string;
  city: string;
  loans: number;
  lent: number;
  pos: number;
  profit: number;
  netProfit: number;
  npa: number;
  bad: number;
  avgScore: number;
  avgBureau: number;
  avgRate: number;
  avgTenure: number;
  first: string;
  last: string;
  npaRate: number;
  xirr: number | null;
}

export function borrowerStats(rows: Loan[], scenario: Scenario): BorrowerStat[] {
  const groups = groupRows(rows, (l) => l.borrowerKey);
  const out: BorrowerStat[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const npa = group.filter(isNpa).length;
    const bad = group.filter((l) => isBad(l, scenario)).length;
    out.push({
      key,
      name: first.name,
      city: first.city,
      loans: group.length,
      lent: round(sum(group, (l) => l.amount), 2),
      pos: round(sum(group, (l) => l.pos), 2),
      profit: round(sum(group, (l) => scenarioProfit(l, scenario)), 2),
      netProfit: round(sum(group, (l) => l.netProfit), 2),
      npa,
      bad,
      avgScore: round(mean(group, (l) => l.score), 1),
      avgBureau: round(mean(group.filter((l) => l.bureau !== null), (l) => l.bureau ?? 0), 1),
      avgRate: round(mean(group, (l) => l.rate), 2),
      avgTenure: round(mean(group, (l) => l.tenure), 2),
      first: group.map((l) => l.disb).sort()[0] ?? '',
      last: group.map((l) => l.disb).sort().slice(-1)[0] ?? '',
      npaRate: group.length ? round((npa / group.length) * 100, 2) : 0,
      xirr: portfolioXirr(group, scenario),
    });
  }
  return out.sort((a, b) => b.lent - a.lent);
}

// ---------------------------------------------------------------------------
// Forward projection & Monte Carlo
// ---------------------------------------------------------------------------
export interface Projection {
  months: { month: string; principal: number; interest: number; cumulativeProfit: number }[];
  pos: number;
  futureProfit: number;
  weightedMonths: number;
  annualisedPct: number;
  contractual: number;
  recovery: number;
  strict: number;
  monteCarlo: { p10: number; p50: number; p90: number; mean: number; histogram: { x: number; count: number }[] };
}

export function forwardProjection(rows: Loan[], scenario: Scenario, meta: Meta, model: ModelData, iterations = 2500): Projection {
  const active = rows.filter(isActive);
  const pos = sum(active, (l) => l.pos) || 1;
  const future = active.map((l) => ({
    loan: l,
    months: Math.max(0.5, l.maturityGapDays ? l.maturityGapDays / 30.44 : 1),
    profit: futureProfit(l, scenario),
  }));
  const weightedMonths = active.length
    ? active.reduce((s, l) => s + l.pos * Math.max(0.5, (l.maturityGapDays ?? 30) / 30.44), 0) / pos
    : 0;
  const totalFuture = future.reduce((s, f) => s + f.profit, 0);
  const annualised = pos && weightedMonths ? (totalFuture / pos) * (12 / weightedMonths) * 100 : 0;

  const monthsMap = new Map<string, { principal: number; interest: number }>();
  for (const l of active) {
    const key = (l.maturityMonth || '2026-11').slice(0, 7);
    const entry = monthsMap.get(key) || { principal: 0, interest: 0 };
    entry.principal += l.pos;
    entry.interest += Math.max(0, l.futureInterest - l.futureFee);
    monthsMap.set(key, entry);
  }
  const months = [...monthsMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  let cumulative = 0;
  const monthSeries = months.map(([month, v]) => {
    cumulative += v.interest;
    return { month, principal: round(v.principal, 2), interest: round(v.interest, 2), cumulativeProfit: round(cumulative, 2) };
  });

  // Monte Carlo: default shocks for on-time active loans, recovery uncertainty
  // for already-impaired loans.
  const random = rng(20261020);
  const pdMap = new Map<string, number>();
  for (const l of active) pdMap.set(l.id, scoreLoan(l, model).pd);
  const simulated: number[] = [];
  const base = sum(rows.filter(isClosed), (l) => l.netProfit) + sum(active, (l) => l.netProfit);
  for (let i = 0; i < iterations; i += 1) {
    let profit = base;
    for (const l of active) {
      const pd = clamp(pdMap.get(l.id) ?? 0.08, 0.005, 0.8);
      if (l.impaired) {
        const rec = betaSample(8, 10, random);
        const recRate = clamp(rec, 0.05, 0.9);
        profit += l.received + l.pos * recRate - l.amount;
      } else if (random() < pd) {
        const severity = betaSample(2, 2, random);
        profit += l.received - l.amount - l.pos * clamp(severity, 0.2, 1);
      } else {
        profit += scenarioProfit(l, scenario) - l.netProfit;
      }
    }
    simulated.push(profit);
  }
  simulated.sort((a, b) => a - b);
  const hist = histogram(simulated, 28);
  return {
    months: monthSeries,
    pos: round(pos, 2),
    futureProfit: round(totalFuture, 2),
    weightedMonths: round(weightedMonths, 2),
    annualisedPct: round(annualised, 2),
    contractual: round(sum(active, (l) => futureProfit(l, 'contractual')), 2),
    recovery: round(sum(active, (l) => futureProfit(l, 'recovery')), 2),
    strict: round(sum(active, (l) => futureProfit(l, 'strict')), 2),
    monteCarlo: {
      p10: round(percentile(simulated, 10), 2),
      p50: round(percentile(simulated, 50), 2),
      p90: round(percentile(simulated, 90), 2),
      mean: round(mean(simulated, (v) => v), 2),
      histogram: hist.map((h) => ({ x: round(h.x, 0), count: h.count })),
    },
  };
}

function histogram(values: number[], bins: number): { x: number; count: number }[] {
  if (!values.length) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const width = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ x: lo + width * (i + 0.5), count: 0 }));
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    out[idx].count += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scorecard / underwriting
// ---------------------------------------------------------------------------
export interface ScoredLoan {
  pd: number;
  modelScore: number;
  missing: number;
  confidence: 'high' | 'medium' | 'low';
  expectedAnnualReturn: number;
  expectedProfit: number;
  decision: 'APPROVE' | 'REVIEW' | 'REJECT';
  reasons: string[];
}

export function scoreLoan(
  loan: Loan,
  model: ModelData,
  options: { strictness?: number; minScore?: number; maxTenure?: number; maxFoir?: number } = {},
): ScoredLoan {
  const values: Record<string, number | null> = {
    score: loan.score,
    bureau: loan.bureau,
    tenure: loan.tenure,
    rate: loan.rate,
    age: loan.age,
    logBorrowerAmount: Math.log1p(loan.borrowerAmount || 0),
    logIncome: loan.income ? Math.log1p(loan.income) : null,
    foir: loan.foir,
    loanToAnnualIncome: loan.loanToAnnualIncome,
    profession: loan.profession,
    female: loan.gender === 1 ? 1 : 0,
    tier2: loan.cityTier === 2 ? 1 : 0,
    tier3: loan.cityTier === 3 ? 1 : 0,
    stayOwned: loan.stay === 1 ? 1 : 0,
    stayRented: loan.stay === 2 ? 1 : 0,
    daily: loan.repay ? 1 : 0,
    gradeAA: loan.grade === 1 ? 1 : 0,
  };
  let z = model.intercept;
  let missing = 0;
  for (const coef of model.coefficients) {
    const raw = values[coef.key];
    const isMissing = raw === null || raw === undefined || !Number.isFinite(raw);
    if (isMissing) missing += 1;
    const v = isMissing ? coef.impute : raw;
    const x = clamp((v - coef.mean) / (coef.std || 1), -6, 6);
    z += coef.coef * x;
  }
  const pd = 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  const adjusted = clamp(pd * (options.strictness ?? 1), 0.001, 0.95);
  const interest = loan.amount * (loan.rate / 100) * (loan.tenure / 12);
  const expectedProfit = interest * (1 - adjusted) - loan.amount * adjusted * model.lgd;
  const annual = loan.amount && loan.tenure
    ? (expectedProfit / loan.amount) * (12 / loan.tenure) * 100
    : 0;
  const minScore = options.minScore ?? 740;
  const maxTenure = options.maxTenure ?? 6;
  const maxFoir = options.maxFoir ?? 0.7;
  const reasons: string[] = [];
  if (loan.score < minScore) reasons.push(`LDC score ${loan.score} below ${minScore}`);
  if (loan.tenure > maxTenure) reasons.push(`Tenure ${loan.tenure}M above ${maxTenure}M cap`);
  if (loan.foir !== null && loan.foir > maxFoir) reasons.push(`FOIR ${(loan.foir * 100).toFixed(0)}% above ${(maxFoir * 100).toFixed(0)}%`);
  if (loan.bureau !== null && loan.bureau < 600) reasons.push(`Bureau ${loan.bureau} below 600`);
  if (loan.impaired) reasons.push('Existing delinquency on book');
  if (loan.cityTier === 0) reasons.push('City unmapped');
  if (missing >= 3) reasons.push(`${missing} model features imputed`);
  const decision = adjusted <= 0.05 && reasons.length === 0
    ? 'APPROVE'
    : adjusted <= 0.12 && !reasons.some((r) => r.includes('below') || r.includes('above')) && loan.tenure <= maxTenure
      ? 'REVIEW'
      : 'REJECT';
  return {
    pd: round(adjusted, 4),
    modelScore: Math.round((1 - adjusted) * 100),
    missing,
    confidence: missing <= 1 ? 'high' : missing <= 3 ? 'medium' : 'low',
    expectedAnnualReturn: round(annual, 2),
    expectedProfit: round(expectedProfit, 2),
    decision,
    reasons,
  };
}

export interface PolicyRules {
  minScore: number;
  maxTenure: number;
  maxFoir: number;
  profession: 'all' | 'salaried' | 'self';
  minRate: number;
  maxTicket: number;
  requireBureau: boolean;
  requireIncome: boolean;
}

export const DEFAULT_POLICY: PolicyRules = {
  minScore: 740,
  maxTenure: 6,
  maxFoir: 0.7,
  profession: 'all',
  minRate: 0,
  maxTicket: 5000,
  requireBureau: false,
  requireIncome: false,
};

export function evaluatePolicy(rows: Loan[], scenario: Scenario, rules: PolicyRules) {
  const closed = rows.filter(isClosed);
  const approved = closed.filter((l) => {
    if (l.score < rules.minScore) return false;
    if (l.tenure > rules.maxTenure) return false;
    if (l.rate < rules.minRate) return false;
    if (l.amount > rules.maxTicket) return false;
    if (rules.profession === 'salaried' && l.profession !== 0) return false;
    if (rules.profession === 'self' && l.profession !== 1) return false;
    if (rules.requireBureau && l.bureau === null) return false;
    if (rules.requireIncome && l.income === null) return false;
    if (l.foir !== null && rules.maxFoir < 10 && l.foir > rules.maxFoir) return false;
    return true;
  });
  const rejected = closed.filter((l) => !approved.includes(l));
  const bad = approved.filter((l) => isNpa(l)).length;
  const anr = approved.map((l) => l.reportedAnr).filter((v): v is number => Number.isFinite(v));
  const lent = sum(approved, (l) => l.amount);
  const profit = sum(approved, (l) => l.netProfit);
  const ci = wilsonInterval(bad, approved.length);
  const flows: { time: number; amount: number }[] = [];
  for (const l of approved) {
    flows.push({ time: new Date(`${l.disb}T00:00:00Z`).getTime(), amount: -l.amount });
    if (l.received > 0) flows.push({ time: new Date(`${l.closure || l.maturity}T00:00:00Z`).getTime(), amount: l.received });
  }
  return {
    approved,
    rejected,
    count: approved.length,
    approvalRate: closed.length ? round((approved.length / closed.length) * 100, 2) : 0,
    npa: bad,
    npaRate: approved.length ? round((bad / approved.length) * 100, 2) : 0,
    npaUpper95: round(ci.high * 100, 2),
    avgAnr: anr.length ? round(mean(anr, (v) => v), 2) : 0,
    lent: round(lent, 2),
    profit: round(profit, 2),
    avgProfit: approved.length ? round(profit / approved.length, 2) : 0,
    xirr: xirr(flows),
    simpleAnnual: lent ? round((profit / lent) * 100, 2) : 0,
    rejectedCount: rejected.length,
    rejectedNpaRate: rejected.length ? round((rejected.filter(isNpa).length / rejected.length) * 100, 2) : 0,
    scenario,
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
export const DEFAULT_FILTERS: Filters = {
  search: '',
  status: [0, 1, 2],
  grade: [0, 1, 2],
  gender: [0, 1, 2, 3],
  profession: [0, 1],
  stay: [0, 1, 2],
  cityTier: [0, 1, 2, 3],
  repay: [0, 1],
  listType: [0, 1],
  dpdBucket: [0, 1, 2, 3, 4],
  score: [700, 900],
  bureau: [0, 900],
  tenure: [1, 12],
  rate: [0, 60],
  amount: [0, 5000],
  borrowerAmount: [0, 300000],
  age: [18, 70],
  income: [0, 2500000],
  foir: [0, 10],
  dti: [0, 10],
  vintage: [0, 400],
  pos: [0, 5000],
  months: [],
  cities: [],
  states: [],
  flags: {
    overdue: 'any',
    npa: 'any',
    prepaid: 'any',
    repeat: 'any',
    matured: 'any',
    incomeMissing: 'any',
    bureauMissing: 'any',
    impaired: 'any',
    positiveProfit: 'any',
  },
};

function inRange(value: number | null, range: [number, number], defaults: [number, number]): boolean {
  if (value === null || !Number.isFinite(value)) {
    return range[0] <= defaults[0] && range[1] >= defaults[1];
  }
  return value >= range[0] && value <= range[1];
}

function tri(value: boolean, state: 'any' | 'yes' | 'no'): boolean {
  if (state === 'any') return true;
  return state === 'yes' ? value : !value;
}

export function applyFilters(rows: Loan[], filters: Filters, rules: Rule[], scenario: Scenario): Loan[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((l) => {
    if (search) {
      const hay = `${l.name} ${l.id} ${l.city} ${l.state} ${l.borrowerKey}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (!filters.status.includes(l.status)) return false;
    if (!filters.grade.includes(l.grade)) return false;
    if (!filters.gender.includes(l.gender)) return false;
    if (!filters.profession.includes(l.profession)) return false;
    if (!filters.stay.includes(l.stay)) return false;
    if (!filters.cityTier.includes(l.cityTier)) return false;
    if (!filters.repay.includes(l.repay)) return false;
    if (!filters.listType.includes(l.listType)) return false;
    if (!filters.dpdBucket.includes(l.dpdBucket)) return false;
    if (l.score < filters.score[0] || l.score > filters.score[1]) return false;
    if (!inRange(l.bureau, filters.bureau, [0, 900])) return false;
    if (l.tenure < filters.tenure[0] || l.tenure > filters.tenure[1]) return false;
    if (l.rate < filters.rate[0] || l.rate > filters.rate[1]) return false;
    if (l.amount < filters.amount[0] || l.amount > filters.amount[1]) return false;
    if (l.borrowerAmount < filters.borrowerAmount[0] || l.borrowerAmount > filters.borrowerAmount[1]) return false;
    if (l.age < filters.age[0] || l.age > filters.age[1]) return false;
    if (!inRange(l.income, filters.income, [0, 250000])) return false;
    if (!inRange(l.foir, filters.foir, [0, 10])) return false;
    if (!inRange(l.loanToAnnualIncome, filters.dti, [0, 10])) return false;
    if (l.vintageDays < filters.vintage[0] || l.vintageDays > filters.vintage[1]) return false;
    if (l.pos < filters.pos[0] || l.pos > filters.pos[1]) return false;
    if (filters.months.length && !filters.months.includes(l.disbMonth)) return false;
    if (filters.cities.length && !filters.cities.includes(l.city)) return false;
    if (filters.states.length && !filters.states.includes(l.state)) return false;
    if (!tri(l.dpd > 0, filters.flags.overdue)) return false;
    if (!tri(isNpa(l), filters.flags.npa)) return false;
    if (!tri(l.prepaid === 1, filters.flags.prepaid)) return false;
    if (!tri(l.repeatCount > 1, filters.flags.repeat)) return false;
    if (!tri(l.isMatured === 1, filters.flags.matured)) return false;
    if (!tri(l.income === null, filters.flags.incomeMissing)) return false;
    if (!tri(l.bureau === null, filters.flags.bureauMissing)) return false;
    if (!tri(isNpa(l) || (isActive(l) && l.impaired === 1), filters.flags.impaired)) return false;
    if (!tri(scenarioProfit(l, scenario) > 0, filters.flags.positiveProfit)) return false;
    for (const rule of rules) {
      if (!applyRule(l, rule)) return false;
    }
    return true;
  });
}

function applyRule(loan: Loan, rule: Rule): boolean {
  if (!rule.field) return true;
  const raw = (loan as unknown as Record<string, unknown>)[rule.field];
  const value = raw === null || raw === undefined ? '' : String(raw);
  const numValue = Number(raw);
  const target = Number(rule.value);
  const target2 = Number(rule.value2);
  switch (rule.op) {
    case 'gt': return Number.isFinite(numValue) && numValue > target;
    case 'gte': return Number.isFinite(numValue) && numValue >= target;
    case 'lt': return Number.isFinite(numValue) && numValue < target;
    case 'lte': return Number.isFinite(numValue) && numValue <= target;
    case 'eq': return value.toLowerCase() === rule.value.toLowerCase();
    case 'neq': return value.toLowerCase() !== rule.value.toLowerCase();
    case 'between': return Number.isFinite(numValue) && numValue >= target && numValue <= target2;
    case 'in': return rule.value.split(',').map((v) => v.trim().toLowerCase()).includes(value.toLowerCase());
    case 'contains': return value.toLowerCase().includes(rule.value.toLowerCase());
    case 'exists': return raw !== null && raw !== undefined && raw !== '' && raw !== 0;
    default: return true;
  }
}

export function activeFilterCount(filters: Filters, rules: Rule[]): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  const defaults = DEFAULT_FILTERS;
  if (filters.status.length !== defaults.status.length) count += 1;
  if (filters.grade.length !== defaults.grade.length) count += 1;
  if (filters.gender.length !== defaults.gender.length) count += 1;
  if (filters.profession.length !== defaults.profession.length) count += 1;
  if (filters.stay.length !== defaults.stay.length) count += 1;
  if (filters.cityTier.length !== defaults.cityTier.length) count += 1;
  if (filters.repay.length !== defaults.repay.length) count += 1;
  if (filters.listType.length !== defaults.listType.length) count += 1;
  if (filters.dpdBucket.length !== defaults.dpdBucket.length) count += 1;
  for (const key of ['score', 'bureau', 'tenure', 'rate', 'amount', 'borrowerAmount', 'age', 'income', 'foir', 'dti', 'vintage', 'pos'] as const) {
    const a = filters[key];
    const b = defaults[key];
    if (a[0] !== b[0] || a[1] !== b[1]) count += 1;
  }
  if (filters.months.length) count += 1;
  if (filters.cities.length) count += 1;
  if (filters.states.length) count += 1;
  if (Object.values(filters.flags).some((v) => v !== 'any')) count += 1;
  count += rules.length;
  return count;
}

// Correlation matrix for risk drivers.
export function correlationMatrix(rows: Loan[], fields: { key: string; label: string; get: (l: Loan) => number | null }[]) {
  const labels = fields.map((f) => f.label);
  const values = fields.map((f) => rows.map((l) => f.get(l) ?? NaN));
  const matrix: { x: number; y: number; value: number }[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    for (let j = 0; j < fields.length; j += 1) {
      matrix.push({ x: i, y: j, value: round(correlation(values[i], values[j]), 3) });
    }
  }
  return { labels, matrix };
}

export function correlationBetween(rows: Loan[], a: (l: Loan) => number | null, b: (l: Loan) => number | null): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const loan of rows) {
    const x = a(loan);
    const y = b(loan);
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  return round(correlation(xs, ys), 3);
}

export function feeStats(rows: Loan[]) {
  const gross = sum(rows, (l) => l.interestRec + l.fee);
  const fee = sum(rows, (l) => l.fee);
  return {
    fee: round(fee, 2),
    gross: round(gross, 2),
    net: round(gross - fee, 2),
    feeToGross: gross ? round((fee / gross) * 100, 2) : 0,
    feeToLent: sum(rows, (l) => l.amount) ? round((fee / sum(rows, (l) => l.amount)) * 100, 2) : 0,
    effectiveFeePct: sum(rows, (l) => l.amount) ? round((fee / sum(rows, (l) => l.amount)) * 100, 2) : 0,
  };
}

export function tenureEmi(loan: Loan): number {
  return loan.emi ?? emi(loan.borrowerAmount, loan.rate, loan.tenure);
}
