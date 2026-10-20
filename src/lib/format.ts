const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2Fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('en-IN');

export function inr(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `₹${(decimals ? inr2Fmt : inrFmt).format(value)}`;
}

export function inrCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

export function num(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return decimals ? value.toFixed(decimals) : numFmt.format(value);
}

export function pct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function pctRatio(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function signed(value: number | null | undefined, kind: 'inr' | 'pct' | 'num' = 'num', decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const prefix = value > 0 ? '+' : '';
  if (kind === 'inr') return `${prefix}${inrCompact(value)}`;
  if (kind === 'pct') return `${prefix}${value.toFixed(decimals)}%`;
  return `${prefix}${num(value, decimals)}`;
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function monthLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value}-01T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return value;
  const days = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

export function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bS\/O\b/gi, 'S/O');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function formatMetric(value: number | null | undefined, type: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  switch (type) {
    case 'money':
      return inrCompact(value);
    case 'percent':
      return pct(value);
    case 'ratio':
      return pctRatio(value);
    default:
      return num(value);
  }
}
