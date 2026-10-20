import { PAGES, chartCount } from '../src/lib/pages.ts';

let total = 0;
for (const p of PAGES) {
  const n = p.sections.reduce((s, sec) => s + sec.charts.length, 0);
  total += n;
  console.log(`${n.toString().padStart(3)}  ${p.id.padEnd(14)} ${p.title}`);
}
console.log(`${total} charts, chartCount()=${chartCount()}`);
