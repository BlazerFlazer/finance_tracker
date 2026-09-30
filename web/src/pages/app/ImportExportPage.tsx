import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Field } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/States';
import { useT, useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api, downloadFile } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { useAccounts, useCategories, categoryLabel } from '../../hooks/api';
import { parseMoneyInput } from '@shared/money';
import { formatDate } from '@shared/dates';

interface ParsedRow {
  raw: Record<string, string>;
  occurredOn: string | null;
  amountMinor: number | null;
  type: 'income' | 'expense';
  merchant: string;
  categoryText: string;
  categoryId: string;
  isDuplicate: boolean;
  skip: boolean;
}

export default function ImportExportPage() {
  const t = useT();
  const { locale } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: accounts } = useAccounts();
  const { data: expenseCats } = useCategories('expense');
  const { data: incomeCats } = useCategories('income');

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState({ date: '', amount: '', type: '', merchant: '', category: '' });
  const [accountId, setAccountId] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);

  const { data: batches } = useQuery({ queryKey: ['import', 'batches'], queryFn: () => api.get<{ batches: { id: string; filename: string | null; importedRows: number; status: string; createdAt: string }[] }>('/api/import/batches').then((r) => r.batches) });

  const handleFile = (file: File) => {
    import('papaparse').then(({ default: Papa }) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          setHeaders(result.meta.fields ?? []);
          setRows(result.data);
          setParsed(null);
          const guess = (keys: string[]) => result.meta.fields?.find((f) => keys.some((k) => f.toLowerCase().includes(k))) ?? '';
          setMapping({ date: guess(['date']), amount: guess(['amount', 'sum']), type: guess(['type']), merchant: guess(['merchant', 'description', 'payee']), category: guess(['category']) });
        },
      });
    });
  };

  const account = accounts?.find((a) => a.id === accountId);

  const buildPreview = async () => {
    if (!account || !mapping.date || !mapping.amount) return;
    const draft: ParsedRow[] = rows.map((r) => {
      const dateRaw = r[mapping.date]?.trim() ?? '';
      const iso = /^\d{4}-\d{2}-\d{2}/.test(dateRaw) ? dateRaw.slice(0, 10) : (() => {
        const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(dateRaw);
        if (!m) return null;
        const year = m[3]!.length === 2 ? `20${m[3]}` : m[3];
        return `${year}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
      })();
      const amountText = r[mapping.amount] ?? '';
      const parsedAmount = parseMoneyInput(amountText, account.currency, locale);
      const typeRaw = mapping.type ? r[mapping.type]?.toLowerCase() : '';
      const type: 'income' | 'expense' = typeRaw?.includes('income') || typeRaw?.includes('доход') ? 'income' : typeRaw?.includes('expense') || typeRaw?.includes('расход') ? 'expense' : parsedAmount.ok && parsedAmount.minor < 0 ? 'expense' : 'income';
      return {
        raw: r,
        occurredOn: iso,
        amountMinor: parsedAmount.ok ? Math.abs(parsedAmount.minor) : null,
        type,
        merchant: mapping.merchant ? (r[mapping.merchant] ?? '') : '',
        categoryText: mapping.category ? (r[mapping.category] ?? '') : '',
        categoryId: '',
        isDuplicate: false,
        skip: false,
      };
    });

    const dupCheck = await api.post<{ duplicateIndexes: number[] }>('/api/import/detect-duplicates', {
      rows: draft.filter((d) => d.occurredOn && d.amountMinor).map((d) => ({ occurredOn: d.occurredOn, amountMinor: d.type === 'expense' ? d.amountMinor : d.amountMinor, merchant: d.merchant })),
    }).catch(() => ({ duplicateIndexes: [] }));
    const dupSet = new Set(dupCheck.duplicateIndexes);
    draft.forEach((d, i) => { if (dupSet.has(i)) { d.isDuplicate = true; d.skip = true; } });
    setParsed(draft);
  };

  const categoryTextOptions = useMemo(() => [...new Set((parsed ?? []).map((p) => p.categoryText).filter(Boolean))], [parsed]);
  const [categoryTextMap, setCategoryTextMap] = useState<Record<string, string>>({});

  const commitMutation = useMutation({
    mutationFn: () => {
      const finalRows = (parsed ?? [])
        .filter((p) => !p.skip && p.occurredOn && p.amountMinor)
        .map((p) => ({
          accountId,
          type: p.type,
          amountMinor: p.amountMinor!,
          currency: account!.currency,
          categoryId: categoryTextMap[p.categoryText] || p.categoryId,
          occurredOn: p.occurredOn!,
          merchant: p.merchant || undefined,
        }));
      return api.post<{ imported: number }>('/api/import/commit', { rows: finalRows });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['import', 'batches'] });
      show({ kind: 'success', title: `${res.imported} ${t('nav.transactions').toLowerCase()} imported` });
      setParsed(null); setRows([]); setHeaders([]);
    },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  const undoMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/import/batches/${id}/undo`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['import', 'batches'] }); qc.invalidateQueries({ queryKey: ['transactions'] }); show({ kind: 'success', title: t('common.done') }); },
  });

  const allCategoriesMapped = parsed?.filter((p) => !p.skip).every((p) => p.categoryId || categoryTextMap[p.categoryText]) ?? false;

  return (
    <>
      <PageHeader title={t('nav.importExport')} />

      <div className="card card-pad mb-4">
        <div className="card-title mb-3"><Download size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Export</div>
        <div className="flex-row gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => downloadFile('/api/export/transactions.csv', {}, 'transactions.csv')}>CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={() => downloadFile('/api/export/transactions.xlsx', {}, 'transactions.xlsx')}>Excel</button>
        </div>
      </div>

      <div className="card card-pad mb-4">
        <div className="card-title mb-3"><Upload size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Import from CSV</div>
        {headers.length === 0 ? (
          <>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}><FileSpreadsheet size={15} /> Choose CSV file</button>
          </>
        ) : !parsed ? (
          <div className="flex-col gap-4">
            <Field label={t('common.account')}>
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">—</option>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select>
            </Field>
            <div className="grid grid-cols-2" style={{ gap: 12 }}>
              {(['date', 'amount', 'type', 'merchant', 'category'] as const).map((field) => (
                <Field key={field} label={field} optional={field === 'type' || field === 'merchant' || field === 'category'}>
                  <select className="select" value={mapping[field]} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}>
                    <option value="">—</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <p className="text-tertiary text-sm">{rows.length} rows detected.</p>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!accountId || !mapping.date || !mapping.amount} onClick={buildPreview}>{t('common.next')}</button>
          </div>
        ) : (
          <div className="flex-col gap-4">
            {categoryTextOptions.length > 0 && (
              <div>
                <div className="font-medium text-sm mb-2">Map categories</div>
                <div className="flex-col gap-2">
                  {categoryTextOptions.map((txt) => (
                    <div key={txt} className="flex-row gap-2">
                      <span className="text-sm" style={{ width: 160 }}>{txt}</span>
                      <select className="select" value={categoryTextMap[txt] ?? ''} onChange={(e) => setCategoryTextMap((m) => ({ ...m, [txt]: e.target.value }))}>
                        <option value="">—</option>
                        {[...(expenseCats ?? []), ...(incomeCats ?? [])].map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="data-table">
                <thead><tr><th /><th>{t('common.date')}</th><th>{t('common.description')}</th><th>{t('common.type')}</th><th className="col-right">{t('common.amount')}</th><th>{t('common.category')}</th></tr></thead>
                <tbody>
                  {parsed.map((p, i) => (
                    <tr key={i} style={{ opacity: p.skip ? 0.5 : 1 }}>
                      <td><input type="checkbox" checked={!p.skip} onChange={(e) => setParsed((arr) => arr!.map((x, j) => (j === i ? { ...x, skip: !e.target.checked } : x)))} /></td>
                      <td>{p.occurredOn ? formatDate(p.occurredOn, locale, 'short') : <span className="text-danger">invalid</span>}</td>
                      <td className="truncate" style={{ maxWidth: 160 }}>{p.merchant || '—'}{p.isDuplicate && <span className="badge badge-warning" style={{ marginLeft: 6 }}><AlertTriangle size={10} /> dup</span>}</td>
                      <td>{t(`enums.transactionType.${p.type}`)}</td>
                      <td className="col-right">{p.amountMinor !== null ? (p.amountMinor / 100).toFixed(2) : <span className="text-danger">invalid</span>}</td>
                      <td>
                        <select className="select input-sm" value={categoryTextMap[p.categoryText] || p.categoryId} onChange={(e) => setParsed((arr) => arr!.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}>
                          <option value="">—</option>
                          {(p.type === 'income' ? incomeCats : expenseCats)?.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex-row gap-2">
              <button className="btn btn-ghost" onClick={() => { setParsed(null); setHeaders([]); setRows([]); }}>{t('common.cancel')}</button>
              <button className="btn btn-primary" disabled={!allCategoriesMapped || commitMutation.isPending} onClick={() => commitMutation.mutate()}>
                Import {parsed.filter((p) => !p.skip).length} rows
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="card-title mb-3">Import history</div>
        {!batches || batches.length === 0 ? <EmptyState title="No imports yet" /> : (
          <div className="flex-col gap-2">
            {batches.map((b) => (
              <div key={b.id} className="flex-row space-between text-sm">
                <span>{b.filename ?? 'Import'} · {b.importedRows} rows · {formatDate(b.createdAt.slice(0, 10), locale, 'short')}</span>
                {b.status === 'completed' ? <button className="btn btn-ghost btn-sm" onClick={() => undoMutation.mutate(b.id)}><RotateCcw size={13} /> Undo</button> : <span className="badge badge-neutral">Undone</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
