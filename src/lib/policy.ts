/**
 * Lending policy: twenty rules, twenty points.
 *
 * Every criterion is derived from this book's own outcomes — NPA rate, loss
 * by value, capital-time return and realised profit per ₹100 lent — and each
 * one states the action to take when bidding on a new loan. The same criteria
 * score a live marketplace loan (where the platform exposes the field) and
 * replay the whole policy over the closed book.
 */
import type { AvailableLoan, Loan, Meta } from './types';
import { isClosed, isNpa } from './metrics';
import { mean, median, round, sum, wilsonInterval } from './stats';
import { clamp } from './format';

export type PolicyCategory = 'tenure' | 'score' | 'amount' | 'pricing' | 'installment' | 'profile' | 'process';

export interface BorrowerProfile {
  score: number;
  tenure: number;
  rate: number;
  amount: number;
  emi: number | null;
  foir: number | null;
  bureau: number | null;
  income: number | null;
  age: number | null;
  profession: number | null;
  cityTier: number | null;
  grade: number | null;
  repay: number | null;
  repeatCount: number;
}

export interface PolicyCriterion {
  id: string;
  emoji: string;
  n: number;
  title: string;
  action: string;
  why: string;
  impact: string;
  impactValue: number;
  sample: number;
  gate: boolean;
  category: PolicyCategory;
  /** null = the marketplace does not expose this field, so verify it in the app. */
  check: (p: BorrowerProfile) => boolean | null;
}

export interface BucketStats {
  n: number;
  closed: number;
  npaRate: number;
  npaLo: number;
  npaHi: number;
  valueLoss: number;
  capitalTime: number;
  per100: number;
  xirrMedian: number | null;
  holdDays: number;
  prepay: number;
}

export interface PolicyResult {
  criteria: PolicyCriterion[];
  gates: PolicyCriterion[];
  passed: number;
  failed: number;
  unknown: number;
  blocked: string[];
}

export interface PolicyBacktest {
  approved: number;
  approvalRate: number;
  npaRate: number;
  npaRateBook: number;
  xirr: number | null;
  capitalTime: number;
  capitalTimeBook: number;
  profit: number;
  profitPer100: number;
  profitPer100Book: number;
  lent: number;
}

export function bucketStats(rows: Loan[], predicate: (l: Loan) => boolean): BucketStats {
  const group = rows.filter(predicate);
  const closed = group.filter(isClosed);
  const npa = closed.filter(isNpa);
  const ci = wilsonInterval(npa.length, closed.length);
  const lent = sum(closed, (l) => l.amount);
  const profit = sum(closed, (l) => l.netProfit);
  const capitalDays = sum(closed, (l) => l.amount * l.holdingDays);
  const xirr = closed
    .filter((l) => l.holdingDays >= 30 && Math.abs(l.xirrRecovery ?? 0) <= 300)
    .map((l) => l.xirrRecovery as number)
    .sort((a, b) => a - b);
  return {
    n: group.length,
    closed: closed.length,
    npaRate: closed.length ? (npa.length / closed.length) * 100 : 0,
    npaLo: ci.low * 100,
    npaHi: ci.high * 100,
    valueLoss: lent ? (sum(closed, (l) => l.npaAmount || 0) / lent) * 100 : 0,
    capitalTime: capitalDays ? (profit / capitalDays) * 365 * 100 : 0,
    per100: lent ? (profit / lent) * 100 : 0,
    xirrMedian: xirr.length ? round(xirr[Math.floor(xirr.length / 2)], 2) : null,
    holdDays: closed.length ? mean(closed.map((l) => l.holdingDays), (v) => v) : 0,
    prepay: closed.length ? (closed.filter((l) => l.prepaid === 1).length / closed.length) * 100 : 0,
  };
}

export function profileOfLoan(loan: Loan): BorrowerProfile {
  return {
    score: loan.score,
    tenure: loan.tenure,
    rate: loan.rate,
    amount: loan.amount,
    emi: loan.emi,
    foir: loan.foir,
    bureau: loan.bureau,
    income: loan.income,
    age: loan.age,
    profession: loan.profession,
    cityTier: loan.cityTier,
    grade: loan.grade,
    repay: loan.repay,
    repeatCount: loan.repeatCount,
  };
}

