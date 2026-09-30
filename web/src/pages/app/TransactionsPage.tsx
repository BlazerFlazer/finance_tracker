import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Pencil, Receipt, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dropdown } from '../../components/ui/Dropdown';
import { TransactionFormModal, type TransactionRecord } from '../../components/transactions/TransactionFormModal';
import { useT, useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api, downloadFile } from '../../lib/api';
import { useAccounts, useCategories, categoryLabel } from '../../hooks/api';
import { formatDate } from '@shared/dates';

interface TxListResponse {
  transactions: (TransactionRecord & { accountName: string; categoryName: string | null; categorySystemKey?: string | null })[];
  total: number;
  page: number;
  pageSize: number;
}

export default function TransactionsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<TransactionRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const query = { page, pageSize: 25, search: search || undefined, type: type || undefined, accountId: accountId || undefined, categoryId: categoryId || undefined, sort: 'date_desc' as const };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['transactions', query],
    queryFn: () => api.get<TxListResponse>('/api/transactions', query as never),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      show({ kind: 'success', title: t('common.deleted') });
    },
  });
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/transactions/${id}/duplicate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      show({ kind: 'success', title: t('common.created') });
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = !!(search || type || accountId || categoryId);

  return (
    <>
      <PageHeader
        title={t('nav.transactions')}
        actions={
          <div className="flex-row gap-2">
            <Dropdown
              align="end"
              trigger={({ onClick, ref }) => (
                <button ref={ref as React.RefObject<HTMLButtonElement>} className="btn btn-secondary btn-sm" onClick={onClick}><Download size={14} /> {t('common.download')}</button>
              )}
            >
              <button className="dropdown-item" onClick={() => downloadFile('/api/export/transactions.csv', query as never, 'transactions.csv')}>CSV</button>
              <button className="dropdown-item" onClick={() => downloadFile('/api/export/transactions.xlsx', query as never, 'transactions.xlsx')}>Excel</button>
            </Dropdown>
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.add')}</button>
          </div>
        }
      />

      <div className="card card-pad mb-4">
        <div className="flex-row gap-2 wrap">
          <div className="input-group" style={{ flex: 1, minWidth: 200 }}>
            <span className="input-group-icon"><Search size={14} /></span>
            <input className="input" placeholder={t('common.search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className={`btn btn-sm ${showFilters ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal size={14} /> {t('common.filters')}
          </button>
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setType(''); setAccountId(''); setCategoryId(''); setPage(1); }}>
              {t('transactions.filters.clearAll')}
            </button>
          )}
        </div>
        {showFilters && (
          <div className="flex-row gap-2 wrap mt-3">
            <select className="select input-sm" style={{ width: 150 }} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">{t('transactions.filters.type')}</option>
              <option value="income">{t('common.income')}</option>
              <option value="expense">{t('common.expense')}</option>
              <option value="transfer">{t('common.transfer')}</option>
            </select>
            <select className="select input-sm" style={{ width: 170 }} value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(1); }}>
              <option value="">{t('transactions.filters.account')}</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="select input-sm" style={{ width: 170 }} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
              <option value="">{t('transactions.filters.category')}</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <SkeletonRows rows={8} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.transactions.length === 0 ? (
        <EmptyState icon={<Receipt size={22} />} title={t('transactions.noTransactions')} description={t('transactions.noTransactionsDesc')} action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('common.add')}</button>} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.description')}</th>
                <th>{t('common.category')}</th>
                <th>{t('common.account')}</th>
                <th className="col-right">{t('common.amount')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((tx) => (
                <tr key={tx.id} className="is-clickable" onClick={() => setEditing(tx)}>
                  <td className="text-secondary">{formatDate(tx.occurredOn, locale, 'short')}</td>
                  <td>
                    <div className="font-medium truncate" style={{ maxWidth: 260 }}>{tx.merchant || tx.description || '—'}</div>
                    {!!tx.tags.length && <div className="flex-row gap-1 mt-1">{tx.tags.map((tg) => <span key={tg.id} className="badge badge-neutral">{tg.name}</span>)}</div>}
                  </td>
                  <td>{tx.splits.length > 0 ? `${tx.splits.length} categories` : categoryLabel({ name: tx.categoryName, systemKey: tx.categorySystemKey ?? null }, t)}</td>
                  <td className="text-secondary">{tx.accountName}</td>
                  <td className="col-right col-num">
                    <Money minor={tx.type === 'expense' ? -tx.amountMinor : tx.amountMinor} currency={tx.currency} sign="always" />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      align="end"
                      trigger={({ onClick, ref }) => <button ref={ref as React.RefObject<HTMLButtonElement>} className="btn btn-icon btn-ghost btn-sm" onClick={onClick}>⋯</button>}
                    >
                      <button className="dropdown-item" onClick={() => setEditing(tx)}><Pencil size={14} /> {t('common.edit')}</button>
                      <button className="dropdown-item" onClick={() => duplicateMutation.mutate(tx.id)}><Copy size={14} /> {t('transactions.duplicate')}</button>
                      <button className="dropdown-item danger" onClick={() => setDeleting(tx.id)}><Trash2 size={14} /> {t('common.delete')}</button>
                    </Dropdown>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="flex-row space-between mt-4">
          <span className="text-secondary text-sm">{t('common.pageOf', { page, pages: totalPages })}</span>
          <div className="flex-row gap-2">
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('common.back')}</button>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</button>
          </div>
        </div>
      )}

      <TransactionFormModal open={creating} onClose={() => setCreating(false)} />
      <TransactionFormModal open={!!editing} transaction={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title={t('common.delete')}
        description={t('common.confirmDelete')}
        danger
        confirmLabel={t('common.delete')}
      />
    </>
  );
}
