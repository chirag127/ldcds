export type ChartOption = Record<string, any>;
import { inrCompact, num, pct } from './format';

export const COLORS = {
  emerald: '#2ee6a7',
  teal: '#14b8a6',
  cyan: '#22d3ee',
  sky: '#38bdf8',
  blue: '#60a5fa',
  indigo: '#818cf8',
  violet: '#a78bfa',
  fuchsia: '#e879f9',
  rose: '#fb7185',
  red: '#f87171',
  amber: '#fbbf24',
  orange: '#fb923c',
  lime: '#a3e635',
  slate: '#94a3b8',
  muted: '#64748b',
};

export const SERIES_COLORS = [
  COLORS.emerald,
  COLORS.cyan,
  COLORS.violet,
  COLORS.amber,
  COLORS.rose,
  COLORS.blue,
  COLORS.lime,
  COLORS.fuchsia,
  COLORS.orange,
  COLORS.indigo,
  COLORS.teal,
  COLORS.sky,
];

const TEXT = '#cbd5e1';
const MUTED = '#7c8ba1';
const GRID = 'rgba(148,163,184,0.10)';
const TOOLTIP_BG = 'rgba(8,13,24,0.96)';
const TOOLTIP_BORDER = 'rgba(148,163,184,0.22)';

export function baseOption(): ChartOption {
  return {
    backgroundColor: 'transparent',
    color: SERIES_COLORS,
    textStyle: {
      fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif',
      color: TEXT,
      fontSize: 11,
    },
    animationDuration: 520,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'axis',
      backgroundColor: TOOLTIP_BG,
      borderColor: TOOLTIP_BORDER,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: '#e2e8f0', fontSize: 11, fontFamily: 'Manrope' },
      axisPointer: {
        type: 'shadow',
        shadowStyle: { color: 'rgba(148,163,184,0.06)' },
        lineStyle: { color: 'rgba(148,163,184,0.35)', type: 'dashed' },
      },
      extraCssText: 'border-radius:10px;box-shadow:0 18px 40px rgba(0,0,0,.45);backdrop-filter:blur(8px);',
    },
    legend: {
      top: 2,
      right: 4,
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 12,
      icon: 'roundRect',
      textStyle: { color: MUTED, fontSize: 10, fontFamily: 'Manrope' },
    },
    grid: { left: 6, right: 14, top: 34, bottom: 6, containLabel: true },
  };
}

export function axisX(extra: Record<string, unknown> = {}) {
  return {
    type: 'category',
    axisLine: { lineStyle: { color: 'rgba(148,163,184,0.18)' } },
    axisTick: { show: false },
    axisLabel: { color: MUTED, fontSize: 10, interval: 0, hideOverlap: true },
    splitLine: { show: false },
    ...extra,
  };
}

export function axisY(extra: Record<string, unknown> = {}) {
  return {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: MUTED, fontSize: 10 },
    splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
    ...extra,
  };
}

export interface BarSeries {
  name: string;
  data: (number | null | { value: number; itemStyle?: { color: string }; name?: string })[];
  color?: string;
  stack?: string;
  type?: 'bar' | 'line';
  yAxisIndex?: number;
  lineStyle?: Record<string, unknown>;
  areaStyle?: Record<string, unknown>;
}

export interface BarOptions {
  categories: (string | number)[];
  series: BarSeries[];
  horizontal?: boolean;
  stack?: boolean;
  showLegend?: boolean;
  yFormat?: 'money' | 'percent' | 'num' | 'ratio';
  xFormat?: 'money' | 'percent' | 'num' | 'ratio';
  label?: boolean;
  grid?: Record<string, unknown>;
}

function valueFormatter(kind?: string) {
  return (value: unknown) => {
    const v = typeof value === 'object' && value !== null && 'value' in value
      ? (value as { value: unknown }).value
      : value;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    if (kind === 'money') return inrCompact(v);
    if (kind === 'percent') return pct(v);
    if (kind === 'ratio') return pct(v * 100);
    return num(v);
  };
}

export function barOption({
  categories,
  series,
  horizontal = false,
  stack = false,
  showLegend,
  yFormat,
  xFormat,
  label = false,
  grid,
}: BarOptions): ChartOption {
  const base = baseOption();
  const axisCat = axisX({ data: categories });
  const axisVal = axisY({
    axisLabel: {
      color: MUTED,
      fontSize: 10,
      formatter: (v: number) => (yFormat === 'money' ? inrCompact(v) : yFormat === 'percent' ? `${v}%` : num(v)),
    },
  });
  return {
    ...base,
    grid: { left: 6, right: 16, top: showLegend === false ? 12 : 34, bottom: 6, containLabel: true, ...grid },
    legend: { ...(base.legend as object), show: showLegend !== false && series.length > 1 },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      valueFormatter: valueFormatter(yFormat),
      axisPointer: { type: 'shadow' },
    },
    xAxis: horizontal ? axisVal : axisCat,
    yAxis: horizontal ? axisCat : axisVal,
    series: series.map((s) => ({
      type: s.type ?? 'bar',
      name: s.name,
      data: s.data,
      stack: stack || s.stack ? (s.stack ?? 'total') : undefined,
      yAxisIndex: s.yAxisIndex ?? 0,
      barMaxWidth: horizontal ? 18 : 26,
      itemStyle: {
        color: s.color ?? undefined,
        borderRadius: horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0],
      },
      lineStyle: s.lineStyle,
      areaStyle: s.areaStyle,
      label: label
        ? {
            show: true,
            position: horizontal ? 'right' : 'top',
            color: '#cbd5e1',
            fontSize: 9,
            formatter: (p: { value: number | { value: number } }) => {
              const v = typeof p.value === 'object' && p.value !== null ? p.value.value : (p.value as number);
              return yFormat === 'money' ? inrCompact(v) : yFormat === 'percent' ? `${v}%` : num(v);
            },
          }
        : undefined,
      emphasis: { focus: 'series' },
      smooth: s.type === 'line' ? 0.25 : undefined,
    })),
  };
}

