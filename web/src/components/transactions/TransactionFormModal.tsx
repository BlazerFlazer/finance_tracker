import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { AmountInput } from '../ui/AmountInput';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/api';
import { errorToMessageKey, fieldErrorsFrom } from '../../lib/errors';
import { useAccounts, useCategories, useTags, categoryLabel, type AccountDto } from '../../hooks/api';

export interface TransactionRecord {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  accountId: string;
  currency: string;
  amountMinor: number;
  categoryId: string | null;
  merchant: string | null;
  description: string | null;
  occurredOn: string;
  occurredTime: string | null;
  splits: { categoryId: string; amountMinor: number; note: string | null }[];
  tags: { id: string; name: string }[];
}

interface SplitRow {
  categoryId: string;
  text: string;
  minor: number | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export function TransactionFormModal({
  open,
  onClose,
  initialType = 'expense',
  transaction,
  defaultAccountId,
}: {
  open: boolean;
  onClose: () => void;
  initialType?: 'income' | 'expense';
  transaction?: TransactionRecord | null;
  defaultAccountId?: string;
}) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const [type, setType] = useState<'income' | 'expense'>(transaction?.type === 'income' ? 'income' : initialType);
  const { data: categories } = useCategories(type);
  const { data: tags } = useTags();

  const [accountId, setAccountId] = useState(transaction?.accountId ?? defaultAccountId ?? '');
  const [amountMinor, setAmountMinor] = useState<number | null>(transaction?.amountMinor ?? null);
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [merchant, setMerchant] = useState(transaction?.merchant ?? '');
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [occurredOn, setOccurredOn] = useState(transaction?.occurredOn ?? today());
  const [tagIds, setTagIds] = useState<string[]>(transaction?.tags.map((tg) => tg.id) ?? []);
  const [splitting, setSplitting] = useState((transaction?.splits.length ?? 0) > 0);
  const [splits, setSplits] = useState<SplitRow[]>(
    transaction?.splits.map((s) => ({ categoryId: s.categoryId, text: '', minor: s.amountMinor })) ?? [
      { categoryId: '', text: '', minor: null },
      { categoryId: '', text: '', minor: null },
    ],
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, { key: string }>>({});

  useEffect(() => {
    if (!open) return;
    setType(transaction?.type === 'income' ? 'income' : initialType);
    setAccountId(transaction?.accountId ?? defaultAccountId ?? accounts?.[0]?.id ?? '');
    setAmountMinor(transaction?.amountMinor ?? null);
    setCategoryId(transaction?.categoryId ?? '');
    setMerchant(transaction?.merchant ?? '');
    setDescription(transaction?.description ?? '');
    setOccurredOn(transaction?.occurredOn ?? today());
    setTagIds(transaction?.tags.map((tg) => tg.id) ?? []);
    setSplitting((transaction?.splits.length ?? 0) > 0);
    setSplits(
      transaction?.splits.length
        ? transaction.splits.map((s) => ({ categoryId: s.categoryId, text: '', minor: s.amountMinor }))
        : [{ categoryId: '', text: '', minor: null }, { categoryId: '', text: '', minor: null }],
    );
    setFieldErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id]);

  const account: AccountDto | undefined = accounts?.find((a) => a.id === accountId);
  const currency = account?.currency ?? 'USD';
  const splitTotal = useMemo(() => splits.reduce((s, r) => s + (r.minor ?? 0), 0), [splits]);
  const splitsValid = !splitting || (splits.every((r) => r.categoryId && r.minor !== null && r.minor > 0) && splitTotal === amountMinor);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        type,
        accountId,
        currency,
        amountMinor: amountMinor!,
        categoryId,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
        occurredOn,
        tagIds,
        splits: splitting ? splits.map((r) => ({ categoryId: r.categoryId, amountMinor: r.minor! })) : undefined,
      };
      if (transaction) return api.put(`/api/transactions/${transaction.id}`, payload);
      return api.post('/api/transactions', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      show({ kind: 'success', title: t(transaction ? 'common.updated' : 'common.created') });
      onClose();
    },
    onError: (e) => {
      setFieldErrors(fieldErrorsFrom(e));
      const { key, params } = errorToMessageKey(e);
      show({ kind: 'error', title: t(key, params) });
    },
  });

  const canSubmit = accountId && amountMinor && amountMinor > 0 && categoryId && occurredOn && splitsValid;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={transaction ? t('transactions.editTransaction') : t(type === 'income' ? 'transactions.addIncome' : 'transactions.addExpense')}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="flex-col gap-4">
        {!transaction && (
          <div className="segmented" role="tablist">
            <button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => { setType('expense'); setCategoryId(''); }}>{t('common.expense')}</button>
            <button type="button" className={type === 'income' ? 'active' : ''} onClick={() => { setType('income'); setCategoryId(''); }}>{t('common.income')}</button>
          </div>
        )}

        <Field label={t('common.amount')} error={fieldErrors.amountMinor && t(fieldErrors.amountMinor.key)}>
          <AmountInput minor={amountMinor} currency={currency} onChange={setAmountMinor} invalid={!!fieldErrors.amountMinor} autoFocus />
        </Field>

        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Field label={t('common.account')} error={fieldErrors.accountId && t(fieldErrors.accountId.key)}>
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-invalid={!!fieldErrors.accountId}>
              <option value="" disabled>{t('common.account')}</option>
              {accounts?.filter((a) => !a.isArchived).map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          </Field>
          <Field label={t('common.date')} error={fieldErrors.occurredOn && t(fieldErrors.occurredOn.key)}>
            <input className="input" type="date" value={occurredOn} max={today()} onChange={(e) => setOccurredOn(e.target.value)} />
          </Field>
        </div>

        {!splitting && (
          <Field label={t('common.category')} error={fieldErrors.categoryId && t(fieldErrors.categoryId.key)}>
            <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-invalid={!!fieldErrors.categoryId}>
              <option value="" disabled>{t('common.category')}</option>
              {categories?.filter((c) => !c.isArchived).map((c) => (
                <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t('common.description')} optional>
          <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={type === 'expense' ? 'Netflix, Trader Joe’s…' : 'Acme Corp…'} />
        </Field>
        <Field optional>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('common.notes')} rows={2} />
        </Field>

        {type === 'expense' && (
          <label className="checkbox-row">
            <input type="checkbox" checked={splitting} onChange={(e) => setSplitting(e.target.checked)} />
            <span className="text-sm">{t('transactions.splitToggle')}</span>
          </label>
        )}

        {splitting && (
          <div className="flex-col gap-2">
            {splits.map((row, i) => (
              <div key={i} className="flex-row gap-2">
                <select className="select" value={row.categoryId} onChange={(e) => setSplits((s) => s.map((r, j) => (j === i ? { ...r, categoryId: e.target.value } : r)))}>
                  <option value="" disabled>{t('common.category')}</option>
                  {categories?.filter((c) => !c.isArchived).map((c) => (
                    <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>
                  ))}
                </select>
                <div style={{ width: 130 }}>
                  <AmountInput minor={row.minor} currency={currency} onChange={(m) => setSplits((s) => s.map((r, j) => (j === i ? { ...r, minor: m } : r)))} />
                </div>
                <button type="button" className="btn btn-icon btn-ghost btn-sm" onClick={() => setSplits((s) => s.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSplits((s) => [...s, { categoryId: '', text: '', minor: null }])}>
              <Plus size={14} /> {t('transactions.splitAddPart')}
            </button>
            <div className="text-sm" style={{ color: splitTotal === amountMinor ? 'var(--success)' : 'var(--danger)' }}>
              {(splitTotal / 100).toFixed(2)} / {amountMinor ? (amountMinor / 100).toFixed(2) : '0.00'} {currency}
            </div>
          </div>
        )}

        {!!tags?.length && (
          <Field label={t('common.tags')} optional>
            <div className="flex-row wrap gap-2">
              {tags.map((tag) => {
                const active = tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={active ? 'badge badge-brand' : 'badge badge-neutral'}
                    onClick={() => setTagIds((ids) => (active ? ids.filter((id) => id !== tag.id) : [...ids, tag.id]))}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
