export type Scenario = 'contractual' | 'recovery' | 'strict';

export type Nullable<T> = T | null;

export interface Loan {
  id: string;
  name: string;
  borrowerKey: string;
  repeatCount: number;
  age: number;
  gender: number;
  city: string;
  state: string;
  cityTier: number;
  profession: number;
  stay: number;
  income: Nullable<number>;
  borrowerAmount: number;
  bureau: Nullable<number>;
  score: number;
  grade: number;
  amount: number;
  pos: number;
  rate: number;
  tenure: number;
  repay: number;
  listType: number;
  status: number;
  dpd: number;
  dpdBucket: number;
  overdue: number;
  npa: number;
  prepaid: number;
  disb: string;
  inv: string;
  maturity: string;
  closure: string;
  disbMonth: string;
  maturityMonth: string;
  closureMonth: string;
  received: number;
  principalRec: number;
  interestRec: number;
  fee: number;
  npaAmount: number;
  netProfit: number;
  realizedRoi: Nullable<number>;
  reportedAnr: Nullable<number>;
  expReturns: number;
  futureInterest: number;
  futureFee: number;
  profitContractual: number;
  profitRecovery: number;
  profitStrict: number;
  xirrContractual: Nullable<number>;
  xirrRecovery: Nullable<number>;
  xirrStrict: Nullable<number>;
  holdingDays: number;
  vintageDays: number;
  seasoning: number;
  isMatured: number;
  maturityGapDays: Nullable<number>;
  daysToClose: Nullable<number>;
  emi: Nullable<number>;
  foir: Nullable<number>;
  loanToAnnualIncome: Nullable<number>;
  recoveryRate: Nullable<number>;
  lossSeverity: number;
  impaired: number;
  incomeMissing: number;
  bureauMissing: number;
  cityMissing: number;
  stayMissing: number;
  scheme: string;
}

export interface ColumnDef {
  key: keyof Loan | string;
  label: string;
  type: 'id' | 'text' | 'code' | 'money' | 'percent' | 'ratio' | 'int' | 'bool' | 'date' | 'month' | 'score';
  description: string;
}

export interface ScenarioTotals {
  scenario: Scenario;
  totalLent: number;
  realisedProfit: number;
  projectedProfit: number;
  futureProfit: number;
  totalReceived: number;
  pos: number;
  expectedLoss: number;
  portfolioXirr: number | null;
  roiPct: number;
  activeCount: number;
  closedCount: number;
  npaCount: number;
  impairedCount: number;
  impairedPos: number;
  overdueActiveCount: number;
  overdueActivePos: number;
}

export interface ReturnMethods {
  officialClosedAnr: number;
  officialClosedAbsolute: number;
  officialClosedXirr: string;
  officialClosedLent: number;
  officialClosedInterest: number;
  officialClosedNpa: number;
  officialClosedFee: number;
  recomputed: {
    closedLent: number;
    closedProfit: number;
    closedAbsolutePct: number;
    closedAvgHoldingDays: number;
    closedCapitalTimeAnnualPct: number;
    closedPortfolioXirr: number | null;
    closedNaiveMeanAnr: number;
    closedMedianAnr: number;
    closedCount: number;
    closedNpaCount: number;
    closedNpaRateByCount: number;
    closedNpaRateByValue: number;
    closedRecoveryRate: number;
  };
  active: {
    pos: number;
    realisedInterest: number;
    futureInterest: number;
    contractualProfit: number;
    recoveryProfit: number;
    strictProfit: number;
    portfolioXirrContractual: number | null;
    portfolioXirrRecovery: number | null;
    portfolioXirrStrict: number | null;
  };
  whyTheyDiffer: string[];
}

export interface AvailableLoan {
  id: string;
  name: string;
  loanAmount: number;
  fundedAmount: number;
  remainingAmount: number;
  remainingPct: number;
  tenure: number;
  rate: number;
  score: number;
  riskType: string;
  lendingAmount: number;
  repay: string;
  roiList: number[];
}

export interface DataQuality {
  missingIncome: number;
  missingBureau: number;
  missingCity: number;
  missingState: number;
  missingStay: number;
  missingPurpose: number;
  missingMarital: number;
  zeroAmount: number;
  duplicateIds: number;
  closureBeforeDisb: number;
  maturityBeforeDisb: number;
  pastMaturityStillActive: number;
  incomeZeroShare: number;
  bureauZeroShare: number;
  cityCoverage: number;
  stateCoverage: number;
}

export interface Meta {
  schemaVersion: number;
  generatedAt: string;
  asOf: string;
  source: string;
  recoveryRate: number;
  lgd: number;
  counts: {
    loans: number;
    active: number;
    closed: number;
    npa: number;
    overdueActive: number;
    impaired: number;
    borrowers: number;
    repeatBorrowers: number;
    repeatLoans: number;
    cities: number;
    states: number;
    months: number;
    schemes: number;
    columns: number;
  };
  totals: {
    lent: number;
    pos: number;
    received: number;
    principalReceived: number;
    interestReceived: number;
    fee: number;
    npaAmount: number;
    netProfit: number;
    activeExpectedReturns: number;
    activeFutureInterest: number;
  };
  returnMethods: ReturnMethods;
  scenarios: Record<Scenario, ScenarioTotals>;
  officialPortfolio: {
    open: Record<string, unknown> | null;
    closed: Record<string, unknown> | null;
  };
  dataQuality: DataQuality;
  dictionaries: Record<string, string[]>;
  columns: ColumnDef[];
  availableLoans: AvailableLoan[];
  monthly: Record<string, {
    month: string;
    loans: number;
    lent: number;
    active: number;
    closed: number;
    npa: number;
    profit: number;
    received: number;
    pos: number;
  }>;
  notes: string[];
}