export interface LineSeries {
  name: string;
  data: (number | null)[];
  color?: string;
  area?: boolean;
  dashed?: boolean;
  yAxisIndex?: number;
  smooth?: boolean;
  symbol?: boolean;
}

export function lineOption({
  x,
  series,
  showLegend,
  yFormat,
  area = false,
  zoom = false,
  grid,
}: {
  x: (string | number)[];
  series: LineSeries[];
  showLegend?: boolean;
  yFormat?: 'money' | 'percent' | 'num' | 'ratio';
  area?: boolean;
  zoom?: boolean;
  grid?: Record<string, unknown>;
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: showLegend === false ? 12 : 34, bottom: zoom ? 34 : 6, containLabel: true, ...grid },
    legend: { ...(base.legend as object), show: showLegend !== false && series.length > 1 },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      valueFormatter: valueFormatter(yFormat),
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(148,163,184,0.35)', type: 'dashed' } },
    },
    dataZoom: zoom
      ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 4, borderColor: 'rgba(148,163,184,0.16)', backgroundColor: 'rgba(148,163,184,0.04)', fillerColor: 'rgba(34,211,238,0.10)', handleStyle: { color: COLORS.cyan }, textStyle: { color: MUTED, fontSize: 9 } }]
      : undefined,
    xAxis: axisX({ data: x, boundaryGap: false }),
    yAxis: axisY({
      axisLabel: {
        color: MUTED,
        fontSize: 10,
        formatter: (v: number) => (yFormat === 'money' ? inrCompact(v) : yFormat === 'percent' ? `${v}%` : num(v)),
      },
    }),
    series: series.map((s) => ({
      type: 'line',
      name: s.name,
      data: s.data,
      smooth: s.smooth ?? 0.28,
      symbol: s.symbol === false ? 'none' : 'circle',
      symbolSize: 4,
      showSymbol: s.symbol !== false,
      yAxisIndex: s.yAxisIndex ?? 0,
      lineStyle: { width: 2.2, color: s.color, type: s.dashed ? 'dashed' : 'solid' },
      itemStyle: { color: s.color },
      areaStyle: s.area || area
        ? {
            opacity: 0.18,
            color: s.color,
          }
        : undefined,
      emphasis: { focus: 'series' },
    })),
  };
}

