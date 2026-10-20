/**
 * Percentage sanity audit.
 *
 *   npm run charts:audit
 *
 * Builds every chart and hero KPI for all three scenarios and fails when a
 * percentage shown to the reader is implausible. It exists because two
 * separate unit bugs slipped through: XIRR was multiplied by 100 twice, and a
 * money series (average ticket) was rendered as a percentage. Both produced
 * confident-looking nonsense like "4596.1%" or "Peak 3507.6%".
 *
 * Thresholds:
 *   - any percentage token above 400% is a bug, not an outcome;
 *   - any XIRR series value above 1500 is the ratio/percent scaling bug.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PAGES } from '../src/lib/pages.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const data = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', name), 'utf8'));

const payload = data('loans.json');
const meta = data('meta.json');
const model = data('model.json');
const loans = payload.rows.map((row) => {
  const loan = {};
  payload.columns.forEach((key, i) => { loan[key] = row[i]; });
  return loan;
});
const ctx = {
  scenario: 'recovery',
  meta,
  model,
  allLoans: loans,
  applyFilter: () => {},
  setSearch: () => {},
  openLoan: () => {},
};

const PCT = /(-?[\d,]+(?:\.\d+)?)\s*%/g;
const MAX_PCT = 400;
const MAX_XIRR = 1500;
const issues = [];

function checkText(where, text) {
  if (typeof text !== 'string') return;
  for (const match of text.matchAll(PCT)) {
    const value = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(value) && Math.abs(value) > MAX_PCT) {
      issues.push(`${where}: "${text.slice(0, 160)}"`);
      return;
    }
  }
}

function numbersIn(value, depth = 0) {
  const out = [];
  if (depth > 8 || value === null || value === undefined) return out;
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => out.push(...numbersIn(v, depth + 1)));
  else if (typeof value === 'object') Object.values(value).forEach((v) => out.push(...numbersIn(v, depth + 1)));
  return out;
}

let checks = 0;

for (const page of PAGES) {
  for (const scenario of ['recovery', 'strict', 'contractual']) {
    const view = { ...ctx, scenario };
    for (const kpi of page.heroKpis(loans, view)) {
      checks += 1;
      checkText(`${page.id} KPI "${kpi.label}"`, kpi.value);
    }
    for (const section of page.sections) {
      for (const spec of section.charts) {
        checks += 1;
        const result = spec.build(loans, view);
        checkText(`${scenario} ${page.id}/${spec.id} option`, JSON.stringify(result.option));
        checkText(`${scenario} ${page.id}/${spec.id} insight`, `${result.insight?.headline ?? ''} ${result.insight?.detail ?? ''}`);
        for (const row of result.table?.rows ?? []) {
          for (const [key, value] of Object.entries(row)) {
            if (/xirr/i.test(key) && typeof value === 'number' && Math.abs(value) > MAX_XIRR) {
              issues.push(`${scenario} ${page.id}/${spec.id} table ${key}=${value}`);
            }
          }
        }
        for (const series of result.option?.series ?? []) {
          if (!/xirr/i.test(series?.name ?? '')) continue;
          const max = Math.max(0, ...numbersIn(series.data).map((v) => Math.abs(v)));
          if (max > MAX_XIRR) issues.push(`${scenario} ${page.id}/${spec.id} series ${series.name} max=${max}`);
        }
      }
    }
  }
}

if (issues.length) {
  console.error(`${issues.length} implausible value(s) found:\n${issues.join('\n')}`);
  process.exit(1);
}
console.log(`OK ${checks} chart/KPI checks · no percentage above ${MAX_PCT}% · no XIRR above ${MAX_XIRR}%`);
