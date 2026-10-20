export interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  delta?: string;
  tone?: 'good' | 'bad' | 'neutral';
}

export function Kpi({ label, value, hint, delta, tone = 'neutral' }: KpiProps) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-meta">
        {delta ? <em>{delta}</em> : null}
        {hint ? <span>{hint}</span> : null}
      </span>
    </div>
  );
}
