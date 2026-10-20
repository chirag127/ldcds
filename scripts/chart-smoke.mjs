/**
 * Headless smoke test for every chart and hero KPI.
 *
 *   npx rolldown scripts/chart-smoke.mjs -d .tmp --format esm --platform node
 *   node .tmp/chart-smoke.js
 *
 * Builds all 488 chart specs against the real dataset under all three
 * scenarios. Catches option-builder exceptions that a type-check cannot.
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

let failures = 0;
let empty = 0;
let total = 0;

for (const scenario of ['recovery', 'strict', 'contractual']) {
  for (const page of PAGES) {
    for (const section of page.sections) {
      for (const spec of section.charts) {
        total += 1;
        try {
          const result = spec.build(loans, { ...ctx, scenario });
          if (!result || typeof result !== 'object') throw new Error('no result');
          if (!result.option || Object.keys(result.option).length === 0) {
            if (!result.table) {
              empty += 1;
              console.log(`EMPTY ${scenario} ${page.id}/${spec.id}`);
            }
          }
          if (!result.insight?.headline) console.log(`NO INSIGHT ${scenario} ${page.id}/${spec.id}`);
        } catch (err) {
          failures += 1;
          console.log(`FAIL ${scenario} ${page.id}/${spec.id}: ${err.message}`);
        }
      }
    }
    try {
      page.heroKpis(loans, { ...ctx, scenario });
    } catch (err) {
      failures += 1;
      console.log(`FAIL KPI ${scenario} ${page.id}: ${err.message}`);
    }
  }
}

console.log(`${total} chart builds · ${failures} failures · ${empty} empty options`);
process.exit(failures ? 1 : 0);
