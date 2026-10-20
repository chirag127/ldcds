# LenDenClub loan book analytics

A static, public analytics site for a personal LenDenClub P2P loan book:
5,567 loans, ₹33.14 lakh deployed, 16 tabs and 488 charts. Every chart has a
written insight card that says which loans to prefer or avoid. Filters,
scenario assumptions, the underwriting lab and the loan explorer all run in
the browser — there is no backend.

- Live site: <https://chirag127.github.io/ldcds/>
- Stack: Vite 8, React 19, TypeScript 5.9, ECharts 6, React Router 7
- Hosting: GitHub Pages (static, hash routing, relative asset base)

> Research and education project, not investment advice. Names are published
> by the book owner's explicit decision; PAN, phone, email, agreement links and
> investor identifiers are stripped.

## What is in the site

| Tab | What it answers |
| --- | --- |
| Executive | Book size, profit, NPA, prepayment, coverage, forward view |
| Portfolio | Outcome mix, vintage, ticket sizes, concentration, data quality |
| Returns | Platform ANR vs capital-time annualisation vs XIRR, and why they differ |
| Active book | Outstanding principal, maturity ladder, overdue active, forward interest |
| NPA & losses | Loss anatomy, recovery, severity, strict vs recovery write-off |
| Risk | Risk grades, score bands, DPD, impairment, bureau coverage |
| Scorecard | Logistic scorecard, ROC, lift, calibration, WOE, IV, policy grid |
| Tenure | Tenure mix, seasoning, prepayment, hazard, maturity |
| Geography | States, cities, tiers, concentration, regional NPA |
| Cohorts | Disbursement cohorts, cohort XIRR, vintage quality |
| Borrowers | Repeat borrowers, exposure, top borrowers, names |
| Fees | Platform fees, fee drag, fee by segment |
| Underwriting | Policy replay against the closed book + manual loan evaluator |
| Opportunities | Live marketplace snapshot screened against historical policy |
| Explorer | All 5,567 loans, 69 fields, column picker, CSV export |
| Methodology | Data assembly, sanitisation, return definitions, caveats |

Charts are defined once as lazy specs (`src/lib/pages.ts`). Each card mounts its
ECharts instance only when it scrolls near the viewport (IntersectionObserver,
600 px root margin), so a tab with 60+ charts still loads quickly.

## Data flow

```
app.lendenclub.com (signed-in browser)
        │  public/downloader/lendenclub-scraper.js
        ▼
data/raw/lending_data_import_YYYY-MM-DD.json     flat loan records
data/raw/lendenclub_FULL_YYYY-MM-DD.json         list rows + borrower details
        │  scripts/build-data.mjs  (+ scripts/city-map.mjs)
        ▼
public/data/loans.json      columnar { columns, rows } — 5,567 × 69, ~2.1 MB
public/data/meta.json       counts, totals, scenarios, return methods, dictionaries
public/data/model.json      scorecard, ROC/lift/calibration, WOE, 40-policy grid
        │  vite build
        ▼
dist/  →  GitHub Pages
```

`data/raw/` is gitignored. Only the sanitised derived dataset is published.

### Key figures

| Metric | Value |
| --- | --- |
| Loans | 5,567 (2,633 active, 2,934 closed) |
| Capital deployed | ₹33,14,000 |
| Principal outstanding | ₹7,96,111 |
| Closed-book platform ANR | 16.1% (official) |
| Reconstructed capital-time return | 24.36% |
| Portfolio XIRR (closed, approximated) | 26.83% |
| Naive mean of loan ANRs | 23.59% |
| NPA | 234 loans (7.98% by count, 4.94% by value) |
| Overdue active | 144 loans, ₹84,952 outstanding |
| Impaired total | 378 loans, ₹1,88,613 outstanding |
| NPA recovery | 44.71% |
| Prepayment | ~80% of closed loans close before maturity |

The gap between 16.1% and the higher loan-level numbers is explained on the
Returns tab: the platform annualises the whole closed book over capital-time,
while per-loan annualisation inflates short-tenure loans that prepay early.
Four definitions are shown side by side instead of picking one.

### Unit conventions

| Quantity | Stored as | Display rule |
| --- | --- | --- |
| XIRR (loan level and group) | percent | already ×100 — never multiply again |
| ANR, NPA rate, impairment rate | percent | already ×100 |
| Recovery rate, loss severity | ratio 0–1 | multiply on display |
| Money | rupees | — |

