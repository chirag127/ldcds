/**
 * Exposure-adjusted (annualised) risk.
 *
 * Raw NPA counts punish long tenures and flatter short ones: a 12-month loan
 * has four times as much time to default as a 3-month loan. Everything here is
 * measured per loan-month at risk, and per rupee-month lent, so a 2M loan and
 * a 12M loan are compared on the same clock.
 */
import type { Loan } from './types';
import { DIMENSIONS, groupRows, isClosed, isNpa, numericSeries } from './metrics';
import { mean, round, sum } from './stats';

export const DAYS_PER_MONTH = 30.44;

export interface HazardStats {
  n: number;
  closed: number;
  npa: number;
  loanMonths: number;
  avgMonths: number;
  /** Defaults per 1,000 loan-months at risk — the fair cross-tenure number. */
  npaPer1000LoanMonths: number;
  /** Monthly default rate in percent. */
  monthlyNpaRate: number;
  /** Monthly default rate × 12. */
  annualisedNpaRate: number;
  /** Rupees lost per ₹1,000 of principal per month at risk. */
  lossPer1000RupeeMonths: number;
  annualisedLossPer1000: number;
  /** Raw NPA rate for the closed book, for side-by-side display. */
  rawNpaRate: number;
  lossSeverity: number;
  capitalTime: number;
  per100: number;
  xirrMedian: number | null;
}

export function exposureMonths(loan: Loan): number {
  const days = loan.holdingDays > 0 ? loan.holdingDays : loan.vintageDays;
  return days / DAYS_PER_MONTH;
}

export function hazardStats(rows: Loan[], predicate: (l: Loan) => boolean): HazardStats {
  const group = rows.filter(predicate);
  const closed = group.filter(isClosed);
  const npa = closed.filter(isNpa);
  const loanMonths = sum(closed, exposureMonths);
  const lent = sum(closed, (l) => l.amount);
  const loss = sum(closed, (l) => l.npaAmount || 0);
  const rupeeMonths = sum(closed, (l) => l.amount * exposureMonths(l));
  const capitalDays = sum(closed, (l) => l.amount * l.holdingDays);
  const profit = sum(closed, (l) => l.netProfit);
  const xirr = numericSeries(closed, (l) => l.xirrRecovery);
  const per1000 = loanMonths ? (npa.length / loanMonths) * 1000 : 0;
  const lossPer1000 = rupeeMonths ? (loss / rupeeMonths) * 1000 : 0;
  const severity = lent ? (loss / lent) * 100 : 0;
  const avgMonths = loanMonths ? loanMonths / Math.max(1, closed.length) : 0;
  return {
    n: group.length,
    closed: closed.length,
    npa: npa.length,
    loanMonths: round(loanMonths, 2),
    avgMonths: round(avgMonths, 2),
    npaPer1000LoanMonths: round(per1000, 2),
    monthlyNpaRate: round(per1000 / 10, 2),
    annualisedNpaRate: round((per1000 / 10) * 12, 1),
    lossPer1000RupeeMonths: round(lossPer1000, 2),
    annualisedLossPer1000: round(lossPer1000 * 12, 1),
    rawNpaRate: closed.length ? round((npa.length / closed.length) * 100, 2) : 0,
    lossSeverity: round(severity, 2),
    capitalTime: capitalDays ? round((profit / capitalDays) * 365 * 100, 2) : 0,
    per100: lent ? round((profit / lent) * 100, 2) : 0,
    xirrMedian: xirr.length ? round(xirr[Math.floor(xirr.length / 2)], 2) : null,
  };
}

export interface DimHazard {
  key: string;
  label: string;
  stats: HazardStats;
}

/** Hazard stats per bucket of a dimension, ordered by the dimension's order. */
export function hazardByDimension(rows: Loan[], dim: keyof typeof DIMENSIONS): DimHazard[] {
  const dimension = DIMENSIONS[dim];
  const groups = groupRows(rows, (l) => String(dimension.get(l)));
  const list = [...groups.entries()].map(([key, group]) => ({ key, label: key, stats: hazardStats(rows, (l) => String(dimension.get(l)) === key) }));
  if (dimension.order) {
    const idx = new Map(dimension.order.map((label, i) => [label, i]));
    list.sort((a, b) => (idx.get(a.label) ?? 999) - (idx.get(b.label) ?? 999));
  } else {
    list.sort((a, b) => b.stats.npaPer1000LoanMonths - a.stats.npaPer1000LoanMonths);
  }
  return list;
}

/** Cumulative share of defaults by seasoning month, for the newest cohorts. */
export function cumulativeHazardBySeasoning(rows: Loan[], months = 9): { month: string; series: { name: string; data: (number | null)[] }[] } {
  const cohorts = [...new Set(rows.map((l) => l.disbMonth))].sort().slice(-months);
  const buckets = Array.from({ length: 9 }, (_, i) => (i + 1) * 30.44);
  const series = cohorts.map((month) => {
    const group = rows.filter((l) => l.disbMonth === month);
    const closed = group.filter(isClosed);
    const data = buckets.map((limit) => {
      const inWindow = closed.filter((l) => l.holdingDays >= 0 && (l.disb && l.vintageDays >= limit || l.holdingDays >= limit));
      if (!inWindow.length) return null;
      return round((inWindow.filter(isNpa).length / inWindow.length) * 100, 2);
    });
    return { name: month, data };
  });
  return { month: 'seasoning', series };
}
