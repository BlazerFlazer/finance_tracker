import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Receipt as ReceiptIcon, ScanLine, Upload } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { useAccounts, useCategories, categoryLabel } from '../../hooks/api';

interface Draft { merchant: string; date: string; amountMinor: number | null }

/** Extracts a best-guess merchant/date/total from OCR text. The person always reviews and can correct every field before saving (section 36) — this never auto-submits. */
function parseReceiptText(text: string): Draft {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const merchant = lines[0]?.slice(0, 120) ?? '';
  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  const slashMatch = /\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/.exec(text);
  let date = new Date().toISOString().slice(0, 10);
  if (isoMatch) {
    date = isoMatch[0];
  } else if (slashMatch) {
    const [, a, b, y] = slashMatch;
    let day = Number(a);
    let month = Number(b);
    // Receipts write dates as DD/MM or MM/DD depending on locale — ambiguous without more context, so assume
    // DD/MM (the more common convention for this app's audience) but swap when that's not a valid calendar
    // date and the alternative reading is (e.g. "09/29/2026" can only be month=09, day=29).
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = y!.length === 2 ? `20${y}` : y;
      date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  // The decimal part is required (not optional) so a bare integer — a year, quantity, or receipt/phone
  // number — never gets mistaken for a total; a real currency amount is printed with exactly 2 decimals.
  const amounts = [...text.matchAll(/(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2})/g)].map((m) => m[1]!.replace(/[ ,](?=\d{3})/g, '').replace(',', '.')).map(Number).filter((n) => !Number.isNaN(n) && n > 0);
  const total = amounts.length ? Math.max(...amounts) : null;
  return { merchant, date, amountMinor: total !== null ? Math.round(total * 100) : null };
}

export default function ReceiptsPage() {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories('expense');

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const runOcr = async (picked: File) => {
    setFile(picked);
    setImageUrl(URL.createObjectURL(picked));
    setDraft(null);
    setScanning(true);
    setProgress(0);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        workerPath: '/vendor/tesseract-worker/worker.min.js',
        // An explicit file (not a directory) skips tesseract.js's browser feature-detection, which on a
        // relaxed-SIMD-capable browser picks "tesseract-core-relaxedsimd-lstm.wasm.js" — a variant our
        // installed tesseract.js-core@6 doesn't ship, failing every scan with a worker importScripts error.
        corePath: '/vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js',
        langPath: '/vendor/tesseract-lang',
        logger: (m) => { if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100)); },
      });
      const { data } = await worker.recognize(picked);
      setDraft(parseReceiptText(data.text));
      await worker.terminate();
    } catch (e) {
      show({ kind: 'error', title: 'Could not read this receipt', description: 'You can still fill in the details manually.' });
      setDraft({ merchant: '', date: new Date().toISOString().slice(0, 10), amountMinor: null });
    } finally {
      setScanning(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const tx = await api.post<{ transaction: { id: string } }>('/api/transactions', {
        type: 'expense', accountId, currency: accounts?.find((a) => a.id === accountId)?.currency, amountMinor: draft!.amountMinor, categoryId, merchant: draft!.merchant || undefined, occurredOn: draft!.date,
      });
      if (file) {
        const form = new FormData();
        form.append('file', file);
        form.append('transactionId', tx.transaction.id);
        await api.upload('/api/attachments', form);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      show({ kind: 'success', title: t('common.created') });
      setDraft(null); setImageUrl(null); setFile(null);
    },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  return (
    <>
      <PageHeader title={t('nav.receipts')} subtitle="Scanned entirely in your browser — the image is only uploaded once you save." />
      <div className="grid grid-cols-2">
        <div className="card card-pad" style={{ minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {imageUrl ? (
            <img src={imageUrl} alt="Receipt" style={{ maxHeight: 320, borderRadius: 10, objectFit: 'contain' }} />
          ) : (
            <>
              <ScanLine size={32} color="var(--text-tertiary)" />
              <p className="text-secondary text-sm mt-3">Take a photo or upload a receipt image</p>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && runOcr(e.target.files[0])} />
          <button className="btn btn-primary mt-4" onClick={() => fileRef.current?.click()} disabled={scanning}>
            {scanning ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {scanning ? `${progress}%` : 'Choose image'}
          </button>
        </div>

        <div className="card card-pad">
          <div className="card-title mb-4"><ReceiptIcon size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Review &amp; confirm</div>
          {!draft ? (
            <p className="text-secondary text-sm">Scan a receipt to pre-fill these fields — you can edit anything before saving.</p>
          ) : (
            <div className="flex-col gap-4">
              <Field label="Merchant"><input className="input" value={draft.merchant} onChange={(e) => setDraft({ ...draft, merchant: e.target.value })} /></Field>
              <Field label={t('common.amount')}><AmountInput minor={draft.amountMinor} currency={accounts?.find((a) => a.id === accountId)?.currency ?? 'USD'} onChange={(m) => setDraft({ ...draft, amountMinor: m })} /></Field>
              <Field label={t('common.date')}><input className="input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
              <Field label={t('common.account')}>
                <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">—</option>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </Field>
              <Field label={t('common.category')}>
                <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">—</option>{categories?.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}</select>
              </Field>
              <button className="btn btn-primary btn-block" disabled={!accountId || !categoryId || !draft.amountMinor || saveMutation.isPending} onClick={() => saveMutation.mutate()}>{t('common.save')}</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