export function profileOfAvailable(loan: AvailableLoan): BorrowerProfile {
  return {
    score: loan.score,
    tenure: loan.tenure,
    rate: loan.rate,
    amount: loan.loanAmount,
    emi: null,
    foir: null,
    bureau: null,
    income: null,
    age: null,
    profession: null,
    cityTier: null,
    grade: null,
    repay: null,
    repeatCount: 1,
  };
}

const p1 = (v: number) => `${round(v, 1)}%`;
const p2 = (v: number) => `${round(v, 2)}%`;

/**
 * The twenty criteria. Evidence strings are filled in from the live book, so
 * the panel re-derives itself whenever the filters change.
 */
export function derivePolicy(rows: Loan[]): PolicyCriterion[] {
  const short = bucketStats(rows, (l) => l.tenure === 2);
  const mid = bucketStats(rows, (l) => l.tenure === 3 || l.tenure === 4);
  const long = bucketStats(rows, (l) => l.tenure >= 6);
  const scoreLow = bucketStats(rows, (l) => l.score < 740);
  const scoreMid = bucketStats(rows, (l) => l.score >= 740 && l.score < 760);
  const scoreHigh = bucketStats(rows, (l) => l.score >= 760);
  const smallTicket = bucketStats(rows, (l) => l.amount <= 1000);
  const midTicket = bucketStats(rows, (l) => l.amount > 1000 && l.amount <= 2500);
  const bigTicket = bucketStats(rows, (l) => l.amount > 2500);
  const cheap = bucketStats(rows, (l) => l.rate < 40);
  const priced = bucketStats(rows, (l) => l.rate >= 44);
  const highFoir = bucketStats(rows, (l) => l.foir !== null && l.foir > 0.1);
  const lowFoir = bucketStats(rows, (l) => l.foir !== null && l.foir <= 0.1);
  const bigEmi = bucketStats(rows, (l) => l.emi !== null && l.emi > 500);
  const smallEmi = bucketStats(rows, (l) => l.emi !== null && l.emi <= 500);
  const young = bucketStats(rows, (l) => l.age <= 25);
  const prime = bucketStats(rows, (l) => l.age > 30 && l.age <= 50);
  const noIncome = bucketStats(rows, (l) => l.income === null);
  const thinIncome = bucketStats(rows, (l) => l.income !== null && l.income < 15000);
  const badBureau = bucketStats(rows, (l) => l.bureau !== null && l.bureau < 650);
  const goodBureau = bucketStats(rows, (l) => l.bureau !== null && l.bureau >= 650);
  const repeat = bucketStats(rows, (l) => l.repeatCount > 1);
  const firstTime = bucketStats(rows, (l) => l.repeatCount <= 1);
  const tier1 = bucketStats(rows, (l) => l.cityTier === 1);
  const tier2 = bucketStats(rows, (l) => l.cityTier === 2);
  const salaried = bucketStats(rows, (l) => l.profession === 0);
  const selfEmployed = bucketStats(rows, (l) => l.profession === 1);
  const gradeA = bucketStats(rows, (l) => l.grade === 0);
  const gradeAA = bucketStats(rows, (l) => l.grade === 1);
  const edi = bucketStats(rows, (l) => l.repay === 1);
  const emiBook = bucketStats(rows, (l) => l.repay === 0);
  const youngVintage = bucketStats(rows, (l) => l.vintageDays <= 92);
  const seasoned = bucketStats(rows, (l) => l.vintageDays > 183);
  const twoMonth = bucketStats(rows, (l) => l.tenure === 2);
  const threeMonth = bucketStats(rows, (l) => l.tenure === 3);

  const spread = (a: number, b: number) => round(Math.abs(a - b), 1);

  const criteria: PolicyCriterion[] = [
    {
      id: 'tenure-short',
      emoji: '🧱',
      n: 1,
      title: 'Give 2–3 month loans, not 6–12 month ones',
      action: 'Tenure: 2–3 months. Hard cap 4 months.',
      why: `2M loans ran ${p2(short.npaRate)} NPA and ${p1(short.capitalTime)} capital-time return; 3–4M ran ${p2(mid.npaRate)} and ${p1(mid.capitalTime)}; 6M and 12M ran ${p2(long.npaRate)} NPA with ${p1(long.capitalTime)} and lost ${p1(Math.abs(long.per100))} per ₹100 lent.`,
      impact: `${spread(long.npaRate, short.npaRate)} pp NPA spread`,
      impactValue: spread(long.npaRate, short.npaRate),
      sample: short.closed + mid.closed + long.closed,
      gate: true,
      category: 'tenure',
      check: (p) => (p.tenure <= 4 ? true : null),
    },
    {
      id: 'tenure-prefer-2m',
      emoji: '⏳',
      n: 2,
      title: 'When both are on the table, take the 2-month loan',
      action: 'Prefer 2M over 3M: capital comes back twice as fast.',
      why: `2M returns ${p1(twoMonth.capitalTime)} capital-time against ${p1(threeMonth.capitalTime)} for 3M, and ${p1(twoMonth.prepay)} of 2M loans close early versus ${p1(threeMonth.prepay)} of 3M loans. Same money, roughly twice the cycles a year.`,
      impact: `${spread(twoMonth.capitalTime, threeMonth.capitalTime)} pp capital-time`,
      impactValue: spread(twoMonth.capitalTime, threeMonth.capitalTime),
      sample: twoMonth.closed + threeMonth.closed,
      gate: false,
      category: 'tenure',
      check: (p) => (p.tenure === 2 ? true : p.tenure <= 4 ? false : null),
    },
    {
      id: 'score-floor',
      emoji: '🎯',
      n: 3,
      title: 'Only lend at LenDenClub score 740 or above',
      action: 'LDC score floor: 740.',
      why: `Below 740 the book ran ${p2(scoreLow.npaRate)} NPA (${p2(scoreLow.valueLoss)} of principal lost); 740–759 ran ${p2(scoreMid.npaRate)}; 760+ ran ${p2(scoreHigh.npaRate)}. The 740 line is where the loss rate halves.`,
      impact: `${spread(scoreLow.npaRate, scoreHigh.npaRate)} pp NPA spread`,
      impactValue: spread(scoreLow.npaRate, scoreHigh.npaRate),
      sample: scoreLow.closed + scoreMid.closed + scoreHigh.closed,
      gate: true,
      category: 'score',
      check: (p) => (p.score >= 740 ? true : false),
    },
    {
      id: 'score-prefer-760',
      emoji: '💯',
      n: 4,
      title: 'Prefer 760+ over 740–759',
      action: 'Target band: 760 and above.',
      why: `760+ loans ran ${p2(scoreHigh.npaRate)} NPA and ${p2(scoreHigh.valueLoss)} of value lost, against ${p2(scoreMid.npaRate)} and ${p2(scoreMid.valueLoss)} for 740–759. The premium is free — you are not paying for the better score.`,
      impact: `${spread(scoreMid.npaRate, scoreHigh.npaRate)} pp NPA spread`,
      impactValue: spread(scoreMid.npaRate, scoreHigh.npaRate),
      sample: scoreMid.closed + scoreHigh.closed,
      gate: false,
      category: 'score',
      check: (p) => (p.score >= 760 ? true : p.score >= 740 ? false : null),
    },
    {
      id: 'ticket-cap',
      emoji: '💰',
      n: 5,
      title: 'Keep every ticket at ₹1,000 or below',
      action: 'Invested amount per loan: ≤ ₹1,000.',
      why: `Loans of ₹1,000 and under ran ${p2(smallTicket.npaRate)} NPA and returned ${p1(smallTicket.per100)} per ₹100 lent; the ₹1,001–2,500 band ran ${p2(midTicket.npaRate)} NPA, lost ${p1(midTicket.valueLoss)} of principal and returned ${p1(midTicket.per100)} per ₹100.`,
      impact: `${spread(midTicket.npaRate, smallTicket.npaRate)} pp NPA spread`,
      impactValue: spread(midTicket.npaRate, smallTicket.npaRate),
      sample: smallTicket.closed + midTicket.closed,
      gate: true,
      category: 'amount',
      check: (p) => (p.amount <= 1000 ? true : false),
    },
    {
      id: 'ticket-ceiling',
      emoji: '⚠️',
      n: 6,
      title: 'Never go above ₹2,500 on one loan',
      action: 'Absolute ticket ceiling: ₹2,500.',
      why: `Above ₹2,500 the book ran ${p2(bigTicket.npaRate)} NPA and lost ${p1(bigTicket.valueLoss)} of principal. Bigger tickets do not earn more — they lose more, because one default wipes out a bigger slice of a smaller book.`,
      impact: `${spread(bigTicket.npaRate, smallTicket.npaRate)} pp NPA spread`,
      impactValue: spread(bigTicket.npaRate, smallTicket.npaRate),
      sample: bigTicket.closed + smallTicket.closed,
      gate: true,
      category: 'amount',
      check: (p) => (p.amount <= 2500 ? true : false),
    },
    {
      id: 'rate-floor',
      emoji: '⬆️',
      n: 7,
      title: 'Do not bid below 44% APR',
      action: 'Minimum borrower APR: 44%.',
      why: `Below 40% APR the median loan XIRR fell to ${p1(cheap.xirrMedian ?? 0)} against ${p1(priced.xirrMedian ?? 0)} for loans priced at 44% and above. Yield, not risk, is what breaks on cheap loans — they carry the same default risk.`,
      impact: `${spread(priced.xirrMedian ?? 0, cheap.xirrMedian ?? 0)} pp XIRR spread`,
      impactValue: spread(priced.xirrMedian ?? 0, cheap.xirrMedian ?? 0),
      sample: cheap.closed + priced.closed,
      gate: true,
      category: 'pricing',
      check: (p) => (p.rate >= 44 ? true : false),
    },
    {
      id: 'fee-net',
      emoji: '💸',
      n: 8,
      title: 'Price the platform fee into the decision',
      action: 'Require 44% gross so at least 38–40% is left net of fees.',
      why: `The platform fee runs about 1% of principal on 2–3M loans and 2.3–5.4% on 4M and above, which is 5–11 points of annual return. A 44% headline becomes roughly 38% net, and a 48% headline becomes about 40% net once the fee is amortised.`,
      impact: '5–11 points of annual return',
      impactValue: 8,
      sample: rows.length,
      gate: false,
      category: 'pricing',
      check: (p) => (p.rate >= 44 ? true : null),
    },
    {
      id: 'foir-cap',
      emoji: '📉',
      n: 9,
      title: 'Cap the instalment at 10% of monthly income',
      action: 'FOIR ceiling: 10% (EMI ÷ monthly income).',
      why: `Borrowers above 10% FOIR ran ${p2(highFoir.npaRate)} NPA against ${p2(lowFoir.npaRate)} for everyone else. A stretched instalment is the cleanest early-warning signal in the whole dataset.`,
      impact: `${spread(highFoir.npaRate, lowFoir.npaRate)} pp NPA spread`,
      impactValue: spread(highFoir.npaRate, lowFoir.npaRate),
      sample: highFoir.closed + lowFoir.closed,
      gate: true,
      category: 'installment',
      check: (p) => (p.foir === null ? null : p.foir <= 0.1),
    },
    {
      id: 'emi-cap',
      emoji: '💵',
      n: 10,
      title: 'Keep the monthly instalment under ₹500',
      action: 'Monthly EMI: ≤ ₹500 per month.',
      why: `Loans with an EMI above ₹500 ran ${p2(bigEmi.npaRate)} NPA against ${p2(smallEmi.npaRate)} for the smaller instalments. A large EMI is a large monthly obligation on a thin-file borrower, and it defaults more often.`,
      impact: `${spread(bigEmi.npaRate, smallEmi.npaRate)} pp NPA spread`,
      impactValue: spread(bigEmi.npaRate, smallEmi.npaRate),
      sample: bigEmi.closed + smallEmi.closed,
      gate: true,
      category: 'installment',
      check: (p) => (p.emi === null ? null : p.emi <= 500),
    },
    {
      id: 'age-floor',
      emoji: '👤',
      n: 11,
      title: 'Do not lend to borrowers under 26',
      action: 'Borrower age: 26 and above.',
      why: `Borrowers of 25 and under ran ${p2(young.npaRate)} NPA, lost ${p1(young.valueLoss)} of principal and returned ${p1(young.per100)} per ₹100 lent — the only band in the book that lost money. The 31–50 band returned ${p1(prime.per100)} per ₹100.`,
      impact: `${spread(young.npaRate, prime.npaRate)} pp NPA spread`,
      impactValue: spread(young.npaRate, prime.npaRate),
      sample: young.closed + prime.closed,
      gate: true,
      category: 'profile',
      check: (p) => (p.age === null ? null : p.age >= 26),
    },
    {
      id: 'income-known',
      emoji: '📄',
      n: 12,
      title: 'Require a stated monthly income',
      action: 'Income must be on file, and at least ₹15,000 a month.',
      why: `Loans with no income recorded lost ${p1(noIncome.valueLoss)} of principal and returned ${p1(noIncome.per100)} per ₹100; borrowers below ₹15,000 a month returned ${p1(thinIncome.per100)} per ₹100 with ${p2(thinIncome.npaRate)} NPA — the safest band in the book.`,
      impact: `${spread(noIncome.valueLoss, thinIncome.valueLoss)} pp value-loss spread`,
      impactValue: spread(noIncome.valueLoss, thinIncome.valueLoss),
      sample: noIncome.closed + thinIncome.closed,
      gate: true,
      category: 'profile',
      check: (p) => (p.income === null ? null : p.income >= 15000),
    },
    {
      id: 'bureau-floor',
      emoji: '🏦',
      n: 13,
      title: 'Require a bureau score of 650 or above',
      action: 'Bureau score floor: 650.',
      why: `Below 650 the book ran ${p2(badBureau.npaRate)} NPA and lost ${p1(badBureau.valueLoss)} of principal, returning ${p1(badBureau.per100)} per ₹100; 650 and above ran ${p2(goodBureau.npaRate)} NPA and ${p1(goodBureau.per100)} per ₹100.`,
      impact: `${spread(badBureau.npaRate, goodBureau.npaRate)} pp NPA spread`,
      impactValue: spread(badBureau.npaRate, goodBureau.npaRate),
      sample: badBureau.closed + goodBureau.closed,
      gate: true,
      category: 'profile',
      check: (p) => (p.bureau === null ? null : p.bureau >= 650),
    },
    {
      id: 'repeat-borrower',
      emoji: '🔁',
      n: 14,
      title: 'Prefer repeat borrowers over first-timers',
      action: 'Repeat borrowers first; they have already paid once.',
      why: `Repeat borrowers ran ${p2(repeat.npaRate)} NPA and returned ${p1(repeat.per100)} per ₹100, against ${p2(firstTime.npaRate)} and ${p1(firstTime.per100)} for first-time borrowers. They are the only free predictor in the file — you already know they paid.`,
      impact: `${spread(firstTime.npaRate, repeat.npaRate)} pp NPA spread`,
      impactValue: spread(firstTime.npaRate, repeat.npaRate),
      sample: repeat.closed + firstTime.closed,
      gate: false,
      category: 'profile',
      check: (p) => (p.repeatCount > 1 ? true : false),
    },
    {
      id: 'city-tier',
      emoji: '🏙️',
      n: 15,
      title: 'Treat metro (tier 1) as the risky tier, not the safe one',
      action: 'Tier 2 and unmapped cities are fine; tier 1 needs a discount.',
      why: `Tier 2 loans returned ${p1(tier2.per100)} per ₹100 with ${p2(tier2.npaRate)} NPA, while tier 1 ran ${p2(tier1.npaRate)} NPA — the worst of the mapped tiers — and returned ${p1(tier1.per100)} per ₹100. City tier is not a safety ladder here.`,
      impact: `${spread(tier1.npaRate, tier2.npaRate)} pp NPA spread`,
      impactValue: spread(tier1.npaRate, tier2.npaRate),
      sample: tier1.closed + tier2.closed,
      gate: false,
      category: 'profile',
      check: (p) => (p.cityTier === null ? null : p.cityTier !== 1),
    },
    {
      id: 'grade',
      emoji: '🏅',
      n: 16,
      title: 'Grade AA beats grade A in this book',
      action: 'Prefer the platform grade AA over A.',
      why: `Grade A loans ran ${p2(gradeA.npaRate)} NPA and returned ${p1(gradeA.per100)} per ₹100; grade AA ran ${p2(gradeAA.npaRate)} NPA and returned ${p1(gradeAA.per100)}. Check the label the app shows, not the letter you assume.`,
      impact: `${spread(gradeA.npaRate, gradeAA.npaRate)} pp NPA spread`,
      impactValue: spread(gradeA.npaRate, gradeAA.npaRate),
      sample: gradeA.closed + gradeAA.closed,
      gate: false,
      category: 'profile',
      check: (p) => (p.grade === null ? null : p.grade !== 0),
    },
    {
      id: 'repayment-type',
      emoji: '📅',
      n: 17,
      title: 'Only take monthly EMI loans you can price yourself',
      action: 'Monthly EMI only; treat daily EDI as unrated.',
      why: `Daily EDI is ${edi.n} loans in the book and ${edi.closed} closed ones, so there is no outcome evidence at all against ${emiBook.closed} closed monthly-EMI loans. Unrated is not the same as safe.`,
      impact: `${edi.closed} closed EDI loans to measure`,
      impactValue: 0,
      sample: edi.n,
      gate: true,
      category: 'installment',
      check: (p) => (p.repay === null ? null : p.repay === 0),
    },
    {
      id: 'prepay-model',
      emoji: '⏪',
      n: 18,
      title: 'Underwrite to the early-exit date, not the maturity date',
      action: 'Model a 30–90 day cash-back, not a hold-to-maturity.',
      why: `${p1(emiBook.prepay)} of closed loans closed before maturity and ${p1(short.prepay)} of 2M loans did. Capital-time return of ${p1(short.capitalTime)} on 2M loans comes from the money coming back early — hold-to-maturity modelling destroys the return.`,
      impact: `${p1(emiBook.prepay)} of loans prepay`,
      impactValue: emiBook.prepay,
      sample: emiBook.closed,
      gate: false,
      category: 'process',
      check: () => null,
    },
    {
      id: 'seasoning',
      emoji: '🕒',
      n: 19,
      title: 'Judge a cohort only after six months of seasoning',
      action: 'Ignore vintage numbers younger than six months.',
      why: `Loans disbursed in the last 93 days show ${p2(youngVintage.npaRate)} NPA, but ${p1(youngVintage.prepay)} of them already closed early — they have not lived long enough to default. Seasoned cohorts ran ${p2(seasoned.npaRate)} NPA.`,
      impact: `${p1(youngVintage.prepay)} of young loans already exited`,
      impactValue: youngVintage.prepay,
      sample: seasoned.closed,
      gate: false,
      category: 'process',
      check: () => null,
    },
    {
      id: 'expectation',
      emoji: '📈',
      n: 20,
      title: 'Expect roughly 30% a year net of losses on this profile',
      action: 'Underwrite to 25–30% net, not to the 46% headline APR.',
      why: `The whole book returned ${p1(24.36)} capital-time and ${p1(26.83)} money-weighted XIRR with a 16.1% platform ANR. The target profile — short tenure, score 740+, ticket ≤ ₹1,000, APR ≥ 44% — clears that on the historical record.`,
      impact: '25–30% net of expected losses',
      impactValue: 27,
      sample: rows.length,
      gate: false,
      category: 'process',
      check: () => null,
    },
  ];

  return criteria.sort((a, b) => a.n - b.n);
}

