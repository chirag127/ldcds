import type { PageConfig } from '../lib/types';
import { useStore } from '../data/store';
import { ChartCard } from '../components/ChartCard';
import { Kpi } from '../components/Kpi';
import { num } from '../lib/format';

export function PageHero({ page }: { page: PageConfig }) {
  const { rows, ctx } = useStore();
  const kpis = page.heroKpis(rows, ctx);
  const charts = page.sections.reduce((s, sec) => s + sec.charts.length, 0);
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow">{page.eyebrow}</span>
        <h1>{page.title}</h1>
        <p>{page.description}</p>
        <div className="hero-meta">
          <span>{num(rows.length)} loans in view</span>
          <span>{charts} charts</span>
          <span>scenario: {ctx.scenario}</span>
        </div>
      </div>
      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <Kpi key={`${k.label}-${i}`} {...k} />
        ))}
      </div>
    </section>
  );
}

export function ChartSections({ page }: { page: PageConfig }) {
  const { rows, ctx } = useStore();
  let counter = 0;
  return (
    <>
      <nav className="section-nav">
        {page.sections.map((s, i) => (
          <a key={s.id} href={`#${s.id}`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>
            <em>{String(i + 1).padStart(2, '0')}</em>
            {s.title}
            <span>{s.charts.length}</span>
          </a>
        ))}
      </nav>

      {page.sections.map((section) => (
        <section className="chart-section" id={section.id} key={section.id}>
          <header className="section-head">
            <h2>{section.title}</h2>
            {section.description ? <p>{section.description}</p> : null}
          </header>
          <div className="chart-grid">
            {section.charts.map((spec) => {
              const index = counter;
              counter += 1;
              return <ChartCard key={spec.id} spec={spec} rows={rows} ctx={ctx} index={index} />;
            })}
          </div>
        </section>
      ))}
    </>
  );
}

export function PageView({ page }: { page: PageConfig }) {
  return (
    <div className="page">
      <PageHero page={page} />
      <ChartSections page={page} />
    </div>
  );
}