export interface ModelCoefficient {
  key: string;
  label: string;
  coef: number;
  mean: number;
  std: number;
  impute: number;
  iv: number;
}

export interface Policy {
  minScore: number;
  maxTenure: number;
  maxFoir: number | null;
  profession: string;
  loans: number;
  approvalRate: number;
  npaRate: number;
  npaUpper95: number;
  avgReportedAnr: number;
  lent: number;
  profit: number;
  avgProfit: number;
  simpleAnnual: number;
  xirr: number | null;
  expectedLossRate: number;
}

export interface WoeBin {
  bin: string;
  count: number;
  bad: number;
  good: number;
  badRate: number;
  woe: number;
}

export interface WoeGroup {
  key: string;
  label: string;
  iv: number;
  bins: WoeBin[];
}

export interface ModelData {
  schemaVersion: number;
  generatedAt: string;
  asOf: string;
  trainedOn: string;
  observations: number;
  events: number;
  eventRate: number;
  features: { key: string; label: string; kind: 'num' | 'cat' }[];
  coefficients: ModelCoefficient[];
  intercept: number;
  metrics: {
    auc: number;
    gini: number;
    ks: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    logLoss: number;
    brier: number;
    cvAuc: number;
    cvFolds: number;
    trainSize: number;
    testSize: number;
    confusion: { tp: number; fp: number; fn: number; tn: number };
  };
  roc: { fpr: number; tpr: number }[];
  lift: { decile: number; count: number; bad: number; badRate: number; lift: number; avgScore: number }[];
  calibration: { bin: number; predicted: number; actual: number; count: number }[];
  /** Platt mapping from the class-balanced scorecard onto real default rates. */
  platt: { a: number; b: number; meanPredicted: number; meanActual: number; baseRate: number; threshold: number };
  woe: WoeGroup[];
  lgd: number;
  recoveryRate: number;
  policyGrid: Policy[];
  policyGridSize: number;
  recommendedPolicies: {
    balanced: Policy | null;
    highestXirr: Policy | null;
    safest: Policy | null;
    shortTenure: Policy | null;
  };
  notes: string[];
}

export type FlagKey =
  | 'overdue'
  | 'npa'
  | 'prepaid'
  | 'repeat'
  | 'matured'
  | 'incomeMissing'
  | 'bureauMissing'
  | 'impaired'
  | 'positiveProfit';

export type Tri = 'any' | 'yes' | 'no';

export interface Filters {
  search: string;
  status: number[];
  grade: number[];
  gender: number[];
  profession: number[];
  stay: number[];
  cityTier: number[];
  repay: number[];
  listType: number[];
  dpdBucket: number[];
  score: [number, number];
  bureau: [number, number];
  tenure: [number, number];
  rate: [number, number];
  amount: [number, number];
  borrowerAmount: [number, number];
  age: [number, number];
  income: [number, number];
  foir: [number, number];
  dti: [number, number];
  vintage: [number, number];
  pos: [number, number];
  months: string[];
  cities: string[];
  states: string[];
  flags: Record<FlagKey, Tri>;
}

export type RuleOp =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'between'
  | 'in'
  | 'contains'
  | 'exists';

export interface Rule {
  id: string;
  field: string;
  op: RuleOp;
  value: string;
  value2: string;
}

export interface Insight {
  tone: 'positive' | 'warning' | 'negative' | 'neutral';
  headline: string;
  detail: string;
  action?: 'PREFER' | 'AVOID' | 'WATCH' | 'INFO';
}

export interface TableData {
  columns: { key: string; label: string; align?: 'left' | 'right'; type?: ColumnDef['type'] }[];
  rows: Record<string, unknown>[];
}

export interface ChartResult {
  option: unknown;
  insight: Insight;
  table?: TableData;
}

export interface ChartSpec {
  id: string;
  title: string;
  subtitle?: string;
  section?: string;
  span?: 1 | 2 | 3 | 4;
  height?: number;
  note?: string;
  build: (rows: Loan[], ctx: ViewContext) => ChartResult;
}

export interface ViewContext {
  scenario: Scenario;
  meta: Meta;
  model: ModelData;
  allLoans: Loan[];
  applyFilter: (field: keyof Filters, value: unknown) => void;
  setSearch: (value: string) => void;
  openLoan: (loan: Loan) => void;
}

export interface PageConfig {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  heroKpis: (rows: Loan[], ctx: ViewContext) => { label: string; value: string; delta?: string; hint?: string; tone?: 'good' | 'bad' | 'neutral' }[];
  sections: { id: string; title: string; description?: string; charts: ChartSpec[] }[];
  custom?: 'underwriting' | 'explorer' | 'methodology' | 'opportunities' | 'executive' | 'policy';
}
