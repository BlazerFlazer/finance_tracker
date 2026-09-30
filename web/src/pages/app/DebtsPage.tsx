import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, Trash2, Wand2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/States';
import { Money, useMoneyFormatter } from '../../components/ui/Money';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ChartTooltipBox } from '../../components/charts/ChartTooltip';
import { DEBT_KINDS } from '@shared/constants';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { categoricalColors } from '../../lib/charts';
import { useTheme } from '../../lib/theme';

interface Debt { id: string; name: string; creditor: string | null; kind: string; currency: string; originalMinor: number; remainingMinor: number; interestRate: number; minPaymentMinor: number; status: string }

function DebtFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<typeof DEBT_KINDS[number]>('loan');
  const [originalMinor, setOriginalMinor] = useState<number | null>(null);
  const [remainingMinor, setRemainingMinor] = useState<number | null>(null);
  const [interestRate, setInterestRate] = useState('0');
  const [minPaymentMinor, setMinPaymentMinor] = useState<number | null>(null);
  useEffect(() => { if (open) { setName(''); setKind('loan'); setOriginalMinor(null); setRemainingMinor(null); setInterestRate('0'); setMinPaymentMinor(null); } }, [open]);

  const currency = user?.mainCurrency ?? 'USD';
  const mutation = useMutation({
    mutationFn: () => api.post('/api/debts', { name, kind, currency, originalMinor, remainingMinor, interestRate: Number(interestRate), minPaymentMinor: minPaymentMinor ?? 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); show({ kind: 'success', title: t('common.created') }); onClose(); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  return (
    <Modal open={open} onClose={onClose} title={t('common.create')} footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!name || !originalMinor || !remainingMinor || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}>
      <div className="flex-col gap-4">
        <Field label={t('common.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('common.type')}><select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{DEBT_KINDS.map((k) => <option key={k} value={k}>{t(`enums.debtKind.${k}`)}</option>)}</select></Field>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Field label="Original amount"><AmountInput minor={originalMinor} currency={currency} onChange={setOriginalMinor} /></Field>
          <Field label="Remaining amount"><AmountInput minor={remainingMinor} currency={currency} onChange={setRemainingMinor} /></Field>
        </div>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Field label="Interest rate (% APR)"><input className="input" type="number" min={0} step={0.1} value={interestRate} onChange={(e) => setInterestRate(e.target.value)} /></Field>
          <Field label="Minimum monthly payment"><AmountInput minor={minPaymentMinor} currency={currency} onChange={setMinPaymentMinor} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function PayoffCalculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { resolvedTheme } = useTheme();
  const money = useMoneyFormatter();
  const colors = categoricalColors(resolvedTheme);
  const [strategy, setStrategy] = useState<'snowball' | 'avalanche' | 'minimum'>('avalanche');
  const [extra, setExtra] = useState<number | null>(0);

  const { data } = useQuery({
    queryKey: ['debts', 'payoff', strategy, extra],
    queryFn: () => api.post<{ results: { currency: string; months: number | null; totalInterestMinor: number; payoffDate: string | null; schedule: { month: number; balanceMinor: number }[] }[] }>('/api/debts/payoff-calculator', { strategy, extraMonthlyMinor: extra ?? 0 }),
    enabled: open,
  });
  const result = data?.results[0];

  return (
    <Modal open={open} onClose={onClose} title="Debt payoff calculator" size="lg">
      <div className="flex-col gap-4">
        <div className="segmented">
          <button className={strategy === 'avalanche' ? 'active' : ''} onClick={() => setStrategy('avalanche')}>Avalanche</button>
          <button className={strategy === 'snowball' ? 'active' : ''} onClick={() => setStrategy('snowball')}>Snowball</button>
          <button className={strategy === 'minimum' ? 'active' : ''} onClick={() => setStrategy('minimum')}>Minimum only</button>
        </div>
        <Field label="Extra payment per month" optional><AmountInput minor={extra} currency={result?.currency ?? 'USD'} onChange={setExtra} /></Field>
        {result && (
          <>
            <div className="grid grid-cols-2">
              <div className="stat-card"><div className="stat-card-label">Payoff time</div><div className="stat-card-value">{result.months ? `${result.months} mo` : '—'}</div></div>
              <div className="stat-card"><div className="stat-card-label">Total interest</div><div className="stat-card-value"><Money minor={result.totalInterestMinor} currency={result.currency} neutral /></div></div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={result.schedule}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={0} />
                <Tooltip content={({ active, payload }) => (!active || !payload?.length ? null : <ChartTooltipBox rows={[{ label: 'Balance', value: money(Number(payload[0]?.value ?? 0), result.currency), color: colors[0] }]} />)} />
                <Line type="monotone" dataKey="balanceMinor" stroke={colors[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
        <p className="text-tertiary text-sm">Estimates only, assuming payments stay the same going forward. Avalanche pays the highest-interest debt first; Snowball pays the smallest balance first.</p>
      </div>
    </Modal>
  );
}

export default function DebtsPage() {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['debts'], queryFn: () => api.get<{ debts: Debt[]; totalRemainingMinor: number }>('/api/debts') });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/debts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); show({ kind: 'success', title: t('common.deleted') }); },
  });

  return (
    <>
      <PageHeader
        title={t('nav.debts')}
        actions={<div className="flex-row gap-2"><button className="btn btn-secondary btn-sm" onClick={() => setCalcOpen(true)}><Wand2 size={14} /> Payoff calculator</button><button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> {t('common.create')}</button></div>}
      />
      {isLoading ? <SkeletonRows rows={3} height={110} /> : !data || data.debts.length === 0 ? (
        <EmptyState icon={<Landmark size={22} />} title="No debts tracked" description="Add a loan or credit card balance to track payoff progress." action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.create')}</button>} />
      ) : (
        <div className="grid grid-cols-2">
          {data.debts.map((d) => (
            <div className="card card-pad" key={d.id}>
              <div className="flex-row space-between">
                <div>
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-tertiary text-sm">{t(`enums.debtKind.${d.kind}`)}{d.creditor ? ` · ${d.creditor}` : ''} · {d.interestRate}% APR</div>
                </div>
                <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setDeleting(d.id)}><Trash2 size={14} /></button>
              </div>
              <div className="progress-track mt-3"><div className="progress-bar" style={{ width: `${Math.round((1 - d.remainingMinor / d.originalMinor) * 100)}%` }} /></div>
              <div className="flex-row space-between text-sm mt-2">
                <Money minor={d.remainingMinor} currency={d.currency} neutral />
                <span className="text-tertiary">/ <Money minor={d.originalMinor} currency={d.currency} neutral /></span>
              </div>
              {d.minPaymentMinor > 0 && <div className="text-tertiary text-sm mt-1">Min payment: <Money minor={d.minPaymentMinor} currency={d.currency} neutral /></div>}
            </div>
          ))}
        </div>
      )}
      <DebtFormModal open={creating} onClose={() => setCreating(false)} />
      <PayoffCalculator open={calcOpen} onClose={() => setCalcOpen(false)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && deleteMutation.mutate(deleting)} title={t('common.delete')} description={t('common.confirmDelete')} danger confirmLabel={t('common.delete')} />
    </>
  );
}