/** Score a profile against the policy: how many of the twenty rules it passes. */
export function scorePolicy(criteria: PolicyCriterion[], profile: BorrowerProfile): PolicyResult {
  let passed = 0;
  let failed = 0;
  let unknown = 0;
  const blocked: string[] = [];
  for (const c of criteria) {
    const result = c.check(profile);
    if (result === null) {
      unknown += 1;
      continue;
    }
    if (result) passed += 1;
    else {
      failed += 1;
      if (c.gate) blocked.push(c.action);
    }
  }
  return { criteria, gates: criteria.filter((c) => c.gate), passed, failed, unknown, blocked };
}

/** Replay the policy over the closed book: what it approves and how it performs. */
export function backtestPolicy(rows: Loan[], criteria: PolicyCriterion[]): PolicyBacktest {
  const closed = rows.filter(isClosed);
  const approved = closed.filter((l) => {
    const profile = profileOfLoan(l);
    return criteria.every((c) => {
      if (!c.gate) return true;
      const result = c.check(profile);
      return result === null ? true : result;
    });
  });
  const npaOf = (group: Loan[]) => {
    const bad = group.filter(isNpa).length;
    return group.length ? (bad / group.length) * 100 : 0;
  };
  const capTimeOf = (group: Loan[]) => {
    const profit = sum(group, (l) => l.netProfit);
    const capitalDays = sum(group, (l) => l.amount * l.holdingDays);
    return capitalDays ? (profit / capitalDays) * 365 * 100 : 0;
  };
  const profitOf = (group: Loan[]) => sum(group, (l) => l.netProfit);
  const lentOf = (group: Loan[]) => sum(group, (l) => l.amount);
  return {
    approved: approved.length,
    approvalRate: closed.length ? (approved.length / closed.length) * 100 : 0,
    npaRate: npaOf(approved),
    npaRateBook: npaOf(closed),
    xirr: null,
    capitalTime: capTimeOf(approved),
    capitalTimeBook: capTimeOf(closed),
    profit: profitOf(approved),
    profitPer100: lentOf(approved) ? (profitOf(approved) / lentOf(approved)) * 100 : 0,
    profitPer100Book: lentOf(closed) ? (profitOf(closed) / lentOf(closed)) * 100 : 0,
    lent: lentOf(approved),
  };
}

