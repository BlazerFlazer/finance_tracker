import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PiggyBank, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { BUDGET_PERIODS } from '@shared/constants';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { useAuth } from '../../lib/auth';
import { useCategories, categoryLabel } from '../../hooks/api';

interface BudgetItemProgress { categoryId: string; categoryName: string | null; categorySystemKey: string | null; budgetedMinor: number; spentMinor: number; percentUsed: number }
interface BudgetProgress {
  budget: { id: string; name: string; period: string; currency: string; noticePct: number; warningPct: number; isActive: boolean };
  items: BudgetItemProgress[];
  totalBudgetedMinor: number; totalSpentMinor: number; totalRemainingMinor: number; percentUsed: number; alertLevel: string;
}

const alertBadge = (level: string) => (level === 'exceeded' ? 'badge-danger' : level === 'warning' ? 'badge-warning' : level === 'notice' ? 'badge-info' : 'badge-success');

function BudgetFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: categories } = useCategories('expense');
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<typeof BUDGET_PERIODS[number]>('monthly');
  const [items, setItems] = useState<{ categoryId: string; minor: number | null }[]>([{ categoryId: '', minor: null }]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPeriod('monthly');
    setItems([{ categoryId: '', minor: null }]);
  }, [open]);

  const currency = user?.mainCurrency ?? 'USD';
  const mutation = useMutation({
    mutationFn: () => api.post('/api/budgets', { name, period, currency, items: items.filter((i) => i.categoryId && i.minor).map((i) => ({ categoryId: i.categoryId, amountMinor: i.minor })) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budgets'] }); show({ kind: 'success', title: t('common.created') }); onClose(); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  const valid = name && period && items.some((i) => i.categoryId && i.minor);

  return (
    <Modal open={open} onClose={onClose} title={t('common.create')} footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}>
      <div className="flex-col gap-4">
        <Field label={t('common.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Period">
          <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            {BUDGET_PERIODS.map((p) => <option key={p} value={p}>{t(`enums.budgetPeriod.${p}`)}</option>)}
          </select>
        </Field>
        <Field label={t('nav.categories')}>
          <div className="flex-col gap-2">
            {items.map((item, i) => (
              <div key={i} className="flex-row gap-2">
                <select className="select" value={item.categoryId} onChange={(e) => setItems((s) => s.map((r, j) => (j === i ? { ...r, categoryId: e.target.value } : r)))}>
                  <option value="">{t('common.category')}</option>
                  {categories?.filter((c) => !c.isArchived).map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
                </select>
                <div style={{ width: 130 }}><AmountInput minor={item.minor} currency={currency} onChange={(m) => setItems((s) => s.map((r, j) => (j === i ? { ...r, minor: m } : r)))} /></div>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setItems((s) => [...s, { categoryId: '', minor: null }])}><Plus size={14} /> {t('common.add')}</button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export default function BudgetsPage() {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['budgets'], queryFn: () => api.get<{ budgets: BudgetProgress[] }>('/api/budgets').then((r) => r.budgets) });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/budgets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budgets'] }); show({ kind: 'success', title: t('common.deleted') }); },
  });

  return (
    <>
      <PageHeader title={t('nav.budgets')} actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> {t('common.create')}</button>} />
      {isLoading ? <SkeletonRows rows={3} height={140} /> : !data || data.length === 0 ? (
        <EmptyState icon={<PiggyBank size={22} />} title="No budgets yet" description="Create a budget to keep an eye on your spending by category." action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.create')}</button>} />
      ) : (
        <div className="grid grid-cols-2">
          {data.map((b) => (
            <div className="card card-pad" key={b.budget.id}>
              <div className="flex-row space-between">
                <div>
                  <div className="font-semibold">{b.budget.name}</div>
                  <div className="text-tertiary text-sm">{t(`enums.budgetPeriod.${b.budget.period}`)}</div>
                </div>
                <div className="flex-row gap-2">
                  <span className={`badge ${alertBadge(b.alertLevel)}`}>{b.percentUsed}%</span>
                  <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setDeleting(b.budget.id)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="progress-track mt-3"><div className={`progress-bar ${b.alertLevel === 'exceeded' ? 'danger' : b.alertLevel === 'warning' ? 'warning' : 'success'}`} style={{ width: `${Math.min(100, b.percentUsed)}%` }} /></div>
              <div className="flex-row space-between text-sm mt-2">
                <span className="text-secondary"><Money minor={b.totalSpentMinor} currency={b.budget.currency} neutral /> {t('common.spent').toLowerCase()}</span>
                <span className="text-secondary"><Money minor={Math.max(0, b.totalRemainingMinor)} currency={b.budget.currency} neutral /> {t('common.remaining').toLowerCase()}</span>
              </div>
              <div className="flex-col gap-2 mt-4">
                {b.items.map((item) => (
                  <div key={item.categoryId} className="flex-row space-between text-sm">
                    <span className="truncate">{item.categoryName ?? (item.categorySystemKey ? t(`categoryNames.${item.categorySystemKey}`) : '—')}</span>
                    <span className="text-tertiary"><Money minor={item.spentMinor} currency={b.budget.currency} neutral /> / <Money minor={item.budgetedMinor} currency={b.budget.currency} neutral /></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <BudgetFormModal open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && deleteMutation.mutate(deleting)} title={t('common.delete')} description={t('common.confirmDelete')} danger confirmLabel={t('common.delete')} />
    </>
  );
}
