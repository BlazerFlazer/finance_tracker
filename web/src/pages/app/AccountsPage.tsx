import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Archive, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { Dropdown } from '../../components/ui/Dropdown';
import { TransferFormModal } from '../../components/transactions/TransferFormModal';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/api';
import { errorToMessageKey, fieldErrorsFrom } from '../../lib/errors';
import { useAccounts, useCurrencies, type AccountDto } from '../../hooks/api';
import { ACCOUNT_TYPES } from '@shared/constants';

const ACCOUNT_COLORS = ['#6366f1', '#0ea5e9', '#22c55e', '#f97316', '#ec4899', '#a855f7', '#14b8a6', '#64748b'];

function AccountFormModal({ open, onClose, account }: { open: boolean; onClose: () => void; account?: AccountDto | null }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const { data: currencies } = useCurrencies();
  const [name, setName] = useState('');
  const [type, setType] = useState<typeof ACCOUNT_TYPES[number]>('bank');
  const [currency, setCurrency] = useState('USD');
  const [openingBalanceMinor, setOpeningBalanceMinor] = useState<number | null>(0);
  const [institution, setInstitution] = useState('');
  const [color, setColor] = useState(ACCOUNT_COLORS[0]!);
  const [includeInNetWorth, setIncludeInNetWorth] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, { key: string }>>({});

  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? '');
    setType((account?.type as typeof type) ?? 'bank');
    setCurrency(account?.currency ?? 'USD');
    setOpeningBalanceMinor(account?.openingBalanceMinor ?? 0);
    setInstitution(account?.institution ?? '');
    setColor(account?.color ?? ACCOUNT_COLORS[0]!);
    setIncludeInNetWorth(account?.includeInNetWorth ?? true);
    setFieldErrors({});
  }, [open, account?.id]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { name, type, currency, openingBalanceMinor: openingBalanceMinor ?? 0, institution: institution || null, color, includeInNetWorth };
      return account ? api.patch(`/api/accounts/${account.id}`, payload) : api.post('/api/accounts', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      show({ kind: 'success', title: t('common.saved') });
      onClose();
    },
    onError: (e) => {
      setFieldErrors(fieldErrorsFrom(e));
      const { key, params } = errorToMessageKey(e);
      show({ kind: 'error', title: t(key, params) });
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account ? t('common.edit') : t('common.add')}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!name || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}
    >
      <div className="flex-col gap-4">
        <Field label={t('common.name')} error={fieldErrors.name && t(fieldErrors.name.key)}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Field label={t('common.type')}>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {ACCOUNT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`enums.accountType.${ty}`)}</option>)}
            </select>
          </Field>
          <Field label={t('common.currency')}>
            <select className="select" value={currency} disabled={!!account} onChange={(e) => setCurrency(e.target.value)}>
              {(currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Opening balance">
          <AmountInput minor={openingBalanceMinor} currency={currency} onChange={setOpeningBalanceMinor} />
        </Field>
        <Field label="Institution" optional><input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} /></Field>
        <Field label="Color">
          <div className="flex-row gap-2">
            {ACCOUNT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: color === c ? '2px solid var(--text-primary)' : '2px solid transparent' }} aria-label={c} />
            ))}
          </div>
        </Field>
        <label className="checkbox-row"><input type="checkbox" checked={includeInNetWorth} onChange={(e) => setIncludeInNetWorth(e.target.checked)} /><span className="text-sm">Include in net worth</span></label>
      </div>
    </Modal>
  );
}

export default function AccountsPage() {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useAccounts(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountDto | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleting, setDeleting] = useState<AccountDto | null>(null);

  const archiveMutation = useMutation({
    mutationFn: ({ id, isArchived }: { id: string; isArchived: boolean }) => api.patch(`/api/accounts/${id}`, { isArchived }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); show({ kind: 'success', title: t('common.saved') }); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/accounts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); show({ kind: 'success', title: t('common.deleted') }); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  const active = accounts?.filter((a) => !a.isArchived) ?? [];
  const archived = accounts?.filter((a) => a.isArchived) ?? [];

  return (
    <>
      <PageHeader
        title={t('nav.accounts')}
        actions={
          <div className="flex-row gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setTransferOpen(true)}><ArrowLeftRight size={14} /> {t('common.transfer')}</button>
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> {t('common.add')}</button>
          </div>
        }
      />

      {!isLoading && active.length === 0 && (
        <EmptyState icon={<Wallet size={22} />} title="No accounts yet" description="Add your first account to start tracking balances." action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.add')}</button>} />
      )}

      <div className="grid grid-cols-3">
        {active.map((a) => (
          <div className="card card-pad" key={a.id}>
            <div className="flex-row space-between">
              <div className="icon-chip" style={{ background: `${a.color}22`, color: a.color }}><Wallet size={16} /></div>
              <Dropdown align="end" trigger={({ onClick, ref }) => <button ref={ref as React.RefObject<HTMLButtonElement>} className="btn btn-icon btn-ghost btn-sm" onClick={onClick}>⋯</button>}>
                <button className="dropdown-item" onClick={() => setEditing(a)}><Pencil size={14} /> {t('common.edit')}</button>
                <button className="dropdown-item" onClick={() => archiveMutation.mutate({ id: a.id, isArchived: true })}><Archive size={14} /> Archive</button>
                <button className="dropdown-item danger" onClick={() => setDeleting(a)}><Trash2 size={14} /> {t('common.delete')}</button>
              </Dropdown>
            </div>
            <div className="font-semibold mt-3">{a.name}</div>
            <div className="text-tertiary text-sm">{t(`enums.accountType.${a.type}`)}{a.institution ? ` · ${a.institution}` : ''}</div>
            <div style={{ fontSize: 22, fontWeight: 650, marginTop: 10 }}><Money minor={a.balanceMinor} currency={a.currency} /></div>
            {!a.includeInNetWorth && <span className="badge badge-neutral mt-2">Excluded from net worth</span>}
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3">{t('common.archived')}</h3>
          <div className="grid grid-cols-3">
            {archived.map((a) => (
              <div className="card card-pad" key={a.id} style={{ opacity: 0.65 }}>
                <div className="font-semibold">{a.name}</div>
                <div className="text-tertiary text-sm">{t(`enums.accountType.${a.type}`)}</div>
                <div className="flex-row space-between mt-2">
                  <Money minor={a.balanceMinor} currency={a.currency} neutral />
                  <button className="btn btn-secondary btn-sm" onClick={() => archiveMutation.mutate({ id: a.id, isArchived: false })}>Restore</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AccountFormModal open={creating} onClose={() => setCreating(false)} />
      <AccountFormModal open={!!editing} account={editing} onClose={() => setEditing(null)} />
      <TransferFormModal open={transferOpen} onClose={() => setTransferOpen(false)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        title={t('common.delete')}
        description={t('common.confirmDelete')}
        danger
        confirmLabel={t('common.delete')}
      />
    </>
  );
}
