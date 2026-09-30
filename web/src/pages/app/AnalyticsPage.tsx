import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock, EmptyState } from '../../components/ui/States';
import { Money, useMoneyFormatter } from '../../components/ui/Money';
import { StatCard } from '../../components/ui/StatCard';
import { ChartCard, ChartTooltipBox, Legend } from '../../components/charts/ChartTooltip';
import { PERIOD_PRESETS, monthLabel } from '@shared/dates';
import { useT, useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { api } from '../../lib/api';
import { categoricalColors, foldTopCategories, otherColor } from '../../lib/charts';

interface Overview {
  currency: string;
  totals: { income: number; expense: number; net: number };
  priorTotals: { income: number; expense: number; net: number };
  incomeExpenseByMonth: { month: string; incomeMinor: number; expenseMinor: number; netMinor: number }[];
  spendingByCategory: { categoryId: string | null; name: string | null; systemKey: string | null; amountMinor: number; percent: number }[];
  topMerchants: { merchant: string; amountMinor: number; count: number }[];
  budgetPerformance: { budget: { id: string; name: string }; percentUsed: number; alertLevel: string }[];
}

export default function AnalyticsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const money = useMoneyFormatter();
  const colors = categoricalColors(resolvedTheme);
  const [period, setPeriod] = useState<typeof PERIOD_PRESETS[number]>('30d');

  const { data, isLoading } = useQuery({ queryKey: ['analytics', 'overview', period], queryFn: () => api.get<Overview>('/api/analytics/overview', { period }) });

  const pct = (cur: number, prev: number) => (prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null);
  const slices = data ? foldTopCategories(data.spendingByCategory.map((c) => ({ ...c, name: c.name ?? (c.systemKey ? t(`categoryNames.${c.systemKey}`) : t('categoryNames.uncategorized')) })), 7) : [];

  return (
    <>
      <PageHeader
        title={t('nav.analytics')}
        actions={
          <div className="segmented">
            {PERIOD_PRESETS.filter((p) => p !== 'custom').map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>)}
          </div>
        }
      />
      {isLoading || !data ? <LoadingBlock height={400} /> : (
        <>
          <div className="grid grid-cols-3 mb-4">
            <StatCard label={t('common.income')} value={<Money minor={data.totals.income} currency={data.currency} neutral />} delta={(() => { const p = pct(data.totals.income, data.priorTotals.income); return p === null ? null : { positive: p >= 0, text: `${p >= 0 ? '+' : ''}${p}%` }; })()} />
            <StatCard label={t('common.expenses')} value={<Money minor={data.totals.expense} currency={data.currency} neutral />} delta={(() => { const p = pct(data.totals.expense, data.priorTotals.expense); return p === null ? null : { positive: p <= 0, text: `${p >= 0 ? '+' : ''}${p}%` }; })()} />
            <StatCard label={t('common.savings')} value={<Money minor={data.totals.net} currency={data.currency} />} delta={(() => { const p = pct(data.totals.net, data.priorTotals.net); return p === null ? null : { positive: p >= 0, text: `${p >= 0 ? '+' : ''}${p}%` }; })()} />
          </div>

          <div className="grid grid-cols-2 mb-4">
            <ChartCard title={`${t('common.income')} vs ${t('common.expenses')}`}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.incomeExpenseByMonth}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m, locale)} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={0} />
                  <Tooltip content={({ active, payload, label }) => (!active || !payload?.length ? null : (
                    <ChartTooltipBox title={monthLabel(String(label), locale)} rows={[{ label: t('common.income'), value: money(Number(payload[0]?.payload.incomeMinor ?? 0), data.currency), color: colors[0] }, { label: t('common.expenses'), value: money(Number(payload[0]?.payload.expenseMinor ?? 0), data.currency), color: colors[1] }]} />
                  ))} cursor={{ fill: 'var(--bg-hover)' }} />
                  <Bar dataKey="incomeMinor" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="expenseMinor" fill={colors[1]} radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
              <Legend items={[{ label: t('common.income'), color: colors[0]! }, { label: t('common.expenses'), color: colors[1]! }]} />
            </ChartCard>

            <ChartCard title="Spending by category">
              {slices.length === 0 ? <EmptyState title={t('transactions.noTransactions')} /> : (
                <div className="flex-row gap-4">
                  <ResponsiveContainer width={160} height={200}>
                    <PieChart>
                      <Pie data={slices} dataKey="amountMinor" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2} stroke="var(--bg-elevated)" strokeWidth={2}>
                        {slices.map((s, i) => <Cell key={i} fill={s.name === 'Other' ? otherColor(resolvedTheme) : colors[i % colors.length]} />)}
                      </Pie>
                      <Tooltip content={({ active, payload }) => (!active || !payload?.length ? null : <ChartTooltipBox rows={[{ label: String(payload[0]?.name), value: money(Number(payload[0]?.value ?? 0), data.currency) }]} />)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-col gap-2" style={{ flex: 1, justifyContent: 'center' }}>
                    {slices.map((s, i) => (
                      <div key={i} className="flex-row space-between text-sm">
                        <span className="flex-row gap-2 truncate"><span className="chart-legend-swatch" style={{ background: s.name === 'Other' ? otherColor(resolvedTheme) : colors[i % colors.length] }} />{s.name}</span>
                        <Money minor={s.amountMinor} currency={data.currency} neutral />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-2">
            <div className="card card-pad">
              <div className="card-title mb-3">Top merchants</div>
              {data.topMerchants.length === 0 ? <p className="text-secondary text-sm">{t('transactions.noTransactions')}</p> : (
                <div className="flex-col gap-2">
                  {data.topMerchants.map((m) => (
                    <div key={m.merchant} className="flex-row space-between text-sm">
                      <span className="truncate">{m.merchant} <span className="text-tertiary">×{m.count}</span></span>
                      <Money minor={m.amountMinor} currency={data.currency} neutral />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card card-pad">
              <div className="card-title mb-3">{t('nav.budgets')}</div>
              {data.budgetPerformance.length === 0 ? <p className="text-secondary text-sm">—</p> : (
                <div className="flex-col gap-3">
                  {data.budgetPerformance.map((b) => (
                    <div key={b.budget.id}>
                      <div className="flex-row space-between text-sm mb-1"><span>{b.budget.name}</span><span className="text-tertiary">{b.percentUsed}%</span></div>
                      <div className="progress-track"><div className={`progress-bar ${b.alertLevel === 'exceeded' ? 'danger' : b.alertLevel === 'warning' ? 'warning' : 'success'}`} style={{ width: `${Math.min(100, b.percentUsed)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