export function pieOption({
  data,
  donut = true,
  rose = false,
  showLegend = true,
  valueFormat = 'money',
  centerText,
}: {
  data: { name: string; value: number; color?: string }[];
  donut?: boolean;
  rose?: boolean;
  showLegend?: boolean;
  valueFormat?: 'money' | 'percent' | 'num';
  centerText?: { value: string; label: string };
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      valueFormatter: valueFormatter(valueFormat),
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<b>${p.name}</b><br/>${valueFormat === 'money' ? inrCompact(p.value) : num(p.value)} · ${p.percent.toFixed(1)}%`,
    },
    legend: {
      ...(base.legend as object),
      show: showLegend,
      orient: 'vertical',
      right: 4,
      top: 'middle',
      itemGap: 9,
      textStyle: { color: MUTED, fontSize: 10 },
    },
    series: [
      {
        type: 'pie',
        radius: donut ? ['48%', '70%'] : '68%',
        center: showLegend ? ['36%', '50%'] : ['50%', '50%'],
        roseType: rose ? 'radius' : undefined,
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#080d18', borderWidth: 2, borderRadius: 4 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 6 },
        data: data.map((d) => ({ ...d, itemStyle: d.color ? { color: d.color } : undefined })),
      },
    ],
    graphic: centerText
      ? [
          {
            type: 'text',
            left: showLegend ? '30%' : 'center',
            top: '44%',
            style: { text: centerText.value, fill: '#f8fafc', fontSize: 18, fontWeight: 800, fontFamily: 'Manrope', textAlign: 'center' },
          },
          {
            type: 'text',
            left: showLegend ? '30%' : 'center',
            top: '54%',
            style: { text: centerText.label, fill: MUTED, fontSize: 9, fontFamily: 'Manrope', textAlign: 'center' },
          },
        ]
      : undefined,
  };
}

export function treemapOption({
  data,
  valueFormat = 'money',
  height = 280,
}: {
  data: { name: string; value: number; color?: string; children?: unknown[] }[];
  valueFormat?: 'money' | 'percent' | 'num';
  height?: number;
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      valueFormatter: valueFormatter(valueFormat),
    },
    series: [
      {
        type: 'treemap',
        width: '100%',
        height,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          color: '#e2e8f0',
          fontSize: 10,
          formatter: (p: { name: string; value: number }) => `${p.name}\n${valueFormat === 'money' ? inrCompact(p.value) : num(p.value)}`,
        },
        upperLabel: { show: false },
        itemStyle: { borderColor: '#080d18', borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 } }],
        data,
      },
    ],
  };
}

export function scatterOption({
  points,
  xName,
  yName,
  xFormat = 'num',
  yFormat = 'num',
  color = COLORS.cyan,
  size = 6,
  opacity = 0.65,
  regression,
  categories,
}: {
  points: { x: number; y: number; name?: string; value?: number; color?: string; group?: string }[];
  xName: string;
  yName: string;
  xFormat?: 'money' | 'percent' | 'num';
  yFormat?: 'money' | 'percent' | 'num';
  color?: string;
  size?: number;
  opacity?: number;
  regression?: { slope: number; intercept: number };
  categories?: string[];
}): ChartOption {
  const base = baseOption();
  const groups = categories ?? [...new Set(points.map((p) => p.group ?? 'Loans'))];
  return {
    ...base,
    grid: { left: 6, right: 18, top: 18, bottom: 22, containLabel: true },
    legend: { ...(base.legend as object), show: groups.length > 1, top: 0 },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: { data: { name?: string; x: number; y: number; value?: number } }) => {
        const name = p.data.name ? `<b>${p.data.name}</b><br/>` : '';
        return `${name}${xName}: ${xFormat === 'money' ? inrCompact(p.data.x) : xFormat === 'percent' ? pct(p.data.x) : num(p.data.x)}<br/>${yName}: ${yFormat === 'money' ? inrCompact(p.data.y) : yFormat === 'percent' ? pct(p.data.y) : num(p.data.y)}`;
      },
    },
    xAxis: {
      type: 'value',
      name: xName,
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => (xFormat === 'money' ? inrCompact(v) : xFormat === 'percent' ? `${v}%` : num(v)) },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
    },
    yAxis: {
      type: 'value',
      name: yName,
      nameLocation: 'middle',
      nameGap: 34,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => (yFormat === 'money' ? inrCompact(v) : yFormat === 'percent' ? `${v}%` : num(v)) },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      axisLine: { show: false },
    },
    series: [
      ...groups.map((group) => ({
        type: 'scatter',
        name: group,
        data: points
          .filter((p) => (p.group ?? 'Loans') === group)
          .map((p) => ({ name: p.name, value: [p.x, p.y], itemStyle: { color: p.color, opacity } })),
        symbolSize: (val: number[]) => Math.max(3, Math.min(22, size + (Number.isFinite(val[2]) ? 0 : 0))),
        emphasis: { focus: 'series', scale: 1.4 },
      })),
      ...(regression
        ? [
            {
              type: 'line',
              name: 'Trend',
              data: [
                [Math.min(...points.map((p) => p.x)), regression.intercept + regression.slope * Math.min(...points.map((p) => p.x))],
                [Math.max(...points.map((p) => p.x)), regression.intercept + regression.slope * Math.max(...points.map((p) => p.x))],
              ],
              symbol: 'none',
              lineStyle: { color: COLORS.amber, width: 1.4, type: 'dashed' },
              tooltip: { show: false },
            },
          ]
        : []),
    ],
  };
}

export function heatmapOption({
  xLabels,
  yLabels,
  cells,
  min = 0,
  max,
  valueFormat = 'percent',
  xName,
  yName,
}: {
  xLabels: string[];
  yLabels: string[];
  cells: { x: number; y: number; value: number; label?: string }[];
  min?: number;
  max?: number;
  valueFormat?: 'percent' | 'num' | 'money' | 'ratio';
  xName?: string;
  yName?: string;
}): ChartOption {
  const base = baseOption();
  const maxValue = max ?? Math.max(...cells.map((c) => c.value), 0.0001);
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 44, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: { data: [number, number, number] }) => {
        const value = p.data[2];
        return `<b>${yLabels[p.data[1]]}</b> × ${xLabels[p.data[0]]}<br/>${valueFormat === 'money' ? inrCompact(value) : valueFormat === 'percent' ? pct(value) : num(value)}`;
      },
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      name: xName,
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9, interval: 0, rotate: xLabels.length > 12 ? 40 : 0 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      name: yName,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    visualMap: {
      min: 0,
      max: maxValue,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 10,
      itemHeight: 60,
      textStyle: { color: MUTED, fontSize: 9 },
      inRange: { color: ['#0b2b33', '#0e7490', '#22d3ee', '#a3e635', '#fbbf24', '#fb7185', '#be123c'] },
      formatter: (v: number) => (valueFormat === 'percent' ? `${Math.round(v)}%` : num(v)),
    },
    series: [
      {
        type: 'heatmap',
        data: cells.map((c) => [c.x, c.y, c.value]),
        label: {
          show: cells.length <= 80,
          color: '#e2e8f0',
          fontSize: 8,
          formatter: (p: { data: [number, number, number] }) => (valueFormat === 'percent' ? `${p.data[2].toFixed(0)}%` : ''),
        },
        itemStyle: { borderColor: '#080d18', borderWidth: 1.5, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: '#f8fafc', borderWidth: 1 } },
      },
    ],
  };
}

export function boxOption({
  categories,
  data,
  yName,
  yFormat = 'percent',
}: {
  categories: string[];
  data: (number[] | null)[];
  yName: string;
  yFormat?: 'money' | 'percent' | 'num';
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 30, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: { name: string; data: number[] }) => {
        if (!Array.isArray(p.data)) return p.name;
        const [min, q1, med, q3, max] = p.data;
        const f = (v: number) => (yFormat === 'money' ? inrCompact(v) : yFormat === 'percent' ? pct(v) : num(v));
        return `<b>${p.name}</b><br/>Max ${f(max)}<br/>Q3 ${f(q3)}<br/>Median ${f(med)}<br/>Q1 ${f(q1)}<br/>Min ${f(min)}`;
      },
    },
    xAxis: axisX({ data: categories }),
    yAxis: axisY({
      name: yName,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => (yFormat === 'money' ? inrCompact(v) : yFormat === 'percent' ? `${v}%` : num(v)) },
    }),
    series: [
      {
        type: 'boxplot',
        data,
        itemStyle: { color: 'rgba(34,211,238,0.16)', borderColor: COLORS.cyan, borderWidth: 1.4 },
        emphasis: { itemStyle: { borderColor: COLORS.emerald } },
      },
    ],
  };
}

export function histOption({
  bins,
  xName,
  yName = 'Loans',
  color = COLORS.violet,
  yFormat = 'num',
  xFormat = 'num',
}: {
  bins: { x: number; count: number; from?: number; to?: number }[];
  xName: string;
  yName?: string;
  color?: string;
  yFormat?: 'money' | 'percent' | 'num';
  xFormat?: 'money' | 'percent' | 'num' | 'ratio';
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 14, top: 12, bottom: 30, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const p = (params as { dataIndex: number }[])[0];
        const bin = bins[p.dataIndex];
        const f = (v: number) => (xFormat === 'money' ? inrCompact(v) : xFormat === 'percent' ? pct(v) : xFormat === 'ratio' ? pct(v * 100) : num(v, 1));
        return `${f(bin.from ?? 0)} – ${f(bin.to ?? bin.x)}<br/><b>${num(bin.count)} loans</b>`;
      },
    },
    xAxis: axisX({
      data: bins.map((b) => (xFormat === 'money' ? inrCompact(b.x) : xFormat === 'percent' ? `${b.x.toFixed(0)}%` : num(b.x, 1))),
      axisLabel: { color: MUTED, fontSize: 9, interval: Math.max(0, Math.floor(bins.length / 8)), hideOverlap: true },
      name: xName,
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: MUTED, fontSize: 9 },
    }),
    yAxis: axisY({ name: yName, nameTextStyle: { color: MUTED, fontSize: 9 } }),
    series: [
      {
        type: 'bar',
        data: bins.map((b) => b.count),
        itemStyle: { color, borderRadius: [4, 4, 0, 0], opacity: 0.85 },
        barMaxWidth: 30,
      },
    ],
  };
}

export function ecdfOption({
  points,
  xName,
  color = COLORS.emerald,
  xFormat = 'num',
}: {
  points: { x: number; y: number }[];
  xName: string;
  color?: string;
  xFormat?: 'money' | 'percent' | 'num' | 'ratio';
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 30, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? pct(v * 100) : '—'),
    },
    xAxis: {
      type: 'value',
      name: xName,
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => (xFormat === 'money' ? inrCompact(v) : xFormat === 'percent' ? `${v}%` : xFormat === 'ratio' ? `${(v * 100).toFixed(0)}%` : num(v)) },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
    },
    yAxis: axisY({
      max: 1,
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${Math.round(v * 100)}%` },
    }),
    series: [
      {
        type: 'line',
        data: points.map((p) => [p.x, p.y]),
        showSymbol: false,
        smooth: false,
        lineStyle: { color, width: 2 },
        areaStyle: { color, opacity: 0.12 },
      },
    ],
  };
}

