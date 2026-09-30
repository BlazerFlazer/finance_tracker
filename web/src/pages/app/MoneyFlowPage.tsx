import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock, EmptyState } from '../../components/ui/States';
import { Money, useMoneyFormatter } from '../../components/ui/Money';
import { ChartTooltipBox } from '../../components/charts/ChartTooltip';
import { useT, useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { api } from '../../lib/api';
import { categoricalColors, foldTopCategories, otherColor } from '../../lib/charts';
import { addMonths, monthLabel } from '@shared/dates';

interface MoneyFlow {
  currency: string;
  period: { from: string; to: string };
  income: number;
  expenses: number;
  remaining: number;
  categories: { categoryId: string | null; name: string | null; systemKey: string | null; amountMinor: number; percent: number }[];
  merchants: { merchant: string; amountMinor: number; count: number }[];
}

function FlowBar({ label, value, max, color, currency }: { label: string; value: number; max: number; color: string; currency: string }) {
  const money = useMoneyFormatter();
  return (
    <div className="flex-row gap-3" style={{ alignItems: 'center' }}>
      <span className="text-sm text-secondary truncate" style={{ width: 130 }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--bg-sunken)', borderRadius: 6, height: 28, overflow: 'hidden' }}>
        <div style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: color, height: '100%', borderRadius: 6, transition: 'width .3s' }} />
      </div>
      <span className="text-sm font-medium tabular-nums" style={{ width: 100, textAlign: 'right' }}>{money(value, currency)}</span>
    </div>
  );
}

export default function MoneyFlowPage() {
  const t = useT();
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const money = useMoneyFormatter();
  const colors = categoricalColors(resolvedTheme);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, isLoading } = useQuery({ queryKey: ['money-flow', period], queryFn: () => api.get<MoneyFlow>('/api/money-flow', { period }) });

  const slices = data ? foldTopCategories(data.categories.map((c) => ({ ...c, name: c.name ?? (c.systemKey ? t(`categoryNames.${c.systemKey}`) : t('categoryNames.uncategorized')) })), 7) : [];
  const max = data ? Math.max(data.income, data.expenses) : 0;

  return (
    <>
      <PageHeader
        title={t('nav.moneyFlow')}
        actions={
          <div className="flex-row gap-2">
            <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setPeriod((p) => addMonths(`${p}-01`, -1).slice(0, 7))}><ChevronLeft size={15} /></button>
            <span className="font-semibold" style={{ minWidth: 120, textAlign: 'center' }}>{monthLabel(period, locale, 'long')}</span>
            <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setPeriod((p) => addMonths(`${p}-01`, 1).slice(0, 7))}><ChevronRight size={15} /></button>
          </div>
        }
      />
      {isLoading || !data ? <LoadingBlock height={400} /> : data.income === 0 && data.expenses === 0 ? (
        <EmptyState title={t('transactions.noTransactions')} />
      ) : (
        <div className="grid grid-cols-2">
          <div className="card card-pad">
            <div className="card-title mb-4">{t('common.income')} → {t('common.expenses')} → {t('common.remaining')}</div>
            <div className="flex-col gap-3">
              <FlowBar label={t('common.income')} value={data.income} max={max} color="var(--success)" currency={data.currency} />
              <FlowBar label={t('common.expenses')} value={data.expenses} max={max} color="var(--danger)" currency={data.currency} />
              <FlowBar label={t('common.remaining')} value={Math.max(0, data.remaining)} max={max} color="var(--accent)" currency={data.currency} />
            </div>
            <div className="card-title mt-6 mb-3" style={{ fontSize: 13 }}>Top merchants</div>
            <div className="flex-col gap-2">
              {data.merchants.slice(0, 6).map((m) => (
                <div key={m.merchant} className="flex-row space-between text-sm">
                  <span className="truncate">{m.merchant}</span>
                  <Money minor={m.amountMinor} currency={data.currency} neutral />
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-4">By category</div>
            {slices.length === 0 ? <EmptyState title={t('transactions.noTransactions')} /> : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={slices} dataKey="amountMinor" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="var(--bg-elevated)" strokeWidth={2}>
                      {slices.map((s, i) => <Cell key={i} fill={s.name === 'Other' ? otherColor(resolvedTheme) : colors[i % colors.length]} />)}
                    </Pie>
                    <Tooltip content={({ active, payload }) => (!active || !payload?.length ? null : <ChartTooltipBox rows={[{ label: String(payload[0]?.name), value: money(Number(payload[0]?.value ?? 0), data.currency) }]} />)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-col gap-2 mt-3">
                  {slices.map((s, i) => (
                    <div key={i} className="flex-row space-between text-sm">
                      <span className="flex-row gap-2 truncate"><span className="chart-legend-swatch" style={{ background: s.name === 'Other' ? otherColor(resolvedTheme) : colors[i % colors.length] }} />{s.name}</span>
                      <Money minor={s.amountMinor} currency={data.currency} neutral />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