`toDisplay()` and `fmtVal()` multiply only `ratio` values. A metric tagged
`ratio` that actually holds percent values is the exact defect that printed
"4596% XIRR", so `npm run charts:audit` fails the build when any card shows a
percentage above 400% or an XIRR above 1500%. ANR charts exclude NPA loans:
their reported ANR is a write-off (as low as -600%), not a return.

### Scenarios

| Scenario | Treatment of impaired active loans |
| --- | --- |
| Contractual | Full contractual cash flow |
| Recovery (default) | 45% of outstanding principal recovered |
| Strict | 100% write-off |

Closed NPAs are always haircut by their already-realised recovery.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run build        # tsc -b && vite build
npm run preview
npm run data:verify  # integrity + privacy checks on public/data
npm run data:build   # rebuild public/data from data/raw (requires raw exports)
npm run charts:count # per-tab chart inventory (expect 488)
npm run charts:dupes # duplicate chart id check
npm run charts:smoke # build all 488 charts × 3 scenarios headlessly
npm run charts:audit # fail on implausible percentages (unit-bug guard)
```

Node 22+ is required by the build pipeline. The scraper itself is a plain
browser script with no dependencies.

### Regenerating the dataset

1. Run `public/downloader/lendenclub-scraper.js` on app.lendenclub.com (see
   `/downloader/` on the site for instructions).
2. Put both JSON files in `data/raw/`.
3. `npm run data:build && npm run data:verify && npm run build`.

`build-data.mjs` joins the flat import with list rows, derives risk grades,
returns, scenarios, NPA flags, city/state/tier, trains the logistic scorecard
on closed loans, builds the policy grid and writes the three JSON files.

## Architecture

```
src/
  App.tsx                 routes, layout, shortcuts, footer
  data/store.tsx          fetch + hydrate, filters, scenario, share links
  lib/
    types.ts              Loan, Meta, Model, ChartSpec, PageConfig
    metrics.ts            filtering, aggregation, dimensions, scoring, policy
    stats.ts              statistics, XIRR, regression, sampling
    charts.ts             ECharts option builders
    chart-kit.ts          chart factories used by page configs
    pages.ts              16 page definitions / 488 chart specs
    insights.ts           insight + ranking generators
    filters.ts            filter model, serialisation, presets
    format.ts             INR, percent, date formatters
  components/             EChart, ChartCard, DataTable, FilterPanel, ...
  pages/                  PageView + 4 custom pages
scripts/
  build-data.mjs          raw → public/data
  city-map.mjs            city/state/tier normalisation
  verify-data.mjs         integrity and PII checks
  chart-count.mjs         per-tab chart inventory
  chart-dupes.mjs         duplicate chart id check
  chart-smoke.mjs         headless build of every chart × scenario
  percent-audit.mjs       fails on implausible percentages in any card
public/
  data/*.json             published dataset
  downloader/             scraper + instructions
```

Filters live in the URL (`?f=...`) and `localStorage` (`ldc.filters.v2`), so a
filtered view can be shared. Advanced rules support numeric comparisons,
categorical inclusion and flags. Scenario choice is part of the view state.
`Ctrl/Cmd+K` opens a command palette across tabs and actions.

## Deployment

`.github/workflows/deploy.yml` runs the dataset checks and a headless build of
all 488 charts, then builds on every push to `main` and publishes `dist/`
through GitHub Pages. The Vite `base` is `./` and the app uses
`HashRouter`, so deep links work under `/ldcds/` without server rewrites.
`public/.nojekyll` prevents Jekyll from dropping hashed asset folders.

To enable Pages the first time: **Settings → Pages → Build and deployment →
Source: GitHub Actions**, then push to `main`.

## Known limitations

- The export has no instalment dates; XIRR dates closed inflows at closure and
  active inflows at the as-of date. Treat XIRR as directional.
- DPD is a point-in-time snapshot. Strict write-off is deliberately harsh.
- NPA recognition lags delinquency by ~150 days, so recent cohorts look clean.
- Borrower state is derived from a curated city map; 59.5% of loans fall into
  `Other` (plus 9.8% explicitly `Unknown`) when the city is missing or unmapped.
- `income = 0` means missing (1,912 loans); `bureau = 0` means missing (4).
- The scorecard is trained on 2,934 closed loans with a time-unaware split.
  AUC ≈ 0.744 in-sample, 0.719 cross-validated. Research grade, not production.
- The 2,040-loan September 2026 bulk disbursement (₹5.69 lakh) dominates recent
  cohorts and is too young to judge.
