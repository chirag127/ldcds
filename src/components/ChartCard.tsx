import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartResult, ChartSpec, Loan, ViewContext } from '../lib/types';
import { EChart } from './EChart';
import { DataTable } from './DataTable';
import type * as echarts from 'echarts';

const ACTION_LABEL: Record<string, string> = {
  PREFER: 'Prefer',
  AVOID: 'Avoid',
  WATCH: 'Watch',
  INFO: 'Context',
};

export interface ChartCardProps {
  spec: ChartSpec;
  rows: Loan[];
  ctx: ViewContext;
  index?: number;
}

export function ChartCard({ spec, rows, ctx, index }: ChartCardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [visible, setVisible] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const result = useMemo<ChartResult | null>(() => {
    if (!visible) return null;
    try {
      return spec.build(rows, ctx);
    } catch (err) {
      console.error(`Chart ${spec.id} failed`, err);
      return {
        option: {},
        insight: {
          tone: 'negative',
          headline: 'This chart could not be built',
          detail: `The current filter combination produced an unexpected shape. ${err instanceof Error ? err.message : ''}`,
          action: 'INFO',
        },
      };
    }
  }, [visible, spec, rows, ctx]);

  const hasSeries = result ? Object.keys(result.option as Record<string, unknown>).length > 0 : false;
  const showTableMode = showTable || (result?.table !== undefined && !hasSeries);

  const download = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#080d18' });
    const link = document.createElement('a');
    link.href = url;
    link.download = `${spec.id}.png`;
    link.click();
  };

  return (
    <section className={`card span-${spec.span ?? 1}`} ref={hostRef} id={`chart-${spec.id}`}>
      <header className="card-head">
        <div>
          <h3>{spec.title}</h3>
          <p>{spec.subtitle ?? spec.note ?? ''}</p>
        </div>
        <div className="card-tools">
          {index !== undefined ? <span className="chart-index">#{index + 1}</span> : null}
          {result?.table ? (
            <button className="icon-btn" onClick={() => setShowTable((v) => !v)} title="Toggle table">
              {showTable ? '↺' : '▤'}
            </button>
          ) : null}
          <button className="icon-btn" onClick={() => setExpanded(true)} title="Expand">
            ⤢
          </button>
        </div>
      </header>

      <div className="card-body" style={{ minHeight: showTableMode ? undefined : spec.height ?? 260 }}>
        {!result ? (
          <div className="chart-skeleton" style={{ height: spec.height ?? 260 }}>
            <span />
          </div>
        ) : showTableMode && result.table ? (
          <DataTable data={result.table} pageSize={8} dense />
        ) : (
          <EChart option={result.option} height={spec.height ?? 260} onReady={(c) => (chartRef.current = c)} />
        )}
      </div>

      {result ? (
        <footer className={`insight ${result.insight.tone}`}>
          <div className="insight-head">
            {result.insight.action ? (
              <span className={`pill ${result.insight.action.toLowerCase()}`}>{ACTION_LABEL[result.insight.action]}</span>
            ) : null}
            <strong>{result.insight.headline}</strong>
          </div>
          <p>{result.insight.detail}</p>
        </footer>
      ) : null}

      {expanded && result ? (
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="card-head">
              <div>
                <h3>{spec.title}</h3>
                <p>{spec.subtitle ?? ''}</p>
              </div>
              <div className="card-tools">
                {hasSeries ? (
                  <button className="ghost-btn" onClick={download}>
                    PNG
                  </button>
                ) : null}
                <button className="icon-btn" onClick={() => setExpanded(false)}>
                  ✕
                </button>
              </div>
            </header>
            <div className="modal-body">
              {result.table && showTableMode ? (
                <DataTable data={result.table} pageSize={20} />
              ) : (
                <EChart option={result.option} height={Math.max(420, (spec.height ?? 260) * 1.6)} />
              )}
            </div>
            <footer className={`insight ${result.insight.tone}`}>
              <div className="insight-head">
                {result.insight.action ? (
                  <span className={`pill ${result.insight.action.toLowerCase()}`}>{ACTION_LABEL[result.insight.action]}</span>
                ) : null}
                <strong>{result.insight.headline}</strong>
              </div>
              <p>{result.insight.detail}</p>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