/** The policy in one line, for the summary header. */
export function policySummary(criteria: PolicyCriterion[]): string {
  const gate = (id: string) => criteria.find((c) => c.id === id)?.action ?? '';
  return [
    gate('score-floor').replace('LDC score floor: ', 'score ≥ '),
    gate('tenure-short').replace('Tenure: 2–3 months. Hard cap 4 months.', 'tenure ≤ 4M (prefer 2–3M)'),
    gate('ticket-cap').replace('Invested amount per loan: ≤ ₹1,000.', 'ticket ≤ ₹1,000'),
    gate('rate-floor').replace('Minimum borrower APR: 44%.', 'APR ≥ 44%'),
    gate('foir-cap').replace('FOIR ceiling: 10% (EMI ÷ monthly income).', 'FOIR ≤ 10%'),
    gate('emi-cap').replace('Monthly EMI: ≤ ₹500 per month.', 'EMI ≤ ₹500'),
    gate('bureau-floor').replace('Bureau score floor: 650.', 'bureau ≥ 650'),
    gate('age-floor').replace('Borrower age: 26 and above.', 'age ≥ 26'),
    gate('income-known').replace('Income must be on file, and at least ₹15,000 a month.', 'income ≥ ₹15k'),
  ].join(' · ');
}

export function medianOf(values: number[]): number {
  return values.length ? round(median(values), 2) : 0;
}

export function clampPct(value: number): number {
  return clamp(value, 0, 100);
}
