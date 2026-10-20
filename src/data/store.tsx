import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Filters, Loan, Meta, ModelData, Rule, Scenario, ViewContext } from '../lib/types';
import { DEFAULT_FILTERS, applyFilters } from '../lib/metrics';
import { cloneFilters, defaultFilters, mergeFilters, PRESETS } from '../lib/filters';

const STORAGE_KEY = 'ldc.filters.v2';

type RawLoanRow = (string | number | null)[];
interface ColumnarLoans {
  columns: string[];
  rows: RawLoanRow[];
}

function hydrate(payload: ColumnarLoans): Loan[] {
  const out: Loan[] = [];
  const { columns, rows } = payload;
  for (const row of rows) {
    const loan: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i += 1) loan[columns[i]] = row[i];
    out.push(loan as unknown as Loan);
  }
  return out;
}

function loadStoredFilters(): Filters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFilters();
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return mergeFilters(defaultFilters(), parsed);
  } catch {
    return defaultFilters();
  }
}

function loadStoredRules(): Rule[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}.rules`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Rule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface Store {
  loans: Loan[];
  meta: Meta;
  model: ModelData;
  ready: boolean;
  error: string | null;
  rows: Loan[];
  filters: Filters;
  rules: Rule[];
  scenario: Scenario;
  activeRules: number;
  selected: Loan | null;
  drawerOpen: boolean;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  setScenario: (scenario: Scenario) => void;
  setFilters: (filters: Filters) => void;
  patchFilters: (patch: Partial<Filters>) => void;
  applyFilter: (field: keyof Filters, value: unknown) => void;
  setSearch: (value: string) => void;
  setRules: (rules: Rule[]) => void;
  toggleFlag: (key: keyof Filters['flags']) => void;
  applyPreset: (id: string) => void;
  reset: () => void;
  openLoan: (loan: Loan) => void;
  closeLoan: () => void;
  presetId: string;
  ctx: ViewContext;
}

const StoreContext = createContext<Store | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [model, setModel] = useState<ModelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<Filters>(() => loadStoredFilters());
  const [rules, setRulesState] = useState<Rule[]>(() => loadStoredRules());
  const [scenario, setScenarioState] = useState<Scenario>('recovery');
  const [selected, setSelected] = useState<Loan | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [presetId, setPresetId] = useState('custom');

  // Restore scenario from the hash search string (#/page?sc=strict).
  useEffect(() => {
    const hash = window.location.hash;
    const q = hash.indexOf('?');
    if (q === -1) return;
    const params = new URLSearchParams(hash.slice(q + 1));
    const sc = params.get('sc');
    if (sc === 'strict' || sc === 'recovery' || sc === 'contractual') setScenarioState(sc);
    const preset = params.get('preset');
    if (preset) {
      const found = PRESETS.find((p) => p.id === preset);
      if (found) {
        setFiltersState(mergeFilters(defaultFilters(), found.patch));
        setRulesState((found.rules ?? []).map((r, i) => ({ ...r, id: `r${i}` })));
        setPresetId(found.id);
      }
    }
    const encoded = params.get('f');
    if (encoded) {
      try {
        const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { filters?: Partial<Filters>; rules?: Rule[] };
        if (parsed.filters) setFiltersState(mergeFilters(defaultFilters(), parsed.filters));
        if (Array.isArray(parsed.rules)) setRulesState(parsed.rules);
        setPresetId('custom');
      } catch {
        // malformed share link; keep the stored filters
      }
    }
  }, []);

  useEffect(() => {
    const base = new URL(window.location.href);
    const [path, existing] = base.hash.replace(/^#/, '').split('?');
    const params = new URLSearchParams(existing ?? '');
    params.set('sc', scenario);
    if (presetId !== 'custom') params.set('preset', presetId);
    else params.delete('preset');
    const next = `#${path}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState(null, '', `${base.pathname}${base.search}${next}`);
  }, [scenario, presetId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
      localStorage.setItem(`${STORAGE_KEY}.rules`, JSON.stringify(rules));
    } catch {
      // storage can be unavailable in private mode; the app still works in-memory
    }
  }, [filters, rules]);

  useEffect(() => {
    let cancelled = false;
    const base = document.baseURI;
    const get = async <T,>(name: string): Promise<T> => {
      const res = await fetch(new URL(`data/${name}`, base).toString(), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      return (await res.json()) as T;
    };
    (async () => {
      try {
        const [loanPayload, metaPayload, modelPayload] = await Promise.all([
          get<ColumnarLoans>('loans.json'),
          get<Meta>('meta.json'),
          get<ModelData>('model.json'),
        ]);
        if (cancelled) return;
        setLoans(hydrate(loanPayload));
        setMeta(metaPayload);
        setModel(modelPayload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load dataset');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => (loans.length ? applyFilters(loans, filters, rules, scenario) : []),
    [loans, filters, rules, scenario],
  );

  const setFilters = useCallback((next: Filters) => {
    setFiltersState(next);
    setPresetId('custom');
  }, []);

  const patchFilters = useCallback((patch: Partial<Filters>) => {
    setFiltersState((prev) => mergeFilters(prev, patch));
    setPresetId('custom');
  }, []);

  const applyFilter = useCallback(
    (field: keyof Filters, value: unknown) => {
      setFiltersState((prev) => {
        const next = cloneFilters(prev);
        (next as unknown as Record<string, unknown>)[field] = value;
        return next;
      });
      setPresetId('custom');
    },
    [],
  );

  const setSearch = useCallback((value: string) => {
    setFiltersState((prev) => ({ ...cloneFilters(prev), search: value }));
    setPresetId('custom');
  }, []);

  const setRules = useCallback((next: Rule[]) => {
    setRulesState(next);
    setPresetId('custom');
  }, []);

  const toggleFlag = useCallback((key: keyof Filters['flags']) => {
    setFiltersState((prev) => {
      const current = prev.flags[key];
      const next = current === 'any' ? 'yes' : current === 'yes' ? 'no' : 'any';
      return { ...cloneFilters(prev), flags: { ...prev.flags, [key]: next } };
    });
    setPresetId('custom');
  }, []);

  const applyPreset = useCallback((id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setFiltersState(mergeFilters(defaultFilters(), preset.patch));
    setRulesState((preset.rules ?? []).map((r, i) => ({ ...r, id: `r${i}` })));
    if (preset.scenario) setScenarioState(preset.scenario);
    setPresetId(preset.id);
  }, []);

  const reset = useCallback(() => {
    setFiltersState(defaultFilters());
    setRulesState([]);
    setPresetId('all');
  }, []);

  const openLoan = useCallback((loan: Loan) => {
    setSelected(loan);
    setDrawerOpen(true);
  }, []);

  const closeLoan = useCallback(() => setDrawerOpen(false), []);

  const activeRules = useMemo(() => {
    let count = 0;
    if (filters.search.trim()) count += 1;
    const d = DEFAULT_FILTERS;
    (
      [
        'status',
        'grade',
        'gender',
        'profession',
        'stay',
        'cityTier',
        'repay',
        'listType',
        'dpdBucket',
      ] as const
    ).forEach((key) => {
      if (filters[key].length !== d[key].length) count += 1;
    });
    (
      [
        'score',
        'bureau',
        'tenure',
        'rate',
        'amount',
        'borrowerAmount',
        'age',
        'income',
        'foir',
        'dti',
        'vintage',
        'pos',
      ] as const
    ).forEach((key) => {
      if (filters[key][0] !== d[key][0] || filters[key][1] !== d[key][1]) count += 1;
    });
    if (filters.months.length) count += 1;
    if (filters.cities.length) count += 1;
    if (filters.states.length) count += 1;
    if (Object.values(filters.flags).some((v) => v !== 'any')) count += 1;
    return count + rules.length;
  }, [filters, rules]);

  const ctx = useMemo<ViewContext | null>(() => {
    if (!meta || !model) return null;
    return {
      scenario,
      meta,
      model,
      allLoans: loans,
      applyFilter,
      setSearch,
      openLoan,
    };
  }, [meta, model, loans, scenario, applyFilter, setSearch, openLoan]);

  if (!meta || !model || !ctx) {
    return (
      <div className="boot">
        <div className="boot-mark">LDC</div>
        <h1>Loading the loan book</h1>
        <p>Parsing 5,567 loans, building the scorecard and preparing 350+ charts.</p>
        {error ? <p className="boot-error">{error}</p> : <div className="boot-bar"><span /></div>}
      </div>
    );
  }

  const store: Store = {
    loans,
    meta,
    model,
    ready: true,
    error,
    rows,
    filters,
    rules,
    scenario,
    activeRules,
    selected,
    drawerOpen,
    filterOpen,
    setFilterOpen,
    setScenario: (sc) => {
      setScenarioState(sc);
      setPresetId('custom');
    },
    setFilters,
    patchFilters,
    applyFilter,
    setSearch,
    setRules,
    toggleFlag,
    applyPreset,
    reset,
    openLoan,
    closeLoan,
    presetId,
    ctx,
  };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside DataProvider');
  return store;
}
