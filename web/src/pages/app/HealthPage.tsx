import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Info } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock, EmptyState } from '../../components/ui/States';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';

interface HealthComponent { key: string; score: number; weight: number; value: number; included: boolean; reason?: string }
interface Health { score: number | null; components: HealthComponent[] }

const LABELS: Record<string, string> = {
  savings_rate: 'Savings rate', budget_adherence: 'Budget adherence', debt_ratio: 'Debt ratio',
  emergency_fund: 'Emergency fund', recurring_expenses: 'Recurring expenses', spending_consistency: 'Spending consistency',
};
const REASONS: Record<string, string> = { no_income_data: 'Not enough income data yet', no_budgets: "You haven't set up any budgets yet", no_expense_data: 'Not enough expense data yet', not_enough_months: 'Needs a few more months of history' };

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

export default function HealthPage() {
  const t = useT();
  const { data, isLoading } = useQuery({ queryKey: ['health-score'], queryFn: () => api.get<Health>('/api/health-score') });

  return (
    <>
      <PageHeader title={t('nav.health')} />
      <div className="disclaimer-box mb-4"><Info size={15} /> This score is a transparent estimate from your own data, not a professional financial assessment.</div>
      {isLoading || !data ? <LoadingBlock height={320} /> : data.score === null ? (
        <EmptyState icon={<HeartPulse size={22} />} title="Not enough data yet" description="Add some transactions to see your Financial Health score." />
      ) : (
        <div className="grid grid-cols-2">
          <div className="card card-pad text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="160" height="160" viewBox="0 0 160 160">
              <circle cx="80" cy="80" r="70" fill="none" stroke="var(--bg-sunken)" strokeWidth="14" />
              <circle cx="80" cy="80" r="70" fill="none" stroke={scoreColor(data.score)} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(data.score / 100) * 440} 440`} transform="rotate(-90 80 80)" />
              <text x="80" y="88" textAnchor="middle" fontSize="34" fontWeight="700" fill="var(--text-primary)">{data.score}</text>
            </svg>
            <p className="text-secondary text-sm mt-3">out of 100</p>
          </div>
          <div className="flex-col gap-3">
            {data.components.map((c) => (
              <div className="card card-pad" key={c.key}>
                <div className="flex-row space-between mb-2">
                  <span className="font-medium text-sm">{LABELS[c.key] ?? c.key}</span>
                  {c.included ? <span className="text-sm font-semibold" style={{ color: scoreColor(c.score) }}>{Math.round(c.score)}</span> : <span className="badge badge-neutral">{REASONS[c.reason ?? ''] ?? c.reason}</span>}
                </div>
                {c.included && <div className="progress-track"><div className="progress-bar" style={{ width: `${c.score}%`, background: scoreColor(c.score) }} /></div>}
                {c.included && <div className="text-tertiary text-xs mt-1">Weight: {c.weight}%</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
