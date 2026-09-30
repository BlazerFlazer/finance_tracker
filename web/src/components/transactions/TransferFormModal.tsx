import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { AmountInput } from '../ui/AmountInput';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/api';
import { errorToMessageKey, fieldErrorsFrom } from '../../lib/errors';
import { useAccounts } from '../../hooks/api';

const today = () => new Date().toISOString().slice(0, 10);

export function TransferFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [toAmountMinor, setToAmountMinor] = useState<number | null>(null);
  const [occurredOn, setOccurredOn] = useState(today());
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, { key: string }>>({});

  useEffect(() => {
    if (!open) return;
    setFromAccountId(accounts?.[0]?.id ?? '');
    setToAccountId('');
    setAmountMinor(null);
    setToAmountMinor(null);
    setOccurredOn(today());
    setDescription('');
    setFieldErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const from = accounts?.find((a) => a.id === fromAccountId);
  const to = accounts?.find((a) => a.id === toAccountId);
  const sameCurrency = from && to && from.currency === to.currency;

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/api/accounts/transfer', {
        fromAccountId,
        toAccountId,
        amountMinor: amountMinor!,
        toAmountMinor: sameCurrency ? undefined : toAmountMinor!,
        occurredOn,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
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

  const canSubmit = fromAccountId && toAccountId && fromAccountId !== toAccountId && amountMinor && amountMinor > 0 && (sameCurrency || (toAmountMinor && toAmountMinor > 0));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('common.transfer')}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button>
        </>
      }
    >
      <div className="flex-col gap-4">
        <Field label={t('common.from')} error={fieldErrors.fromAccountId && t(fieldErrors.fromAccountId.key)}>
          <select className="select" value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
            {accounts?.filter((a) => !a.isArchived).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        <Field label={t('common.amount')}>
          <AmountInput minor={amountMinor} currency={from?.currency ?? 'USD'} onChange={setAmountMinor} />
        </Field>
        <div className="flex-row" style={{ justifyContent: 'center', color: 'var(--text-tertiary)' }}><ArrowDown size={18} /></div>
        <Field label={t('common.to')} error={fieldErrors.toAccountId && t(fieldErrors.toAccountId.key)}>
          <select className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="">—</option>
            {accounts?.filter((a) => !a.isArchived && a.id !== fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        {to && !sameCurrency && (
          <Field label={`${t('common.amount')} (${to.currency})`}>
            <AmountInput minor={toAmountMinor} currency={to.currency} onChange={setToAmountMinor} />
          </Field>
        )}
        <Field label={t('common.date')}>
          <input className="input" type="date" value={occurredOn} max={today()} onChange={(e) => setOccurredOn(e.target.value)} />
        </Field>
        <Field optional>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('common.description')} />
        </Field>
      </div>
    </Modal>
  );
}
