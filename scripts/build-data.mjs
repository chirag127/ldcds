/**
 * Build the static analytics dataset from the raw LenDenClub exports.
 *
 * Inputs (gitignored, local only):
 *   data/raw/lending_data_import_YYYY-MM-DD.json
 *   data/raw/lendenclub_FULL_YYYY-MM-DD.json
 *
 * Outputs (committed, public):
 *   public/data/loans.json   columnar loan records
 *   public/data/meta.json    dictionaries, official portfolio, data quality
 *   public/data/model.json   credit scorecard, WOE/IV, policy grid
 *
 * No investor PAN/phone/email/address, agreement URLs, signed S3 tokens or
 * raw response payloads are written. Borrower names are retained because the
 * repository owner explicitly requested them; everything else is minimised.
 */

import fs from 'node:fs';
import path from 'node:path';
import { normaliseCity } from './city-map.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const ASOF_FALLBACK = '2026-10-20';
const SCHEMA_VERSION = 3;
const RECOVERY_RATE = 0.45; // realised NPA principal recovery: 83,838 / 187,500
const LGD = 0.55;
const DAY = 86_400_000;

const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const num = (v, f = 0) => {
  if (v === null || v === undefined || v === '' || v === '-') return f;
  const n = Number(String(v).replace(/[₹,\s%]/g, ''));
  return Number.isFinite(n) ? n : f;
};
const txt = (v, f = '') => {
  if (v === null || v === undefined || v === '' || v === '-') return f;
  return String(v).trim();
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dayDiff = (a, b) => {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Number.isFinite(da) && Number.isFinite(db) ? Math.round((da - db) / DAY) : null;
};
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isoDate = (v) => {
  const s = txt(v);
  if (!s) return '';
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return s.slice(0, 10);
};
const monthOf = (d) => (d ? d.slice(0, 7) : '');
const hash36 = (value) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
};