export function radarOption({
  indicators,
  series,
  max,
}: {
  indicators: { name: string; max: number }[];
  series: { name: string; value: number[]; color?: string }[];
  max?: number;
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item' },
    legend: { ...(base.legend as object), show: series.length > 1, bottom: 0, top: undefined },
    radar: {
      indicator: indicators.map((i) => ({ ...i, max: max ?? i.max })),
      center: ['50%', '48%'],
      radius: '60%',
      splitNumber: 4,
      axisName: { color: MUTED, fontSize: 9 },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.14)' } },
      splitArea: { areaStyle: { color: ['rgba(148,163,184,0.02)', 'rgba(148,163,184,0.04)'] } },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.14)' } },
    },
    series: [
      {
        type: 'radar',
        data: series.map((s) => ({
          name: s.name,
          value: s.value,
          itemStyle: { color: s.color },
          lineStyle: { color: s.color, width: 1.8 },
          areaStyle: { color: s.color, opacity: 0.12 },
        })),
        symbolSize: 3,
      },
    ],
  };
}

export function gaugeOption({
  value,
  max = 100,
  label,
  color = COLORS.emerald,
  suffix = '%',
}: {
  value: number;
  max?: number;
  label: string;
  color?: string;
  suffix?: string;
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    series: [
      {
        type: 'gauge',
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max,
        radius: '92%',
        center: ['50%', '56%'],
        progress: { show: true, width: 10, roundCap: true, itemStyle: { color } },
        axisLine: { lineStyle: { width: 10, color: [[1, 'rgba(148,163,184,0.12)']] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: { show: true, offsetCenter: [0, '32%'], color: MUTED, fontSize: 9 },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '2%'],
          color: '#f8fafc',
          fontSize: 22,
          fontWeight: 800,
          fontFamily: 'JetBrains Mono',
          formatter: (v: number) => `${v.toFixed(1)}${suffix}`,
        },
        data: [{ value, name: label }],
      },
    ],
  };
}

