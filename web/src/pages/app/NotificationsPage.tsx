import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, CreditCard, Landmark, ShieldAlert, Target, TrendingDown } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingBlock } from '../../components/ui/States';
import { NOTIFICATION_TYPES } from '@shared/constants';
import { useT, useI18n } from '../../lib/i18n';
import { api } from '../../lib/api';
import { formatDate } from '@shared/dates';

interface Notification { id: string; type: string; severity: string; code: string; params: Record<string, unknown>; readAt: string | null; createdAt: string }
interface Pref { type: string; inApp: boolean; email: boolean; push: boolean }

const ICONS: Record<string, typeof Bell> = { upcoming_bill: CalendarClock, subscription_payment: CreditCard, budget_warning: AlertTriangle, goal_progress: Target, unusual_spending: TrendingDown, low_balance: AlertTriangle, debt_payment: Landmark, security_alert: ShieldAlert, monthly_review: Bell };

// Note: kept in English regardless of UI language for now — see docs/QA.md "known simplifications".
function describe(n: Notification): string {
  const p = n.params;
  switch (n.type) {
    case 'upcoming_bill': return `${p.name}`;
    case 'subscription_payment': return `${p.name} — payment due`;
    case 'budget_warning': return `${p.name}: ${p.percentUsed}% used`;
    case 'low_balance': return `${p.name} is running low`;
    case 'unusual_spending': return `Unusual spending at ${p.merchant ?? 'a merchant'}`;
    default: return n.code;
  }
}

export default function NotificationsPage() {
  const t = useT();
  const { locale } = useI18n();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | 'settings'>('all');
  const { data, isLoading } = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api.get<{ items: Notification[] }>('/api/notifications', { pageSize: 50 }).then((r) => r.items) });
  const { data: prefs } = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => api.get<{ items: Pref[] }>('/api/notifications/preferences').then((r) => r.items) });

  const readMutation = useMutation({ mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readAllMutation = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const prefMutation = useMutation({ mutationFn: (items: Pref[]) => api.put('/api/notifications/preferences', { items }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] }) });

  const togglePref = (type: string, channel: 'inApp' | 'email' | 'push') => {
    if (!prefs) return;
    prefMutation.mutate(prefs.map((p) => (p.type === type ? { ...p, [channel]: !p[channel] } : p)));
  };

  return (
    <>
      <PageHeader title={t('nav.notifications')} actions={tab === 'all' && <button className="btn btn-secondary btn-sm" onClick={() => readAllMutation.mutate()}>Mark all read</button>} />
      <div className="tabs mb-4">
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>{t('common.all')}</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>{t('nav.settings')}</button>
      </div>

      {tab === 'all' ? (
        isLoading ? <LoadingBlock height={300} /> : !data || data.length === 0 ? (
          <EmptyState icon={<Bell size={22} />} title="No notifications" />
        ) : (
          <div className="flex-col gap-2">
            {data.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <div key={n.id} className="card card-pad flex-row gap-3" style={{ opacity: n.readAt ? 0.6 : 1, cursor: n.readAt ? 'default' : 'pointer' }} onClick={() => !n.readAt && readMutation.mutate(n.id)}>
                  <div className="icon-chip" style={{ background: n.severity === 'critical' ? 'var(--danger-soft)' : n.severity === 'warning' ? 'var(--warning-soft)' : 'var(--info-soft)', color: n.severity === 'critical' ? 'var(--danger)' : n.severity === 'warning' ? 'var(--warning)' : 'var(--info)' }}><Icon size={15} /></div>
                  <div style={{ flex: 1 }}>
                    <div className="text-sm font-medium">{describe(n)}</div>
                    <div className="text-tertiary text-xs mt-1">{formatDate(n.createdAt.slice(0, 10), locale, 'short')}</div>
                  </div>
                  {!n.readAt && <span className="badge-dot" style={{ background: 'var(--accent)', width: 8, height: 8, borderRadius: '50%' }} />}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>{t('common.type')}</th><th className="text-center">In-app</th><th className="text-center">Email</th></tr></thead>
            <tbody>
              {NOTIFICATION_TYPES.map((type) => {
                const p = prefs?.find((x) => x.type === type);
                return (
                  <tr key={type}>
                    <td>{t(`enums.notificationType.${type}`)}</td>
                    <td className="text-center"><label className="switch"><input type="checkbox" checked={p?.inApp ?? true} onChange={() => togglePref(type, 'inApp')} /><span className="switch-track" /><span className="switch-thumb" /></label></td>
                    <td className="text-center"><label className="switch"><input type="checkbox" checked={p?.email ?? false} onChange={() => togglePref(type, 'email')} /><span className="switch-track" /><span className="switch-thumb" /></label></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