function latestRaw(prefix) {
  if (!fs.existsSync(RAW_DIR)) return null;
  const files = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

function readJson(file) {
  if (!file) throw new Error(`Missing raw export. Put ${file ?? 'the JSON export'} in data/raw/.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// Load + join
// ---------------------------------------------------------------------------
const importFile = latestRaw('lending_data_import_');
const fullFile = latestRaw('lendenclub_FULL_');
const importJson = readJson(importFile);
const fullJson = readJson(fullFile);
const generatedAt = txt(fullJson.generated_at || importJson.generated_at, new Date().toISOString());
const asOf = isoDate(generatedAt) || ASOF_FALLBACK;

const byId = new Map();
for (const loan of importJson.loans || []) {
  const id = txt(loan.id || loan.loan_id);
  if (id) byId.set(id, { ...loan });
}

let joinedLists = 0;
for (const listType of ['open', 'closed']) {
  for (const row of fullJson.loan_lists?.[listType] || []) {
    const id = txt(row.loan_id);
    const target = byId.get(id);
    if (!target) continue;
    target.__list_type = listType.toUpperCase();
    target.__expected_returns = num(row.expected_returns, 0);
    target.__loan_type = txt(row.loan_type, 'MONTHLY');
    target.__scheme_id = txt(row.scheme_id, '');
    joinedLists += 1;
  }
}

const rawLoans = [...byId.values()];

// Borrower grouping (same name + age + city is a reasonable repeat proxy).
const borrowerGroups = new Map();
for (const loan of rawLoans) {
  const key = `${txt(loan.borrower_name).toLowerCase()}|${txt(loan.borrower_age)}|${txt(loan.borrower_city).toLowerCase()}`;
  const list = borrowerGroups.get(key) || [];
  list.push(loan.id);
  borrowerGroups.set(key, list);
}

// ---------------------------------------------------------------------------
// Derive
// ---------------------------------------------------------------------------
const gradeFrom = (loan) => {
  const risk = txt(loan.risk_category).toUpperCase();
  if (risk.includes('AAA')) return 2;
  if (/\bAA\b/.test(risk)) return 1;
  if (/\bA\b/.test(risk)) return 0;
  const score = num(loan.score);
  if (score >= 850) return 2;
  if (score >= 750) return 1;
  return 0;
};

const genderCode = (value) => {
  const v = txt(value).toUpperCase();
  if (v.startsWith('M')) return 0;
  if (v.startsWith('F')) return 1;
  if (v.startsWith('O')) return 2;
  return 3;
};
const professionCode = (value) => (/self/i.test(txt(value)) ? 1 : 0);
const stayCode = (value) => {
  const v = txt(value).toUpperCase();
  if (v.includes('SELF')) return 1;
  if (v.includes('RENT')) return 2;
  return 0;
};
const dpdCode = (v) => {
  const d = num(v, 0);
  if (d <= 0) return 0;
  if (d <= 30) return 1;
  if (d <= 60) return 2;
  if (d <= 90) return 3;
  return 4;
};
const statusCode = (value) => {
  const v = txt(value).toUpperCase();
  if (v === 'NPA') return 2;
  if (v === 'CLOSED') return 1;
  return 0;
};

function emiOf(principal, annualRate, months) {
  const p = num(principal);
  const n = num(months);
  const r = num(annualRate) / 1200;
  if (!p || !n) return null;
  if (!r) return round(p / n, 2);
  const pow = (1 + r) ** n;
  return round((p * r * pow) / (pow - 1), 2);
}

function xirrPct(flows) {
  if (!Array.isArray(flows) || flows.length < 2) return null;
  const clean = flows
    .filter((f) => f && Number.isFinite(f.amount) && Number.isFinite(f.time))
    .sort((a, b) => a.time - b.time);
  if (clean.length < 2) return null;
  const hasNeg = clean.some((f) => f.amount < 0);
  const hasPos = clean.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  const t0 = clean[0].time;
  const npv = (rate) => {
    let total = 0;
    for (const flow of clean) {
      const years = (flow.time - t0) / DAY / 365;
      total += flow.amount / (1 + rate) ** years;
    }
    return total;
  };
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo * fhi > 0) {
    // Try a wider upper bound for extreme short-tenure returns.
    hi = 100;
    fhi = npv(hi);
    if (!Number.isFinite(fhi) || flo * fhi > 0) return null;
  }
  for (let i = 0; i < 160; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!Number.isFinite(fm)) break;
    if (fm * flo <= 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  const rate = (lo + hi) / 2;
  return Number.isFinite(rate) ? round(rate * 100, 2) : null;
}

const loans = rawLoans.map((raw) => {
  const id = txt(raw.id || raw.loan_id);
  const name = txt(raw.borrower_name, 'Borrower').replace(/\s+/g, ' ');
  const status = statusCode(raw.status);
  const isActive = status === 0;
  const isNpa = status === 2;
  const listType = raw.__list_type === 'OPEN' ? 0 : 1;
  const disb = isoDate(raw.disb_date);
  const inv = isoDate(raw.investment_date);
  const maturity = isoDate(raw.maturity_date);
  const closure = isoDate(raw.closure_date);
  const amount = round(num(raw.amount), 2);
  const pos = round(num(raw.pos), 2);
  const rate = round(num(raw.rate), 2);
  const tenure = Math.max(1, Math.round(num(raw.tenure, 1)));
  const received = round(num(raw.received), 2);
  const principalRec = round(num(raw.principal_rec), 2);
  const interestRec = round(num(raw.interest_rec), 2);
  const fee = round(num(raw.fee), 2);
  const npaAmount = round(num(raw.npa), 2);
  const dpd = Math.max(0, Math.round(num(raw.dpd)));
  const incomeRaw = num(raw.borrower_income);
  const income = incomeRaw > 0 ? round(incomeRaw, 2) : null;
  const bureauRaw = num(raw.bureau_score);
  const bureau = bureauRaw > 0 ? Math.round(bureauRaw) : null;
  const score = Math.round(num(raw.score));
  const borrowerAmount = round(num(raw.borrower_loan_amount), 2);
  const normalizedCity = normaliseCity(raw.borrower_city);
  const borrowerKey = `BRW-${hash36(`${name.toLowerCase()}|${raw.borrower_age}|${txt(raw.borrower_city).toLowerCase()}`)}`;
  const repeatCount = (borrowerGroups.get(`${name.toLowerCase()}|${txt(raw.borrower_age)}|${txt(raw.borrower_city).toLowerCase()}`) || []).length;

  const netProfit = isActive ? interestRec : round(num(raw.net_profit, interestRec - npaAmount), 2);
  const reportedAnr = isActive ? null : round(num(raw.ann_net_pct), 2);
  const expReturns = isActive ? round(num(raw.__expected_returns, 0), 2) : 0;
  const futureInterest = isActive ? Math.max(0, round(expReturns - received - pos, 2)) : 0;
  const futureFee = isActive ? round(pos * 0.01, 2) : 0;
  const emi = isActive || status === 1 || isNpa ? emiOf(borrowerAmount, rate, tenure) : null;
  const foir = income && emi ? round(emi / income, 4) : null;
  const loanToAnnualIncome = income && borrowerAmount ? round(borrowerAmount / (income * 12), 4) : null;
  const recoveryRate = isNpa ? (amount > 0 ? round(clamp((amount - npaAmount) / amount, 0, 1), 4) : 0) : status === 1 ? 1 : null;
  const lossSeverity = isNpa && amount > 0 ? round(npaAmount / amount, 4) : 0;

  const vintageDays = disb ? Math.max(0, dayDiff(asOf, disb) ?? 0) : 0;
  const holdingDays = status === 0
    ? vintageDays
    : closure && disb
      ? Math.max(0, dayDiff(closure, disb) ?? 0)
      : vintageDays;
  const seasoning = round(vintageDays / 30.44, 2);
  const isMatured = Boolean(maturity && maturity <= asOf);
  const maturityGapDays = maturity ? dayDiff(maturity, asOf) : null;
  const prepaid = status === 1 && Boolean(closure && maturity && closure < maturity);
  const impaired = Boolean(isNpa || (!isActive ? false : dpd > 0));

  // Scenario profit: total lifetime profit for the loan (realised + future).
  const contractualProfit = isActive ? round(expReturns - amount - futureFee, 2) : netProfit;
  const recoveryProfit = isActive && impaired
    ? round(received + RECOVERY_RATE * pos - amount, 2)
    : contractualProfit;
  const strictProfit = isActive && impaired ? round(received - amount, 2) : contractualProfit;

  const futureCash = (scenario) => {
    if (!isActive) return 0;
    if (scenario === 'strict' && impaired) return 0;
    if (scenario === 'recovery' && impaired) return round(RECOVERY_RATE * pos, 2);
    return round(pos + futureInterest - futureFee, 2);
  };
  const cash = {
    contractual: futureCash('contractual'),
    recovery: futureCash('recovery'),
    strict: futureCash('strict'),
  };

  const outflow = { time: new Date(`${disb || asOf}T00:00:00Z`).getTime(), amount: -amount };
  const closureTime = new Date(`${closure || maturity || asOf}T00:00:00Z`).getTime();
  const asOfTime = new Date(`${asOf}T00:00:00Z`).getTime();
  const futureTime = new Date(`${maturity && maturity > asOf ? maturity : addDays(asOf, 30)}T00:00:00Z`).getTime();
  const buildXirr = (scenario) => {
    if (!amount) return null;
    const flows = [outflow];
    if (!isActive) {
      if (received > 0) flows.push({ time: closureTime, amount: received });
    } else {
      if (received > 0) flows.push({ time: asOfTime, amount: received });
      if (cash[scenario] > 0) flows.push({ time: futureTime, amount: cash[scenario] });
    }
    if (flows.length === 1) return -100;
    return xirrPct(flows);
  };

  return {
    id,
    name,
    borrowerKey,
    repeatCount,
    age: Math.round(num(raw.borrower_age)),
    gender: genderCode(raw.borrower_gender),
    city: normalizedCity.city,
    state: normalizedCity.state,
    cityTier: normalizedCity.tier,
    profession: professionCode(raw.borrower_profession),
    stay: stayCode(raw.borrower_stay_type),
    income,
    borrowerAmount,
    bureau,
    score,
    grade: gradeFrom(raw),
    amount,
    pos,
    rate,
    tenure,
    repay: /daily|edi/i.test(txt(raw.__loan_type)) ? 1 : 0,
    listType,
    status,
    dpd,
    dpdBucket: dpdCode(dpd),
    overdue: dpd > 0,
    npa: isNpa ? 1 : 0,
    prepaid: prepaid ? 1 : 0,
    disb,
    inv,
    maturity,
    closure,
    disbMonth: monthOf(disb),
    maturityMonth: monthOf(maturity),
    closureMonth: monthOf(closure),
    received,
    principalRec,
    interestRec,
    fee,
    npaAmount,
    netProfit,
    realizedRoi: amount ? round(netProfit / amount, 4) : null,
    reportedAnr,
    expReturns,
    futureInterest,
    futureFee,
    profitContractual: contractualProfit,
    profitRecovery: recoveryProfit,
    profitStrict: strictProfit,
    xirrContractual: buildXirr('contractual'),
    xirrRecovery: buildXirr('recovery'),
    xirrStrict: buildXirr('strict'),
    holdingDays,
    vintageDays,
    seasoning,
    isMatured: isMatured ? 1 : 0,
    maturityGapDays,
    daysToClose: status !== 0 && closure && disb ? Math.max(0, dayDiff(closure, disb) ?? 0) : null,
    emi,
    foir,
    loanToAnnualIncome,
    recoveryRate,
    lossSeverity,
    impaired: impaired ? 1 : 0,
    incomeMissing: income === null ? 1 : 0,
    bureauMissing: bureau === null ? 1 : 0,
    cityMissing: normalizedCity.city === 'Unknown' ? 1 : 0,
    stayMissing: stayCode(raw.borrower_stay_type) === 0 ? 1 : 0,
    scheme: txt(raw.__scheme_id),
  };
});

// ---------------------------------------------------------------------------
// Column dictionary
// ---------------------------------------------------------------------------
const COLUMNS = [
  ['id', 'Loan ID', 'id', 'LenDenClub loan identifier'],
  ['name', 'Borrower', 'text', 'Borrower name as reported by the platform'],
  ['borrowerKey', 'Borrower key', 'id', 'Stable key for repeat-borrower grouping (name + age + city)'],
  ['repeatCount', 'Loans by borrower', 'int', 'Number of loans in this export sharing the same borrower key'],
  ['age', 'Age', 'int', 'Borrower age in years'],
  ['gender', 'Gender', 'code', '0 Male, 1 Female, 2 Other, 3 Unknown'],
  ['city', 'City', 'text', 'Normalised city / district'],
  ['state', 'State', 'text', 'Mapped Indian state (Other when unmapped)'],
  ['cityTier', 'City tier', 'code', '0 Unknown, 1 Metro, 2 Tier 2, 3 Other'],
  ['profession', 'Borrower type', 'code', '0 Salaried, 1 Self-employed'],
  ['stay', 'Residence', 'code', '0 Unknown, 1 Self-owned, 2 Rented'],
  ['income', 'Monthly income', 'money', 'Self-reported monthly income; null when zero/missing'],
  ['borrowerAmount', 'Borrower loan amount', 'money', 'Full loan sanctioned to the borrower'],
  ['bureau', 'Bureau score', 'score', 'CRIF bureau score; null when missing'],
  ['score', 'LenDenClub score', 'score', 'LDC score 700–878 in this book'],
  ['grade', 'Risk grade', 'code', '0 A (High), 1 AA (Medium), 2 AAA (Low)'],
  ['amount', 'Invested amount', 'money', "Your principal in this loan"],
  ['pos', 'Principal outstanding', 'money', 'Remaining principal (0 for closed loans)'],
  ['rate', 'Borrower APR', 'percent', 'Annualised borrower interest rate'],
  ['tenure', 'Tenure (months)', 'int', 'Contracted loan tenure'],
  ['repay', 'Repayment type', 'code', '0 Monthly EMI, 1 Daily EDI'],
  ['listType', 'Platform list', 'code', '0 Open/active list, 1 Closed list'],
  ['status', 'Status', 'code', '0 Active, 1 Closed, 2 NPA'],
  ['dpd', 'Days past due', 'int', 'Current days past due'],
  ['dpdBucket', 'DPD bucket', 'code', '0 0 DPD, 1 1–30, 2 31–60, 3 61–90, 4 90+'],
  ['overdue', 'Overdue', 'bool', 'DPD > 0'],
  ['npa', 'NPA', 'bool', 'Marked NPA by the platform'],
  ['prepaid', 'Prepaid', 'bool', 'Closed before contractual maturity'],
  ['disb', 'Disbursement date', 'date', 'Loan disbursement / investment date'],
  ['inv', 'Investment date', 'date', 'Platform investment date'],
  ['maturity', 'Maturity date', 'date', 'Contracted maturity'],
  ['closure', 'Closure / NPA date', 'date', 'Actual closure or NPA classification date'],
  ['disbMonth', 'Disbursement month', 'month', 'YYYY-MM'],
  ['maturityMonth', 'Maturity month', 'month', 'YYYY-MM'],
  ['closureMonth', 'Closure month', 'month', 'YYYY-MM'],
  ['received', 'Total received', 'money', 'Principal + interest received to date'],
  ['principalRec', 'Principal received', 'money', 'Principal recovered to date'],
  ['interestRec', 'Interest received', 'money', 'Net interest received after platform fees'],
  ['fee', 'Fees', 'money', 'Platform / facilitation fees deducted'],
  ['npaAmount', 'NPA principal', 'money', 'Principal written off / outstanding at NPA'],
  ['netProfit', 'Net profit', 'money', 'Interest net of fees and NPA write-off'],
  ['realizedRoi', 'Realised ROI', 'ratio', 'Net profit ÷ invested amount'],
  ['reportedAnr', 'Reported ANR', 'percent', "Platform's annualised net return for closed loans"],
  ['expReturns', 'Expected total returns', 'money', 'Lifetime contractual repayment for active loans'],
  ['futureInterest', 'Future interest', 'money', 'Expected remaining interest on active loans'],
  ['futureFee', 'Future fees', 'money', 'Estimated 1% platform fee on outstanding'],
  ['profitContractual', 'Profit — contractual', 'money', 'Total lifetime profit if every active loan pays as agreed'],
  ['profitRecovery', 'Profit — recovery', 'money', 'Impaired active loans recover 45% of principal'],
  ['profitStrict', 'Profit — strict', 'money', 'Any DPD > 0 active loan is a 100% principal write-off'],
  ['xirrContractual', 'XIRR — contractual', 'percent', 'Money-weighted return, contractual scenario'],
  ['xirrRecovery', 'XIRR — recovery', 'percent', 'Money-weighted return, 45% recovery scenario'],
  ['xirrStrict', 'XIRR — strict', 'percent', 'Money-weighted return, strict write-off scenario'],
  ['holdingDays', 'Holding days', 'int', 'Days from disbursement to closure or as-of date'],
  ['vintageDays', 'Vintage days', 'int', 'Days since disbursement'],
  ['seasoning', 'Seasoning (months)', 'ratio', 'Vintage days ÷ 30.44'],
  ['isMatured', 'Matured', 'bool', 'Contractual maturity has passed'],
  ['maturityGapDays', 'Days to maturity', 'int', 'Negative when past maturity'],
  ['daysToClose', 'Days to close', 'int', 'Disbursement to closure/NPA'],
  ['emi', 'Estimated EMI', 'money', 'EMI implied by borrower amount, APR and tenure'],
  ['foir', 'FOIR', 'ratio', 'Estimated EMI ÷ monthly income'],
  ['loanToAnnualIncome', 'Loan / annual income', 'ratio', 'Borrower loan amount ÷ annual income'],
  ['recoveryRate', 'Recovery rate', 'ratio', 'Principal recovered ÷ invested amount (NPA only)'],
  ['lossSeverity', 'Loss severity', 'ratio', 'NPA principal ÷ invested amount'],
  ['impaired', 'Impaired', 'bool', 'NPA or any DPD > 0'],
  ['incomeMissing', 'Income missing', 'bool', 'Income absent or zero'],
  ['bureauMissing', 'Bureau missing', 'bool', 'Bureau score absent or zero'],
  ['cityMissing', 'City missing', 'bool', 'No usable city'],
  ['stayMissing', 'Residence missing', 'bool', 'Residence type not supplied'],
  ['scheme', 'Scheme ID', 'id', 'Platform scheme identifier'],
].map(([key, label, type, description]) => ({ key, label, type, description }));

const DICTIONARIES = {
  status: ['Active', 'Closed', 'NPA'],
  grade: ['A (High)', 'AA (Medium)', 'AAA (Low)'],
  gender: ['Male', 'Female', 'Other', 'Unknown'],
  profession: ['Salaried', 'Self-employed'],
  stay: ['Unknown', 'Self-owned', 'Rented'],
  repay: ['Monthly EMI', 'Daily EDI'],
  listType: ['Open', 'Closed'],
  dpdBucket: ['0 DPD', '1–30 DPD', '31–60 DPD', '61–90 DPD', '90+ DPD'],
  cityTier: ['Unknown', 'Tier 1 metro', 'Tier 2 city', 'Tier 3 / other'],
  scenario: ['Contractual', 'Recovery (45%)', 'Strict write-off'],
};

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------
const active = loans.filter((l) => l.status === 0);
const closed = loans.filter((l) => l.status !== 0);
const npa = loans.filter((l) => l.status === 2);
const overdueActive = active.filter((l) => l.dpd > 0);
const sum = (rows, key) => round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0), 2);

function scenarioTotals(scenario) {
  const profitKey = scenario === 'strict' ? 'profitStrict' : scenario === 'recovery' ? 'profitRecovery' : 'profitContractual';
  const xirrKey = scenario === 'strict' ? 'xirrStrict' : scenario === 'recovery' ? 'xirrRecovery' : 'xirrContractual';
  const totalLent = sum(loans, 'amount');
  const realised = round(closed.reduce((s, l) => s + l.netProfit, 0) + active.reduce((s, l) => s + l.netProfit, 0), 2);
  const projected = sum(loans, profitKey);
  const future = round(projected - realised, 2);
  const npaLoss = round(npa.reduce((s, l) => s + l.npaAmount, 0), 2);
  const activeImpairedPos = round(overdueActive.reduce((s, l) => s + l.pos, 0), 2);
  const expectedLoss = scenario === 'strict'
    ? round(npaLoss + activeImpairedPos, 2)
    : scenario === 'recovery'
      ? round(npaLoss + activeImpairedPos * (1 - RECOVERY_RATE), 2)
      : npaLoss;
  const cashflows = [];
  for (const l of loans) {
    const disbTime = new Date(`${l.disb || asOf}T00:00:00Z`).getTime();
    cashflows.push({ time: disbTime, amount: -l.amount });
    const inflow = l.status === 0 ? l.received : l.received;
    if (inflow > 0) {
      cashflows.push({
        time: l.status === 0
          ? new Date(`${asOf}T00:00:00Z`).getTime()
          : new Date(`${l.closure || l.maturity || asOf}T00:00:00Z`).getTime(),
        amount: inflow,
      });
    }
    if (l.status === 0) {
      const futureCash = scenario === 'strict' && l.impaired
        ? 0
        : scenario === 'recovery' && l.impaired
          ? round(RECOVERY_RATE * l.pos, 2)
          : round(l.pos + l.futureInterest - l.futureFee, 2);
      if (futureCash > 0) {
        cashflows.push({
          time: new Date(`${l.maturity && l.maturity > asOf ? l.maturity : addDays(asOf, 30)}T00:00:00Z`).getTime(),
          amount: futureCash,
        });
      }
    }
  }
  return {
    scenario,
    totalLent,
    realisedProfit: round(active.reduce((s, l) => s + l.netProfit, 0) + closed.reduce((s, l) => s + l.netProfit, 0), 2),
    projectedProfit: projected,
    futureProfit: future,
    totalReceived: sum(loans, 'received'),
    pos: sum(active, 'pos'),
    expectedLoss,
    portfolioXirr: xirrPct(cashflows),
    roiPct: totalLent ? round((projected / totalLent) * 100, 2) : 0,
    activeCount: active.length,
    closedCount: closed.length,
    npaCount: npa.length,
    impairedCount: npa.length + overdueActive.length,
    impairedPos: round(sum(npa, 'npaAmount') + activeImpairedPos, 2),
    overdueActiveCount: overdueActive.length,
    overdueActivePos: activeImpairedPos,
  };
}

const scenarios = {
  contractual: scenarioTotals('contractual'),
  recovery: scenarioTotals('recovery'),
  strict: scenarioTotals('strict'),
};

const official = fullJson.portfolio?.data?.data || null;
const officialOpen = official?.open || null;
const officialClosed = official?.closed || null;

const dataQuality = {
  missingIncome: loans.filter((l) => l.income === null).length,
  missingBureau: loans.filter((l) => l.bureau === null).length,
  missingCity: loans.filter((l) => l.city === 'Unknown').length,
  missingState: loans.filter((l) => l.state === 'Other' || l.state === 'Unknown').length,
  missingStay: loans.filter((l) => l.stay === 0).length,
  missingPurpose: loans.length,
  missingMarital: loans.length,
  zeroAmount: loans.filter((l) => !l.amount).length,
  duplicateIds: loans.length - new Set(loans.map((l) => l.id)).size,
  closureBeforeDisb: loans.filter((l) => l.closure && l.disb && l.closure < l.disb).length,
  maturityBeforeDisb: loans.filter((l) => l.maturity && l.disb && l.maturity < l.disb).length,
  pastMaturityStillActive: active.filter((l) => l.maturity && l.maturity < asOf).length,
  incomeZeroShare: round(loans.filter((l) => l.income === null).length / loans.length, 4),
  bureauZeroShare: round(loans.filter((l) => l.bureau === null).length / loans.length, 4),
  cityCoverage: round(loans.filter((l) => l.city !== 'Unknown').length / loans.length, 4),
  stateCoverage: round(loans.filter((l) => l.state !== 'Other' && l.state !== 'Unknown').length / loans.length, 4),
};

const counts = {
  loans: loans.length,
  active: active.length,
  closed: closed.length,
  npa: npa.length,
  overdueActive: overdueActive.length,
  impaired: npa.length + overdueActive.length,
  borrowers: new Set(loans.map((l) => l.borrowerKey)).size,
  repeatBorrowers: [...loans.reduce((m, l) => m.set(l.borrowerKey, (m.get(l.borrowerKey) || 0) + 1), new Map()).values()].filter((n) => n > 1).length,
  repeatLoans: loans.filter((l) => l.repeatCount > 1).length,
  cities: new Set(loans.map((l) => l.city).filter((c) => c !== 'Unknown')).size,
  states: new Set(loans.map((l) => l.state).filter((s) => s !== 'Other' && s !== 'Unknown')).size,
  months: new Set(loans.map((l) => l.disbMonth).filter(Boolean)).size,
  schemes: new Set(loans.map((l) => l.scheme).filter(Boolean)).size,
  columns: COLUMNS.length,
};

const totals = {
  lent: sum(loans, 'amount'),
  pos: sum(active, 'pos'),
  received: sum(loans, 'received'),
  principalReceived: sum(loans, 'principalRec'),
  interestReceived: sum(loans, 'interestRec'),
  fee: sum(loans, 'fee'),
  npaAmount: sum(npa, 'npaAmount'),
  netProfit: sum(loans, 'netProfit'),
  activeExpectedReturns: sum(active, 'expReturns'),
  activeFutureInterest: sum(active, 'futureInterest'),
};

function portfolioXirr(rows, scenario = 'actual') {
  const flows = [];
  for (const l of rows) {
    flows.push({ time: new Date(`${l.disb || asOf}T00:00:00Z`).getTime(), amount: -l.amount });
    if (l.received > 0) {
      flows.push({
        time: l.status === 0
          ? new Date(`${asOf}T00:00:00Z`).getTime()
          : new Date(`${l.closure || l.maturity || asOf}T00:00:00Z`).getTime(),
        amount: l.received,
      });
    }
    if (l.status === 0) {
      const futureCash = scenario === 'strict' && l.impaired
        ? 0
        : scenario === 'recovery' && l.impaired
          ? round(RECOVERY_RATE * l.pos, 2)
          : round(l.pos + l.futureInterest - l.futureFee, 2);
      if (futureCash > 0) {
        flows.push({
          time: new Date(`${l.maturity && l.maturity > asOf ? l.maturity : addDays(asOf, 30)}T00:00:00Z`).getTime(),
          amount: futureCash,
        });
      }
    }
  }
  return xirrPct(flows);
}

const closedLent = sum(closed, 'amount');
const closedProfit = sum(closed, 'netProfit');
const closedAvgHoldingDays = closed.length ? closed.reduce((s, l) => s + l.holdingDays, 0) / closed.length : 0;
const closedNaiveAnr = closed.length ? closed.reduce((s, l) => s + (l.reportedAnr || 0), 0) / closed.length : 0;
const returnMethods = {
  officialClosedAnr: round(num(officialClosed?.annualized_net_return), 2),
  officialClosedAbsolute: round(num(officialClosed?.absolute_return), 2),
  officialClosedXirr: txt(officialClosed?.xirr, '0%'),
  officialClosedLent: round(num(officialClosed?.total_lent_amount), 2),
  officialClosedInterest: round(num(officialClosed?.net_interest_received), 2),
  officialClosedNpa: round(num(officialClosed?.total_npa_amount), 2),
  officialClosedFee: round(num(officialClosed?.total_fee_amount), 2),
  recomputed: {
    closedLent: round(closedLent, 2),
    closedProfit: round(closedProfit, 2),
    closedAbsolutePct: closedLent ? round((closedProfit / closedLent) * 100, 2) : 0,
    closedAvgHoldingDays: round(closedAvgHoldingDays, 1),
    closedCapitalTimeAnnualPct: closedLent && closedAvgHoldingDays
      ? round((closedProfit / closedLent) * (365 / closedAvgHoldingDays) * 100, 2)
      : 0,
    closedPortfolioXirr: portfolioXirr(closed),
    closedNaiveMeanAnr: round(closedNaiveAnr, 2),
    closedMedianAnr: round(median(closed.map((l) => l.reportedAnr || 0)), 2),
    closedCount: closed.length,
    closedNpaCount: npa.length,
    closedNpaRateByCount: round((npa.length / closed.length) * 100, 2),
    closedNpaRateByValue: closedLent ? round((sum(npa, 'npaAmount') / closedLent) * 100, 2) : 0,
    closedRecoveryRate: round((sum(npa, 'amount') - sum(npa, 'npaAmount')) / Math.max(1, sum(npa, 'amount')), 4),
  },
  active: {
    pos: sum(active, 'pos'),
    realisedInterest: sum(active, 'interestRec'),
    futureInterest: sum(active, 'futureInterest'),
    contractualProfit: sum(active, 'profitContractual'),
    recoveryProfit: sum(active, 'profitRecovery'),
    strictProfit: sum(active, 'profitStrict'),
    portfolioXirrContractual: portfolioXirr(active, 'contractual'),
    portfolioXirrRecovery: portfolioXirr(active, 'recovery'),
    portfolioXirrStrict: portfolioXirr(active, 'strict'),
  },
  whyTheyDiffer: [
    'Loan-level ANR annualises each loan independently and ignores capital idle time, sequencing and the fact that 80% of closed loans prepaid early.',
    'The platform ANR uses total closed-book profit over total lent with its own capital-time convention.',
    'Capital-time annualisation uses actual holding days, so early prepayments lift it above the platform ANR.',
    'XIRR is money-weighted and very sensitive to repayment timing; the export has no instalment dates, so closed-loan inflows are dated at closure.',
  ],
};

// Simple monthly series for the README / smoke tests.
const monthly = {};
for (const loan of loans) {
  if (!loan.disbMonth) continue;
  const m = monthly[loan.disbMonth] || (monthly[loan.disbMonth] = { month: loan.disbMonth, loans: 0, lent: 0, active: 0, closed: 0, npa: 0, profit: 0, received: 0, pos: 0 });
  m.loans += 1;
  m.lent += loan.amount;
  m.active += loan.status === 0 ? 1 : 0;
  m.closed += loan.status !== 0 ? 1 : 0;
  m.npa += loan.npa;
  m.profit += loan.netProfit;
  m.received += loan.received;
  m.pos += loan.pos;
}
for (const m of Object.values(monthly)) {
  for (const k of ['lent', 'profit', 'received', 'pos']) m[k] = round(m[k], 2);
}

const availableLoans = (importJson.available_loans_sample || []).map((l) => ({
  id: txt(l.loan_id),
  name: txt(l.borrower_name, 'Borrower'),
  loanAmount: num(l.loan_amount),
  fundedAmount: num(l.funded_amount),
  remainingAmount: num(l.remaining_amount),
  remainingPct: num(l.remaining_amount_percentage),
  tenure: num(l.loan_tenure),
  rate: num(l.loan_roi),
  score: num(l.ldc_score),
  riskType: txt(l.risk_type),
  lendingAmount: num(l.lending_amount),
  repay: txt(l.repayment_frequency),
  roiList: Array.isArray(l.roi_list) ? l.roi_list.map((x) => num(x)) : [],
}));

const meta = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  asOf,
  source: 'LenDenClub manual lending export (v5/v6 APIs)',
  recoveryRate: RECOVERY_RATE,
  lgd: LGD,
  counts,
  totals,
  returnMethods,
  scenarios,
  officialPortfolio: { open: officialOpen, closed: officialClosed },
  dataQuality,
  dictionaries: DICTIONARIES,
  columns: COLUMNS,
  availableLoans,
  monthly,
  notes: [
    'Returns are shown under three scenarios: contractual, 45% recovery on impaired active loans, and strict write-off of any active loan with DPD > 0.',
    'The platform ANR (16.1% on closed loans) is money-weighted across the whole book; averaging per-loan annualised returns overstates it because short-tenure loans annualise small absolute gains.',
    'DPD is a point-in-time snapshot. A loan can cure, so strict write-off is deliberately conservative.',
    'NPA classification lags delinquency by roughly 150 days in this book; recent cohorts therefore look artificially clean.',
    'XIRR is approximate: repayment dates are not present in the export, so closed-loan inflows are dated at closure and active inflows at the as-of date.',
    'Borrower state is derived from a curated city/district map; unmapped places are labelled Other.',
    'This is an analytics/education project, not investment advice.',
  ],
};

// ---------------------------------------------------------------------------
// Credit model (research-grade logistic scorecard)
// ---------------------------------------------------------------------------
const FEATURES = [
  { key: 'score', label: 'LenDenClub score', kind: 'num' },
  { key: 'bureau', label: 'Bureau score', kind: 'num' },
  { key: 'tenure', label: 'Tenure (months)', kind: 'num' },
  { key: 'rate', label: 'Borrower APR', kind: 'num' },
  { key: 'age', label: 'Borrower age', kind: 'num' },
  { key: 'logBorrowerAmount', label: 'Log borrower amount', kind: 'num' },
  { key: 'logIncome', label: 'Log monthly income', kind: 'num' },
  { key: 'foir', label: 'FOIR', kind: 'num' },
  { key: 'loanToAnnualIncome', label: 'Loan / annual income', kind: 'num' },
  { key: 'profession', label: 'Self-employed', kind: 'cat' },
  { key: 'female', label: 'Female borrower', kind: 'cat' },
  { key: 'tier2', label: 'Tier 2 city', kind: 'cat' },
  { key: 'tier3', label: 'Tier 3 city', kind: 'cat' },
  { key: 'stayOwned', label: 'Self-owned home', kind: 'cat' },
  { key: 'stayRented', label: 'Rented home', kind: 'cat' },
  { key: 'daily', label: 'Daily repayment', kind: 'cat' },
  { key: 'gradeAA', label: 'Grade AA', kind: 'cat' },
];

const modelRows = closed.map((l) => ({
  id: l.id,
  y: l.npa,
  values: {
    score: l.score,
    bureau: l.bureau,
    tenure: l.tenure,
    rate: l.rate,
    age: l.age,
    logBorrowerAmount: Math.log1p(l.borrowerAmount || 0),
    logIncome: l.income ? Math.log1p(l.income) : null,
    foir: l.foir,
    loanToAnnualIncome: l.loanToAnnualIncome,
    profession: l.profession,
    female: l.gender === 1 ? 1 : 0,
    tier2: l.cityTier === 2 ? 1 : 0,
    tier3: l.cityTier === 3 ? 1 : 0,
    stayOwned: l.stay === 1 ? 1 : 0,
    stayRented: l.stay === 2 ? 1 : 0,
    daily: l.repay ? 1 : 0,
    gradeAA: l.grade === 1 ? 1 : 0,
  },
}));

function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const impute = {};
for (const f of FEATURES) {
  impute[f.key] = median(modelRows.map((r) => r.values[f.key]));
}
const rawMatrix = modelRows.map((r) => FEATURES.map((f) => {
  const v = r.values[f.key];
  return Number.isFinite(v) ? v : impute[f.key];
}));
const means = FEATURES.map((_, j) => rawMatrix.reduce((s, row) => s + row[j], 0) / rawMatrix.length);
const stds = FEATURES.map((_, j) => {
  const m = means[j];
  const variance = rawMatrix.reduce((s, row) => s + (row[j] - m) ** 2, 0) / rawMatrix.length;
  return Math.sqrt(variance) || 1;
});
const X = rawMatrix.map((row) => row.map((v, j) => clamp((v - means[j]) / stds[j], -6, 6)));
const y = modelRows.map((r) => r.y);

const foldOf = (id) => parseInt(hash36(id).slice(-4), 36) % 5;
const trainIdx = [];
const testIdx = [];
modelRows.forEach((r, i) => (foldOf(r.id) === 0 ? testIdx : trainIdx).push(i));

const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));

function wilsonUpper(bad, n, z = 1.96) {
  if (!n) return 0;
  const p = bad / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.min(1, (centre + spread) / denom);
}

function trainLogistic(indices, { epochs = 2600, lr = 0.08, l2 = 0.6 } = {}) {
  const d = FEATURES.length;
  const w = new Array(d).fill(0);
  let b = 0;
  const pos = indices.reduce((s, i) => s + y[i], 0);
  const neg = indices.length - pos;
  const wPos = indices.length / (2 * Math.max(1, pos));
  const wNeg = indices.length / (2 * Math.max(1, neg));
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (const i of indices) {
      let z = b;
      for (let j = 0; j < d; j += 1) z += w[j] * X[i][j];
      const p = sigmoid(z);
      const sampleWeight = y[i] ? wPos : wNeg;
      const err = (p - y[i]) * sampleWeight;
      for (let j = 0; j < d; j += 1) gw[j] += err * X[i][j];
      gb += err;
    }
    const n = Math.max(1, indices.length);
    for (let j = 0; j < d; j += 1) w[j] -= lr * (gw[j] / n + l2 * w[j] / n);
    b -= lr * (gb / n);
  }
  return { w, b };
}

function predictAt(model, i) {
  let z = model.b;
  for (let j = 0; j < model.w.length; j += 1) z += model.w[j] * X[i][j];
  return sigmoid(z);
}
function auc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rank = 1;
  let posRankSum = 0;
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    if (i > 0 && pairs[i][0] !== pairs[i - 1][0]) rank = i + 1;
    if (pairs[i][1]) {
      posRankSum += rank;
      pos += 1;
    } else neg += 1;
  }
  if (!pos || !neg) return 0.5;
  return (posRankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}
function ks(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => b[0] - a[0]);
  let tp = 0;
  let fp = 0;
  let maxKs = 0;
  const pos = labels.reduce((s, v) => s + v, 0);
  const neg = labels.length - pos;
  for (const [, label] of pairs) {
    if (label) tp += 1;
    else fp += 1;
    maxKs = Math.max(maxKs, Math.abs(tp / pos - fp / neg));
  }
  return maxKs;
}

const finalModel = trainLogistic(trainIdx);
const testScores = testIdx.map((i) => predictAt(finalModel, i));
const testLabels = testIdx.map((i) => y[i]);
const testAuc = auc(testScores, testLabels);
const testKs = ks(testScores, testLabels);
const predAt50 = testScores.map((p) => (p >= 0.5 ? 1 : 0));
let tp = predAt50.reduce((s, p, i) => s + (p && testLabels[i] ? 1 : 0), 0);
let fp = predAt50.reduce((s, p, i) => s + (p && !testLabels[i] ? 1 : 0), 0);
let fn = predAt50.reduce((s, p, i) => s + (!p && testLabels[i] ? 1 : 0), 0);
let tn = predAt50.length - tp - fp - fn;
let precision = tp + fp ? tp / (tp + fp) : 0;
let recall = tp + fn ? tp / (tp + fn) : 0;
let logLoss = -testScores.reduce((s, p, i) => s + (testLabels[i] ? Math.log(Math.max(p, 1e-9)) : Math.log(Math.max(1 - p, 1e-9))), 0) / testScores.length;
let brier = testScores.reduce((s, p, i) => s + (p - testLabels[i]) ** 2, 0) / testScores.length;

// 5-fold cross-validation AUC (shorter training for speed).
const cvAucs = [];
const oofScores = new Array(modelRows.length).fill(null);
for (let fold = 0; fold < 5; fold += 1) {
  const tr = [];
  const te = [];
  modelRows.forEach((r, i) => (foldOf(r.id) === fold ? te : tr).push(i));
  if (!te.length || !tr.some((i) => y[i]) || !te.some((i) => y[i])) continue;
  const m = trainLogistic(tr, { epochs: 2600, lr: 0.08, l2: 0.6 });
  const foldScores = te.map((i) => predictAt(m, i));
  cvAucs.push(auc(foldScores, te.map((i) => y[i])));
  te.forEach((i, k) => { oofScores[i] = foldScores[k]; });
}

// Platt calibration. Training used class-balanced weights so the model ranks
// well, but that inflates raw probabilities (the balanced prior is ~39% vs a
// true base rate of ~8%). Platt scaling maps the score onto the real rate
// without changing the ranking.
const logit = (p) => Math.log(Math.max(p, 1e-9) / Math.max(1 - p, 1e-9));
function fitPlatt(xs, labels, { epochs = 5000, lr = 0.05 } = {}) {
  let a = 1;
  let b = 0;
  const n = xs.length || 1;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < n; i += 1) {
      if (xs[i] === null || !Number.isFinite(xs[i])) continue;
      const p = sigmoid(a * xs[i] + b);
      const err = p - labels[i];
      ga += err * xs[i];
      gb += err;
    }
    a -= (lr * ga) / n;
    b -= (lr * gb) / n;
  }
  return { a: round(a, 6), b: round(b, 6) };
}
const platt = fitPlatt(oofScores.map((p) => (p === null ? null : logit(p))), y);
const calibrate = (p) => (p === null ? null : sigmoid(platt.a * logit(p) + platt.b));
const calibratedTestScores = testScores.map((p) => calibrate(p) ?? p);
const meanPredicted = round(calibratedTestScores.reduce((s, p) => s + p, 0) / calibratedTestScores.length, 4);
const meanActual = round(testLabels.reduce((s, v) => s + v, 0) / testLabels.length, 4);
logLoss = -calibratedTestScores.reduce((s, p, i) => s + (testLabels[i] ? Math.log(Math.max(p, 1e-9)) : Math.log(Math.max(1 - p, 1e-9))), 0) / calibratedTestScores.length;
brier = calibratedTestScores.reduce((s, p, i) => s + (p - testLabels[i]) ** 2, 0) / calibratedTestScores.length;

// Classification metrics are reported on the calibrated probability at a 10%
// default threshold — the base rate is ~8%, so 0.5 would flag a third of the
// book as bad.
const decisionThreshold = 0.1;
const predFlag = calibratedTestScores.map((p) => (p >= decisionThreshold ? 1 : 0));
tp = predFlag.reduce((s, p, i) => s + (p && testLabels[i] ? 1 : 0), 0);
fp = predFlag.reduce((s, p, i) => s + (p && !testLabels[i] ? 1 : 0), 0);
fn = predFlag.reduce((s, p, i) => s + (!p && testLabels[i] ? 1 : 0), 0);
tn = predFlag.length - tp - fp - fn;
precision = tp + fp ? tp / (tp + fp) : 0;
recall = tp + fn ? tp / (tp + fn) : 0;

// ROC, lift, calibration.
const roc = [];
{
  const pos = testLabels.reduce((s, v) => s + v, 0);
  const neg = testLabels.length - pos;
  const sorted = testScores.map((s, i) => [s, testLabels[i]]).sort((a, b) => b[0] - a[0]);
  let tp2 = 0;
  let fp2 = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i][1]) tp2 += 1;
    else fp2 += 1;
    if (i % Math.max(1, Math.floor(sorted.length / 80)) === 0 || i === sorted.length - 1) {
      roc.push({ fpr: round(fp2 / neg, 4), tpr: round(tp2 / pos, 4) });
    }
  }
}
const lift = [];
{
  const sorted = testScores.map((s, i) => [s, testLabels[i]]).sort((a, b) => b[0] - a[0]);
  const base = testLabels.reduce((s, v) => s + v, 0) / testLabels.length;
  const size = Math.ceil(sorted.length / 10);
  for (let d = 0; d < 10; d += 1) {
    const slice = sorted.slice(d * size, (d + 1) * size);
    if (!slice.length) break;
    const bad = slice.filter(([, label]) => label).length;
    lift.push({
      decile: d + 1,
      count: slice.length,
      bad,
      badRate: round(bad / slice.length, 4),
      lift: round(bad / slice.length / Math.max(base, 1e-9), 3),
      avgScore: round(slice.reduce((s, [p]) => s + p, 0) / slice.length, 4),
    });
  }
}
const calibration = [];
{
  const size = Math.ceil(calibratedTestScores.length / 10);
  const order = calibratedTestScores.map((s, i) => [s, testLabels[i]]).sort((a, b) => a[0] - b[0]);
  for (let b = 0; b < 10; b += 1) {
    const slice = order.slice(b * size, (b + 1) * size);
    if (!slice.length) break;
    calibration.push({
      bin: b + 1,
      predicted: round(slice.reduce((s, [p]) => s + p, 0) / slice.length, 4),
      actual: round(slice.filter(([, label]) => label).length / slice.length, 4),
      count: slice.length,
    });
  }
}

// WOE / IV on the full closed book (descriptive).
function woeTable(key, label) {
  const rows = modelRows.map((r) => ({ v: r.values[key], y: r.y }));
  const isCategorical = ['profession', 'female', 'tier2', 'tier3', 'stayOwned', 'stayRented', 'daily', 'gradeAA'].includes(key);
  let groups;
  if (isCategorical) {
    groups = [0, 1].map((v) => ({
      bin: v ? `${label}: yes` : `${label}: no`,
      rows: rows.filter((r) => (Number.isFinite(r.v) ? (r.v ? 1 : 0) : 0) === v),
    }));
  } else {
    const vals = rows.map((r) => r.v).filter(Number.isFinite).sort((a, b) => a - b);
    if (!vals.length) return [];
    const edges = [vals[0]];
    for (let q = 1; q < 5; q += 1) {
      const v = vals[Math.floor((vals.length - 1) * (q / 5))];
      if (v > edges[edges.length - 1]) edges.push(v);
    }
    edges.push(vals[vals.length - 1] + 1e-9);
    groups = [];
    for (let i = 0; i < edges.length - 1; i += 1) {
      groups.push({
        bin: `${round(edges[i], 1)} – ${round(edges[i + 1], 1)}`,
        rows: rows.filter((r) => Number.isFinite(r.v) && r.v >= edges[i] && r.v < edges[i + 1]),
      });
    }
  }
  const totalBad = rows.filter((r) => r.y).length;
  const totalGood = rows.length - totalBad;
  let iv = 0;
  const out = groups.map((g) => {
    const bad = g.rows.filter((r) => r.y).length;
    const good = g.rows.length - bad;
    const badPct = (bad + 0.5) / (totalBad + 0.5 * groups.length);
    const goodPct = (good + 0.5) / (totalGood + 0.5 * groups.length);
    const woe = Math.log(badPct / goodPct);
    iv += (badPct - goodPct) * woe;
    return {
      bin: g.bin,
      count: g.rows.length,
      bad,
      good,
      badRate: round(bad / Math.max(1, g.rows.length), 4),
      woe: round(woe, 3),
    };
  });
  return { key, label, iv: round(iv, 3), bins: out.filter((b) => b.count > 0) };
}

const woe = FEATURES.map((f) => woeTable(f.key, f.label));
const coefficients = FEATURES.map((f, j) => ({
  key: f.key,
  label: f.label,
  coef: round(finalModel.w[j], 4),
  mean: round(means[j], 4),
  std: round(stds[j], 4),
  impute: round(impute[f.key], 4),
  iv: woe.find((w) => w.key === f.key)?.iv ?? 0,
}));

function predictRow(loan) {
  const values = {
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
  let z = finalModel.b;
  FEATURES.forEach((f, j) => {
    const raw = Number.isFinite(values[f.key]) ? values[f.key] : impute[f.key];
    const x = clamp((raw - means[j]) / stds[j], -6, 6);
    z += finalModel.w[j] * x;
  });
  return sigmoid(platt.a * logit(sigmoid(z)) + platt.b);
}

// Policy grid (in-sample; illustrative).
const policyGrid = [];
const thresholds = [700, 720, 740, 760, 780, 800];
const tenures = [2, 3, 4, 5, 6, 12];
const foirs = [0.35, 0.5, 0.7, 1.0, 99];
const professions = ['all', 'salaried', 'self'];
for (const minScore of thresholds) {
  for (const maxTenure of tenures) {
    for (const maxFoir of foirs) {
      for (const profession of professions) {
        const picked = closed.filter((l) => {
          if (l.score < minScore || l.tenure > maxTenure) return false;
          if (profession === 'salaried' && l.profession !== 0) return false;
          if (profession === 'self' && l.profession !== 1) return false;
          if (l.foir !== null && l.foir > maxFoir) return false;
          return true;
        });
        if (picked.length < 300) continue;
        const lent = picked.reduce((s, l) => s + l.amount, 0);
        const profit = picked.reduce((s, l) => s + l.netProfit, 0);
        const bad = picked.filter((l) => l.npa).length;
        const avgHolding = picked.reduce((s, l) => s + l.holdingDays, 0) / picked.length;
        const simpleAnnual = lent && avgHolding ? (profit / lent) * (365 / avgHolding) * 100 : 0;
        const flows = [];
        for (const l of picked) {
          flows.push({ time: new Date(`${l.disb}T00:00:00Z`).getTime(), amount: -l.amount });
          if (l.received > 0) flows.push({ time: new Date(`${l.closure || l.maturity}T00:00:00Z`).getTime(), amount: l.received });
        }
        policyGrid.push({
          minScore,
          maxTenure,
          maxFoir: maxFoir === 99 ? null : maxFoir,
          profession,
          loans: picked.length,
          approvalRate: round(picked.length / closed.length, 4),
          npaRate: round(bad / picked.length, 4),
          npaUpper95: round(wilsonUpper(bad, picked.length), 4),
          avgReportedAnr: round(picked.reduce((s, l) => s + (l.reportedAnr || 0), 0) / picked.length, 2),
          lent: round(lent, 2),
          profit: round(profit, 2),
          avgProfit: round(profit / picked.length, 2),
          simpleAnnual: round(simpleAnnual, 2),
          xirr: xirrPct(flows),
          expectedLossRate: round((bad / picked.length) * LGD, 4),
        });
      }
    }
  }
}
policyGrid.sort((a, b) => (b.xirr ?? -999) - (a.xirr ?? -999) || b.loans - a.loans);

// Deduplicate near-identical cells: keep the best FOIR cut for each
// score / tenure / profession combination.
const seenPolicy = new Set();
const deduped = [];
for (const p of policyGrid) {
  const key = `${p.minScore}|${p.maxTenure}|${p.profession}`;
  if (seenPolicy.has(key)) continue;
  seenPolicy.add(key);
  deduped.push(p);
  if (deduped.length >= 80) break;
}
const balancedPool = deduped.filter((p) => p.maxTenure >= 4 && p.loans >= 500);
const safePool = deduped.filter((p) => p.npaRate <= 0.04 && p.loans >= 300 && p.maxTenure >= 4);
const recommendedPolicies = {
  balanced: balancedPool[0] || deduped[0] || null,
  highestXirr: deduped[0] || null,
  safest: safePool.sort((a, b) => a.npaRate - b.npaRate || (b.xirr ?? -999) - (a.xirr ?? -999))[0] || null,
  shortTenure: deduped.find((p) => p.maxTenure <= 3 && p.loans >= 300) || null,
};

const model = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  asOf,
  trainedOn: 'Closed loans only (status CLOSED or NPA)',
  observations: modelRows.length,
  events: y.reduce((s, v) => s + v, 0),
  eventRate: round(y.reduce((s, v) => s + v, 0) / modelRows.length, 4),
  features: FEATURES.map((f) => ({ key: f.key, label: f.label, kind: f.kind })),
  coefficients,
  intercept: round(finalModel.b, 4),
  metrics: {
    auc: round(testAuc, 4),
    gini: round(testAuc * 2 - 1, 4),
    ks: round(testKs, 4),
    accuracy: round((tp + tn) / Math.max(1, testScores.length), 4),
    precision: round(precision, 4),
    recall: round(recall, 4),
    f1: round(precision + recall ? (2 * precision * recall) / (precision + recall) : 0, 4),
    logLoss: round(logLoss, 4),
    brier: round(brier, 4),
    cvAuc: round(cvAucs.reduce((s, v) => s + v, 0) / Math.max(1, cvAucs.length), 4),
    cvFolds: cvAucs.length,
    trainSize: trainIdx.length,
    testSize: testIdx.length,
    confusion: { tp, fp, fn, tn },
  },
  roc,
  lift,
  calibration,
  platt: { ...platt, meanPredicted, meanActual, baseRate: round(y.reduce((s, v) => s + v, 0) / y.length, 4), threshold: decisionThreshold },
  woe,
  lgd: LGD,
  recoveryRate: RECOVERY_RATE,
  policyGrid: deduped,
  policyGridSize: policyGrid.length,
  recommendedPolicies,
  notes: [
    'Logistic scorecard trained on 2,934 closed loans; NPA is the target.',
    'AUC around 0.60–0.65 is typical for thin-file consumer credit; treat this as directional, not production-grade.',
    'Policy grid is in-sample and ignores approval elasticity, concentration limits and seasonality.',
    'Features are standardised; coefficients are log-odds per 1 standard deviation.',
    'Training used class-balanced weights, so raw scores are not probabilities. Platt scaling on out-of-fold predictions maps them onto the real base rate — always read the calibrated number.',
  ],
};

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const columnKeys = COLUMNS.map((c) => c.key);
const rows = loans.map((l) => columnKeys.map((key) => {
  const v = l[key];
  if (v === undefined) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}));
const payload = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  asOf,
  columns: columnKeys,
  rows,
};
fs.writeFileSync(path.join(OUT_DIR, 'loans.json'), JSON.stringify(payload));
fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'model.json'), JSON.stringify(model, null, 2));

// A compact build report in the console.
const report = {
  rawImport: path.basename(importFile),
  rawFull: path.basename(fullFile),
  joinedLists,
  ...counts,
  totals,
  scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, v]) => [k, {
    projectedProfit: v.projectedProfit,
    futureProfit: v.futureProfit,
    portfolioXirr: v.portfolioXirr,
    roiPct: v.roiPct,
    expectedLoss: v.expectedLoss,
  }])),
  model: {
    auc: model.metrics.auc,
    ks: model.metrics.ks,
    cvAuc: model.metrics.cvAuc,
    recommendedPolicies,
  },
  files: {
    loansBytes: fs.statSync(path.join(OUT_DIR, 'loans.json')).size,
    metaBytes: fs.statSync(path.join(OUT_DIR, 'meta.json')).size,
    modelBytes: fs.statSync(path.join(OUT_DIR, 'model.json')).size,
  },
};
console.log(JSON.stringify(report, null, 2));