export function funnelOption({ data, valueFormat = 'money' }: { data: { name: string; value: number; color?: string }[]; valueFormat?: 'money' | 'num' }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item', valueFormatter: valueFormatter(valueFormat) },
    legend: { ...(base.legend as object), show: true, orient: 'vertical', right: 0, top: 'middle' },
    series: [
      {
        type: 'funnel',
        left: '4%',
        right: '28%',
        top: 8,
        bottom: 8,
        minSize: '24%',
        maxSize: '100%',
        sort: 'descending',
        gap: 3,
        label: { show: true, position: 'inside', color: '#04111a', fontSize: 10, fontWeight: 700 },
        itemStyle: { borderColor: '#080d18', borderWidth: 2, borderRadius: 5 },
        data,
      },
    ],
  };
}

export function sankeyOption({
  nodes,
  links,
  height = 320,
}: {
  nodes: { name: string; itemStyle?: { color: string } }[];
  links: { source: string; target: string; value: number }[];
  height?: number;
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item', valueFormatter: valueFormatter('money') },
    series: [
      {
        type: 'sankey',
        data: nodes,
        links,
        left: 4,
        right: 80,
        top: 8,
        bottom: 8,
        height,
        nodeWidth: 10,
        nodeGap: 10,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        label: { color: '#cbd5e1', fontSize: 9 },
        lineStyle: { color: 'gradient', opacity: 0.25, curveness: 0.5 },
        itemStyle: { borderWidth: 0 },
      },
    ],
  };
}

export function sunburstOption({ data }: { data: unknown[] }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item', valueFormatter: valueFormatter('money') },
    series: [
      {
        type: 'sunburst',
        data,
        radius: ['18%', '88%'],
        center: ['50%', '50%'],
        sort: (a: { value: number }, b: { value: number }) => b.value - a.value,
        emphasis: { focus: 'ancestor' },
        label: { color: '#e2e8f0', fontSize: 9, rotate: 'radial', minAngle: 8 },
        itemStyle: { borderColor: '#080d18', borderWidth: 1.5 },
        levels: [
          {},
          { r0: '18%', r: '48%', label: { rotate: 0, fontSize: 9 } },
          { r0: '48%', r: '72%', label: { rotate: 'tangential', fontSize: 8 } },
          { r0: '72%', r: '88%', label: { show: false } },
        ],
      },
    ],
  };
}

export function themeRiverOption({
  months,
  series,
}: {
  months: string[];
  series: { name: string; data: number[]; color?: string }[];
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'axis', valueFormatter: valueFormatter('money') },
    legend: { ...(base.legend as object), show: true, top: 0 },
    singleAxis: {
      type: 'category',
      data: months,
      top: 30,
      bottom: 10,
      axisLabel: { color: MUTED, fontSize: 9 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'themeRiver',
        data: series.flatMap((s) => s.data.map((v, i) => [months[i], v, s.name])),
        label: { show: false },
        itemStyle: { opacity: 0.85 },
        emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.4)' } },
      },
    ],
  };
}

