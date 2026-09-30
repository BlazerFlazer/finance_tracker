import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PiggyBank, Plus, Target, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { GOAL_KINDS } from '@shared/constants';
import { useT, useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { formatDate } from '@shared/dates';

interface GoalWithMetrics {
  goal: { id: string; name: string; kind: string; targetMinor: number; currentMinor: number; currency: string; deadline: string | null; status: string };
  metrics: { progress: number; remainingMinor: number; completed: boolean; daysLeft: number | null; requiredMonthlyMinor: number | null; estimatedCompletion: string | null; status: string };
}

function GoalFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<typeof GOAL_KINDS[number]>('other');
  const [targetMinor, setTargetMinor] = useState<number | null>(null);
  const [deadline, setDeadline] = useState('');
  useEffect(() => { if (open) { setName(''); setKind('other'); setTargetMinor(null); setDeadline(''); } }, [open]);

  const currency = user?.mainCurrency ?? 'USD';
  const mutation = useMutation({
    mutationFn: () => api.post('/api/goals', { name, kind, targetMinor, currency, deadline: deadline || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); show({ kind: 'success', title: t('common.created') }); onClose(); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  return (
    <Modal open={open} onClose={onClose} title={t('common.create')} footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!name || !targetMinor || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}>
      <div className="flex-col gap-4">
        <Field label={t('common.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New laptop" /></Field>
        <Field label={t('common.type')}>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{GOAL_KINDS.map((k) => <option key={k} value={k}>{t(`enums.goalKind.${k}`)}</option>)}</select>
        </Field>
        <Field label="Target amount"><AmountInput minor={targetMinor} currency={currency} onChange={setTargetMinor} /></Field>
        <Field label="Deadline" optional><input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ContributeModal({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: GoalWithMetrics['goal'] | null }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const [minor, setMinor] = useState<number | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  useEffect(() => { if (open) { setMinor(null); setDate(new Date().toISOString().slice(0, 10)); } }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/goals/${goal!.id}/contributions`, { amountMinor: minor, contributedOn: date }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); show({ kind: 'success', title: t('common.saved') }); onClose(); },
  });

  if (!goal) return null;
  return (
    <Modal open={open} onClose={onClose} title={goal.name} footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!minor || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}>
      <div className="flex-col gap-4">
        <Field label="Amount (use a negative number to withdraw)"><AmountInput minor={minor} currency={goal.currency} onChange={setMinor} /></Field>
        <Field label={t('common.date')}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function GoalsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [contributing, setContributing] = useState<GoalWithMetrics['goal'] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['goals'], queryFn: () => api.get<{ goals: GoalWithMetrics[] }>('/api/goals').then((r) => r.goals) });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/goals/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); show({ kind: 'success', title: t('common.deleted') }); },
  });

  return (
    <>
      <PageHeader title={t('nav.goals')} actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> {t('common.create')}</button>} />
      {isLoading ? <SkeletonRows rows={3} height={160} /> : !data || data.length === 0 ? (
        <EmptyState icon={<Target size={22} />} title="No goals yet" description="Set a goal to start tracking progress toward something you're saving for." action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.create')}</button>} />
      ) : (
        <div className="grid grid-cols-3">
          {data.map(({ goal, metrics }) => (
            <div className="card card-pad" key={goal.id}>
              <div className="flex-row space-between">
                <span className="badge badge-neutral">{t(`enums.goalKind.${goal.kind}`)}</span>
                <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setDeleting(goal.id)}><Trash2 size={14} /></button>
              </div>
              <div className="font-semibold mt-2" style={{ fontSize: 16 }}>{goal.name}</div>
              <div className="progress-track mt-3"><div className={`progress-bar ${metrics.completed ? 'success' : metrics.status === 'behind' || metrics.status === 'overdue' ? 'warning' : ''}`} style={{ width: `${Math.round(metrics.progress * 100)}%` }} /></div>
              <div className="flex-row space-between text-sm mt-2">
                <Money minor={goal.currentMinor} currency={goal.currency} neutral />
                <span className="text-tertiary">/ <Money minor={goal.targetMinor} currency={goal.currency} neutral /></span>
              </div>
              {goal.deadline && <div className="text-tertiary text-sm mt-1">{formatDate(goal.deadline, locale, 'medium')}{metrics.requiredMonthlyMinor ? ` · ${(metrics.requiredMonthlyMinor / 100).toFixed(0)} ${goal.currency}/mo needed` : ''}</div>}
              <button className="btn btn-secondary btn-sm btn-block mt-4" onClick={() => setContributing(goal)}><PiggyBank size={14} /> Add contribution</button>
            </div>
          ))}
        </div>
      )}
      <GoalFormModal open={creating} onClose={() => setCreating(false)} />
      <ContributeModal open={!!contributing} goal={contributing} onClose={() => setContributing(null)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && deleteMutation.mutate(deleting)} title={t('common.delete')} description={t('common.confirmDelete')} danger confirmLabel={t('common.delete')} />
    </>
  );
}
