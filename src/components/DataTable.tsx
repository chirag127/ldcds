import { formatMetric } from '../lib/format';
import type { TableData } from '../lib/types';
import { useMemo, useState } from 'react';

export interface DataTableProps {
  data: TableData;
  initialSort?: string;
  pageSize?: number;
  onRowClick?: (row: Record<string, unknown>) => void;
  exportName?: string;
  dense?: boolean;
  maxRows?: number;
}

function toCsv(data: TableData): string {
  const header = data.columns.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const lines = data.rows.map((row) =>
    data.columns
      .map((c) => {
        const value = row[c.key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'number') return String(value);
        return `"${String(value).replace(/"/g, '""')}"`;
      })
      .join(','),
  );
  return [header, ...lines].join('\r\n');
}

export function downloadCsv(name: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function DataTable({ data, initialSort, pageSize = 15, onRowClick, exportName, dense, maxRows }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort ?? null);
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const list = [...data.rows];
    if (!sortKey) return list;
    return list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return direction === 'asc' ? av - bv : bv - av;
      return direction === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
  }, [data.rows, sortKey, direction]);

  const size = maxRows ?? pageSize;
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * size, current * size + size);

  const sort = (key: string) => {
    if (sortKey === key) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setDirection('desc');
    }
    setPage(0);
  };

  return (
    <div className={`dt ${dense ? 'dt-dense' : ''}`}>
      <div className="dt-scroll">
        <table>
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th
                  key={c.key}
                  className={c.align === 'right' ? 'right' : ''}
                  onClick={() => sort(c.key)}
                  title="Click to sort"
                >
                  {c.label}
                  {sortKey === c.key ? <span className="dt-sort">{direction === 'asc' ? '▲' : '▼'}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'clickable' : undefined}
              >
                {data.columns.map((c) => {
                  const value = row[c.key];
                  const display =
                    typeof value === 'number' && c.type ? formatMetric(value, c.type) : value === null || value === undefined ? '—' : String(value);
                  return (
                    <td key={c.key} className={c.align === 'right' ? 'right mono' : ''}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={data.columns.length} className="dt-empty">
                  No rows match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="dt-foot">
        <span>
          {sorted.length.toLocaleString('en-IN')} rows
          {pages > 1 ? ` · page ${current + 1} of ${pages}` : ''}
        </span>
        <span className="dt-actions">
          {exportName ? (
            <button className="ghost-btn" onClick={() => downloadCsv(`${exportName}.csv`, toCsv(data))}>
              CSV
            </button>
          ) : null}
          {pages > 1 && !maxRows ? (
            <>
              <button className="ghost-btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
                Prev
              </button>
              <button className="ghost-btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                Next
              </button>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
