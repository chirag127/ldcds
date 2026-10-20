export interface Cashflow {
  time: number;
  amount: number;
}

const DAY_MS = 86_400_000;

export function sum<T>(rows: T[], get: (row: T) => number): number {
  let total = 0;
  for (const row of rows) {
    const v = get(row);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

export function mean<T>(rows: T[], get: (row: T) => number): number {
  let total = 0;
  let n = 0;
  for (const row of rows) {
    const v = get(row);
    if (Number.isFinite(v)) {
      total += v;
      n += 1;
    }
  }
  return n ? total / n : 0;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function quantile(values: number[], q: number): number {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const pos = (a.length - 1) * Math.max(0, Math.min(1, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function stddev(values: number[]): number {
  const a = values.filter(Number.isFinite);
  if (a.length < 2) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export function correlation(xs: number[], ys: number[]): number {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return 0;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / pairs.length;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den ? num / den : 0;
}

export function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 2) return { slope: 0, intercept: 0, r2: 0 };
  const mx = pairs.reduce((s, [x]) => s + x, 0) / pairs.length;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length;
  let num = 0;
  let den = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  const ssTot = pairs.reduce((s, [, y]) => s + (y - my) ** 2, 0);
  const ssRes = pairs.reduce((s, [x, y]) => s + (y - (intercept + slope * x)) ** 2, 0);
  return { slope, intercept, r2: ssTot ? 1 - ssRes / ssTot : 0 };
}

export function wilsonInterval(bad: number, n: number, z = 1.96): { low: number; high: number; rate: number } {
  if (!n) return { low: 0, high: 0, rate: 0 };
  const p = bad / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    rate: p,
    low: Math.max(0, (centre - spread) / denom),
    high: Math.min(1, (centre + spread) / denom),
  };
}

export function wilsonUpper(bad: number, n: number, z = 1.96): number {
  return wilsonInterval(bad, n, z).high;
}

export function histogram(values: number[], bins = 20, min?: number, max?: number): { x: number; count: number; from: number; to: number }[] {
  const a = values.filter(Number.isFinite);
  if (!a.length) return [];
  const lo = min ?? Math.min(...a);
  const hi = max ?? Math.max(...a);
  if (hi <= lo) return [{ x: lo, count: a.length, from: lo, to: lo }];
  const width = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({
    x: lo + width * (i + 0.5),
    count: 0,
    from: lo + width * i,
    to: lo + width * (i + 1),
  }));
  for (const v of a) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    out[idx].count += 1;
  }
  return out;
}

export function ecdf(values: number[], points = 80): { x: number; y: number }[] {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return [];
  const out: { x: number; y: number }[] = [];
  const step = Math.max(1, Math.floor(a.length / points));
  for (let i = 0; i < a.length; i += step) out.push({ x: a[i], y: (i + 1) / a.length });
  out.push({ x: a[a.length - 1], y: 1 });
  return out;
}

export function hhi(shares: number[]): number {
  const total = shares.reduce((s, v) => s + v, 0);
  if (!total) return 0;
  return shares.reduce((s, v) => s + (v / total) ** 2, 0) * 10_000;
}

export function gini(values: number[]): number {
  const a = values.filter((v) => Number.isFinite(v) && v >= 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const total = a.reduce((s, v) => s + v, 0);
  if (!total) return 0;
  let cumulative = 0;
  let weighted = 0;
  for (let i = 0; i < a.length; i += 1) {
    cumulative += a[i];
    weighted += cumulative;
  }
  return (a.length + 1 - (2 * weighted) / total) / a.length;
}

export function lorenz(values: number[], points = 60): { x: number; y: number }[] {
  const a = values.filter((v) => Number.isFinite(v) && v >= 0).sort((x, y) => x - y);
  if (!a.length) return [];
  const total = a.reduce((s, v) => s + v, 0) || 1;
  const out: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let cumulative = 0;
  const step = Math.max(1, Math.floor(a.length / points));
  for (let i = 0; i < a.length; i += step) {
    cumulative += a.slice(i, Math.min(a.length, i + step)).reduce((s, v) => s + v, 0);
    out.push({ x: (i + step) / a.length, y: cumulative / total });
  }
  out.push({ x: 1, y: 1 });
  return out;
}

export function movingAverage(values: number[], window = 3): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

export function npv(rate: number, flows: Cashflow[]): number {
  if (!flows.length) return 0;
  const t0 = flows[0].time;
  return flows.reduce((s, f) => s + f.amount / (1 + rate) ** ((f.time - t0) / DAY_MS / 365), 0);
}

export function xirr(flows: Cashflow[]): number | null {
  const clean = flows.filter((f) => f && Number.isFinite(f.amount) && Number.isFinite(f.time)).sort((a, b) => a.time - b.time);
  if (clean.length < 2) return null;
  const hasNeg = clean.some((f) => f.amount < 0);
  const hasPos = clean.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo, clean);
  let fhi = npv(hi, clean);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo * fhi > 0) {
    hi = 100;
    fhi = npv(hi, clean);
    if (!Number.isFinite(fhi) || flo * fhi > 0) return null;
  }
  for (let i = 0; i < 160; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, clean);
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
  return Number.isFinite(rate) ? rate * 100 : null;
}

export function emi(principal: number, annualRate: number, months: number): number {
  if (!principal || !months) return 0;
  const r = annualRate / 1200;
  if (!r) return principal / months;
  const pow = (1 + r) ** months;
  return (principal * r * pow) / (pow - 1);
}

export function futureValue(principal: number, annualRate: number, months: number): number {
  if (!months) return principal;
  return principal * (1 + annualRate / 100) ** (months / 12);
}

// Deterministic PRNG for Monte Carlo (mulberry32).
export function rng(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(random: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function gammaSample(shape: number, random: () => number): number {
  if (shape < 1) {
    const u = random();
    return gammaSample(shape + 1, random) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      x = gaussian(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaSample(a: number, b: number, random: () => number): number {
  const x = gammaSample(Math.max(1e-6, a), random);
  const y = gammaSample(Math.max(1e-6, b), random);
  return x / (x + y);
}

export function percentile(values: number[], p: number): number {
  return quantile(values, p / 100);
}

export function safeDiv(a: number, b: number, fallback = 0): number {
  return b ? a / b : fallback;
}

export function round(value: number, decimals = 2): number {
  return Number.isFinite(value) ? Math.round(value * 10 ** decimals) / 10 ** decimals : 0;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  return Math.round((da - db) / DAY_MS);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 120) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard += 1;
  }
  return out;
}

export function normalizedEntropy(values: number[]): number {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0 || values.length <= 1) return 0;
  let h = 0;
  for (const v of values) {
    if (v <= 0) continue;
    const p = v / total;
    h -= p * Math.log(p);
  }
  return h / Math.log(values.length);
}
