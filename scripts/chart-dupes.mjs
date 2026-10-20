import { PAGES } from '../src/lib/pages.ts';

const seen = new Map();
for (const page of PAGES) {
  for (const section of page.sections) {
    for (const chart of section.charts) {
      const key = `${page.id}/${chart.id}`;
      if (seen.has(key)) console.log('DUP', key, 'in section', section.title, 'and', seen.get(key));
      seen.set(key, section.title);
      if (!chart.id) console.log('NO ID', page.id, chart.title);
    }
  }
}
const global = new Map();
for (const key of seen.keys()) {
  const id = key.split('/')[1];
  global.set(id, (global.get(id) || 0) + 1);
}
for (const [id, n] of global) if (n > 1) console.log('GLOBAL DUP', id, n);
console.log('checked', seen.size);
