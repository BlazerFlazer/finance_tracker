import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

export function StatCard({ label, value, delta, icon }: { label: ReactNode; value: ReactNode; delta?: { positive: boolean; text: string } | null; icon?: ReactNode }) {
  return (
    <div className="card card-pad stat-card">
      <div className="stat-card-label">
        {icon}
        {label}
      </div>
      <div className="stat-card-value">{value}</div>
      {delta && (
        <span className={`stat-card-delta ${delta.positive ? 'up' : 'down'}`}>
          {delta.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {delta.text}
        </span>
      )}
    </div>
  );
}