export function calendarOption({
  year,
  data,
  max,
}: {
  year: string;
  data: [string, number][];
  max?: number;
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item', valueFormatter: valueFormatter('money') },
    visualMap: {
      min: 0,
      max: max ?? Math.max(...data.map((d) => d[1]), 1),
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 10,
      itemHeight: 50,
      textStyle: { color: MUTED, fontSize: 9 },
      inRange: { color: ['#0b2b33', '#0e7490', '#22d3ee', '#a3e635', '#fbbf24'] },
      formatter: (v: number) => inrCompact(v),
    },
    calendar: {
      top: 26,
      left: 30,
      right: 10,
      bottom: 34,
      range: year,
      cellSize: ['auto', 13],
      splitLine: { show: false },
      itemStyle: { color: 'rgba(148,163,184,0.05)', borderWidth: 0 },
      dayLabel: { color: MUTED, fontSize: 9, nameMap: 'en' },
      monthLabel: { color: MUTED, fontSize: 9, nameMap: 'en' },
      yearLabel: { show: false },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data,
        itemStyle: { borderRadius: 2 },
      },
    ],
  };
}

export function candlestickOption({
  categories,
  data,
}: {
  categories: string[];
  data: [number, number, number, number][];
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 14, top: 12, bottom: 30, containLabel: true },
    tooltip: { ...(base.tooltip as object), trigger: 'axis', axisPointer: { type: 'cross' } },
    xAxis: axisX({ data: categories, boundaryGap: true }),
    yAxis: axisY({ axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${v.toFixed(0)}%` } }),
    series: [
      {
        type: 'candlestick',
        data,
        itemStyle: { color: COLORS.emerald, color0: COLORS.rose, borderColor: COLORS.emerald, borderColor0: COLORS.rose },
      },
    ],
  };
}

export function waterfallOption({
  items,
  valueFormat = 'money',
}: {
  items: { name: string; value: number; type?: 'total' | 'delta' }[];
  valueFormat?: 'money' | 'percent' | 'num';
}): ChartOption {
  const base = baseOption();
  let running = 0;
  const bases: number[] = [];
  const values: number[] = [];
  const colors: string[] = [];
  for (const item of items) {
    if (item.type === 'total') {
      bases.push(0);
      values.push(item.value);
      running = item.value;
      colors.push(item.value >= 0 ? COLORS.cyan : COLORS.rose);
    } else {
      const start = item.value >= 0 ? running : running + item.value;
      bases.push(start);
      values.push(Math.abs(item.value));
      running += item.value;
      colors.push(item.value >= 0 ? COLORS.emerald : COLORS.rose);
    }
  }
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 36, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const p = (params as { dataIndex: number }[])[0];
        const item = items[p.dataIndex];
        const f = (v: number) => (valueFormat === 'money' ? inrCompact(v) : valueFormat === 'percent' ? pct(v) : num(v));
        return `<b>${item.name}</b><br/>${item.value >= 0 ? '+' : ''}${f(item.value)}`;
      },
    },
    xAxis: axisX({ data: items.map((i) => i.name), axisLabel: { color: MUTED, fontSize: 9, interval: 0, rotate: items.length > 7 ? 28 : 0 } }),
    yAxis: axisY({ axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => (valueFormat === 'money' ? inrCompact(v) : `${v}`) } }),
    series: [
      {
        type: 'bar',
        stack: 'wf',
        silent: true,
        itemStyle: { color: 'transparent' },
        data: bases,
      },
      {
        type: 'bar',
        stack: 'wf',
        data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [4, 4, 0, 0] } })),
        barMaxWidth: 34,
        label: {
          show: true,
          position: 'top',
          color: '#cbd5e1',
          fontSize: 9,
          formatter: (p: { dataIndex: number }) => {
            const item = items[p.dataIndex];
            return `${item.value >= 0 ? '+' : ''}${valueFormat === 'money' ? inrCompact(item.value) : item.value.toFixed(1)}`;
          },
        },
      },
    ],
  };
}

export function lorenzOption({ points, giniValue }: { points: { x: number; y: number }[]; giniValue: number }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 30, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = (params as { data: [number, number] }[])[0];
        return `Bottom ${(p.data[0] * 100).toFixed(0)}% of borrowers<br/>${(p.data[1] * 100).toFixed(1)}% of capital`;
      },
    },
    xAxis: {
      type: 'value',
      max: 1,
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      name: 'Borrowers (cumulative)',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: MUTED, fontSize: 9 },
    },
    yAxis: {
      type: 'value',
      max: 1,
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      name: 'Capital',
      nameTextStyle: { color: MUTED, fontSize: 9 },
    },
    series: [
      {
        type: 'line',
        name: 'Lorenz',
        data: points.map((p) => [p.x, p.y]),
        showSymbol: false,
        lineStyle: { color: COLORS.amber, width: 2.2 },
        areaStyle: { color: COLORS.amber, opacity: 0.12 },
      },
      {
        type: 'line',
        name: 'Equality',
        data: [[0, 0], [1, 1]],
        showSymbol: false,
        lineStyle: { color: 'rgba(148,163,184,0.4)', type: 'dashed', width: 1 },
        tooltip: { show: false },
      },
    ],
    graphic: [
      {
        type: 'text',
        right: 18,
        top: 16,
        style: { text: `Gini ${(giniValue * 100).toFixed(1)}`, fill: COLORS.amber, fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono' },
      },
    ],
  };
}

export function rocOption({ points, auc }: { points: { fpr: number; tpr: number }[]; auc: number }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 30, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = (params as { data: [number, number] }[])[0];
        return `FPR ${(p.data[0] * 100).toFixed(1)}%<br/>TPR ${(p.data[1] * 100).toFixed(1)}%`;
      },
    },
    xAxis: {
      type: 'value',
      max: 1,
      name: 'False positive rate',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
    },
    yAxis: {
      type: 'value',
      max: 1,
      name: 'True positive rate',
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        data: [[0, 0], ...points.map((p) => [p.fpr, p.tpr]), [1, 1]],
        showSymbol: false,
        smooth: false,
        lineStyle: { color: COLORS.emerald, width: 2.4 },
        areaStyle: { color: COLORS.emerald, opacity: 0.12 },
      },
      {
        type: 'line',
        data: [[0, 0], [1, 1]],
        showSymbol: false,
        lineStyle: { color: 'rgba(148,163,184,0.35)', type: 'dashed', width: 1 },
        tooltip: { show: false },
      },
    ],
    graphic: [
      {
        type: 'text',
        right: 22,
        bottom: 34,
        style: { text: `AUC ${auc.toFixed(3)}`, fill: COLORS.emerald, fontSize: 12, fontWeight: 800, fontFamily: 'JetBrains Mono' },
      },
    ],
  };
}

export function liftOption({ data }: { data: { decile: number; badRate: number; lift: number }[] }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 34, bottom: 30, containLabel: true },
    legend: { ...(base.legend as object), show: true, top: 0 },
    tooltip: { ...(base.tooltip as object), trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—') },
    xAxis: axisX({ data: data.map((d) => `D${d.decile}`) }),
    yAxis: axisY({ name: 'Bad rate % / lift ×', nameTextStyle: { color: MUTED, fontSize: 9 } }),
    series: [
      {
        type: 'bar',
        name: 'Bad rate %',
        data: data.map((d) => d.badRate * 100),
        itemStyle: { color: COLORS.rose, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 26,
      },
      {
        type: 'line',
        name: 'Lift ×',
        data: data.map((d) => d.lift),
        smooth: true,
        lineStyle: { color: COLORS.cyan, width: 2 },
        itemStyle: { color: COLORS.cyan },
        symbolSize: 5,
      },
    ],
  };
}

export function corrOption({ labels, matrix }: { labels: string[]; matrix: { x: number; y: number; value: number }[] }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 40, containLabel: true },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: { data: [number, number, number] }) => `<b>${labels[p.data[0]]}</b> × ${labels[p.data[1]]}<br/>r = ${p.data[2].toFixed(3)}`,
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: MUTED, fontSize: 9, interval: 0, rotate: 40 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: MUTED, fontSize: 9 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 10,
      itemHeight: 50,
      textStyle: { color: MUTED, fontSize: 9 },
      inRange: { color: ['#be123c', '#7f1d1d', '#1e293b', '#0e7490', '#22d3ee'] },
    },
    series: [
      {
        type: 'heatmap',
        data: matrix.map((m) => [m.x, m.y, m.value]),
        label: { show: true, color: '#e2e8f0', fontSize: 8, formatter: (p: { data: [number, number, number] }) => p.data[2].toFixed(2) },
        itemStyle: { borderColor: '#080d18', borderWidth: 1 },
      },
    ],
  };
}

export function parallelOption({
  dimensions,
  data,
}: {
  dimensions: { name: string; min?: number; max?: number }[];
  data: number[][];
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    parallel: {
      left: 20,
      right: 34,
      top: 24,
      bottom: 18,
      parallelAxisDefault: {
        type: 'value',
        name: '',
        nameTextStyle: { color: MUTED, fontSize: 9 },
        axisLabel: { color: MUTED, fontSize: 8 },
        axisLine: { lineStyle: { color: 'rgba(148,163,184,0.2)' } },
        splitLine: { lineStyle: { color: GRID } },
      },
    },
    parallelAxis: dimensions.map((d) => ({ dim: dimensions.indexOf(d), name: d.name, min: d.min, max: d.max })),
    series: [
      {
        type: 'parallel',
        lineStyle: { width: 0.6, opacity: 0.16, color: COLORS.cyan },
        emphasis: { lineStyle: { width: 1.5, opacity: 0.8 } },
        data,
        smooth: true,
      },
    ],
  };
}

export function polarOption({ categories, values, name }: { categories: string[]; values: number[]; name: string }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item', valueFormatter: valueFormatter('percent') },
    angleAxis: {
      type: 'category',
      data: categories,
      startAngle: 90,
      axisLabel: { color: MUTED, fontSize: 9 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.18)' } },
    },
    radiusAxis: {
      axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${v}%` },
      splitLine: { lineStyle: { color: GRID } },
    },
    polar: { radius: ['18%', '78%'], center: ['50%', '52%'] },
    series: [
      {
        type: 'bar',
        coordinateSystem: 'polar',
        name,
        data: values,
        itemStyle: { color: COLORS.cyan, borderRadius: [2, 2, 0, 0], opacity: 0.8 },
        emphasis: { itemStyle: { color: COLORS.emerald } },
      },
    ],
  };
}

