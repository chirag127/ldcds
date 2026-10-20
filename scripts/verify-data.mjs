/**
 * Integrity checks for the published dataset.
 *
 *   npm run data:verify
 *
 * Fails loudly if the columnar file is malformed, totals drift from meta.json,
 * or the public payload contains agreement URLs / obvious contact PII.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');

const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
const loans = read('loans.json');
const meta = read('meta.json');
const model = read('model.json');

const errors = [];
const warnings = [];
const check = (ok, message) => {
  if (!ok) errors.push(message);
};

check(Array.isArray(loans.columns) && loans.columns.length > 0, 'loans.json has no columns');
check(Array.isArray(loans.rows), 'loans.json has no rows');
check(loans.rows.length === meta.counts.loans, `row count ${loans.rows.length} != meta count ${meta.counts.loans}`);

const width = loans.columns.length;
const badWidth = loans.rows.filter((row) => row.length !== width).length;
check(badWidth === 0, `${badWidth} rows do not match the ${width}-column schema`);

const col = (key) => loans.columns.indexOf(key);
const idx = {
  amount: col('amount'),
  status: col('status'),
  npa: col('npa'),
  pos: col('pos'),
  fee: col('fee'),
  received: col('received'),
};
for (const [name, i] of Object.entries(idx)) check(i >= 0, `missing column: ${name}`);

if (errors.length === 0) {
  const sum = (key) => loans.rows.reduce((s, row) => s + (Number(row[idx[key]]) || 0), 0);
  const round2 = (v) => Math.round(v * 100) / 100;
  const lent = round2(sum('amount'));
  const pos = round2(sum('pos'));
  const npaRows = loans.rows.filter((row) => Number(row[idx.npa]) === 1).length;

  check(Math.abs(lent - meta.totals.lent) < 1, `lent drift: ${lent} vs ${meta.totals.lent}`);
  check(Math.abs(pos - meta.totals.pos) < 1, `outstanding drift: ${pos} vs ${meta.totals.pos}`);
  check(npaRows === meta.counts.npa, `NPA count ${npaRows} != meta ${meta.counts.npa}`);
  check(meta.counts.impaired === meta.counts.npa + meta.counts.overdueActive, 'impaired != NPA + overdue active');
}

check(meta.counts.active + meta.counts.closed === meta.counts.loans, 'active + closed != loans');
check(meta.columns.length === loans.columns.length, 'meta column dictionary does not match the data');
check(Array.isArray(meta.availableLoans) && meta.availableLoans.length > 0, 'no marketplace snapshot');

const statuses = new Set(meta.scenarios ? Object.keys(meta.scenarios) : []);
for (const key of ['contractual', 'recovery', 'strict']) check(statuses.has(key), `missing scenario: ${key}`);

check(model.metrics?.auc > 0.5 && model.metrics?.auc < 1, 'model AUC out of range');
check(model.policyGrid?.length >= 20, 'policy grid too small');
check(model.woe?.length === model.features.length, 'WOE groups do not match model features');

// Privacy sweep. The public payload may contain names (by design) but never
// signed agreement links or direct contact identifiers.
const payload = fs.readFileSync(path.join(DATA, 'loans.json'), 'utf8');
const banned = [
  ['signed agreement URL', /lendendocs|SIGNED_LOAN_AGREEMENT/i],
  ['email address', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ['Indian PAN', /\b[A-Z]{5}[0-9]{4}[A-Z]\b/],
  ['phone number', /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/],
];
for (const [label, pattern] of banned) {
  if (pattern.test(payload)) errors.push(`possible ${label} in public/data/loans.json`);
}
if (/investor_id"\s*:\s*"(?!redacted)/.test(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'))) {
  warnings.push('meta.json has an investor_id field — confirm it is redacted');
}

const mb = (fs.statSync(path.join(DATA, 'loans.json')).size / 1024 / 1024).toFixed(2);
console.log(`loans.json      ${loans.rows.length} rows × ${width} cols (${mb} MB)`);
console.log(`portfolio       ₹${meta.totals.lent.toLocaleString('en-IN')} lent · ${meta.counts.active} active · ${meta.counts.npa} NPA`);
console.log(`model           AUC ${model.metrics.auc.toFixed(3)} · ${model.policyGrid.length} policies · ${model.woe.length} WOE groups`);
for (const warning of warnings) console.warn(`WARN ${warning}`);

if (errors.length) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log('OK all integrity checks passed');
