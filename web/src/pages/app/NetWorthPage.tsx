import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock } from '../../components/ui/States';
import { Money, useMoneyFormatter } from '../../components/ui/Money';
import { ChartCard, ChartTooltipBox } from '../../components/charts/ChartTooltip';
import { useT, useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { api } from '../../lib/api';
import { categoricalColors } from '../../lib/charts';
import { monthLabel } from '@shared/dates';

interface NetWorthResponse {
  currency: string;
  current: { assets: { cash: number; bank: number; savings: number; investments: number; other: number; total: number }; liabilities: { creditCards: number; loans: number; otherDebt: number; total: number }; netWorth: number };
  history: { month: string; accountsMinor: number; debtsMinor: number; netWorthMinor: number }[];
}

export default function NetWorthPage() {
  const t = useT();
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const money = useMoneyFormatter();
  const colors = categoricalColors(resolvedTheme);
  const { data, isLoading } = useQuery({ queryKey: ['networth'], queryFn: () => api.get<NetWorthResponse>('/api/networth', { months: 12 }) });

  return (
    <>
      <PageHeader title={t('nav.netWorth')} subtitle="Assets minus liabilities." />
      {isLoading || !data ? <LoadingBlock height={400} /> : (
        <>
          <div className="grid grid-cols-3 mb-4">
            <div className="stat-card card card-pad"><div className="stat-card-label">Assets</div><div className="stat-card-value text-success"><Money minor={data.current.assets.total} currency={data.currency} neutral /></div></div>
            <div className="stat-card card card-pad"><div className="stat-card-label">Liabilities</div><div className="stat-card-value text-danger"><Money minor={data.current.liabilities.total} currency={data.currency} neutral /></div></div>
            <div className="stat-card card card-pad"><div className="stat-card-label">{t('nav.netWorth')}</div><div className="stat-card-value"><Money minor={data.current.netWorth} currency={data.currency} /></div></div>
          </div>

          <ChartCard title="Net worth over time" subtitle="Last 12 months">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.history}>
                <defs>
                  <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors[0]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={colors[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m, locale)} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={0} />
                <Tooltip content={({ active, payload, label }) => (!active || !payload?.length ? null : (
                  <ChartTooltipBox title={monthLabel(String(label), locale)} rows={[{ label: t('nav.netWorth'), value: money(Number(payload[0]?.value ?? 0), data.currency), color: colors[0] }]} />
                ))} />
                <Area type="monotone" dataKey="netWorthMinor" stroke={colors[0]} strokeWidth={2} fill="url(#nwFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-2 mt-4">
            <div className="card card-pad">
              <div className="card-title mb-3">Assets</div>
              {(['cash', 'bank', 'savings', 'investments', 'other'] as const).map((k) => (
                <div key={k} className="flex-row space-between text-sm mb-2"><span className="text-secondary" style={{ textTransform: 'capitalize' }}>{k}</span><Money minor={data.current.assets[k]} currency={data.currency} neutral /></div>
              ))}
            </div>
            <div className="card card-pad">
              <div className="card-title mb-3">Liabilities</div>
              <div className="flex-row space-between text-sm mb-2"><span className="text-secondary">Credit cards</span><Money minor={data.current.liabilities.creditCards} currency={data.currency} neutral /></div>
              <div className="flex-row space-between text-sm mb-2"><span className="text-secondary">Loans &amp; debts</span><Money minor={data.current.liabilities.loans} currency={data.currency} neutral /></div>
              <div className="flex-row space-between text-sm mb-2"><span className="text-secondary">Other</span><Money minor={data.current.liabilities.otherDebt} currency={data.currency} neutral /></div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
