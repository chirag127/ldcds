import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store';
import { PAGES } from '../lib/pages';
import { inrCompact, titleCase } from '../lib/format';

interface Item {
  id: string;
  kind: 'page' | 'loan' | 'chart';
  title: string;
  meta: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { loans, openLoan } = useStore();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTerm('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const t = term.trim().toLowerCase();
    const pages: Item[] = PAGES.filter((p) => !t || `${p.title} ${p.eyebrow} ${p.description}`.toLowerCase().includes(t))
      .slice(0, 8)
      .map((p) => ({
        id: `page-${p.id}`,
        kind: 'page',
        title: p.title,
        meta: p.eyebrow,
        run: () => navigate(`/${p.id}`),
      }));

    const charts: Item[] = t
      ? PAGES.flatMap((p) => p.sections.flatMap((s) => s.charts.map((c) => ({ p, c }))))
          .filter(({ c }) => c.title.toLowerCase().includes(t))
          .slice(0, 6)
          .map(({ p, c }) => ({
            id: `chart-${c.id}`,
            kind: 'chart',
            title: c.title,
            meta: `${p.title} · chart`,
            run: () => navigate(`/${p.id}#chart-${c.id}`),
          }))
      : [];

    const loanResults: Item[] = t.length >= 2
      ? loans
          .filter((l) => `${l.name} ${l.id} ${l.city} ${l.borrowerKey}`.toLowerCase().includes(t))
          .slice(0, 10)
          .map((l) => ({
            id: `loan-${l.id}`,
            kind: 'loan',
            title: titleCase(l.name),
            meta: `${l.city} · ${inrCompact(l.amount)} · score ${l.score}`,
            run: () => openLoan(l),
          }))
      : [];

    return [...pages, ...charts, ...loanResults];
  }, [term, loans, navigate, openLoan]);

  useEffect(() => setCursor(0), [term]);

  if (!open) return null;

  const choose = (item: Item) => {
    item.run();
    onClose();
  };

  return (
    <div className="modal-backdrop palette-wrap" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <span>⌕</span>
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Jump to a page, chart or borrower…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(items.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter' && items[cursor]) {
                choose(items[cursor]);
              } else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {items.map((item, i) => (
            <button
              key={item.id}
              className={`palette-item ${i === cursor ? 'on' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(item)}
            >
              <span className={`palette-kind ${item.kind}`}>{item.kind}</span>
              <strong>{item.title}</strong>
              <em>{item.meta}</em>
            </button>
          ))}
          {!items.length ? <p className="muted small" style={{ padding: 16 }}>No matches. Try a borrower name, city or page.</p> : null}
        </div>
        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>{items.length} results</span>
        </div>
      </div>
    </div>
  );
}
