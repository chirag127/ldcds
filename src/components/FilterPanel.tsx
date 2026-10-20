import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { FILTER_TOGGLES, PRESETS, RANGE_FILTERS, RULE_FIELDS, topCities } from '../lib/filters';
import { DIMENSIONS } from '../lib/metrics';
import type { FlagKey, Filters, Rule, RuleOp } from '../lib/types';
import { formatMetric, inrCompact, num } from '../lib/format';

function Chips({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: number; label: string }[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const toggle = (value: number) => {
    if (selected.includes(value)) {
      if (selected.length === 1) return;
      onChange(selected.filter((v) => v !== value));
    } else onChange([...selected, value].sort((a, b) => a - b));
  };
  return (
    <div className="filter-block">
      <div className="filter-block-head">
        <span>{label}</span>
        <button className="link-btn" onClick={() => onChange(options.map((o) => o.value))}>
          all
        </button>
      </div>
      <div className="chip-row">
        {options.map((o) => (
          <button
            key={o.value}
            className={`chip ${selected.includes(o.value) ? 'on' : ''}`}
            onClick={() => toggle(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeControl({
  label,
  min,
  max,
  step,
  format,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  format: 'money' | 'percent' | 'ratio' | 'int' | 'score';
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  const display = (v: number) => formatMetric(v, format === 'score' ? 'num' : format);
  return (
    <div className="filter-block range-block">
      <div className="filter-block-head">
        <span>{label}</span>
        <em>
          {display(value[0])} – {display(value[1])}
        </em>
      </div>
      <div className="dual-range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value[0]}
          onChange={(e) => onChange([Math.min(Number(e.target.value), value[1]), value[1]])}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value[1]}
          onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0])])}
        />
      </div>
    </div>
  );
}

function MultiList({
  label,
  options,
  selected,
  onChange,
  searchable,
  limit = 400,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  limit?: number;
}) {
  const [term, setTerm] = useState('');
  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = t ? options.filter((o) => o.toLowerCase().includes(t)) : options;
    return list.slice(0, limit);
  }, [options, term, limit]);
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  return (
    <details className="filter-block multi">
      <summary>
        {label}
        {selected.length ? <em>{selected.length} selected</em> : <em>any</em>}
      </summary>
      {searchable ? (
        <input className="mini-input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} />
      ) : null}
      <div className="check-grid">
        {filtered.map((o) => (
          <label key={o} className={selected.includes(o) ? 'on' : ''}>
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
      {selected.length ? (
        <button className="link-btn" onClick={() => onChange([])}>
          clear {label.toLowerCase()}
        </button>
      ) : null}
    </details>
  );
}

const OPS: { value: RuleOp; label: string }[] = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'between', label: 'between' },
  { value: 'in', label: 'in list' },
  { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'exists' },
];

function encodeState(filters: Filters, rules: Rule[]): string {
  const json = JSON.stringify({ v: 2, filters, rules });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function FilterPanel() {
  const {
    filters,
    rules,
    filterOpen,
    setFilterOpen,
    patchFilters,
    applyFilter,
    setRules,
    toggleFlag,
    reset,
    applyPreset,
    rows,
    loans,
    meta,
    activeRules,
  } = useStore();
  const [copied, setCopied] = useState(false);

  const months = useMemo(() => Object.keys(meta.monthly).sort(), [meta.monthly]);
  const cities = useMemo(() => topCities(loans, 120), [loans]);
  const states = useMemo(() => [...new Set(loans.map((l) => l.state).filter((s) => s && s !== 'Other'))].sort(), [loans]);

  const statusOptions = DIMENSIONS.status.order?.map((label, i) => ({ value: i, label })) ?? [];
  const gradeOptions = ['A (High)', 'AA (Medium)', 'AAA (Low)'].map((label, i) => ({ value: i, label }));
  const professionOptions = [
    { value: 0, label: 'Salaried' },
    { value: 1, label: 'Self-employed' },
  ];
  const genderOptions = ['Male', 'Female', 'Other', 'Unknown'].map((label, i) => ({ value: i, label }));
  const tierOptions = ['Unknown', 'Tier 1 metro', 'Tier 2 city', 'Tier 3 / other'].map((label, i) => ({ value: i, label }));
  const repayOptions = [
    { value: 0, label: 'Monthly EMI' },
    { value: 1, label: 'Daily EDI' },
  ];
  const listOptions = [
    { value: 0, label: 'Open' },
    { value: 1, label: 'Closed' },
  ];
  const stayOptions = ['Unknown', 'Self-owned', 'Rented'].map((label, i) => ({ value: i, label }));
  const dpdOptions = ['0 DPD', '1–30', '31–60', '61–90', '90+'].map((label, i) => ({ value: i, label }));

  const copyLink = async () => {
    const url = new URL(window.location.href);
    const [path] = url.hash.replace(/^#/, '').split('?');
    const token = encodeState(filters, rules);
    url.hash = `${path}?f=${token}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', url.toString());
    }
  };

  const addRule = () => {
    setRules([
      ...rules,
      { id: `r${Date.now()}`, field: 'score', op: 'gte', value: '740', value2: '' },
    ]);
  };

  const updateRule = (id: string, patch: Partial<Rule>) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <aside className={`filter-panel ${filterOpen ? 'open' : ''}`} aria-hidden={!filterOpen}>
      <header className="filter-head">
        <div>
          <span>Filter builder</span>
          <strong>{num(rows.length)} loans in view</strong>
        </div>
        <button className="icon-btn" onClick={() => setFilterOpen(false)}>
          ✕
        </button>
      </header>

      <div className="filter-toolbar">
        <button className="ghost-btn" onClick={reset}>
          Reset all
        </button>
        <button className="ghost-btn" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <span className="filter-count">{activeRules} active</span>
      </div>

      <div className="filter-scroll">
        <div className="filter-block">
          <div className="filter-block-head">
            <span>Quick presets</span>
          </div>
          <div className="preset-grid">
            {PRESETS.map((p) => (
              <button key={p.id} className="preset-chip" onClick={() => applyPreset(p.id)} title={p.description}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-block">
          <div className="filter-block-head">
            <span>Search</span>
          </div>
          <input
            className="mini-input"
            value={filters.search}
            onChange={(e) => applyFilter('search', e.target.value)}
            placeholder="Name, loan ID, city, borrower key"
          />
        </div>

        <Chips label="Status" options={statusOptions} selected={filters.status} onChange={(v) => patchFilters({ status: v })} />
        <Chips label="Grade" options={gradeOptions} selected={filters.grade} onChange={(v) => patchFilters({ grade: v })} />
        <Chips label="Borrower type" options={professionOptions} selected={filters.profession} onChange={(v) => patchFilters({ profession: v })} />
        <Chips label="Gender" options={genderOptions} selected={filters.gender} onChange={(v) => patchFilters({ gender: v })} />
        <Chips label="City tier" options={tierOptions} selected={filters.cityTier} onChange={(v) => patchFilters({ cityTier: v })} />
        <Chips label="Repayment" options={repayOptions} selected={filters.repay} onChange={(v) => patchFilters({ repay: v })} />
        <Chips label="Platform list" options={listOptions} selected={filters.listType} onChange={(v) => patchFilters({ listType: v })} />
        <Chips label="Residence" options={stayOptions} selected={filters.stay} onChange={(v) => patchFilters({ stay: v })} />
        <Chips label="DPD bucket" options={dpdOptions} selected={filters.dpdBucket} onChange={(v) => patchFilters({ dpdBucket: v })} />

        <div className="filter-block">
          <div className="filter-block-head">
            <span>Flags</span>
          </div>
          <div className="flag-list">
            {FILTER_TOGGLES.map((f) => (
              <button
                key={f.key}
                className={`flag ${filters.flags[f.key as FlagKey]}`}
                onClick={() => toggleFlag(f.key as FlagKey)}
                title={f.hint}
              >
                <span>{f.label}</span>
                <em>{filters.flags[f.key as FlagKey]}</em>
              </button>
            ))}
          </div>
        </div>

        {RANGE_FILTERS.map((r) => (
          <RangeControl
            key={r.key}
            label={r.label}
            min={r.min}
            max={r.max}
            step={r.step}
            format={r.format}
            value={filters[r.key] as [number, number]}
            onChange={(v) => patchFilters({ [r.key]: v } as Partial<Filters>)}
          />
        ))}

        <MultiList label="Disbursement months" options={months} selected={filters.months} onChange={(v) => patchFilters({ months: v })} />
        <MultiList label="States" options={states} selected={filters.states} onChange={(v) => patchFilters({ states: v })} searchable />
        <MultiList label="Cities" options={cities} selected={filters.cities} onChange={(v) => patchFilters({ cities: v })} searchable />

        <div className="filter-block">
          <div className="filter-block-head">
            <span>Advanced rules</span>
            <button className="link-btn" onClick={addRule}>
              + add
            </button>
          </div>
          {!rules.length ? <p className="muted small">Stack arbitrary conditions. Rules combine with AND.</p> : null}
          {rules.map((rule) => (
            <div className="rule-row" key={rule.id}>
              <select value={rule.field} onChange={(e) => updateRule(rule.id, { field: e.target.value })}>
                {RULE_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select value={rule.op} onChange={(e) => updateRule(rule.id, { op: e.target.value as RuleOp })}>
                {OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input value={rule.value} onChange={(e) => updateRule(rule.id, { value: e.target.value })} placeholder="value" />
              {rule.op === 'between' ? (
                <input value={rule.value2} onChange={(e) => updateRule(rule.id, { value2: e.target.value })} placeholder="to" />
              ) : null}
              <button className="icon-btn" onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}>
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="filter-block summary">
          <div className="filter-block-head">
            <span>Current snapshot</span>
          </div>
          <dl>
            <div>
              <dt>Loans</dt>
              <dd>{num(rows.length)}</dd>
            </div>
            <div>
              <dt>Capital</dt>
              <dd>{inrCompact(rows.reduce((s, l) => s + l.amount, 0))}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{inrCompact(rows.reduce((s, l) => s + l.pos, 0))}</dd>
            </div>
            <div>
              <dt>NPA</dt>
              <dd>{num(rows.filter((l) => l.npa === 1 || l.status === 2).length)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </aside>
  );
}
