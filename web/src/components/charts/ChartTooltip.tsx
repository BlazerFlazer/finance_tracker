import type { ReactNode } from 'react';

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/** A recharts-compatible tooltip content renderer, styled with our design tokens instead of recharts' defaults. */
export function ChartTooltipBox({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '10px 12px', fontSize: 12.5, minWidth: 140 }}>
      {title && <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>{title}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              {r.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />}
              {r.label}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span className="chart-legend-item" key={item.label}>
          <span className="chart-legend-swatch" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, actions, children, legend }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; legend?: ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="flex-row space-between" style={{ marginBottom: 16 }}>
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
      {legend && <div className="mt-3">{legend}</div>}
    </div>
  );
}
