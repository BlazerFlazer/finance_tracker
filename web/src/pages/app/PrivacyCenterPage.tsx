import { useQuery } from '@tanstack/react-query';
import { Database, Download, LockKeyhole, ShieldOff } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock } from '../../components/ui/States';
import { useT } from '../../lib/i18n';
import { downloadFile, api } from '../../lib/api';

interface PrivacyOverview { dataCounts: Record<string, number>; accountDeletionGraceDays: number; storesBankPasswords: boolean }

// Keys match what the `Db` layer produces — every column comes back camelCased regardless of how the SQL aliased it.
const LABELS: Record<string, string> = { transactions: 'Transactions', accounts: 'Accounts', categories: 'Categories', budgets: 'Budgets', goals: 'Goals', subscriptions: 'Subscriptions', debts: 'Debts', journalEntries: 'Journal entries', attachments: 'Attachments', securityEvents: 'Security events' };

export default function PrivacyCenterPage() {
  const t = useT();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['privacy', 'overview'], queryFn: () => api.get<PrivacyOverview>('/api/privacy/overview') });

  return (
    <>
      <PageHeader title={t('nav.privacy')} />
      {isLoading || !data ? <LoadingBlock height={300} /> : (
        <div className="flex-col gap-4">
          <div className="disclaimer-box"><LockKeyhole size={15} /> FinTrack never stores your online banking password or card PIN. {data.storesBankPasswords === false && 'Confirmed for your account.'}</div>

          <div className="card card-pad">
            <div className="card-title mb-3"><Database size={15} style={{ marginRight: 6, verticalAlign: -2 }} />What's stored</div>
            <div className="grid grid-cols-3">
              {Object.entries(data.dataCounts).map(([key, count]) => (
                <div key={key} className="flex-row space-between text-sm" style={{ padding: '6px 0' }}>
                  <span className="text-secondary">{LABELS[key] ?? key}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-2">Download your data</div>
            <p className="text-secondary text-sm mb-3">Get a complete copy of everything FinTrack stores for your account, as a JSON file.</p>
            <button className="btn btn-secondary" onClick={() => downloadFile('/api/privacy/export', {}, 'fintrack-data.json')}><Download size={15} /> Download my data</button>
          </div>

          <div className="card card-pad" style={{ borderColor: 'var(--danger-soft-border)' }}>
            <div className="card-title mb-2 text-danger"><ShieldOff size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Delete your data</div>
            <p className="text-secondary text-sm mb-3">Deleting your account removes all your financial data after a {data.accountDeletionGraceDays}-day grace period (or immediately, if you choose). Manage this from Security Center.</p>
            <button className="btn btn-danger-ghost" onClick={() => nav('/app/security')}>Go to Security Center</button>
          </div>
        </div>
      )}
    </>
  );
}
