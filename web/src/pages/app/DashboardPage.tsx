import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { CalendarClock, CreditCard, PiggyBank, Sparkles, Target, TrendingUp, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatCard } from '../../components/ui/StatCard';
import { Money, useMoneyFormatter } from '../../components/ui/Money';
import { EmptyState, LoadingBlock } from '../../components/ui/States';
import { ChartCard, ChartTooltipBox, Legend } from '../../components/charts/ChartTooltip';
import { QuickAddButton, useQuickAddModals } from '../../components/layout/QuickAdd';
import { useT, useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { api } from '../../lib/api';
import { categoricalColors, foldTopCategories, otherColor } from '../../lib/charts';
import { monthLabel, formatDate } from '@shared/dates';
import { formatPercent } from '@shared/money';

interface DashboardData {
  currency: string;
  netWorth: { assets: { total: number }; liabilities: { total: number }; netWorth: number };
  netWorthTrend: { month: string; accountsMinor: number; netWorthMinor: number }[];
  totalBalanceMinor: number;
  monthlyIncomeMinor: number;
  monthlyExpensesMinor: number;
  monthlySavingsMinor: number;
  savingsRate: number;
  previousMonth: { incomeMinor: number; expenseMinor: number; netMinor: number } | null;
  spendingByCategory: { categoryId: string | null; name: string | null; systemKey: string | null; amountMinor: number; percent: number }[];
  budgets: { budget: { id: string; name: string; currency: string }; percentUsed: number; totalBudgetedMinor: number; totalSpentMinor: number; alertLevel: string }[];
  goals: { goal: { id: string; name: string; targetMinor: number; currentMinor: number; currency: string }; metrics: { progress: number; status: string } }[];
  activeSubscriptions: { id: string; name: string; priceMinor: number; currency: string; nextPaymentDate: string }[];
  debtRemainingMinor: number;
  upcomingBills: { id: string; name: string; amountMinor: number; currency: string; nextDueDate: string; source: string }[];
  incomeExpenseHistory: { month: string; incomeMinor: number; expenseMinor: number; netMinor: number }[];
}

export default function DashboardPage() {
  const t = useT();
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const money = useMoneyFormatter();
  const quickAdd = useQuickAddModals();
  const colors = categoricalColors(resolvedTheme);

  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/api/dashboard') });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <div className="grid grid-cols-3 mb-4">{Array.from({ length: 6 }).map((_, i) => <LoadingBlock key={i} height={92} />)}</div>
        <LoadingBlock height={320} />
      </>
    );
  }

  const income = data.previousMonth?.incomeMinor;
  const incomeDelta = income ? Math.round(((data.monthlyIncomeMinor - income) / Math.max(1, income)) * 100) : null;
  const expensePrev = data.previousMonth?.expenseMinor;
  const expenseDelta = expensePrev ? Math.round(((data.monthlyExpensesMinor - expensePrev) / Math.max(1, expensePrev)) * 100) : null;

  const categorySlices = foldTopCategories(
    data.spendingByCategory.map((c) => ({ ...c, name: c.name ?? (c.systemKey ? t(`categoryNames.${c.systemKey}`) : t('categoryNames.uncategorized')) })),
    7,
  );

  return (
    <>
      <PageHeader
        title={t('nav.dashboard')}
        actions={
          <div className="flex-row gap-2">
            <QuickAddButton open={quickAdd.open} />
          </div>
        }
      />

      <div className="grid grid-cols-3 mb-4" style={{ gap: 12 }}>
        <StatCard label={t('common.balance')} value={<Money minor={data.totalBalanceMinor} currency={data.currency} />} icon={<Wallet size={14} />} />
        <StatCard label={t('nav.netWorth')} value={<Money minor={data.netWorth.netWorth} currency={data.currency} />} icon={<TrendingUp size={14} />} />
        <StatCard
          label={t('common.income')}
          value={<Money minor={data.monthlyIncomeMinor} currency={data.currency} neutral />}
          delta={incomeDelta !== null ? { positive: incomeDelta >= 0, text: `${incomeDelta >= 0 ? '+' : ''}${incomeDelta}%` } : null}
        />
        <StatCard
          label={t('common.expenses')}
          value={<Money minor={data.monthlyExpensesMinor} currency={data.currency} neutral />}
          delta={expenseDelta !== null ? { positive: expenseDelta <= 0, text: `${expenseDelta >= 0 ? '+' : ''}${expenseDelta}%` } : null}
          icon={<CreditCard size={14} />}
        />
        <StatCard label={t('common.savings')} value={<Money minor={data.monthlySavingsMinor} currency={data.currency} />} icon={<PiggyBank size={14} />} />
        <StatCard label="Savings rate" value={formatPercent(data.savingsRate, locale)} icon={<Sparkles size={14} />} />
      </div>

      <div className="grid grid-cols-2 mb-4">
        <ChartCard title={`${t('common.income')} vs ${t('common.expenses')}`}>
          {data.incomeExpenseHistory.every((h) => h.incomeMinor === 0 && h.expenseMinor === 0) ? (
            <EmptyState title={t('transactions.noTransactions')} description={t('transactions.noTransactionsDesc')} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.incomeExpenseHistory} barGap={2}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m, locale)} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={0} />
                <Tooltip content={({ active, payload, label }) => (!active || !payload?.length ? null : (
                  <ChartTooltipBox title={monthLabel(String(label), locale)} rows={[
                    { label: t('common.income'), value: money(Number(payload[0]?.payload.incomeMinor ?? 0), data.currency), color: colors[0] },
                    { label: t('common.expenses'), value: money(Number(payload[0]?.payload.expenseMinor ?? 0), data.currency), color: colors[1] },
                  ]} />
                ))} cursor={{ fill: 'var(--bg-hover)' }} />
                <Bar dataKey="incomeMinor" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={16} />
                <Bar dataKey="expenseMinor" fill={colors[1]} radius={[4, 4, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <Legend items={[{ label: t('common.income'), color: colors[0]! }, { label: t('common.expenses'), color: colors[1]! }]} />
        </ChartCard>

        <ChartCard title={t('common.balance')} subtitle="Last 12 months">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.netWorthTrend}>
              <defs>
                <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors[0]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={colors[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m, locale)} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={0} />
              <Tooltip content={({ active, payload, label }) => (!active || !payload?.length ? null : (
                <ChartTooltipBox title={monthLabel(String(label), locale)} rows={[{ label: t('common.balance'), value: money(Number(payload[0]?.value ?? 0), data.currency), color: colors[0] }]} />
              ))} />
              <Area type="monotone" dataKey="accountsMinor" stroke={colors[0]} strokeWidth={2} fill="url(#balanceFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 mb-4">
        <ChartCard title="Spending by category" actions={<Link to="/app/analytics" className="link text-sm">{t('common.viewAll')}</Link>}>
          {categorySlices.length === 0 ? (
            <EmptyState title={t('transactions.noTransactions')} />
          ) : (
            <div className="flex-row gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={categorySlices} dataKey="amountMinor" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="var(--bg-elevated)" strokeWidth={2}>
                    {categorySlices.map((slice, i) => (
                      <Cell key={i} fill={slice.name === 'Other' ? otherColor(resolvedTheme) : colors[i % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={({ active, payload }) => (!active || !payload?.length ? null : (
                    <ChartTooltipBox rows={[{ label: String(payload[0]?.name), value: money(Number(payload[0]?.value ?? 0), data.currency) }]} />
                  ))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-col gap-2" style={{ flex: 1, justifyContent: 'center' }}>
                {categorySlices.slice(0, 5).map((s, i) => (
                  <div key={i} className="flex-row space-between text-sm">
                    <span className="flex-row gap-2"><span className="chart-legend-swatch" style={{ background: s.name === 'Other' ? otherColor(resolvedTheme) : colors[i % colors.length] }} />{s.name}</span>
                    <Money minor={s.amountMinor} currency={data.currency} neutral />
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        <div className="flex-col gap-4">
          <div className="card card-pad">
            <div className="card-title mb-3"><CalendarClock size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Upcoming payments</div>
            {data.upcomingBills.length === 0 ? (
              <p className="text-secondary text-sm">Nothing due in the next 14 days.</p>
            ) : (
              <div className="flex-col gap-2">
                {data.upcomingBills.map((b) => (
                  <div key={`${b.source}-${b.id}`} className="flex-row space-between text-sm">
                    <span className="truncate">{b.name}</span>
                    <span className="flex-row gap-2">
                      <span className="text-tertiary">{formatDate(b.nextDueDate, locale, 'dayMonth')}</span>
                      <Money minor={b.amountMinor} currency={b.currency} neutral />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card card-pad">
            <div className="card-title mb-3"><Target size={15} style={{ marginRight: 6, verticalAlign: -2 }} />{t('nav.goals')}</div>
            {data.goals.length === 0 ? (
              <EmptyState title={t('common.notAvailable')} action={<Link to="/app/goals" className="btn btn-secondary btn-sm">{t('common.create')}</Link>} />
            ) : (
              <div className="flex-col gap-3">
                {data.goals.slice(0, 4).map((g) => (
                  <div key={g.goal.id}>
                    <div className="flex-row space-between text-sm mb-1"><span className="truncate">{g.goal.name}</span><span className="text-tertiary">{Math.round(g.metrics.progress * 100)}%</span></div>
                    <div className="progress-track"><div className="progress-bar success" style={{ width: `${Math.round(g.metrics.progress * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {quickAdd.modals}
    </>
  );
}
