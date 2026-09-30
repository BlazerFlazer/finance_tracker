import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock, EmptyState } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { useT, useI18n } from '../../lib/i18n';
import { downloadFile, api } from '../../lib/api';
import { monthLabel } from '@shared/dates';

interface Report {
  period: string; currency: string; incomeMinor: number; expensesMinor: number; savingsMinor: number; savingsRate: number;
  budgetPerformance: { name: string; percentUsed: number; alertLevel: string }[];
  goalsProgress: { name: string; progress: number; status: string }[];
}

export default function ReportsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { data: periods } = useQuery({ queryKey: ['reports', 'periods'], queryFn: () => api.get<{ periods: string[] }>('/api/reports').then((r) => r.periods) });
  const [selected, setSelected] = useState<string | null>(null);
  const period = selected ?? periods?.[0] ?? null;
  const { data: report, isLoading } = useQuery({ queryKey: ['reports', period], queryFn: () => api.get<{ report: Report }>(`/api/reports/${period}`).then((r) => r.report), enabled: !!period });

  return (
    <>
      <PageHeader title={t('nav.reports')} actions={period && <button className="btn btn-primary btn-sm" onClick={() => downloadFile(`/api/reports/${period}/pdf`, {}, `fintrack-report-${period}.pdf`)}><Download size={14} /> PDF</button>} />
      <div className="grid grid-cols-4" style={{ gap: 20 }}>
        <div className="card card-pad">
          <div className="card-title mb-3">Periods</div>
          <div className="flex-col gap-1">
            {periods?.map((p) => (
              <button key={p} className={`sidebar-link ${p === period ? 'active' : ''}`} onClick={() => setSelected(p)}>{monthLabel(p, locale, 'long')}</button>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: 'span 3' }}>
          {isLoading || !report ? <LoadingBlock height={320} /> : (
            <div className="card card-pad">
              <h2 className="mb-4">{monthLabel(report.period, locale, 'long')}</h2>
              <div className="grid grid-cols-3 mb-4">
                <div><div className="stat-card-label">{t('common.income')}</div><div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={report.incomeMinor} currency={report.currency} neutral /></div></div>
                <div><div className="stat-card-label">{t('common.expenses')}</div><div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={report.expensesMinor} currency={report.currency} neutral /></div></div>
                <div><div className="stat-card-label">{t('common.savings')}</div><div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={report.savingsMinor} currency={report.currency} /></div></div>
              </div>
              <div className="divider mb-4" />
              <div className="grid grid-cols-2">
                <div>
                  <div className="font-medium text-sm mb-2">{t('nav.budgets')}</div>
                  {report.budgetPerformance.length === 0 ? <p className="text-tertiary text-sm">—</p> : report.budgetPerformance.map((b) => <div key={b.name} className="flex-row space-between text-sm mb-1"><span>{b.name}</span><span>{b.percentUsed}%</span></div>)}
                </div>
                <div>
                  <div className="font-medium text-sm mb-2">{t('nav.goals')}</div>
                  {report.goalsProgress.length === 0 ? <p className="text-tertiary text-sm">—</p> : report.goalsProgress.map((g) => <div key={g.name} className="flex-row space-between text-sm mb-1"><span>{g.name}</span><span>{g.progress}%</span></div>)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {!periods?.length && <EmptyState icon={<FileText size={22} />} title="No reports yet" />}
    </>
  );
}
