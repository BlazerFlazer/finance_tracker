import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Info } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock, EmptyState } from '../../components/ui/States';
import { Money, useMoneyFormatter } from '../../components/ui/Money';
import { ChartCard, ChartTooltipBox } from '../../components/charts/ChartTooltip';
import { useT, useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { api } from '../../lib/api';
import { categoricalColors } from '../../lib/charts';
import { formatDate } from '@shared/dates';

type Forecast =
  | { insufficientData: true }
  | { insufficientData: false; horizonDays: number; currentBalanceMinor: number; expectedIncomeMinor: number; expectedExpensesMinor: number; expectedSavingsMinor: number; expectedBalanceMinor: number; series: { date: string; balanceMinor: number }[] };

const HORIZONS = [30, 60, 90, 180, 365];

export default function ForecastPage() {
  const t = useT();
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const money = useMoneyFormatter();
  const colors = categoricalColors(resolvedTheme);
  const [horizon, setHorizon] = useState(90);
  const { data, isLoading } = useQuery({ queryKey: ['forecast', horizon], queryFn: () => api.get<{ forecast: Forecast; currency: string }>('/api/forecast', { horizonDays: horizon }) });

  return (
    <>
      <PageHeader title={t('nav.forecast')} actions={<div className="segmented">{HORIZONS.map((h) => <button key={h} className={horizon === h ? 'active' : ''} onClick={() => setHorizon(h)}>{h}d</button>)}</div>} />
      <div className="disclaimer-box mb-4"><Info size={15} /> {t('common.disclaimer')}</div>
      {isLoading || !data ? <LoadingBlock height={360} /> : data.forecast.insufficientData ? (
        <EmptyState title="Not enough data for a reliable forecast." description="Add more transactions over time to unlock a forecast." />
      ) : (
        <>
          <div className="grid grid-cols-3 mb-4">
            <div className="stat-card card card-pad"><div className="stat-card-label">Expected income</div><div className="stat-card-value"><Money minor={data.forecast.expectedIncomeMinor} currency={data.currency} neutral /></div></div>
            <div className="stat-card card card-pad"><div className="stat-card-label">Expected expenses</div><div className="stat-card-value"><Money minor={data.forecast.expectedExpensesMinor} currency={data.currency} neutral /></div></div>
            <div className="stat-card card card-pad"><div className="stat-card-label">Expected balance</div><div className="stat-card-value"><Money minor={data.forecast.expectedBalanceMinor} currency={data.currency} /></div></div>
          </div>
          <ChartCard title="Projected balance" subtitle={`Next ${horizon} days, estimate only`}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.forecast.series}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, locale, 'dayMonth')} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={0} />
                <Tooltip content={({ active, payload, label }) => (!active || !payload?.length ? null : (
                  <ChartTooltipBox title={formatDate(String(label), locale, 'medium')} rows={[{ label: t('common.balance'), value: money(Number(payload[0]?.value ?? 0), data.currency), color: colors[0] }]} />
                ))} />
                <Line type="monotone" dataKey="balanceMinor" stroke={colors[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </>
  );
}
