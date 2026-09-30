import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ShieldAlert, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock } from '../../components/ui/States';
import { Dropdown } from '../../components/ui/Dropdown';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

interface Stats { totalUsers: number; activeUsers: number; newUsers: number; totalTransactions: number; securityEventsBySeverity: { severity: string; n: number }[]; system: { database: string; env: string; uptimeSeconds: number } }
interface AdminUser { id: string; email: string; username: string; role: string; status: string; isDemo: boolean; emailVerifiedAt: string | null; createdAt: string; lastLoginAt: string | null }

export default function AdminPage() {
  const t = useT();
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'stats' | 'users' | 'events'>('stats');
  const [search, setSearch] = useState('');

  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.get<Stats>('/api/admin/stats') });
  const { data: users } = useQuery({ queryKey: ['admin', 'users', search], queryFn: () => api.get<{ items: AdminUser[] }>('/api/admin/users', { search: search || undefined, pageSize: 30 }).then((r) => r.items), enabled: tab === 'users' });
  const { data: events } = useQuery({ queryKey: ['admin', 'events'], queryFn: () => api.get<{ items: { id: string; type: string; severity: string; createdAt: string }[] }>('/api/admin/security-events', { pageSize: 30 }).then((r) => r.items), enabled: tab === 'events' });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/users/${id}/suspend`, { reason: 'Suspended by admin' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'users'] }); show({ kind: 'success', title: t('common.saved') }); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });
  const unsuspendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/users/${id}/unsuspend`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'users'] }); show({ kind: 'success', title: t('common.saved') }); },
  });

  if (user?.role !== 'admin') return <PageHeader title={t('errors.FORBIDDEN')} />;

  if (statsError) {
    return (
      <>
        <PageHeader title={t('nav.admin')} />
        <div className="disclaimer-box"><ShieldAlert size={15} /> Admin access requires two-factor authentication to be enabled on your account (if configured by the server).</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('nav.admin')} />
      <div className="tabs mb-4">
        <button className={`tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>Overview</button>
        <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</button>
        <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>Security events</button>
      </div>

      {tab === 'stats' && (statsLoading || !stats ? <LoadingBlock height={200} /> : (
        <div className="grid grid-cols-4">
          <div className="stat-card card card-pad"><div className="stat-card-label"><Users size={13} /> Total users</div><div className="stat-card-value">{stats.totalUsers}</div></div>
          <div className="stat-card card card-pad"><div className="stat-card-label">Active (30d)</div><div className="stat-card-value">{stats.activeUsers}</div></div>
          <div className="stat-card card card-pad"><div className="stat-card-label">New (7d)</div><div className="stat-card-value">{stats.newUsers}</div></div>
          <div className="stat-card card card-pad"><div className="stat-card-label"><Activity size={13} /> Transactions</div><div className="stat-card-value">{stats.totalTransactions}</div></div>
          <div className="card card-pad" style={{ gridColumn: 'span 4' }}>
            <div className="card-title mb-2">System</div>
            <div className="text-sm text-secondary">Database: {stats.system.database} · Env: {stats.system.env} · Uptime: {Math.round(stats.system.uptimeSeconds / 60)} min</div>
          </div>
        </div>
      ))}

      {tab === 'users' && (
        <>
          <input className="input mb-3" style={{ maxWidth: 320 }} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Email</th><th>Username</th><th>Role</th><th>{t('common.status')}</th><th /></tr></thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}{u.isDemo && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>demo</span>}</td>
                    <td className="text-secondary">{u.username}</td>
                    <td><span className="badge badge-neutral">{u.role}</span></td>
                    <td><span className={`badge ${u.status === 'active' ? 'badge-success' : 'badge-danger'}`}>{u.status}</span></td>
                    <td>
                      <Dropdown align="end" trigger={({ onClick, ref }) => <button ref={ref as React.RefObject<HTMLButtonElement>} className="btn btn-icon btn-ghost btn-sm" onClick={onClick}>⋯</button>}>
                        {u.status === 'active' ? <button className="dropdown-item danger" onClick={() => suspendMutation.mutate(u.id)}>Suspend</button> : <button className="dropdown-item" onClick={() => unsuspendMutation.mutate(u.id)}>Unsuspend</button>}
                      </Dropdown>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'events' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Type</th><th>Severity</th><th>{t('common.date')}</th></tr></thead>
            <tbody>{events?.map((e) => <tr key={e.id}><td>{e.type}</td><td><span className={`badge ${e.severity === 'critical' ? 'badge-danger' : e.severity === 'warning' ? 'badge-warning' : 'badge-neutral'}`}>{e.severity}</span></td><td className="text-secondary">{e.createdAt.slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
