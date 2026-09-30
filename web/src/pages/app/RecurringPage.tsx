import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Repeat, SkipForward, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { FREQUENCIES, TRANSACTION_TYPES } from '@shared/constants';
import { useT, useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { useAccounts, useCategories, categoryLabel } from '../../hooks/api';
import { formatDate } from '@shared/dates';

interface Recurring { id: string; name: string; type: string; accountId: string; accountName: string; currency: string; amountMinor: number; categoryId: string | null; frequency: string; intervalCount: number; nextDueDate: string | null; isActive: boolean }

function RecurringFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const [type, setType] = useState<typeof TRANSACTION_TYPES[number]>('expense');
  const { data: categories } = useCategories(type === 'income' ? 'income' : 'expense');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [frequency, setFrequency] = useState<typeof FREQUENCIES[number]>('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => { if (open) { setType('expense'); setName(''); setAccountId(accounts?.[0]?.id ?? ''); setAmountMinor(null); setCategoryId(''); setFrequency('monthly'); setStartDate(new Date().toISOString().slice(0, 10)); } }, [open, accounts]);

  const account = accounts?.find((a) => a.id === accountId);
  const mutation = useMutation({
    mutationFn: () => api.post('/api/recurring', { name, type, accountId, currency: account?.currency ?? 'USD', amountMinor, categoryId, frequency, intervalCount: 1, startDate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); show({ kind: 'success', title: t('common.created') }); onClose(); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  return (
    <Modal open={open} onClose={onClose} title={t('common.create')} footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!name || !accountId || !amountMinor || !categoryId || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}>
      <div className="flex-col gap-4">
        <div className="segmented"><button className={type === 'expense' ? 'active' : ''} onClick={() => { setType('expense'); setCategoryId(''); }}>{t('common.expense')}</button><button className={type === 'income' ? 'active' : ''} onClick={() => { setType('income'); setCategoryId(''); }}>{t('common.income')}</button></div>
        <Field label={t('common.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, salary…" /></Field>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Field label={t('common.account')}>
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
          <Field label={t('common.amount')}><AmountInput minor={amountMinor} currency={account?.currency ?? 'USD'} onChange={setAmountMinor} /></Field>
        </div>
        <Field label={t('common.category')}>
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('common.category')}</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Field label="Frequency"><select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>{FREQUENCIES.map((f) => <option key={f} value={f}>{t(`enums.frequency.${f}`)}</option>)}</select></Field>
          <Field label="Start date"><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

export default function RecurringPage() {
  const t = useT();
  const { locale } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['recurring'], queryFn: () => api.get<{ recurring: Recurring[] }>('/api/recurring', { includeInactive: true }).then((r) => r.recurring) });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/recurring/${id}/confirm`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); show({ kind: 'success', title: t('common.created') }); },
  });
  const skipMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/recurring/${id}/skip`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); show({ kind: 'success', title: t('common.saved') }); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/recurring/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); show({ kind: 'success', title: t('common.deleted') }); },
  });

  return (
    <>
      <PageHeader title={t('nav.recurring')} actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> {t('common.create')}</button>} />
      {isLoading ? <SkeletonRows rows={5} /> : !data || data.length === 0 ? (
        <EmptyState icon={<Repeat size={22} />} title="No recurring items" description="Add rent, salary, or any regular payment to track upcoming activity." action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.create')}</button>} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>{t('common.name')}</th><th>{t('common.account')}</th><th>{t('common.type')}</th><th className="col-right">{t('common.amount')}</th><th>Next due</th><th /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.55 }}>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-secondary">{r.accountName}</td>
                  <td><span className="badge badge-neutral">{t(`enums.transactionType.${r.type}`)}</span></td>
                  <td className="col-right col-num"><Money minor={r.amountMinor} currency={r.currency} neutral /></td>
                  <td className="text-secondary">{r.nextDueDate ? formatDate(r.nextDueDate, locale, 'short') : '—'}</td>
                  <td>
                    <div className="flex-row gap-1">
                      {r.isActive && r.nextDueDate && (
                        <>
                          <button className="btn btn-icon btn-ghost btn-sm" onClick={() => confirmMutation.mutate(r.id)} aria-label={t('common.confirm')}><Check size={14} /></button>
                          <button className="btn btn-icon btn-ghost btn-sm" onClick={() => skipMutation.mutate(r.id)} aria-label="Skip"><SkipForward size={14} /></button>
                        </>
                      )}
                      <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setDeleting(r.id)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecurringFormModal open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && deleteMutation.mutate(deleting)} title={t('common.delete')} description={t('common.confirmDelete')} danger confirmLabel={t('common.delete')} />
    </>
  );
}
