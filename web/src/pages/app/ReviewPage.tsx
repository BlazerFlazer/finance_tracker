import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { useT, useI18n } from '../../lib/i18n';
import { api } from '../../lib/api';
import { categoryLabel } from '../../hooks/api';
import { addMonths, monthLabel, formatDate } from '@shared/dates';
import { formatPercent } from '@shared/money';

interface Review {
  period: string; currency: string; incomeMinor: number; expensesMinor: number; savingsMinor: number; savingsRate: number;
  biggestCategory: { name: string | null; systemKey: string | null; amountMinor: number } | null;
  largestExpense: { merchant: string | null; amountMinor: number; occurredOn: string } | null;
  budgetPerformance: { name: string; percentUsed: number; alertLevel: string }[];
  goalsProgress: { name: string; progress: number; status: string }[];
  netWorthChangeMinor: number | null;
  previousMonth: { incomeMinor: number; expensesMinor: number; savingsMinor: number } | null;
}

export default function ReviewPage() {
  const t = useT();
  const { locale } = useI18n();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, isLoading } = useQuery({ queryKey: ['review', period], queryFn: () => api.get<{ review: Review }>(`/api/reviews/${period}`).then((r) => r.review) });

  return (
    <>
      <PageHeader
        title={t('nav.review')}
        actions={
          <div className="flex-row gap-2">
            <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setPeriod((p) => addMonths(`${p}-01`, -1).slice(0, 7))}><ChevronLeft size={15} /></button>
            <span className="font-semibold" style={{ minWidth: 120, textAlign: 'center' }}>{monthLabel(period, locale, 'long')}</span>
            <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setPeriod((p) => addMonths(`${p}-01`, 1).slice(0, 7))}><ChevronRight size={15} /></button>
          </div>
        }
      />
      {isLoading || !data ? <LoadingBlock height={400} /> : (
        <>
          <div className="grid grid-cols-4 mb-4">
            <div className="stat-card card card-pad"><div className="stat-card-label">{t('common.income')}</div><div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={data.incomeMinor} currency={data.currency} neutral /></div></div>
            <div className="stat-card card card-pad"><div className="stat-card-label">{t('common.expenses')}</div><div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={data.expensesMinor} currency={data.currency} neutral /></div></div>
            <div className="stat-card card card-pad"><div className="stat-card-label">{t('common.savings')}</div><div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={data.savingsMinor} currency={data.currency} /></div></div>
            <div className="stat-card card card-pad"><div className="stat-card-label">Savings rate</div><div className="stat-card-value" style={{ fontSize: 18 }}>{formatPercent(data.savingsRate / 100, locale)}</div></div>
          </div>

          <div className="grid grid-cols-2 mb-4">
            <div className="card card-pad">
              <div className="card-title mb-3">Highlights</div>
              {data.biggestCategory && <div className="flex-row space-between text-sm mb-2"><span className="text-secondary">Biggest category</span><span>{categoryLabel(data.biggestCategory, t)} · <Money minor={data.biggestCategory.amountMinor} currency={data.currency} neutral /></span></div>}
              {data.largestExpense && <div className="flex-row space-between text-sm mb-2"><span className="text-secondary">Largest expense</span><span>{data.largestExpense.merchant} · <Money minor={data.largestExpense.amountMinor} currency={data.currency} neutral /> · {formatDate(data.largestExpense.occurredOn, locale, 'short')}</span></div>}
              {data.netWorthChangeMinor !== null && <div className="flex-row space-between text-sm"><span className="text-secondary">Net worth change</span><Money minor={data.netWorthChangeMinor} currency={data.currency} sign="always" /></div>}
            </div>
            <div className="card card-pad">
              <div className="card-title mb-3">vs. previous month</div>
              {data.previousMonth ? (
                <>
                  <div className="flex-row space-between text-sm mb-2"><span className="text-secondary">{t('common.income')}</span><span>{data.previousMonth.incomeMinor > 0 ? formatPercent((data.incomeMinor - data.previousMonth.incomeMinor) / data.previousMonth.incomeMinor, locale) : '—'}</span></div>
                  <div className="flex-row space-between text-sm mb-2"><span className="text-secondary">{t('common.expenses')}</span><span>{data.previousMonth.expensesMinor > 0 ? formatPercent((data.expensesMinor - data.previousMonth.expensesMinor) / data.previousMonth.expensesMinor, locale) : '—'}</span></div>
                  <div className="flex-row space-between text-sm"><span className="text-secondary">{t('common.savings')}</span><Money minor={data.savingsMinor - data.previousMonth.savingsMinor} currency={data.currency} sign="always" /></div>
                </>
              ) : <p className="text-secondary text-sm">No data for the previous month.</p>}
            </div>
          </div>

          <div className="grid grid-cols-2">
            <div className="card card-pad">
              <div className="card-title mb-3">{t('nav.budgets')}</div>
              {data.budgetPerformance.length === 0 ? <p className="text-secondary text-sm">—</p> : data.budgetPerformance.map((b) => (
                <div key={b.name} className="flex-row space-between text-sm mb-2"><span>{b.name}</span><span className={`badge ${b.alertLevel === 'exceeded' ? 'badge-danger' : 'badge-neutral'}`}>{b.percentUsed}%</span></div>
              ))}
            </div>
            <div className="card card-pad">
              <div className="card-title mb-3">{t('nav.goals')}</div>
              {data.goalsProgress.length === 0 ? <p className="text-secondary text-sm">—</p> : data.goalsProgress.map((g) => (
                <div key={g.name} className="flex-row space-between text-sm mb-2"><span>{g.name}</span><span className="text-tertiary">{g.progress}%</span></div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
