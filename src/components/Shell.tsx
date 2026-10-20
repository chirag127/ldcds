import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { PAGES } from '../lib/pages';
import { useStore } from '../data/store';
import { num } from '../lib/format';
import { PRESETS } from '../lib/filters';

const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Command', ids: ['executive'] },
  { label: 'The book', ids: ['portfolio', 'returns', 'active', 'npa'] },
  { label: 'Risk', ids: ['risk', 'scorecard', 'tenure', 'geography', 'cohorts', 'borrowers', 'fees'] },
  { label: 'Labs', ids: ['underwriting', 'opportunities', 'explorer'] },
  { label: 'Reference', ids: ['methodology'] },
];

const SCENARIOS = [
  { id: 'contractual', label: 'Contractual' },
  { id: 'recovery', label: 'Recovery 45%' },
  { id: 'strict', label: 'Strict' },
] as const;

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { rows, meta } = useStore();
  return (
    <>
      {open ? <div className="scrim" onClick={onClose} /> : null}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">LDC</span>
          <div>
            <strong>Book Intelligence</strong>
            <small>5,567 loans · as of {meta.asOf}</small>
          </div>
        </div>

        <nav>
          {GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.ids.map((id) => {
                const page = PAGES.find((p) => p.id === id);
                if (!page) return null;
                const count = page.sections.reduce((s, sec) => s + sec.charts.length, 0);
                return (
                  <NavLink
                    key={id}
                    to={`/${id}`}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={onClose}
                  >
                    <span>{page.title}</span>
                    <em>{count}</em>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-stat">
            <span>In view</span>
            <strong>{num(rows.length)}</strong>
            <small>of {num(meta.counts.loans)} loans</small>
          </div>
          <a className="sidebar-link" href="https://github.com/chirag127/ldcds" target="_blank" rel="noreferrer">
            Source & data notes ↗
          </a>
        </div>
      </aside>
    </>
  );
}

export function TopBar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { scenario, setScenario, activeRules, setFilterOpen, reset, rows, meta, presetId, applyPreset, filters, setSearch } =
    useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [term, setTerm] = useState(filters.search);

  useEffect(() => setTerm(filters.search), [filters.search]);

  const page = PAGES.find((p) => location.pathname.startsWith(`/${p.id}`));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(term);
    if (page?.id !== 'explorer') navigate('/explorer');
  };

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation">
        ☰
      </button>
      <div className="topbar-title">
        <span>{page?.eyebrow ?? 'Loan book'}</span>
        <strong>{page?.title ?? 'Executive'}</strong>
      </div>

      <form className="global-search" onSubmit={submit}>
        <span>⌕</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search borrower, city, loan ID…"
          aria-label="Search loans"
        />
        {term ? (
          <button
            type="button"
            className="clear"
            onClick={() => {
              setTerm('');
              setSearch('');
            }}
          >
            ✕
          </button>
        ) : null}
      </form>

      <div className="scenario-switch" role="group" aria-label="Loss scenario">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={scenario === s.id ? 'on' : ''}
            onClick={() => setScenario(s.id)}
            title={
              s.id === 'contractual'
                ? 'All active loans pay in full'
                : s.id === 'recovery'
                  ? 'Impaired active loans recover 45% of principal'
                  : 'Impaired active loans are total losses'
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <select className="preset-select" value={presetId} onChange={(e) => applyPreset(e.target.value)} aria-label="Filter preset">
        <option value="custom">Custom filter…</option>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      <button className="ghost-btn" onClick={() => setFilterOpen(true)}>
        Filters{activeRules ? <span className="badge">{activeRules}</span> : null}
      </button>
      <button className="ghost-btn hide-sm" onClick={() => onSearch()} title="Command palette (Ctrl+K)">
        ⌘K
      </button>
      <button className="ghost-btn hide-sm" onClick={reset} title="Reset filters">
        Reset
      </button>

      <div className="topbar-count">
        <strong>{num(rows.length)}</strong>
        <span>of {num(meta.counts.loans)}</span>
      </div>
    </header>
  );
}
