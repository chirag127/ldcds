import type { ChartSpec, Loan, PageConfig, ViewContext } from './types';
import {
  aggregate,
  categoryStats,
  DIMENSIONS,
  isActive,
  isClosed,
  isNpa,
  monthlyStats,
} from './metrics';
import { inrCompact, num, pct } from './format';
import * as K from './chart-kit';
import { COLORS } from './charts';
import { mean, percentile, sum } from './stats';
import { plain } from './insights';

type Kpi = { label: string; value: string; delta?: string; hint?: string; tone?: 'good' | 'bad' | 'neutral' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Annualised XIRR explodes when a loan is held for only days. Charts keep
 * loans held at least a month and drop the ±300% tail so bins stay readable;
 * portfolio XIRR already handles every cash flow and is unaffected.
 */
const xirrGuard = (get: (l: Loan) => number | null) => (l: Loan) =>
  l.holdingDays >= 30 && Math.abs(get(l) ?? 0) <= 300;

const XIRR_GUARD_NOTE = 'Loans held ≥30 days; annualised outliers beyond ±300% excluded';

/**
 * NPA loans report a negative, unbounded "ANR" — it is a write-off, not a
 * return. Charts that plot ANR keep the performing book only, otherwise a
 * single -600% default compresses the whole axis.
 */
const performingAnr = (l: Loan) => l.npa !== 1 && l.reportedAnr !== null;
const ANR_GUARD_NOTE = 'NPA loans excluded — their reported ANR is a write-off, not a return';

function baseKpis(rows: Loan[], ctx: ViewContext): Kpi[] {
  const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
  return [
    { label: 'Loans in view', value: num(t.count), hint: `${num(t.active)} active · ${num(t.closed)} closed` },
    { label: 'Capital deployed', value: inrCompact(t.lent), hint: `avg ticket ${inrCompact(t.avgTicket)}` },
    { label: 'Principal outstanding', value: inrCompact(t.pos), hint: 'live exposure' },
    {
      label: 'Scenario profit',
      value: inrCompact(t.profit),
      delta: `${pct(t.roiPct)} simple return`,
      tone: t.profit > 0 ? 'good' : 'bad',
    },
    {
      label: 'NPA rate',
      value: pct(t.npaRate),
      hint: `${num(t.npa)} of ${num(t.closed)} closed`,
      tone: t.npaRate > 5 ? 'bad' : 'good',
    },
    {
      label: 'Closed-book ANR',
      value: pct(ctx.meta.returnMethods.officialClosedAnr),
      hint: 'platform · closed loans',
      tone: 'good',
    },
  ];
}

function groupSections(id: string, charts: ChartSpec[]): PageConfig['sections'] {
  const map = new Map<string, ChartSpec[]>();
  for (const c of charts) {
    const key = c.section ?? 'Overview';
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }
  return [...map.entries()].map(([title, list], i) => ({
    id: `${id}-s${i + 1}`,
    title,
    description: sectionBlurb(title),
    charts: list,
  }));
}

function sectionBlurb(title: string): string {
  const map: Record<string, string> = {
    'Book at a glance': 'The numbers that decide whether this book is working, with the assumptions made explicit.',
    'Trend': 'How the book evolved by disbursement month. Young cohorts are not comparable with seasoned ones.',
    'Mix': 'Where the money sits and how each slice performs. Volume is not the same as profitability.',
    'Risk & return': 'What the extra yield costs in defaults, and how concentrated the bet is.',
    'Shape of the book': 'Distributions of the inputs. The average is rarely the loan you actually fund.',
    'Composition': 'Shares of capital and loans. Concentration is the risk nobody prices.',
    'Concentration': 'How evenly exposure is spread. A short list of big groups is a single point of failure.',
    'Vintage behaviour': 'Cohorts followed through time. Judgement belongs on seasoned loans only.',
    'Definitions': 'Four ways to compute return, and why they disagree. Pick one and stay consistent.',
    'Loan-level returns': 'Dispersion inside the portfolio. A good average can hide a violent tail.',
    'Return drivers': 'Which segments actually earned their risk premium.',
    'Cash back': 'When active principal becomes cash again, and what it earns in the meantime.',
    'Delinquency': 'Early-warning buckets. Migration matters more than the stock.',
    'Forward view': 'Projection, simulation and maturity ladder for the live book.',
    'Loss anatomy': 'Where NPA came from, how much was recovered, and what it cost.',
    'Recovery': 'Recovered cash against written-off principal, by segment.',
    'Correlation': 'Features that move together. Do not double count them in a model.',
    'Risk drivers': 'Univariate bad rates by feature. Each chart holds everything else constant by accident.',
    'Interaction': 'Two-way cuts where the risk actually lives.',
    'Model quality': 'Discrimination, calibration and stability of the research scorecard.',
    'Model mechanics': 'Coefficients and weight of evidence. Signs must make economic sense.',
    'Policy': 'Full book replay of score and tenure caps, with confidence bounds.',
    'Tenure economics': 'Short loans prepay less and recycle faster; long loans earn more per loan but carry more risk.',
    'Tenure risk': 'Risk and behaviour by contractual length.',
    'Geography': 'States and cities. Small samples are noisy, so read the loan counts.',
    'City detail': 'City-level exposure and quality. Tier labels are a shortcut, not a substitute.',
    'Cohort quality': 'Vintage matrices. Empty cells are cohorts that have not seasoned, not clean cohorts.',
    'Seasoning': 'How impairment builds after disbursement.',
    'Repeat behaviour': 'Borrowers with multiple loans are correlated bets, not independent ones.',
    'Borrower profile': 'Who borrows, and whether the profile predicts behaviour.',
    'Fees': 'The platform takes its cut up front, which matters most on short tenures.',
    'Unit economics': 'Interest, fees and losses to net profit.',
    'Scorecard': 'Research-grade logistic model trained on closed loans. Not a production credit policy.',
    'Policy simulator': 'Rules evaluated on the closed book, with 95% upper bounds on bad rate.',
    'Marketplace': 'Loans captured in the last scrape, scored against the same policy.',
    'Loan explorer': 'Every field, every filter. Export what you see.',
    'Data & method': 'How the dataset was built, sanitised and what is deliberately missing.',
  };
  return map[title] ?? 'Charts built from the filtered book. Every card states what to prefer or avoid.';
}

const dimBars = (prefix: string, section: string, dim: string, metrics: K.MetricKey[]): ChartSpec[] =>
  metrics.map((m) =>
    K.dimBar({
      id: `${prefix}-${dim}-${m}`,
      title: `${cap(K.METRICS[m].label)} by ${DIMENSIONS[dim].label.toLowerCase()}`,
      section,
      dim,
      metric: m,
      table: m === 'npaRate' || m === 'lent',
    }),
  );

const dimPies = (prefix: string, section: string, dims: string[]): ChartSpec[] =>
  dims.map((dim) =>
    K.dimPie({
      id: `${prefix}-${dim}-pie`,
      title: `Capital share by ${DIMENSIONS[dim].label.toLowerCase()}`,
      section,
      dim,
    }),
  );

const dimHist = (prefix: string, section: string, dim: string): ChartSpec[] =>
  [K.dimBar({ id: `${prefix}-${dim}-hist`, title: `${DIMENSIONS[dim].label} loan counts`, section, dim, metric: 'n' })];

// ---------------------------------------------------------------------------
// 1. Executive
// ---------------------------------------------------------------------------
const executive: PageConfig = {
  id: 'executive',
  title: 'Executive',
  eyebrow: 'Command centre',
  description:
    'One page for the whole book: what is deployed, what came back, what is impaired, and which cut of the data actually earns its risk.',
  heroKpis: baseKpis,
  sections: groupSections('exec', [
    K.gaugeChart({
      id: 'exec-gauge-anr',
      title: 'Platform closed-book ANR',
      section: 'Book at a glance',
      label: 'Annualised net return',
      value: (_rows, ctx) => ctx.meta.returnMethods.officialClosedAnr,
      max: 40,
      insight: (v) =>
        plain(
          v > 20 ? 'positive' : 'warning',
          `${pct(v)} is the platform-reported closed-book ANR`,
          'Prepayments inflate this number because fees are booked against a short holding period. Compare it with the capital-time and XIRR figures on the Returns tab before treating it as your realised return.',
          v > 20 ? 'PREFER' : 'WATCH',
        ),
    }),
    K.gaugeChart({
      id: 'exec-gauge-npa',
      title: 'NPA rate on closed loans',
      section: 'Book at a glance',
      label: 'Written off',
      value: (rows) => {
        const closed = rows.filter(isClosed);
        return closed.length ? (closed.filter(isNpa).length / closed.length) * 100 : 0;
      },
      max: 15,
      color: '#fb7185',
      insight: (v) =>
        plain(
          v > 5 ? 'negative' : 'positive',
          `${pct(v)} of closed loans were written off`,
          `Add the ${pct(100 - v)} clean exits and the book still works, but NPA is lumpy: a handful of tickets drive most of the loss. Recoveries are treated separately at 45% in the base case.`,
          v > 5 ? 'AVOID' : 'INFO',
        ),
    }),
    K.gaugeChart({
      id: 'exec-gauge-prepay',
      title: 'Prepayment rate',
      section: 'Book at a glance',
      label: 'Closed early',
      value: (rows) => {
        const closed = rows.filter(isClosed);
        return closed.length ? (closed.filter((l) => l.prepaid === 1).length / closed.length) * 100 : 0;
      },
      max: 100,
      color: '#22d3ee',
      insight: (v) =>
        plain(
          v > 50 ? 'warning' : 'neutral',
          `${pct(v)} of closed loans exited before maturity`,
          'Early exit is good for capital velocity and bad for the yield you thought you locked in. It is also the main reason the reported ANR overstates a hold-to-maturity return.',
          'INFO',
        ),
    }),
    K.gaugeChart({
      id: 'exec-gauge-coverage',
      title: 'Capital returned',
      section: 'Book at a glance',
      label: 'Cash received / invested',
      value: (rows) => {
        const lent = sum(rows, (l) => l.amount);
        return lent ? (sum(rows, (l) => l.received) / lent) * 100 : 0;
      },
      max: 120,
      color: '#a78bfa',
      insight: (v) =>
        plain(
          v > 80 ? 'positive' : 'neutral',
          `${pct(v)} of deployed capital is already back as cash`,
          'The remainder sits in active principal. A high number means the book is mature; a low one means you are still waiting on the thesis to play out.',
          'INFO',
        ),
    }),
    K.scenarioProfitBars({ id: 'exec-scenarios', title: 'Profit under three loss assumptions', section: 'Book at a glance' }),
    K.waterfallProfit({ id: 'exec-waterfall', title: 'Profit bridge', section: 'Book at a glance', span: 2 }),
    K.outcomeFunnel({ id: 'exec-funnel', title: 'Loan lifecycle funnel', section: 'Book at a glance' }),
    K.monthlyCombo({
      id: 'exec-monthly-volume-risk',
      title: 'Monthly deployment and impairment',
      section: 'Trend',
      bar: 'lent',
      line: 'badRate',
    }),
    K.cumulativeChart({ id: 'exec-cumulative', title: 'Cumulative cash flow', section: 'Trend' }),
    K.roiTimeline({ id: 'exec-roi', title: 'Cohort XIRR', section: 'Trend' }),
    K.monthlyLine({ id: 'exec-monthly-profit', title: 'Monthly profit', section: 'Trend', metric: 'profit' }),
    K.monthlyLine({ id: 'exec-monthly-pos', title: 'Monthly outstanding principal', section: 'Trend', metric: 'pos' }),
    K.dimBar({ id: 'exec-grade-npa', title: 'NPA rate by risk grade', section: 'Mix', dim: 'grade', metric: 'npaRate' }),
    K.dimBar({ id: 'exec-state-lent', title: 'Capital by state', section: 'Mix', dim: 'state', metric: 'lent' }),
    K.dimPie({ id: 'exec-grade-pie', title: 'Capital share by grade', section: 'Mix', dim: 'grade' }),
    K.dimBar({ id: 'exec-tenure-npa', title: 'NPA rate by tenure', section: 'Mix', dim: 'tenure', metric: 'npaRate' }),
    K.dimBar({ id: 'exec-score-npa', title: 'NPA rate by LDC score band', section: 'Mix', dim: 'scoreBand', metric: 'npaRate' }),
    K.dimBar({ id: 'exec-profession-npa', title: 'NPA rate by borrower type', section: 'Mix', dim: 'profession', metric: 'npaRate' }),
    K.dimBar({ id: 'exec-tier-bad', title: 'Impairment by city tier', section: 'Mix', dim: 'cityTier', metric: 'badRate' }),
    K.treemapDim({ id: 'exec-state-treemap', title: 'State exposure treemap', section: 'Mix', dim: 'state' }),
    K.returnMethodsBar({ id: 'exec-returns', title: 'Four definitions of return', section: 'Risk & return' }),
    K.xirrSpread({ id: 'exec-xirr-spread', title: 'Loan-level XIRR distribution', section: 'Risk & return' }),
    K.loanScatterByOutcome({ id: 'exec-scatter', title: 'Score versus pricing by outcome', section: 'Risk & return' }),
    K.radarBook({ id: 'exec-radar', title: 'Grade radar', section: 'Risk & return' }),
    K.percentileChart({ id: 'exec-percentiles', title: 'ANR percentiles', section: 'Risk & return' }),
    K.concentrationSummary({ id: 'exec-state-loss', title: 'State exposure versus expected loss', section: 'Risk & return' }),
    K.lorenzChart({ id: 'exec-lorenz', title: 'Capital concentration by state', section: 'Risk & return', dim: 'state' }),
    K.activeMaturityLadder({ id: 'exec-maturity', title: 'Active maturity ladder', section: 'Risk & return' }),
    K.heatMatrix({
      id: 'exec-month-grade-heat',
      title: 'NPA rate by month and grade',
      section: 'Risk & return',
      xGet: (l) => l.disbMonth,
      yGet: (l) => DIMENSIONS.grade.get(l) as string,
      value: 'npaRate',
      xName: 'Disbursement month',
      yName: 'Grade',
    }),
    K.monthlyHeatCalendar({ id: 'exec-calendar', title: 'Daily deployment rhythm', section: 'Trend' }),
  ]),
};

// ---------------------------------------------------------------------------
// 2. Portfolio
// ---------------------------------------------------------------------------
const portfolio: PageConfig = {
  id: 'portfolio',
  title: 'Portfolio',
  eyebrow: 'Composition',
  description:
    'What is actually inside the book — ticket sizes, tenures, borrower profiles and the shape of every input that feeds the return.',
  heroKpis: (rows, ctx) => {
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    return [
      ...baseKpis(rows, ctx).slice(0, 3),
      { label: 'Average ticket', value: inrCompact(t.avgTicket), hint: 'invested per loan' },
      { label: 'Average tenure', value: `${t.avgTenure.toFixed(1)}M`, hint: `avg APR ${pct(t.avgRate)}` },
      { label: 'Repeat borrowers', value: pct(t.repeatShare), hint: 'share of loans with 2+', tone: t.repeatShare > 20 ? 'bad' : 'neutral' },
    ];
  },
  sections: groupSections('portfolio', [
    ...dimHist('pf', 'Shape of the book', 'status'),
    K.histField({ id: 'pf-amount', title: 'Invested ticket distribution', section: 'Shape of the book', label: 'Invested per loan (₹)', get: (l) => l.amount, kind: 'money' }),
    K.histField({ id: 'pf-borrower-amount', title: 'Borrower loan size', section: 'Shape of the book', label: 'Sanctioned amount (₹)', get: (l) => l.borrowerAmount, kind: 'money' }),
    K.histField({ id: 'pf-tenure', title: 'Tenure distribution', section: 'Shape of the book', label: 'Tenure (months)', get: (l) => l.tenure }),
    K.histField({ id: 'pf-rate', title: 'Pricing distribution', section: 'Shape of the book', label: 'Borrower APR %', get: (l) => l.rate, kind: 'percent', color: COLORS.amber }),
    K.histField({ id: 'pf-score', title: 'LDC score distribution', section: 'Shape of the book', label: 'LDC score', get: (l) => l.score, color: COLORS.cyan }),
    K.histField({ id: 'pf-bureau', title: 'Bureau score distribution', section: 'Shape of the book', label: 'CRIF score', get: (l) => l.bureau, color: COLORS.sky }),
    K.histField({ id: 'pf-age', title: 'Borrower age', section: 'Shape of the book', label: 'Age (years)', get: (l) => l.age, color: COLORS.lime }),
    K.histField({ id: 'pf-income', title: 'Monthly income', section: 'Shape of the book', label: 'Income (₹)', get: (l) => l.income, kind: 'money', color: COLORS.teal }),
    K.histField({ id: 'pf-foir', title: 'FOIR distribution', section: 'Shape of the book', label: 'FOIR', get: (l) => l.foir, kind: 'ratio', color: COLORS.orange }),
    K.histField({ id: 'pf-dti', title: 'Loan-to-income ratio', section: 'Shape of the book', label: 'Loan / annual income', get: (l) => l.loanToAnnualIncome, kind: 'ratio', color: COLORS.indigo }),
    K.histField({ id: 'pf-holding', title: 'Holding period', section: 'Shape of the book', label: 'Days held', get: (l) => l.holdingDays, color: COLORS.violet }),
    K.histField({ id: 'pf-profit', title: 'Realised profit per loan', section: 'Shape of the book', label: 'Net profit (₹)', get: (l) => l.netProfit, kind: 'money', color: COLORS.emerald }),
    ...dimPies('pf', 'Composition', ['state', 'grade', 'profession', 'cityTier', 'repay', 'listType', 'gender']),
    K.dimStack({ id: 'pf-outcome-stack', title: 'Outcome composition', section: 'Composition', dim: 'status' }),
    K.dimBar({ id: 'pf-status-count', title: 'Loan count by status', section: 'Composition', dim: 'status', metric: 'n' }),
    ...dimBars('pf', 'Composition', 'grade', ['lent', 'n', 'npaRate', 'anr', 'xirr', 'prepay']),
    ...dimBars('pf', 'Composition', 'profession', ['lent', 'n', 'npaRate', 'anr', 'xirr', 'ticket']),
    ...dimBars('pf', 'Composition', 'cityTier', ['lent', 'n', 'npaRate', 'anr', 'xirr', 'score']),
    ...dimBars('pf', 'Composition', 'tenure', ['lent', 'n', 'npaRate', 'anr', 'xirr', 'prepay']),
    ...dimBars('pf', 'Composition', 'repay', ['lent', 'n', 'npaRate', 'anr']),
    K.lorenzChart({ id: 'pf-lorenz-state', title: 'Capital concentration by state', section: 'Concentration', dim: 'state' }),
    K.lorenzChart({ id: 'pf-lorenz-city', title: 'Capital concentration by city', section: 'Concentration', dim: 'city' }),
    K.paretoDim({ id: 'pf-pareto-city', title: 'City Pareto', section: 'Concentration', dim: 'city' }),
    K.paretoDim({ id: 'pf-pareto-state', title: 'State Pareto', section: 'Concentration', dim: 'state' }),
    K.treemapDim({ id: 'pf-city-treemap', title: 'City exposure treemap', section: 'Concentration', dim: 'city' }),
    K.dimBar({ id: 'pf-city-count', title: 'Loan count by city', section: 'Concentration', dim: 'city', metric: 'n', limit: 20 }),
    K.monthlyLine({ id: 'pf-monthly-count', title: 'Monthly loan count', section: 'Vintage behaviour', metric: 'n' }),
    K.monthlyLine({ id: 'pf-monthly-lent', title: 'Monthly capital deployed', section: 'Vintage behaviour', metric: 'lent' }),
    K.monthlyLine({ id: 'pf-monthly-ticket', title: 'Monthly average ticket', section: 'Vintage behaviour', metric: 'avgTicket' }),
    K.monthlyCombo({ id: 'pf-monthly-combo', title: 'Volume against average ticket', section: 'Vintage behaviour', bar: 'n', line: 'avgTicket' }),
    K.tenureHeat({ id: 'pf-vintage-heat', title: 'Impairment by month and tenure', section: 'Vintage behaviour' }),
    K.dimBar({ id: 'pf-vintage-npa', title: 'NPA rate by vintage age', section: 'Vintage behaviour', dim: 'vintageBand', metric: 'npaRate' }),
    K.scatterXY({
      id: 'pf-scatter-amount-rate',
      title: 'Ticket size against pricing',
      section: 'Shape of the book',
      xLabel: 'Invested (₹)',
      yLabel: 'APR %',
      xGet: (l) => l.amount,
      yGet: (l) => l.rate,
      xKind: 'money',
      yKind: 'percent',
    }),
  ]),
};

// ---------------------------------------------------------------------------
// 3. Returns
// ---------------------------------------------------------------------------
const returns: PageConfig = {
  id: 'returns',
  title: 'Returns',
  eyebrow: 'Unit economics',
  description:
    'Return is not one number. This tab separates booked ANR, capital-time return, XIRR and the naive loan average, then shows where the money actually came from.',
  heroKpis: (rows, ctx) => {
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    const rm = ctx.meta.returnMethods.recomputed;
    return [
      { label: 'Platform ANR', value: pct(ctx.meta.returnMethods.officialClosedAnr), hint: 'closed loans, booked' },
      { label: 'Capital-time annual', value: pct(rm.closedCapitalTimeAnnualPct), hint: 'accounts for idle cash' },
      { label: 'Closed-book XIRR', value: pct(rm.closedPortfolioXirr ?? 0), hint: 'money-weighted', tone: 'good' },
      { label: 'Naive loan mean', value: pct(rm.closedNaiveMeanAnr), hint: 'equal weight per loan', tone: 'neutral' },
      { label: 'Scenario profit', value: inrCompact(t.profit), hint: `${pct(t.roiPct)} on capital`, tone: t.profit > 0 ? 'good' : 'bad' },
      { label: 'Fee drag', value: pct((t.fee / Math.max(1, t.lent)) * 100), hint: `${inrCompact(t.fee)} paid`, tone: 'neutral' },
    ];
  },
  sections: groupSections('returns', [
    K.returnMethodsBar({ id: 'ret-methods', title: 'Four return definitions', section: 'Definitions' }),
    K.scenarioProfitBars({ id: 'ret-scenarios', title: 'Scenario profit', section: 'Definitions' }),
    K.waterfallProfit({ id: 'ret-waterfall', title: 'Where profit comes from', section: 'Definitions' }),
    K.percentileChart({ id: 'ret-percentiles', title: 'ANR percentiles', section: 'Definitions' }),
    K.histField({ id: 'ret-anr-hist', title: 'Reported ANR distribution', section: 'Definitions', label: 'ANR %', subtitle: ANR_GUARD_NOTE, filter: performingAnr, get: (l) => l.reportedAnr, kind: 'percent', color: COLORS.emerald }),
    K.xirrSpread({ id: 'ret-xirr-hist', title: 'Loan-level XIRR distribution', section: 'Definitions' }),
    K.histField({ id: 'ret-profit-hist', title: 'Net profit per loan', section: 'Definitions', label: 'Net profit (₹)', get: (l) => l.netProfit, kind: 'money', color: COLORS.cyan }),
    K.histField({ id: 'ret-roi-hist', title: 'Simple ROI per loan', section: 'Definitions', label: 'Profit / invested %', get: (l) => (l.amount ? (l.netProfit / l.amount) * 100 : null), kind: 'percent', color: COLORS.amber }),
    K.gaugeChart({
      id: 'ret-gauge-anr',
      title: 'Book ANR',
      section: 'Definitions',
      label: 'Closed ANR',
      value: (rows) => {
        const closed = rows.filter(isClosed);
        return closed.length ? mean(closed.map((l) => l.reportedAnr ?? 0), (v) => v) : 0;
      },
      max: 40,
      insight: (v) => plain(v > 20 ? 'positive' : 'warning', `Average closed-loan ANR ${pct(v)}`, 'This is a simple mean across loans, so small tickets count as much as large ones. It is the most generous of the four methods.', 'INFO'),
    }),
    K.gaugeChart({
      id: 'ret-gauge-xirr',
      title: 'Scenario XIRR',
      section: 'Definitions',
      label: 'Money-weighted',
      value: (rows, ctx) => {
        const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
        return t.portfolioXirr === null ? 0 : t.portfolioXirr;
      },
      max: 40,
      color: '#22d3ee',
      insight: (v) => plain(v > 15 ? 'positive' : 'warning', `Money-weighted XIRR ${pct(v)}`, 'XIRR weights every rupee by the time it was at work. It is the only method that matches what your bank balance did.', 'PREFER'),
    }),
    K.histField({ id: 'ret-xirr-consult', title: 'Contractual XIRR distribution', section: 'Loan-level returns', label: 'XIRR %', subtitle: XIRR_GUARD_NOTE, filter: xirrGuard((l) => l.xirrContractual), get: (l) => l.xirrContractual, kind: 'percent', color: COLORS.cyan }),
    K.histField({ id: 'ret-xirr-recovery', title: 'Recovery-case XIRR distribution', section: 'Loan-level returns', label: 'XIRR %', subtitle: XIRR_GUARD_NOTE, filter: xirrGuard((l) => l.xirrRecovery), get: (l) => l.xirrRecovery, kind: 'percent', color: COLORS.emerald }),
    K.histField({ id: 'ret-xirr-strict', title: 'Strict-case XIRR distribution', section: 'Loan-level returns', label: 'XIRR %', subtitle: XIRR_GUARD_NOTE, filter: xirrGuard((l) => l.xirrStrict), get: (l) => l.xirrStrict, kind: 'percent', color: COLORS.rose }),
    K.boxDim({ id: 'ret-box-grade', title: 'ANR spread by grade', section: 'Loan-level returns', dim: 'grade', label: 'ANR %', subtitle: ANR_GUARD_NOTE, filter: performingAnr, get: (l) => l.reportedAnr }),
    K.boxDim({ id: 'ret-box-tenure', title: 'XIRR spread by tenure', section: 'Loan-level returns', dim: 'tenure', label: 'XIRR %', subtitle: XIRR_GUARD_NOTE, filter: xirrGuard((l) => l.xirrRecovery), get: (l) => l.xirrRecovery }),
    ...dimBars('ret', 'Return drivers', 'grade', ['anr', 'xirr', 'profit', 'lent']),
    ...dimBars('ret', 'Return drivers', 'tenure', ['anr', 'xirr', 'prepay', 'profit']),
    ...dimBars('ret', 'Return drivers', 'scoreBand', ['anr', 'xirr', 'npaRate', 'lent']),
    ...dimBars('ret', 'Return drivers', 'profession', ['anr', 'xirr', 'profit', 'npaRate']),
    ...dimBars('ret', 'Return drivers', 'cityTier', ['anr', 'xirr', 'npaRate', 'ticket']),
    ...dimBars('ret', 'Return drivers', 'state', ['xirr', 'anr', 'lent']),
    ...dimBars('ret', 'Return drivers', 'amountBand', ['anr', 'xirr', 'profit', 'npaRate']),
    K.monthlyLine({ id: 'ret-monthly-anr', title: 'Monthly median ANR', section: 'Return drivers', metric: 'avgAnr' }),
    K.roiTimeline({ id: 'ret-monthly-xirr', title: 'Cohort XIRR', section: 'Return drivers' }),
    K.monthlyCombo({ id: 'ret-volume-yield', title: 'Deployment against median ANR', section: 'Return drivers', bar: 'lent', line: 'avgAnr' }),
    K.scatterXY({
      id: 'ret-scatter-tenure-xirr',
      title: 'Tenure against XIRR',
      section: 'Loan-level returns',
      subtitle: XIRR_GUARD_NOTE,
      xLabel: 'Tenure (months)',
      yLabel: 'XIRR %',
      xGet: (l) => l.tenure,
      yGet: (l) => l.xirrRecovery,
      filter: xirrGuard((l) => l.xirrRecovery),
      yKind: 'percent',
    }),
    K.scatterXY({
      id: 'ret-scatter-score-anr',
      title: 'Score against ANR',
      section: 'Loan-level returns',
      subtitle: ANR_GUARD_NOTE,
      xLabel: 'LDC score',
      yLabel: 'ANR %',
      xGet: (l) => l.score,
      yGet: (l) => l.reportedAnr,
      filter: performingAnr,
      yKind: 'percent',
    }),
    K.scatterXY({
      id: 'ret-scatter-amount-anr',
      title: 'Ticket size against ANR',
      section: 'Loan-level returns',
      subtitle: ANR_GUARD_NOTE,
      xLabel: 'Invested (₹)',
      yLabel: 'ANR %',
      xGet: (l) => l.amount,
      yGet: (l) => l.reportedAnr,
      filter: performingAnr,
      xKind: 'money',
      yKind: 'percent',
    }),
    K.cumulativeChart({ id: 'ret-cumulative', title: 'Cumulative investment and return', section: 'Cash back' }),
    K.feeChart({ id: 'ret-fees', title: 'Fees against interest', section: 'Cash back' }),
    K.monthlyLine({ id: 'ret-monthly-received', title: 'Monthly cash received', section: 'Cash back', metric: 'received' }),
    K.dimLine({ id: 'ret-tenure-xirr-line', title: 'XIRR across tenure', section: 'Return drivers', dim: 'tenure', metric: 'xirr', area: true }),
    K.dimLine({ id: 'ret-tenure-anr-line', title: 'Median ANR across tenure', section: 'Return drivers', dim: 'tenure', metric: 'anr', area: true }),
  ]),
};

// ---------------------------------------------------------------------------
// 4. Active book
// ---------------------------------------------------------------------------
const activeBook: PageConfig = {
  id: 'active',
  title: 'Active book',
  eyebrow: 'Live exposure',
  description:
    'Everything still at risk: outstanding principal, delinquency buckets, maturity ladder and a forward projection under three loss assumptions.',
  heroKpis: (rows, ctx) => {
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    const active = rows.filter(isActive);
    const overdue = active.filter((l) => l.impaired === 1);
    return [
      { label: 'Active loans', value: num(active.length), hint: `${num(rows.length)} in view` },
      { label: 'Principal outstanding', value: inrCompact(t.pos), hint: `${pct((t.pos / Math.max(1, t.lent)) * 100)} of deployed` },
      { label: 'Overdue active', value: num(overdue.length), hint: `${inrCompact(sum(overdue, (l) => l.pos))} at risk`, tone: overdue.length ? 'bad' : 'good' },
      { label: 'Future interest', value: inrCompact(t.futureInterest), hint: 'contractual, before fees' },
      { label: 'Expected returns', value: inrCompact(t.expectedReturns), hint: 'platform projection' },
      { label: 'Weighted months left', value: `${(sum(active, (l) => l.pos * Math.max(0.5, (l.maturityGapDays ?? 30) / 30.44)) / Math.max(1, t.pos)).toFixed(1)}M`, hint: 'principal-weighted' },
    ];
  },
  sections: groupSections('active', [
    K.activeMaturityLadder({ id: 'act-ladder', title: 'Maturity ladder', section: 'Cash back' }),
    K.gaugeChart({
      id: 'act-gauge-overdue',
      title: 'Share of active loans overdue',
      section: 'Delinquency',
      label: 'Overdue active',
      value: (rows) => {
        const active = rows.filter(isActive);
        return active.length ? (active.filter((l) => l.impaired === 1).length / active.length) * 100 : 0;
      },
      max: 25,
      color: '#fbbf24',
      insight: (v) => plain(v > 5 ? 'warning' : 'positive', `${pct(v)} of live loans are past due`, 'Overdue active loans are only NPA if they never cure. Treat the bucket as a probability-weighted loss, not a write-off, until it rolls past 90 days.', v > 5 ? 'WATCH' : 'INFO'),
    }),
    K.dpsBucketBars({ id: 'act-dpd', title: 'DPD bucket composition', section: 'Delinquency' }),
    K.dimBar({ id: 'act-dpd-pos', title: 'Outstanding by DPD bucket', section: 'Delinquency', dim: 'dpdBucket', metric: 'pos' }),
    K.dimBar({ id: 'act-dpd-count', title: 'Loan count by DPD bucket', section: 'Delinquency', dim: 'dpdBucket', metric: 'n' }),
    K.dimBar({ id: 'act-state-pos', title: 'Outstanding by state', section: 'Delinquency', dim: 'state', metric: 'pos' }),
    K.dimBar({ id: 'act-grade-pos', title: 'Outstanding by grade', section: 'Delinquency', dim: 'grade', metric: 'pos' }),
    K.dimBar({ id: 'act-profession-pos', title: 'Outstanding by borrower type', section: 'Delinquency', dim: 'profession', metric: 'pos' }),
    K.dimBar({ id: 'act-tenure-pos', title: 'Outstanding by tenure', section: 'Delinquency', dim: 'tenure', metric: 'pos' }),
    K.dimBar({ id: 'act-score-pos', title: 'Outstanding by score band', section: 'Delinquency', dim: 'scoreBand', metric: 'pos' }),
    K.heatMatrix({
      id: 'act-month-dpd',
      title: 'Delinquency by disbursement month and DPD',
      section: 'Delinquency',
      xGet: (l) => l.disbMonth,
      yGet: (l) => DIMENSIONS.dpdBucket.get(l) as string,
      value: 'count',
      xName: 'Disbursement month',
      yName: 'DPD bucket',
    }),
    K.scatterXY({
      id: 'act-scatter-dpd',
      title: 'Score against days past due',
      section: 'Delinquency',
      xLabel: 'LDC score',
      yLabel: 'DPD',
      xGet: (l) => l.score,
      yGet: (l) => l.dpd,
      filter: (l) => isActive(l),
    }),
    K.histField({ id: 'act-pos-hist', title: 'Outstanding per loan', section: 'Cash back', label: 'Principal outstanding (₹)', get: (l) => (isActive(l) ? l.pos : null), kind: 'money', color: COLORS.cyan }),
    K.histField({ id: 'act-gap-hist', title: 'Days to contractual maturity', section: 'Cash back', label: 'Days remaining', get: (l) => (isActive(l) ? l.maturityGapDays : null), color: COLORS.violet }),
    K.histField({ id: 'act-future-interest', title: 'Future interest per loan', section: 'Cash back', label: 'Interest still due (₹)', get: (l) => (isActive(l) ? l.futureInterest : null), kind: 'money', color: COLORS.emerald }),
    K.monthlyLine({ id: 'act-monthly-pos', title: 'Monthly outstanding principal', section: 'Cash back', metric: 'pos' }),
    K.monthlyLine({ id: 'act-monthly-active', title: 'Active loans by month', section: 'Cash back', metric: 'n' }),
    K.dimStack({ id: 'act-outcome', title: 'Active book outcome mix', section: 'Cash back', dim: 'status' }),
    K.forwardFan({ id: 'act-fan', title: 'Projected profit fan', section: 'Forward view' }),
    K.monteCarloChart({ id: 'act-mc', title: 'Monte Carlo profit distribution', section: 'Forward view' }),
    K.projectionBars({ id: 'act-projection', title: 'Forward profit by scenario', section: 'Forward view' }),
    K.monthlyLine({ id: 'act-monthly-npa', title: 'NPA rate by cohort month', section: 'Forward view', metric: 'npaRate' }),
    K.dimBar({ id: 'act-tier-npa', title: 'NPA rate by city tier', section: 'Forward view', dim: 'cityTier', metric: 'npaRate' }),
    K.dimBar({ id: 'act-vintage-npa', title: 'NPA rate by vintage', section: 'Forward view', dim: 'vintageBand', metric: 'npaRate' }),
  ]),
};

// ---------------------------------------------------------------------------
// 5. NPA
// ---------------------------------------------------------------------------
const npa: PageConfig = {
  id: 'npa',
  title: 'NPA & losses',
  eyebrow: 'Loss anatomy',
  description:
    'Every written-off loan, what was recovered, and which borrower, city and product characteristics keep showing up. Delayed active loans are shown separately.',
  heroKpis: (rows, ctx) => {
    const npaRows = rows.filter(isNpa);
    const closed = rows.filter(isClosed);
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    return [
      { label: 'NPA loans', value: num(npaRows.length), hint: `${pct(closed.length ? (npaRows.length / closed.length) * 100 : 0)} of closed`, tone: npaRows.length ? 'bad' : 'good' },
      { label: 'Principal written off', value: inrCompact(t.npaAmount), hint: 'after partial recovery', tone: 'bad' },
      { label: 'Recovery rate', value: pct(t.recoveryRate * 100), hint: 'recovered / sanctioned' },
      { label: 'Loss severity', value: pct(t.lossSeverity * 100), hint: 'NPA amount / principal', tone: 'bad' },
      { label: 'Overdue active', value: num(t.overdue), hint: `${inrCompact(rows.filter((l) => isActive(l) && l.impaired).length ? sum(rows.filter((l) => isActive(l) && l.impaired), (l) => l.pos) : 0)} outstanding` },
      { label: 'Expected loss', value: inrCompact(t.loss), hint: `scenario: ${ctx.scenario}` },
    ];
  },
  sections: groupSections('npa', [
    ...dimBars('npa', 'Loss anatomy', 'grade', ['npaRate', 'n', 'loss', 'severity']),
    ...dimBars('npa', 'Loss anatomy', 'profession', ['npaRate', 'n', 'loss', 'recovery']),
    ...dimBars('npa', 'Loss anatomy', 'cityTier', ['npaRate', 'n', 'loss', 'recovery']),
    ...dimBars('npa', 'Loss anatomy', 'tenure', ['npaRate', 'n', 'loss', 'severity']),
    ...dimBars('npa', 'Loss anatomy', 'scoreBand', ['npaRate', 'n', 'loss', 'severity']),
    ...dimBars('npa', 'Loss anatomy', 'bureauBand', ['npaRate', 'n', 'loss', 'recovery']),
    ...dimBars('npa', 'Loss anatomy', 'incomeBand', ['npaRate', 'n', 'loss', 'severity']),
    ...dimBars('npa', 'Loss anatomy', 'ageBand', ['npaRate', 'n', 'loss', 'recovery']),
    ...dimBars('npa', 'Loss anatomy', 'amountBand', ['npaRate', 'n', 'loss', 'severity']),
    ...dimBars('npa', 'Loss anatomy', 'gender', ['npaRate', 'n', 'loss', 'recovery']),
    ...dimBars('npa', 'Loss anatomy', 'repeat', ['npaRate', 'n', 'loss', 'recovery']),
    ...dimBars('npa', 'Loss anatomy', 'stay', ['npaRate', 'n', 'loss', 'recovery']),
    ...dimBars('npa', 'Loss anatomy', 'repay', ['npaRate', 'n', 'loss', 'recovery']),
    K.dimBar({ id: 'npa-state-count', title: 'NPA count by state', section: 'Loss anatomy', dim: 'state', metric: 'n', filter: (l) => isNpa(l) }),
    K.dimBar({ id: 'npa-city-count', title: 'NPA count by city', section: 'Loss anatomy', dim: 'city', metric: 'n', limit: 20, filter: (l) => isNpa(l) }),
    K.dimPie({ id: 'npa-state-pie', title: 'NPA capital by state', section: 'Loss anatomy', dim: 'state', metric: 'lent' }),
    K.treemapDim({ id: 'npa-state-treemap', title: 'NPA exposure treemap', section: 'Loss anatomy', dim: 'state', subtitle: 'Principal at risk in written-off loans' }),
    K.dimBar({ id: 'npa-state-recovery', title: 'Recovery rate by state', section: 'Recovery', dim: 'state', metric: 'recovery' }),
    K.dimBar({ id: 'npa-grade-recovery', title: 'Recovery rate by grade', section: 'Recovery', dim: 'grade', metric: 'recovery' }),
    K.dimBar({ id: 'npa-tenure-recovery', title: 'Recovery rate by tenure', section: 'Recovery', dim: 'tenure', metric: 'recovery' }),
    K.histField({ id: 'npa-amount-hist', title: 'Written-off amount per loan', section: 'Recovery', label: 'NPA amount (₹)', get: (l) => (isNpa(l) ? l.npaAmount : null), kind: 'money', color: COLORS.rose }),
    K.histField({ id: 'npa-dpd-hist', title: 'Days past due at write-off', section: 'Recovery', label: 'DPD', get: (l) => (isNpa(l) ? l.dpd : null), color: COLORS.orange }),
    K.monthlyLine({ id: 'npa-monthly-rate', title: 'NPA rate by cohort', section: 'Vintage', metric: 'npaRate' }),
    K.monthlyNpaStack({ id: 'npa-monthly-stack', title: 'Cohort outcome composition', section: 'Vintage' }),
    K.tenureHeat({ id: 'npa-heat', title: 'Impairment by month and tenure', section: 'Vintage' }),
    K.heatMatrix({
      id: 'npa-grade-heat',
      title: 'NPA rate by month and grade',
      section: 'Vintage',
      xGet: (l) => l.disbMonth,
      yGet: (l) => DIMENSIONS.grade.get(l) as string,
      value: 'npaRate',
      xName: 'Disbursement month',
      yName: 'Grade',
    }),
    K.waterfallLoss({ id: 'npa-waterfall', title: 'From disbursed to recovered', section: 'Recovery' }),
    K.lorenzChart({ id: 'npa-lorenz', title: 'NPA concentration across loans', section: 'Recovery', dim: 'city' }),
    K.concentrationSummary({ id: 'npa-state-loss', title: 'State exposure against expected loss', section: 'Vintage' }),
  ]),
};

// ---------------------------------------------------------------------------
// 6. Risk
// ---------------------------------------------------------------------------
const risk: PageConfig = {
  id: 'risk',
  title: 'Risk',
  eyebrow: 'Drivers',
  description:
    'Univariate and interaction cuts of delinquency. Score is the strongest single signal, but tenure, product and geography keep showing up after score is held constant.',
  heroKpis: (rows, ctx) => {
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    return [
      { label: 'Impairment rate', value: pct(t.badRate), hint: `${num(t.badCount)} loans`, tone: t.badRate > 5 ? 'bad' : 'good' },
      { label: 'Average LDC score', value: t.avgScore.toFixed(0), hint: 'higher is better' },
      { label: 'Average bureau', value: t.avgBureau ? t.avgBureau.toFixed(0) : 'missing', hint: 'CRIF' },
      { label: 'Average FOIR', value: pct(mean(rows.filter((l) => l.foir !== null).map((l) => l.foir ?? 0), (v) => v) * 100), hint: 'fixed obligations / income' },
      { label: '90+ DPD', value: num(rows.filter((l) => l.dpdBucket === 4).length), hint: 'worst bucket', tone: 'bad' },
      { label: 'CI upper bound', value: pct(t.ciHigh), hint: '95% Wilson on bad rate' },
    ];
  },
  sections: groupSections('risk', [
    K.corrChart({
      id: 'risk-corr',
      title: 'Feature correlation matrix',
      section: 'Correlation',
      fields: [
        { key: 'score', label: 'LDC score', get: (l) => l.score },
        { key: 'bureau', label: 'Bureau', get: (l) => l.bureau },
        { key: 'tenure', label: 'Tenure', get: (l) => l.tenure },
        { key: 'rate', label: 'APR', get: (l) => l.rate },
        { key: 'age', label: 'Age', get: (l) => l.age },
        { key: 'income', label: 'Income', get: (l) => l.income },
        { key: 'foir', label: 'FOIR', get: (l) => l.foir },
        { key: 'dti', label: 'Loan/income', get: (l) => l.loanToAnnualIncome },
        { key: 'amount', label: 'Invested', get: (l) => l.amount },
        { key: 'profit', label: 'Net profit', get: (l) => l.netProfit },
        { key: 'anr', label: 'ANR', get: (l) => l.reportedAnr },
        { key: 'dpd', label: 'DPD', get: (l) => l.dpd },
      ],
    }),
    K.dimBar({ id: 'risk-score-bad', title: 'Impairment by score band', section: 'Risk drivers', dim: 'scoreBand', metric: 'badRate', table: true }),
    K.dimBar({ id: 'risk-bureau-bad', title: 'Impairment by bureau band', section: 'Risk drivers', dim: 'bureauBand', metric: 'badRate' }),
    K.dimBar({ id: 'risk-grade-bad', title: 'Impairment by grade', section: 'Risk drivers', dim: 'grade', metric: 'badRate' }),
    K.dimBar({ id: 'risk-tenure-bad', title: 'Impairment by tenure', section: 'Risk drivers', dim: 'tenure', metric: 'badRate' }),
    K.dimBar({ id: 'risk-foir-bad', title: 'Impairment by FOIR band', section: 'Risk drivers', dim: 'foirBand', metric: 'badRate' }),
    K.dimBar({ id: 'risk-income-bad', title: 'Impairment by income band', section: 'Risk drivers', dim: 'incomeBand', metric: 'badRate' }),
    K.dimBar({ id: 'risk-age-bad', title: 'Impairment by age band', section: 'Risk drivers', dim: 'ageBand', metric: 'badRate' }),
    K.dimBar({ id: 'risk-tier-bad', title: 'Impairment by city tier', section: 'Risk drivers', dim: 'cityTier', metric: 'badRate' }),
    K.dimBar({ id: 'risk-profession-bad', title: 'Impairment by borrower type', section: 'Risk drivers', dim: 'profession', metric: 'badRate' }),
    K.dimBar({ id: 'risk-repeat-bad', title: 'Impairment by repeat status', section: 'Risk drivers', dim: 'repeat', metric: 'badRate' }),
    K.dimBar({ id: 'risk-amount-bad', title: 'Impairment by ticket band', section: 'Risk drivers', dim: 'amountBand', metric: 'badRate' }),
    K.dimBar({ id: 'risk-repay-bad', title: 'Impairment by repayment type', section: 'Risk drivers', dim: 'repay', metric: 'badRate' }),
    K.dimBar({ id: 'risk-vintage-bad', title: 'Impairment by vintage age', section: 'Risk drivers', dim: 'vintageBand', metric: 'badRate' }),
    K.histField({ id: 'risk-foir-hist', title: 'FOIR distribution', section: 'Risk drivers', label: 'FOIR', get: (l) => l.foir, kind: 'ratio', color: COLORS.amber }),
    K.histField({ id: 'risk-dti-hist', title: 'Loan-to-income distribution', section: 'Risk drivers', label: 'Loan / annual income', get: (l) => l.loanToAnnualIncome, kind: 'ratio', color: COLORS.orange }),
    K.histField({ id: 'risk-dpd-hist', title: 'Days past due distribution', section: 'Risk drivers', label: 'DPD', get: (l) => l.dpd, color: COLORS.rose }),
    K.boxDim({ id: 'risk-score-by-grade', title: 'Score spread by grade', section: 'Interaction', dim: 'grade', label: 'LDC score', get: (l) => l.score }),
    K.boxDim({ id: 'risk-rate-by-tenure', title: 'APR spread by tenure', section: 'Interaction', dim: 'tenure', label: 'APR %', get: (l) => l.rate }),
    K.heatMatrix({
      id: 'risk-score-tier-heat',
      title: 'Impairment by score band and city tier',
      section: 'Interaction',
      xGet: (l) => DIMENSIONS.scoreBand.get(l) as string,
      yGet: (l) => DIMENSIONS.cityTier.get(l) as string,
      value: 'badRate',
      xName: 'Score band',
      yName: 'City tier',
    }),
    K.heatMatrix({
      id: 'risk-tenure-tier-heat',
      title: 'Impairment by tenure and city tier',
      section: 'Interaction',
      xGet: (l) => `${l.tenure}M`,
      yGet: (l) => DIMENSIONS.cityTier.get(l) as string,
      value: 'badRate',
      xName: 'Tenure',
      yName: 'City tier',
    }),
    K.heatMatrix({
      id: 'risk-month-dpd-heat',
      title: 'DPD by month and grade',
      section: 'Interaction',
      xGet: (l) => l.disbMonth,
      yGet: (l) => DIMENSIONS.grade.get(l) as string,
      value: 'count',
      xName: 'Disbursement month',
      yName: 'Grade',
    }),
    K.scatterXY({
      id: 'risk-score-bureau',
      title: 'Score against bureau score',
      section: 'Interaction',
      xLabel: 'LDC score',
      yLabel: 'Bureau score',
      xGet: (l) => l.score,
      yGet: (l) => l.bureau,
      groupBy: 'outcome',
    }),
    K.scatterXY({
      id: 'risk-tenure-rate',
      title: 'Tenure against pricing',
      section: 'Interaction',
      xLabel: 'Tenure (months)',
      yLabel: 'APR %',
      xGet: (l) => l.tenure,
      yGet: (l) => l.rate,
      yKind: 'percent',
      groupBy: 'outcome',
    }),
    K.loanScatterByOutcome({ id: 'risk-scatter-outcome', title: 'Score and pricing by outcome', section: 'Interaction' }),
    K.radarBook({ id: 'risk-radar', title: 'Grade risk-return radar', section: 'Interaction' }),
  ]),
};

// ---------------------------------------------------------------------------
// 7. Scorecard
// ---------------------------------------------------------------------------
const scorecard: PageConfig = {
  id: 'scorecard',
  title: 'Scorecard',
  eyebrow: 'Research model',
  description:
    'A logistic scorecard trained on closed loans to rank risk. AUC 0.744 with 5-fold CV at 0.719 — useful for ranking, not for pricing without human review.',
  heroKpis: (_rows, ctx) => [
    { label: 'Model AUC', value: ctx.model.metrics.auc.toFixed(3), hint: `CV ${ctx.model.metrics.cvAuc.toFixed(3)}`, tone: 'good' },
    { label: 'KS statistic', value: ctx.model.metrics.ks.toFixed(3), hint: 'separation' },
    { label: 'Gini', value: ctx.model.metrics.gini.toFixed(3), hint: '2 × AUC − 1' },
    { label: 'Observations', value: num(ctx.model.observations), hint: `${num(ctx.model.events)} events` },
    { label: 'Event rate', value: pct(ctx.model.eventRate * 100), hint: 'closed-loan NPA' },
    { label: 'Brier score', value: ctx.model.metrics.brier.toFixed(3), hint: 'lower is better' },
  ],
  sections: groupSections('scorecard', [
    K.rocChart({ id: 'sc-roc', title: 'ROC curve', section: 'Model quality' }),
    K.gaugeChart({
      id: 'sc-gauge-auc',
      title: 'Discrimination',
      section: 'Model quality',
      label: 'AUC',
      value: (_rows, ctx) => ctx.model.metrics.auc * 100,
      max: 100,
      color: '#22d3ee',
      insight: (v) => plain(v > 70 ? 'positive' : 'warning', `AUC ${(v / 100).toFixed(3)}`, 'AUC is the chance the model ranks a bad loan above a good one. 0.70–0.80 is usable for triage; below 0.65 is not worth deploying.', v > 70 ? 'PREFER' : 'WATCH'),
    }),
    K.liftChart({ id: 'sc-lift', title: 'Decile lift', section: 'Model quality' }),
    K.calibrationChart({ id: 'sc-calibration', title: 'Calibration: predicted versus actual', section: 'Model quality' }),
    K.confusionHeat({ id: 'sc-confusion', title: 'Confusion matrix at 0.5 threshold', section: 'Model quality' }),
    K.metricsBars({ id: 'sc-metrics', title: 'Classification metrics', section: 'Model quality' }),
    K.coefficientBars({ id: 'sc-coef', title: 'Standardised coefficients', section: 'Model mechanics' }),
    K.ivBars({ id: 'sc-iv', title: 'Information value by feature', section: 'Model mechanics' }),
    K.woeChart({ id: 'sc-woe-score', title: 'Weight of evidence: score', section: 'Model mechanics', feature: 'score' }),
    K.woeChart({ id: 'sc-woe-tenure', title: 'Weight of evidence: tenure', section: 'Model mechanics', feature: 'tenure' }),
    K.woeChart({ id: 'sc-woe-bureau', title: 'Weight of evidence: bureau', section: 'Model mechanics', feature: 'bureau' }),
    K.policyFrontier(ctx => ctx.model, { id: 'sc-frontier', title: 'Policy frontier', section: 'Policy' }),
    K.policyHeat({ id: 'sc-policy-heat', title: 'NPA rate by score floor and tenure cap', section: 'Policy' }),
    K.policyTable({ id: 'sc-policy-table', title: 'Policy grid', section: 'Policy' }),
    K.recommendedPolicies({ id: 'sc-recommended', title: 'Recommended policies', section: 'Policy' }),
    K.dimBar({ id: 'sc-score-bad', title: 'Observed impairment by score band', section: 'Model quality', dim: 'scoreBand', metric: 'badRate' }),
    K.dimBar({ id: 'sc-grade-bad', title: 'Observed impairment by grade', section: 'Model quality', dim: 'grade', metric: 'badRate' }),
    K.histField({ id: 'sc-score-hist', title: 'Score distribution in the book', section: 'Model mechanics', label: 'LDC score', get: (l) => l.score, color: COLORS.cyan }),
    K.histField({ id: 'sc-bureau-hist', title: 'Bureau distribution in the book', section: 'Model mechanics', label: 'Bureau score', get: (l) => l.bureau, color: COLORS.sky }),
    K.scatterXY({
      id: 'sc-score-outcome',
      title: 'Score against outcome',
      section: 'Model quality',
      xLabel: 'LDC score',
      yLabel: 'Net profit (₹)',
      xGet: (l) => l.score,
      yGet: (l) => l.netProfit,
      yKind: 'money',
      groupBy: 'outcome',
    }),
    K.dimBar({ id: 'sc-tenure-bad', title: 'Impairment by tenure', section: 'Policy', dim: 'tenure', metric: 'badRate' }),
  ]),
};

// ---------------------------------------------------------------------------
// 8. Tenure
// ---------------------------------------------------------------------------
const tenure: PageConfig = {
  id: 'tenure',
  title: 'Tenure',
  eyebrow: 'Duration economics',
  description:
    'Short tenures recycle capital faster and fail less; long tenures earn more per loan but concentrate risk. This tab prices that trade-off.',
  heroKpis: (rows, ctx) => {
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    const short = rows.filter((l) => l.tenure <= 3);
    const long = rows.filter((l) => l.tenure >= 6);
    return [
      { label: 'Average tenure', value: `${t.avgTenure.toFixed(1)}M`, hint: 'contractual' },
      { label: 'Short (≤3M) share', value: pct((short.length / Math.max(1, rows.length)) * 100), hint: `${num(short.length)} loans` },
      { label: 'Long (≥6M) share', value: pct((long.length / Math.max(1, rows.length)) * 100), hint: `${num(long.length)} loans`, tone: 'neutral' },
      { label: 'Short NPA', value: pct(short.length ? (short.filter(isNpa).length / Math.max(1, short.filter(isClosed).length)) * 100 : 0), hint: 'closed loans', tone: 'good' },
      { label: 'Long NPA', value: pct(long.length ? (long.filter(isNpa).length / Math.max(1, long.filter(isClosed).length)) * 100 : 0), hint: 'closed loans', tone: 'bad' },
      { label: 'Prepayment', value: pct(t.prepayRate), hint: 'closed early' },
    ];
  },
  sections: groupSections('tenure', [
    ...dimBars('ten', 'Tenure economics', 'tenure', ['lent', 'n', 'npaRate', 'anr', 'xirr', 'prepay', 'ticket', 'score']),
    K.dimPie({ id: 'ten-tenure-pie', title: 'Capital share by tenure', section: 'Tenure economics', dim: 'tenure' }),
    K.dimStack({ id: 'ten-tenure-outcomes', title: 'Outcome mix by tenure', section: 'Tenure economics', dim: 'tenure' }),
    K.dimLine({ id: 'ten-tenure-npa-line', title: 'NPA rate across tenure', section: 'Tenure risk', dim: 'tenure', metric: 'npaRate', area: true }),
    K.dimLine({ id: 'ten-tenure-xirr-line', title: 'XIRR across tenure', section: 'Tenure risk', dim: 'tenure', metric: 'xirr', area: true }),
    K.histField({ id: 'ten-hist', title: 'Tenure distribution', section: 'Tenure economics', label: 'Tenure (months)', get: (l) => l.tenure, color: COLORS.violet }),
    K.histField({ id: 'ten-emi-hist', title: 'EMI size', section: 'Tenure economics', label: 'Monthly EMI (₹)', get: (l) => l.emi, kind: 'money', color: COLORS.amber }),
    K.tenureHeat({ id: 'ten-heat', title: 'Impairment by month and tenure', section: 'Tenure risk' }),
    K.heatMatrix({
      id: 'ten-grade-heat',
      title: 'NPA rate by tenure and grade',
      section: 'Tenure risk',
      xGet: (l) => `${l.tenure}M`,
      yGet: (l) => DIMENSIONS.grade.get(l) as string,
      value: 'npaRate',
      xName: 'Tenure',
      yName: 'Grade',
    }),
    K.boxDim({ id: 'ten-box-rate', title: 'APR spread by tenure', section: 'Tenure risk', dim: 'tenure', label: 'APR %', get: (l) => l.rate }),
    K.boxDim({ id: 'ten-box-anr', title: 'ANR spread by tenure', section: 'Tenure risk', dim: 'tenure', label: 'ANR %', subtitle: ANR_GUARD_NOTE, filter: performingAnr, get: (l) => l.reportedAnr }),
    K.scatterXY({
      id: 'ten-scatter-xirr',
      title: 'Tenure against XIRR',
      section: 'Tenure risk',
      subtitle: XIRR_GUARD_NOTE,
      xLabel: 'Tenure (months)',
      yLabel: 'XIRR %',
      xGet: (l) => l.tenure,
      yGet: (l) => l.xirrRecovery,
      filter: xirrGuard((l) => l.xirrRecovery),
      yKind: 'percent',
    }),
    K.monthlyLine({ id: 'ten-monthly-ticket', title: 'Average ticket by month', section: 'Tenure economics', metric: 'avgTicket' }),
    K.monthlyCombo({ id: 'ten-monthly-tenure', title: 'Volume against NPA', section: 'Tenure risk', bar: 'n', line: 'npaRate' }),
    K.paretoDim({ id: 'ten-pareto', title: 'Capital Pareto by tenure', section: 'Tenure economics', dim: 'tenure' }),
    K.lorenzChart({ id: 'ten-lorenz', title: 'Capital concentration by tenure', section: 'Tenure economics', dim: 'tenure' }),
    K.dimBar({ id: 'ten-age-npa', title: 'NPA by age band at each tenure', section: 'Tenure risk', dim: 'ageBand', metric: 'npaRate', filter: (l) => l.tenure <= 3 }),
    K.dimBar({ id: 'ten-long-npa', title: 'NPA by borrower type on long loans', section: 'Tenure risk', dim: 'profession', metric: 'npaRate', filter: (l) => l.tenure >= 6 }),
    K.dimBar({ id: 'ten-short-npa', title: 'NPA by borrower type on short loans', section: 'Tenure risk', dim: 'profession', metric: 'npaRate', filter: (l) => l.tenure <= 3 }),
    K.roiTimeline({ id: 'ten-cohort-xirr', title: 'Cohort XIRR over time', section: 'Tenure economics' }),
    K.activeMaturityLadder({ id: 'ten-ladder', title: 'Maturity ladder by tenure', section: 'Tenure economics' }),
  ]),
};

// ---------------------------------------------------------------------------
// 9. Geography
// ---------------------------------------------------------------------------
const geography: PageConfig = {
  id: 'geography',
  title: 'Geography',
  eyebrow: 'Where the book lives',
  description:
    'State and city exposure with quality overlays. Tier is a useful prior but a weak substitute for the actual loan-level record in small cities.',
  heroKpis: (rows, ctx) => {
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    const topState = categoryStats(rows, ctx.scenario, DIMENSIONS.state, ctx.meta.recoveryRate, { sortBy: 'lent', xirr: false })[0];
    return [
      { label: 'States', value: num(new Set(rows.map((l) => l.state)).size), hint: 'mapped' },
      { label: 'Cities', value: num(new Set(rows.map((l) => l.city)).size), hint: 'normalised' },
      { label: 'Largest state', value: topState?.label ?? '—', hint: topState ? `${pct(topState.share)} of capital` : '' },
      { label: 'Metro share', value: pct((rows.filter((l) => l.cityTier === 1).length / Math.max(1, rows.length)) * 100), hint: 'Tier 1' },
      { label: 'Tier 3 share', value: pct((rows.filter((l) => l.cityTier === 3).length / Math.max(1, rows.length)) * 100), hint: 'small towns' },
      { label: 'Unmapped', value: pct((rows.filter((l) => l.cityTier === 0).length / Math.max(1, rows.length)) * 100), hint: 'no city match', tone: 'neutral' },
    ];
  },
  sections: groupSections('geo', [
    ...dimBars('geo', 'Geography', 'state', ['lent', 'n', 'npaRate', 'anr', 'xirr', 'ticket', 'recovery', 'loss']),
    ...dimBars('geo', 'Geography', 'cityTier', ['lent', 'n', 'npaRate', 'anr', 'xirr', 'ticket']),
    K.dimPie({ id: 'geo-state-pie', title: 'Capital share by state', section: 'Geography', dim: 'state' }),
    K.treemapDim({ id: 'geo-state-treemap', title: 'State exposure treemap', section: 'Geography', dim: 'state' }),
    K.treemapDim({ id: 'geo-city-treemap', title: 'City exposure treemap', section: 'City detail', dim: 'city' }),
    K.paretoDim({ id: 'geo-state-pareto', title: 'State Pareto', section: 'Geography', dim: 'state' }),
    K.paretoDim({ id: 'geo-city-pareto', title: 'City Pareto', section: 'City detail', dim: 'city' }),
    K.lorenzChart({ id: 'geo-state-lorenz', title: 'State concentration', section: 'Geography', dim: 'state' }),
    K.lorenzChart({ id: 'geo-city-lorenz', title: 'City concentration', section: 'City detail', dim: 'city' }),
    K.concentrationSummary({ id: 'geo-state-exposure', title: 'State exposure against expected loss', section: 'Geography' }),
    K.dimBar({ id: 'geo-city-lent', title: 'Capital by city', section: 'City detail', dim: 'city', metric: 'lent', limit: 25 }),
    K.dimBar({ id: 'geo-city-npa', title: 'NPA rate by city', section: 'City detail', dim: 'city', metric: 'npaRate', limit: 25, minN: 10 }),
    K.dimBar({ id: 'geo-city-count', title: 'Loan count by city', section: 'City detail', dim: 'city', metric: 'n', limit: 25 }),
    K.dimBar({ id: 'geo-city-score', title: 'Average score by city', section: 'City detail', dim: 'city', metric: 'score', limit: 25, minN: 10 }),
    K.heatMatrix({
      id: 'geo-state-grade',
      title: 'NPA rate by state and grade',
      section: 'Geography',
      xGet: (l) => l.state,
      yGet: (l) => DIMENSIONS.grade.get(l) as string,
      value: 'npaRate',
      xName: 'State',
      yName: 'Grade',
      xLimit: 16,
    }),
    K.heatMatrix({
      id: 'geo-tier-tenure',
      title: 'Impairment by tier and tenure',
      section: 'Geography',
      xGet: (l) => `${l.tenure}M`,
      yGet: (l) => DIMENSIONS.cityTier.get(l) as string,
      value: 'badRate',
      xName: 'Tenure',
      yName: 'City tier',
    }),
    K.scatterXY({
      id: 'geo-scatter-city',
      title: 'City NPA against average ticket',
      section: 'City detail',
      xLabel: 'Average ticket (₹)',
      yLabel: 'NPA rate %',
      xGet: (l) => l.amount,
      yGet: (l) => (isNpa(l) ? 100 : 0),
      xKind: 'money',
      yKind: 'percent',
      groupBy: 'status',
    }),
    K.monthlyLine({ id: 'geo-monthly', title: 'Monthly deployment', section: 'Geography', metric: 'lent' }),
    K.dimBar({ id: 'geo-state-prepay', title: 'Prepayment rate by state', section: 'Geography', dim: 'state', metric: 'prepay' }),
    K.dimBar({ id: 'geo-state-holding', title: 'Average holding days by state', section: 'Geography', dim: 'state', metric: 'holding' }),
  ]),
};

// ---------------------------------------------------------------------------
// 10. Cohorts
// ---------------------------------------------------------------------------
const cohorts: PageConfig = {
  id: 'cohorts',
  title: 'Cohorts',
  eyebrow: 'Vintage quality',
  description:
    'Every disbursement month followed over time. Recent cohorts look clean because they are young — this tab makes the seasoning gap explicit.',
  heroKpis: (rows, ctx) => {
    const months = monthlyStats(rows, ctx.scenario);
    const latest = months[months.length - 1];
    const first = months[0];
    return [
      { label: 'Cohorts', value: num(months.length), hint: `${first?.label ?? '—'} to ${latest?.label ?? '—'}` },
      { label: 'Latest cohort loans', value: num(latest?.n ?? 0), hint: `invested ${inrCompact(latest?.lent ?? 0)}` },
      { label: 'Latest NPA', value: pct(latest?.npaRate ?? 0), hint: 'too young to trust' },
      { label: 'Peak NPA cohort', value: months.reduce((a, b) => (b.npaRate > a.npaRate ? b : a), months[0] ?? { label: '—', npaRate: 0 }).label, hint: 'closed loans' },
      { label: 'Best XIRR cohort', value: months.reduce((a, b) => ((b.xirr ?? -1) > (a.xirr ?? -1) ? b : a), months[0] ?? { label: '—', xirr: 0 }).label, hint: 'money-weighted' },
      { label: 'Average cohort size', value: num(Math.round(mean(months, (m) => m.n))), hint: 'loans per month' },
    ];
  },
  sections: groupSections('cohorts', [
    K.heatMatrix({
      id: 'coh-bad-heat',
      title: 'Impairment by month and tenure',
      section: 'Cohort quality',
      xGet: (l) => l.disbMonth,
      yGet: (l) => `${l.tenure}M`,
      value: 'badRate',
      xName: 'Cohort month',
      yName: 'Tenure',
      span: 4,
    }),
    K.heatMatrix({
      id: 'coh-lent-heat',
      title: 'Capital deployed by month and tenure',
      section: 'Cohort quality',
      xGet: (l) => l.disbMonth,
      yGet: (l) => `${l.tenure}M`,
      value: 'lent',
      xName: 'Cohort month',
      yName: 'Tenure',
      span: 4,
    }),
    K.heatMatrix({
      id: 'coh-count-heat',
      title: 'Loan count by month and tenure',
      section: 'Cohort quality',
      xGet: (l) => l.disbMonth,
      yGet: (l) => `${l.tenure}M`,
      value: 'count',
      xName: 'Cohort month',
      yName: 'Tenure',
      span: 4,
    }),
    K.cohortCumulative({ id: 'coh-curves', title: 'Impairment curves by cohort', section: 'Seasoning' }),
    K.monthlyLine({ id: 'coh-npa', title: 'NPA rate by cohort', section: 'Seasoning', metric: 'npaRate' }),
    K.monthlyLine({ id: 'coh-bad', title: 'Impairment rate by cohort', section: 'Seasoning', metric: 'badRate' }),
    K.monthlyLine({ id: 'coh-count', title: 'Loan count by cohort', section: 'Cohort quality', metric: 'n' }),
    K.monthlyLine({ id: 'coh-lent', title: 'Capital by cohort', section: 'Cohort quality', metric: 'lent' }),
    K.monthlyLine({ id: 'coh-ticket', title: 'Average ticket by cohort', section: 'Cohort quality', metric: 'avgTicket' }),
    K.monthlyLine({ id: 'coh-anr', title: 'Median ANR by cohort', section: 'Seasoning', metric: 'avgAnr' }),
    K.monthlyLine({ id: 'coh-profit', title: 'Profit by cohort', section: 'Cohort quality', metric: 'profit' }),
    K.monthlyLine({ id: 'coh-received', title: 'Cash received by cohort', section: 'Cohort quality', metric: 'received' }),
    K.roiTimeline({ id: 'coh-xirr', title: 'XIRR by cohort', section: 'Seasoning' }),
    K.monthlyNpaStack({ id: 'coh-stack', title: 'Outcome composition by cohort', section: 'Seasoning' }),
    K.monthlyCombo({ id: 'coh-volume-bad', title: 'Volume against impairment', section: 'Cohort quality', bar: 'lent', line: 'badRate' }),
    K.monthlyCombo({ id: 'coh-volume-anr', title: 'Volume against median ANR', section: 'Cohort quality', bar: 'lent', line: 'avgAnr' }),
    K.cumulativeChart({ id: 'coh-cumulative', title: 'Cumulative deployment and recovery', section: 'Seasoning' }),
    K.dimLine({ id: 'coh-month-line', title: 'NPA across cohort months', section: 'Seasoning', dim: 'month', metric: 'npaRate', area: true }),
    K.dimLine({ id: 'coh-month-count', title: 'Loan count across cohort months', section: 'Cohort quality', dim: 'month', metric: 'n' }),
    K.dimBar({ id: 'coh-vintage-npa', title: 'NPA by vintage age band', section: 'Seasoning', dim: 'vintageBand', metric: 'npaRate' }),
    K.paretoDim({ id: 'coh-pareto', title: 'Capital Pareto by cohort', section: 'Cohort quality', dim: 'month' }),
    K.monthlyHeatCalendar({ id: 'coh-calendar', title: 'Daily deployment patterns', section: 'Cohort quality' }),
  ]),
};

// ---------------------------------------------------------------------------
// 11. Borrowers
// ---------------------------------------------------------------------------
const borrowers: PageConfig = {
  id: 'borrowers',
  title: 'Borrowers',
  eyebrow: 'People and repeat bets',
  description:
    'Names are published by design; PAN, phone, email and agreement links are stripped. Repeat borrowing is correlated risk disguised as diversification.',
  heroKpis: (rows, ctx) => {
    const stats = new Map<string, Loan[]>();
    for (const l of rows) {
      const list = stats.get(l.borrowerKey);
      if (list) list.push(l);
      else stats.set(l.borrowerKey, [l]);
    }
    const repeat = [...stats.values()].filter((g) => g.length > 1);
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    return [
      { label: 'Borrowers', value: num(stats.size), hint: `${num(rows.length)} loans` },
      { label: 'Repeat borrowers', value: num(repeat.length), hint: `${num(repeat.flat().length)} loans` },
      { label: 'Repeat share of capital', value: pct((repeat.flat().reduce((s, l) => s + l.amount, 0) / Math.max(1, t.lent)) * 100), hint: 'correlated exposure', tone: 'neutral' },
      { label: 'Max loans to one borrower', value: num(Math.max(...[...stats.values()].map((g) => g.length), 0)), hint: 'concentration' },
      { label: 'Average score', value: t.avgScore.toFixed(0), hint: 'across loans' },
      { label: 'NPA borrowers', value: num(new Set(rows.filter(isNpa).map((l) => l.borrowerKey)).size), hint: `${num(rows.filter(isNpa).length)} NPA loans`, tone: 'bad' },
    ];
  },
  sections: groupSections('borrowers', [
    K.topBorrowersTable({ id: 'bor-table', title: 'Largest borrower exposures', section: 'Repeat behaviour' }),
    K.histField({ id: 'bor-repeat-hist', title: 'Loans per borrower', section: 'Repeat behaviour', label: 'Loan count', get: (l) => l.repeatCount, color: COLORS.cyan }),
    K.dimBar({ id: 'bor-repeat-npa', title: 'NPA rate: repeat versus first-time', section: 'Repeat behaviour', dim: 'repeat', metric: 'npaRate' }),
    K.dimBar({ id: 'bor-repeat-lent', title: 'Capital: repeat versus first-time', section: 'Repeat behaviour', dim: 'repeat', metric: 'lent' }),
    K.dimBar({ id: 'bor-repeat-anr', title: 'ANR: repeat versus first-time', section: 'Repeat behaviour', dim: 'repeat', metric: 'anr' }),
    K.dimBar({ id: 'bor-repeat-ticket', title: 'Average ticket: repeat versus first-time', section: 'Repeat behaviour', dim: 'repeat', metric: 'ticket' }),
    K.dimPie({ id: 'bor-repeat-pie', title: 'Loan share by borrower type', section: 'Repeat behaviour', dim: 'repeat', metric: 'n' }),
    K.dimBar({ id: 'bor-gender-npa', title: 'NPA rate by gender', section: 'Borrower profile', dim: 'gender', metric: 'npaRate' }),
    K.dimBar({ id: 'bor-gender-lent', title: 'Capital by gender', section: 'Borrower profile', dim: 'gender', metric: 'lent' }),
    K.dimBar({ id: 'bor-age-npa', title: 'NPA rate by age band', section: 'Borrower profile', dim: 'ageBand', metric: 'npaRate' }),
    K.dimBar({ id: 'bor-age-anr', title: 'ANR by age band', section: 'Borrower profile', dim: 'ageBand', metric: 'anr' }),
    K.dimBar({ id: 'bor-income-npa', title: 'NPA rate by income band', section: 'Borrower profile', dim: 'incomeBand', metric: 'npaRate' }),
    K.dimBar({ id: 'bor-stay-npa', title: 'NPA rate by residence status', section: 'Borrower profile', dim: 'stay', metric: 'npaRate' }),
    K.dimBar({ id: 'bor-city-lent', title: 'Capital by city', section: 'Borrower profile', dim: 'city', metric: 'lent', limit: 20 }),
    K.dimBar({ id: 'bor-city-recovery', title: 'Recovery rate by city', section: 'Borrower profile', dim: 'city', metric: 'recovery', limit: 20, minN: 10 }),
    K.histField({ id: 'bor-income-hist', title: 'Income distribution', section: 'Borrower profile', label: 'Monthly income (₹)', get: (l) => l.income, kind: 'money', color: COLORS.teal }),
    K.histField({ id: 'bor-amount-hist', title: 'Borrower loan size', section: 'Borrower profile', label: 'Sanctioned amount (₹)', get: (l) => l.borrowerAmount, kind: 'money', color: COLORS.violet }),
    K.scatterXY({
      id: 'bor-income-amount',
      title: 'Income against loan size',
      section: 'Borrower profile',
      xLabel: 'Monthly income (₹)',
      yLabel: 'Borrower loan (₹)',
      xGet: (l) => l.income,
      yGet: (l) => l.borrowerAmount,
      xKind: 'money',
      yKind: 'money',
    }),
    K.scatterXY({
      id: 'bor-score-age',
      title: 'Age against score',
      section: 'Borrower profile',
      xLabel: 'Age',
      yLabel: 'LDC score',
      xGet: (l) => l.age,
      yGet: (l) => l.score,
      groupBy: 'outcome',
    }),
    K.lorenzChart({ id: 'bor-lorenz-city', title: 'Borrower concentration by city', section: 'Repeat behaviour', dim: 'city' }),
    K.dimStack({ id: 'bor-outcome', title: 'Outcome mix by borrower type', section: 'Repeat behaviour', dim: 'repeat' }),
  ]),
};

// ---------------------------------------------------------------------------
// 12. Fees
// ---------------------------------------------------------------------------
const fees: PageConfig = {
  id: 'fees',
  title: 'Fees',
  eyebrow: 'Platform cost',
  description:
    'Fees are charged up front, so their drag on annualised return is largest on short loans. This tab quantifies what the platform keeps.',
  heroKpis: (rows, ctx) => {
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    return [
      { label: 'Total fees', value: inrCompact(t.fee), hint: `${pct((t.fee / Math.max(1, t.lent)) * 100)} of capital` },
      { label: 'Fees / interest', value: pct((t.fee / Math.max(1, t.interestReceived)) * 100), hint: `${inrCompact(t.interestReceived)} interest` },
      { label: 'Fees / profit', value: pct((t.fee / Math.max(1, t.profit)) * 100), hint: 'scenario profit' },
      { label: 'Average fee per loan', value: inrCompact(t.fee / Math.max(1, t.count)), hint: 'all loans' },
      { label: 'Net interest', value: inrCompact(t.interestReceived - t.fee), hint: 'after platform cut' },
      { label: 'Fee-free loans', value: num(rows.filter((l) => l.fee === 0).length), hint: `${pct((rows.filter((l) => l.fee === 0).length / Math.max(1, rows.length)) * 100)} of book` },
    ];
  },
  sections: groupSections('fees', [
    K.feeChart({ id: 'fee-monthly', title: 'Fees against interest received', section: 'Unit economics' }),
    K.histField({ id: 'fee-hist', title: 'Fee per loan', section: 'Unit economics', label: 'Fee (₹)', get: (l) => l.fee, kind: 'money', color: COLORS.orange }),
    K.histField({ id: 'fee-pct-hist', title: 'Effective fee rate', section: 'Unit economics', label: 'Fee / invested %', get: (l) => (l.amount ? (l.fee / l.amount) * 100 : null), kind: 'percent', color: COLORS.amber }),
    K.scatterXY({
      id: 'fee-scatter',
      title: 'Fee against interest earned',
      section: 'Unit economics',
      xLabel: 'Fee (₹)',
      yLabel: 'Interest received (₹)',
      xGet: (l) => l.fee,
      yGet: (l) => l.interestRec,
      xKind: 'money',
      yKind: 'money',
    }),
    K.feeByDim({ id: 'fee-by-tenure', title: 'Fees by tenure', section: 'Unit economics', dim: 'tenure' }),
    K.feeByDim({ id: 'fee-by-grade', title: 'Fees by grade', section: 'Unit economics', dim: 'grade' }),
    K.feeByDim({ id: 'fee-by-state', title: 'Fees by state', section: 'Unit economics', dim: 'state' }),
    K.feeByDim({ id: 'fee-by-tier', title: 'Fees by city tier', section: 'Unit economics', dim: 'cityTier' }),
    K.feeByDim({ id: 'fee-by-amount', title: 'Fees by ticket band', section: 'Unit economics', dim: 'amountBand' }),
    K.feeRateByDim({ id: 'feeper-loan', title: 'Effective fee drag by loan size', section: 'Unit economics', dim: 'borrowerAmountBand' }),
    K.feeRateByDim({ id: 'feeper-tenure', title: 'Effective fee drag by tenure', section: 'Unit economics', dim: 'tenure' }),
    K.feeRateByDim({ id: 'feeper-grade', title: 'Effective fee drag by grade', section: 'Unit economics', dim: 'grade' }),
    K.waterfallProfit({ id: 'fee-waterfall', title: 'Fee drag inside the profit bridge', section: 'Unit economics' }),
    K.dimBar({ id: 'fee-amount-lent', title: 'Capital by ticket band', section: 'Unit economics', dim: 'amountBand', metric: 'lent' }),
    K.dimBar({ id: 'fee-tenure-anr', title: 'ANR by tenure', section: 'Unit economics', dim: 'tenure', metric: 'anr' }),
    K.dimBar({ id: 'fee-tenure-xirr', title: 'XIRR by tenure', section: 'Unit economics', dim: 'tenure', metric: 'xirr' }),
    K.monthlyLine({ id: 'fee-monthly-interest', title: 'Monthly interest received', section: 'Unit economics', metric: 'received' }),
    K.monthlyLine({ id: 'fee-monthly-profit', title: 'Monthly profit', section: 'Unit economics', metric: 'profit' }),
    K.scenarioProfitBars({ id: 'fee-scenarios', title: 'Profit across scenarios', section: 'Unit economics' }),
    K.boxDim({ id: 'fee-box-tenure', title: 'Fee spread by tenure', section: 'Unit economics', dim: 'tenure', label: 'Fee (₹)', get: (l) => l.fee, kind: 'money' }),
  ]),
};

// ---------------------------------------------------------------------------
// 13. Underwriting (custom UI + supporting charts)
// ---------------------------------------------------------------------------
const underwriting: PageConfig = {
  id: 'underwriting',
  title: 'Underwriting',
  eyebrow: 'Decision lab',
  description:
    'Replay a policy against the closed book, see the loans it removes, and stress the cut-off. Then score a hypothetical loan with the research model.',
  heroKpis: (rows, ctx) => {
    const balanced = ctx.model.recommendedPolicies.balanced;
    const t = aggregate(rows, ctx.scenario, ctx.meta.recoveryRate);
    return [
      { label: 'Recommended floor', value: balanced ? `${balanced.minScore}` : '740', hint: balanced ? `tenure ≤${balanced.maxTenure}M` : '' },
      { label: 'Approval rate', value: balanced ? pct(balanced.approvalRate * 100) : '—', hint: 'closed book replay' },
      { label: 'Approved NPA', value: balanced ? pct(balanced.npaRate * 100) : '—', hint: '95% upper: ' + (balanced ? pct(balanced.npaUpper95 * 100) : '—'), tone: 'good' },
      { label: 'Approved XIRR', value: balanced ? pct(balanced.xirr ?? 0) : '—', hint: 'closed loans', tone: 'good' },
      { label: 'Current book NPA', value: pct(t.npaRate), hint: 'for comparison', tone: 'bad' },
      { label: 'Model AUC', value: ctx.model.metrics.auc.toFixed(3), hint: 'research grade' },
    ];
  },
  custom: 'underwriting',
  sections: groupSections('uw', [
    K.policyFrontier((ctx) => ctx.model, { id: 'uw-frontier', title: 'Policy frontier', section: 'Policy simulator' }),
    K.policyHeat({ id: 'uw-heat', title: 'NPA grid by score floor and tenure cap', section: 'Policy simulator' }),
    K.recommendedPolicies({ id: 'uw-recommended', title: 'Recommended policy comparison', section: 'Policy simulator' }),
    K.dimBar({ id: 'uw-score-bad', title: 'Observed bad rate by score band', section: 'Policy simulator', dim: 'scoreBand', metric: 'badRate' }),
    K.dimBar({ id: 'uw-tenure-bad', title: 'Observed bad rate by tenure', section: 'Policy simulator', dim: 'tenure', metric: 'badRate' }),
    K.rocChart({ id: 'uw-roc', title: 'Model ROC', section: 'Policy simulator' }),
    K.liftChart({ id: 'uw-lift', title: 'Decile lift', section: 'Policy simulator' }),
    K.calibrationChart({ id: 'uw-calibration', title: 'Model calibration', section: 'Policy simulator' }),
    K.coefficientBars({ id: 'uw-coef', title: 'Scorecard coefficients', section: 'Policy simulator' }),
    K.policyTable({ id: 'uw-policy-table', title: 'Full policy grid', section: 'Policy detail' }),
    K.confusionHeat({ id: 'uw-confusion', title: 'Confusion matrix at the 0.5 cut-off', section: 'Model quality' }),
    K.metricsBars({ id: 'uw-metrics', title: 'Classification metrics', section: 'Model quality' }),
    K.ivBars({ id: 'uw-iv', title: 'Information value by feature', section: 'Model quality' }),
    K.woeChart({ id: 'uw-woe-score', title: 'Weight of evidence: LDC score', section: 'Model mechanics', feature: 'score' }),
    K.woeChart({ id: 'uw-woe-tenure', title: 'Weight of evidence: tenure', section: 'Model mechanics', feature: 'tenure' }),
    K.woeChart({ id: 'uw-woe-bureau', title: 'Weight of evidence: bureau score', section: 'Model mechanics', feature: 'bureau' }),
    K.woeChart({ id: 'uw-woe-foir', title: 'Weight of evidence: FOIR', section: 'Model mechanics', feature: 'foir' }),
    K.histField({ id: 'uw-score-dist', title: 'Score distribution in the booked file', section: 'Applicant pool', label: 'LDC score', get: (l) => l.score, color: COLORS.cyan }),
    K.dimBar({ id: 'uw-profession-bad', title: 'Observed impairment by borrower type', section: 'Applicant pool', dim: 'profession', metric: 'badRate' }),
    K.dimBar({ id: 'uw-tier-bad', title: 'Observed impairment by city tier', section: 'Applicant pool', dim: 'cityTier', metric: 'badRate' }),
  ]),
};

// ---------------------------------------------------------------------------
// 14. Opportunities
// ---------------------------------------------------------------------------
const opportunities: PageConfig = {
  id: 'opportunities',
  title: 'Opportunities',
  eyebrow: 'Marketplace',
  description:
    'Live loans captured in the last scrape, filtered against the same policy tests used on the historical book. Availability is a snapshot, not a promise.',
  heroKpis: (_rows, ctx) => {
    const list = ctx.meta.availableLoans;
    const open = list.filter((l) => l.remainingAmount > 0);
    return [
      { label: 'Live loans', value: num(list.length), hint: 'last scrape' },
      { label: 'Still open', value: num(open.length), hint: `${inrCompact(sum(open, (l) => l.remainingAmount))} remaining` },
      { label: 'Median score', value: num(percentile(list.map((l) => l.score), 50)), hint: 'listed loans' },
      { label: 'Median APR', value: pct(percentile(list.map((l) => l.rate), 50)), hint: 'borrower rate' },
      { label: 'Short tenure (≤3M)', value: num(list.filter((l) => l.tenure <= 3).length), hint: 'faster recycling' },
      { label: 'Avg remaining', value: pct(mean(list, (l) => l.remainingPct)), hint: 'of sanctioned' },
    ];
  },
  custom: 'opportunities',
  sections: groupSections('opp', [
    K.availableScoreHist({ id: 'opp-score', title: 'Listed score distribution', section: 'Marketplace' }),
    K.availableRateHist({ id: 'opp-rate', title: 'Listed APR distribution', section: 'Marketplace' }),
    K.availableTenureBars({ id: 'opp-tenure', title: 'Listed tenure mix', section: 'Marketplace' }),
    K.availableRemainingBars({ id: 'opp-remaining', title: 'Funding progress', section: 'Marketplace' }),
    K.availableScoreRate({ id: 'opp-scatter', title: 'Score against APR on live loans', section: 'Marketplace' }),
    K.opportunityTable({ id: 'opp-table', title: 'Largest open positions', section: 'Marketplace' }),
    K.policyFrontier((ctx) => ctx.model, { id: 'opp-frontier', title: 'Historical policy frontier', section: 'Marketplace' }),
    K.availableRiskMix({ id: 'opp-risk-mix', title: 'Live risk-type mix', section: 'Live snapshot' }),
    K.availableFundingBars({ id: 'opp-funding', title: 'Funding progress of live listings', section: 'Live snapshot' }),
    K.availableEligibility({ id: 'opp-eligibility', title: 'Live loans passing each policy', section: 'Live snapshot' }),
    K.availableTopTable({ id: 'opp-top-table', title: 'Top-scoring live loans', section: 'Live snapshot' }),
    K.policyHeat({ id: 'opp-heat', title: 'Historical NPA grid', section: 'Evidence from the book' }),
    K.dimBar({ id: 'opp-score-bad', title: 'Impairment by score band', section: 'Evidence from the book', dim: 'scoreBand', metric: 'badRate' }),
    K.dimBar({ id: 'opp-tenure-bad', title: 'Impairment by tenure', section: 'Evidence from the book', dim: 'tenure', metric: 'badRate' }),
    K.dimBar({ id: 'opp-grade-npa', title: 'NPA by risk grade', section: 'Evidence from the book', dim: 'grade', metric: 'npaRate' }),
    K.dimBar({ id: 'opp-state-lent', title: 'Where the book is concentrated', section: 'Evidence from the book', dim: 'state', metric: 'lent' }),
    K.xirrSpread({ id: 'opp-xirr-spread', title: 'Spread of loan-level XIRR', section: 'Evidence from the book' }),
    K.forwardFan({ id: 'opp-forward', title: 'Forward return scenarios', section: 'Evidence from the book' }),
    K.histField({ id: 'opp-amount-hist', title: 'Historical ticket sizes', section: 'Evidence from the book', label: 'Invested (₹)', get: (l) => l.amount, kind: 'money' }),
    K.lorenzChart({ id: 'opp-lorenz', title: 'Capital concentration across states', section: 'Evidence from the book', dim: 'state' }),
  ]),
};

// ---------------------------------------------------------------------------
// 15. Explorer
// ---------------------------------------------------------------------------
const explorer: PageConfig = {
  id: 'explorer',
  title: 'Explorer',
  eyebrow: 'Loan level',
  description:
    'All 5,567 loans, all 69 fields, every filter. Search by borrower, city or loan ID; sort any column; export the current view as CSV.',
  heroKpis: baseKpis,
  custom: 'explorer',
  sections: groupSections('exp', [
    K.dimBar({ id: 'exp-status', title: 'Loans by status', section: 'Explorer context', dim: 'status', metric: 'n' }),
    K.dimBar({ id: 'exp-state', title: 'Loans by state', section: 'Explorer context', dim: 'state', metric: 'n' }),
    K.dimBar({ id: 'exp-outcome', title: 'Loans by outcome', section: 'Explorer context', dim: 'outcome', metric: 'n' }),
    K.histField({ id: 'exp-amount', title: 'Invested amount', section: 'Explorer context', label: 'Invested (₹)', get: (l) => l.amount, kind: 'money' }),
    K.histField({ id: 'exp-profit', title: 'Profit per loan', section: 'Explorer context', label: 'Net profit (₹)', get: (l) => l.netProfit, kind: 'money', color: COLORS.emerald }),
    K.monthlyLine({ id: 'exp-monthly', title: 'Loans by month', section: 'Explorer context', metric: 'n' }),
    K.histField({ id: 'exp-rate', title: 'Borrower APR distribution', section: 'Distribution', label: 'APR %', get: (l) => l.rate, kind: 'percent' }),
    K.histField({ id: 'exp-score', title: 'LDC score distribution', section: 'Distribution', label: 'LDC score', get: (l) => l.score, color: COLORS.cyan }),
    K.histField({ id: 'exp-tenure', title: 'Tenure distribution', section: 'Distribution', label: 'Tenure (months)', get: (l) => l.tenure, color: COLORS.lime }),
    K.histField({ id: 'exp-holding', title: 'Holding period', section: 'Distribution', label: 'Holding days', get: (l) => l.holdingDays, color: COLORS.orange }),
    K.boxDim({ id: 'exp-box-grade', title: 'Ticket size spread by risk grade', section: 'Distribution', dim: 'grade', label: 'Invested (₹)', get: (l) => l.amount, kind: 'money' }),
    K.ecdfField({ id: 'exp-ecdf-amount', title: 'Cumulative ticket-size curve', section: 'Distribution', label: 'Invested (₹)', get: (l) => l.amount, kind: 'money' }),
    K.scatterXY({ id: 'exp-score-rate', title: 'Score against APR', section: 'Relationships', xLabel: 'LDC score', yLabel: 'APR %', xGet: (l) => l.score, yGet: (l) => l.rate, xKind: 'num', yKind: 'percent', groupBy: 'outcome' }),
    K.scatterXY({ id: 'exp-amount-profit', title: 'Ticket size against profit', section: 'Relationships', xLabel: 'Invested (₹)', yLabel: 'Net profit (₹)', xGet: (l) => l.amount, yGet: (l) => l.netProfit, xKind: 'money', yKind: 'money', groupBy: 'outcome' }),
    K.corrChart({
      id: 'exp-corr',
      title: 'Correlation across the main numeric fields',
      section: 'Relationships',
      fields: [
        { key: 'amount', label: 'Invested', get: (l) => l.amount },
        { key: 'received', label: 'Received', get: (l) => l.received },
        { key: 'profit', label: 'Net profit', get: (l) => l.netProfit },
        { key: 'rate', label: 'APR', get: (l) => l.rate },
        { key: 'score', label: 'Score', get: (l) => l.score },
        { key: 'tenure', label: 'Tenure', get: (l) => l.tenure },
        { key: 'holding', label: 'Holding days', get: (l) => l.holdingDays },
      ],
    }),
    K.dimPie({ id: 'exp-grade-pie', title: 'Loan count by risk grade', section: 'Composition', dim: 'grade', metric: 'n' }),
    K.dimBar({ id: 'exp-dpd', title: 'Loans by DPD bucket', section: 'Composition', dim: 'dpdBucket', metric: 'n' }),
    K.paretoDim({ id: 'exp-pareto-state', title: 'Capital concentration by state', section: 'Composition', dim: 'state' }),
    K.treemapDim({ id: 'exp-treemap-city', title: 'Capital by city', section: 'Composition', dim: 'city', limit: 20 }),
    K.heatMatrix({ id: 'exp-heat-score-tenure', title: 'NPA by score band and tenure', section: 'Composition', xGet: (l) => String(DIMENSIONS.scoreBand.get(l)), yGet: (l) => String(DIMENSIONS.tenure.get(l)), value: 'npaRate', xName: 'Score band', yName: 'Tenure' }),
  ]),
};

// ---------------------------------------------------------------------------
// 16. Methodology
// ---------------------------------------------------------------------------
const methodology: PageConfig = {
  id: 'methodology',
  title: 'Methodology',
  eyebrow: 'Data and caveats',
  description:
    'How the dataset was assembled, sanitised, derived and modelled. Read this before quoting any number on the site.',
  heroKpis: (_rows, ctx) => [
    { label: 'Loans', value: num(ctx.meta.counts.loans), hint: `${num(ctx.meta.counts.borrowers)} borrowers` },
    { label: 'Fields', value: num(ctx.meta.counts.columns), hint: 'after derivation' },
    { label: 'As of', value: ctx.meta.asOf, hint: `built ${ctx.meta.generatedAt.slice(0, 10)}` },
    { label: 'Recovery assumption', value: pct(ctx.meta.recoveryRate * 100), hint: `LGD ${pct(ctx.meta.lgd * 100)}` },
    { label: 'NPA definition', value: 'Platform', hint: 'status = written off' },
    { label: 'Model', value: 'Research', hint: 'not production' },
  ],
  custom: 'methodology',
  sections: groupSections('meth', [
    K.returnMethodsBar({ id: 'meth-returns', title: 'Return definitions compared', section: 'Data & method' }),
    K.scenarioProfitBars({ id: 'meth-scenarios', title: 'Scenario treatment', section: 'Data & method' }),
    K.dataQualityBars({ id: 'meth-quality', title: 'Missing data by field', section: 'Data & method' }),
    K.coverageBars({ id: 'meth-coverage', title: 'Derived field coverage', section: 'Data & method' }),
    K.corrChart({
      id: 'meth-corr',
      title: 'Correlation of derived return fields',
      section: 'Data & method',
      fields: [
        { key: 'amount', label: 'Invested', get: (l) => l.amount },
        { key: 'received', label: 'Received', get: (l) => l.received },
        { key: 'profit', label: 'Profit', get: (l) => l.netProfit },
        { key: 'anr', label: 'ANR', get: (l) => l.reportedAnr },
        { key: 'xirr', label: 'XIRR', get: (l) => l.xirrRecovery },
        { key: 'holding', label: 'Holding days', get: (l) => l.holdingDays },
        { key: 'fee', label: 'Fee', get: (l) => l.fee },
        { key: 'pos', label: 'Outstanding', get: (l) => l.pos },
      ],
    }),
    K.waterfallProfit({ id: 'meth-waterfall', title: 'Profit bridge', section: 'Money flow', span: 2 }),
    K.outcomeFunnel({ id: 'meth-funnel', title: 'Lifecycle funnel', section: 'Money flow' }),
    K.monthlyCombo({ id: 'meth-monthly-volume', title: 'Monthly volume and impairment', section: 'Money flow', bar: 'lent', line: 'npaRate' }),
    K.monthlyNpaStack({ id: 'meth-npa-stack', title: 'Monthly outcome composition', section: 'Money flow' }),
    K.cumulativeChart({ id: 'meth-cumulative', title: 'Cumulative cash flow', section: 'Money flow' }),
    K.roiTimeline({ id: 'meth-roi', title: 'Cohort XIRR', section: 'Return validation' }),
    K.histField({ id: 'meth-anr-hist', title: 'Reported ANR distribution', section: 'Return validation', label: 'Reported ANR %', subtitle: ANR_GUARD_NOTE, filter: performingAnr, get: (l) => l.reportedAnr, kind: 'percent' }),
    K.ecdfField({ id: 'meth-anr-ecdf', title: 'Cumulative ANR curve', section: 'Return validation', label: 'Reported ANR %', subtitle: ANR_GUARD_NOTE, filter: performingAnr, get: (l) => l.reportedAnr, kind: 'percent' }),
    K.xirrSpread({ id: 'meth-xirr-spread', title: 'Loan-level XIRR spread', section: 'Return validation' }),
    K.forwardFan({ id: 'meth-forward', title: 'Forward projection fan', section: 'Forward view' }),
    K.monteCarloChart({ id: 'meth-monte-carlo', title: 'Monte Carlo profit distribution', section: 'Forward view' }),
    K.projectionBars({ id: 'meth-projection', title: 'Projected profit by scenario', section: 'Forward view' }),
    K.lorenzChart({ id: 'meth-lorenz', title: 'Capital concentration (Lorenz)', section: 'Data & method', dim: 'state' }),
    K.gaugeChart({
      id: 'meth-coverage-gauge',
      title: 'Capital returned to date',
      section: 'Data & method',
      label: 'Cash received / invested',
      value: (rows) => {
        const lent = sum(rows, (l) => l.amount);
        return lent ? (sum(rows, (l) => l.received) / lent) * 100 : 0;
      },
      max: 120,
      color: COLORS.violet,
      insight: (v) =>
        v > 100
          ? plain('positive', `${pct(v)} of invested capital has come back`, 'Above 100% means cash returned exceeds principal, so the remaining book is running on profit.', 'INFO')
          : plain('warning', `${pct(v)} of invested capital has come back`, 'The gap is principal still sitting in active loans, not a loss on its own. Cross-check against outstanding principal and NPA.', 'WATCH'),
    }),
    K.histField({ id: 'meth-fee', title: 'Fee per loan', section: 'Data & method', label: 'Platform fee (₹)', get: (l) => l.fee, kind: 'money', color: COLORS.amber }),
  ]),
};

export const PAGES: PageConfig[] = [
  executive,
  portfolio,
  returns,
  activeBook,
  npa,
  risk,
  scorecard,
  tenure,
  geography,
  cohorts,
  borrowers,
  fees,
  underwriting,
  opportunities,
  explorer,
  methodology,
];

export const PAGE_BY_ID = new Map(PAGES.map((p) => [p.id, p]));

export function chartCount(): number {
  return PAGES.reduce((s, p) => s + p.sections.reduce((n, sec) => n + sec.charts.length, 0), 0);
}
