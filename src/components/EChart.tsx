import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

export interface EChartProps {
  option: unknown;
  height?: number;
  className?: string;
  onReady?: (chart: echarts.ECharts) => void;
}

export function EChart({ option, height, className, onReady }: EChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = echarts.init(hostRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    onReady?.(chart);
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!chartRef.current || !option) return;
    try {
      chartRef.current.setOption(option as EChartsOption, { notMerge: true, lazyUpdate: false });
    } catch (err) {
      console.error('ECharts option rejected', err);
    }
  }, [option]);

  return <div ref={hostRef} className={className} style={{ width: '100%', height: height ?? 260 }} />;
}