export function survivalOption({ points, hazard }: { points: { x: number; y: number }[]; hazard?: { x: number; y: number }[] }): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 12, bottom: 30, containLabel: true },
    tooltip: { ...(base.tooltip as object), trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? pct(v * 100) : '—') },
    xAxis: {
      type: 'value',
      name: 'Months since disbursement',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: MUTED, fontSize: 9 },
      axisLabel: { color: MUTED, fontSize: 9 },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
    },
    yAxis: axisY({ max: 1, axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${Math.round(v * 100)}%` } }),
    series: [
      {
        type: 'line',
        name: 'Still performing',
        data: points.map((p) => [p.x, p.y]),
        showSymbol: false,
        lineStyle: { color: COLORS.emerald, width: 2.2 },
        areaStyle: { color: COLORS.emerald, opacity: 0.12 },
      },
      ...(hazard
        ? [
            {
              type: 'line',
              name: 'Hazard (NPA per month)',
              data: hazard.map((p) => [p.x, p.y]),
              showSymbol: false,
              yAxisIndex: 0,
              lineStyle: { color: COLORS.rose, width: 1.6, type: 'dashed' },
            },
          ]
        : []),
    ],
  };
}

export function fanOption({
  months,
  p10,
  p50,
  p90,
}: {
  months: string[];
  p10: number[];
  p50: number[];
  p90: number[];
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 30, bottom: 30, containLabel: true },
    legend: { ...(base.legend as object), show: true, top: 0 },
    tooltip: { ...(base.tooltip as object), trigger: 'axis', valueFormatter: valueFormatter('money') },
    xAxis: axisX({ data: months, boundaryGap: false }),
    yAxis: axisY({ axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => inrCompact(v) } }),
    series: [
      {
        type: 'line',
        name: 'P10',
        data: p10,
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'transparent' },
      },
      {
        type: 'line',
        name: 'P90–P10 band',
        data: p90.map((v, i) => v - p10[i]),
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(34,211,238,0.16)' },
      },
      {
        type: 'line',
        name: 'P50',
        data: p50,
        symbol: false,
        smooth: true,
        lineStyle: { color: COLORS.emerald, width: 2.4 },
      },
    ],
  };
}

export function comboOption({
  categories,
  bars,
  lines,
  barFormat = 'money',
  lineFormat = 'percent',
}: {
  categories: string[];
  bars: { name: string; data: number[]; color?: string }[];
  lines: { name: string; data: number[]; color?: string; yAxisIndex?: number }[];
  barFormat?: 'money' | 'num';
  lineFormat?: 'money' | 'percent' | 'num';
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 16, top: 34, bottom: 30, containLabel: true },
    legend: { ...(base.legend as object), show: true, top: 0 },
    tooltip: { ...(base.tooltip as object), trigger: 'axis' },
    xAxis: axisX({ data: categories }),
    yAxis: [
      axisY({ axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => (barFormat === 'money' ? inrCompact(v) : num(v)) } }),
      axisY({ axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => (lineFormat === 'money' ? inrCompact(v) : lineFormat === 'percent' ? `${v}%` : num(v)) }, splitLine: { show: false } }),
    ],
    series: [
      ...bars.map((b) => ({
        type: 'bar' as const,
        name: b.name,
        data: b.data,
        yAxisIndex: 0,
        itemStyle: { color: b.color, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 26,
      })),
      ...lines.map((l) => ({
        type: 'line' as const,
        name: l.name,
        data: l.data,
        yAxisIndex: l.yAxisIndex ?? 1,
        smooth: true,
        symbolSize: 5,
        lineStyle: { color: l.color, width: 2 },
        itemStyle: { color: l.color },
      })),
    ],
  };
}

export function bulletOption({
  items,
}: {
  items: { name: string; value: number; target: number; max: number; unit?: string }[];
}): ChartOption {
  const base = baseOption();
  return {
    ...base,
    grid: { left: 6, right: 30, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...(base.tooltip as object), trigger: 'axis' },
    xAxis: { type: 'value', max: 100, axisLabel: { color: MUTED, fontSize: 9, formatter: (v: number) => `${v}` }, splitLine: { lineStyle: { color: GRID } } },
    yAxis: { type: 'category', data: items.map((i) => i.name), axisLabel: { color: MUTED, fontSize: 9 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      {
        type: 'bar',
        data: items.map((i) => ({
          value: (i.value / i.max) * 100,
          itemStyle: { color: i.value >= i.target ? COLORS.emerald : COLORS.amber, borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 16,
        label: {
          show: true,
          position: 'right',
          color: '#e2e8f0',
          fontSize: 9,
          formatter: (p: { dataIndex: number }) => `${items[p.dataIndex].value.toFixed(1)}${items[p.dataIndex].unit ?? ''}`,
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: COLORS.rose, type: 'dashed', width: 1 },
          data: items.map((i) => ({ xAxis: (i.target / i.max) * 100 })),
        },
      },
    ],
  };
}
