import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CreditCard, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { BILLING_CYCLES } from '@shared/constants';
import { useT, useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { formatDate } from '@shared/dates';

interface Subscription { id: string; name: string; priceMinor: number; currency: string; billingCycle: string; nextPaymentDate: string; status: string; monthlyCostMinor: number; yearlyCostMinor: number; lastUsedOn: string | null }

function SubFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [priceMinor, setPriceMinor] = useState<number | null>(null);
  const [billingCycle, setBillingCycle] = useState<typeof BILLING_CYCLES[number]>('monthly');
  const [nextPaymentDate, setNextPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  useEffect(() => { if (open) { setName(''); setPriceMinor(null); setBillingCycle('monthly'); setNextPaymentDate(new Date().toISOString().slice(0, 10)); } }, [open]);

  const currency = user?.mainCurrency ?? 'USD';
  const mutation = useMutation({
    mutationFn: () => api.post('/api/subscriptions', { name, priceMinor, currency, billingCycle, nextPaymentDate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); show({ kind: 'success', title: t('common.created') }); onClose(); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  return (
    <Modal open={open} onClose={onClose} title={t('common.create')} footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!name || !priceMinor || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}>
      <div className="flex-col gap-4">
        <Field label={t('common.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Netflix" /></Field>
        <Field label="Price"><AmountInput minor={priceMinor} currency={currency} onChange={setPriceMinor} /></Field>
        <Field label="Billing cycle">
          <select className="select" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as typeof billingCycle)}>{BILLING_CYCLES.map((c) => <option key={c} value={c}>{t(`enums.billingCycle.${c}`)}</option>)}</select>
        </Field>
        <Field label="Next payment"><input className="input" type="date" value={nextPaymentDate} onChange={(e) => setNextPaymentDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function SubscriptionsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['subscriptions'], queryFn: () => api.get<{ subscriptions: Subscription[]; totalMonthlyCostMinor: number; totalYearlyCostMinor: number }>('/api/subscriptions') });
  const { data: audit } = useQuery({ queryKey: ['subscriptions', 'audit'], queryFn: () => api.get<{ potentiallyUnused: Subscription[]; highRecurringCost: Subscription[] }>('/api/subscriptions/audit') });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/subscriptions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); show({ kind: 'success', title: t('common.deleted') }); },
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/api/subscriptions/${id}`, { status: 'cancelled' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); show({ kind: 'success', title: t('common.saved') }); },
  });

  const currency = data?.subscriptions[0]?.currency ?? 'USD';

  return (
    <>
      <PageHeader title={t('nav.subscriptions')} subtitle={data && `${(data.totalMonthlyCostMinor / 100).toFixed(0)}/mo · ${(data.totalYearlyCostMinor / 100).toFixed(0)}/yr ${currency}`} actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> {t('common.create')}</button>} />

      {!!audit?.potentiallyUnused.length && (
        <div className="disclaimer-box mb-4">
          <AlertTriangle size={16} />
          <div>
            <strong>Possibly unused:</strong> {audit.potentiallyUnused.map((s) => s.name).join(', ')} — you marked these as last used over 60 days ago.
          </div>
        </div>
      )}

      {isLoading ? <SkeletonRows rows={4} /> : !data || data.subscriptions.length === 0 ? (
        <EmptyState icon={<CreditCard size={22} />} title="No subscriptions" description="Track recurring subscriptions to see their true monthly and yearly cost." action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.create')}</button>} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>{t('common.name')}</th><th>Cycle</th><th>Next payment</th><th className="col-right">Monthly</th><th className="col-right">Yearly</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>
              {data.subscriptions.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-secondary">{t(`enums.billingCycle.${s.billingCycle}`)}</td>
                  <td className="text-secondary">{formatDate(s.nextPaymentDate, locale, 'short')}</td>
                  <td className="col-right col-num"><Money minor={s.monthlyCostMinor} currency={s.currency} neutral /></td>
                  <td className="col-right col-num"><Money minor={s.yearlyCostMinor} currency={s.currency} neutral /></td>
                  <td><span className={`badge ${s.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{s.status}</span></td>
                  <td>
                    <div className="flex-row gap-1">
                      {s.status === 'active' && <button className="btn btn-secondary btn-sm" onClick={() => cancelMutation.mutate(s.id)}>Cancel</button>}
                      <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setDeleting(s.id)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SubFormModal open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && deleteMutation.mutate(deleting)} title={t('common.delete')} description={t('common.confirmDelete')} danger confirmLabel={t('common.delete')} />
    </>
  );
}
