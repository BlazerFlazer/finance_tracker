import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Lock, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingBlock } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useT, useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api } from '../../lib/api';
import { formatDate } from '@shared/dates';

interface JournalEntry { id: string; content: string; mood: number | null; createdAt: string }

const PROMPTS = ['Why did I spend more this month?', 'What financial goal am I working toward?', 'Why did I save less?'];

export default function JournalPage() {
  const t = useT();
  const { locale } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [content, setContent] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['journal'], queryFn: () => api.get<{ entries: JournalEntry[] }>('/api/journal').then((r) => r.entries) });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/journal', { content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journal'] }); setContent(''); show({ kind: 'success', title: t('common.saved') }); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/journal/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journal'] }); show({ kind: 'success', title: t('common.deleted') }); },
  });

  return (
    <>
      <PageHeader title={t('nav.journal')} subtitle="Private notes only you can see." />
      <div className="card card-pad mb-4">
        <div className="flex-row wrap gap-2 mb-3">
          {PROMPTS.map((p) => <button key={p} className="badge badge-neutral" onClick={() => setContent((c) => (c ? c : `${p}\n\n`))}>{p}</button>)}
        </div>
        <textarea className="textarea" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write freely…" />
        <button className="btn btn-primary mt-3" disabled={!content.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}><Plus size={14} /> {t('common.add')}</button>
      </div>

      {isLoading ? <LoadingBlock height={200} /> : !data || data.length === 0 ? (
        <EmptyState icon={<BookOpen size={22} />} title="No entries yet" />
      ) : (
        <div className="flex-col gap-3">
          {data.map((e) => (
            <div key={e.id} className="card card-pad">
              <div className="flex-row space-between mb-2">
                <span className="text-tertiary text-sm flex-row gap-1"><Lock size={11} /> {formatDate(e.createdAt.slice(0, 10), locale, 'long')}</span>
                <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setDeleting(e.id)}><Trash2 size={13} /></button>
              </div>
              <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{e.content}</p>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && deleteMutation.mutate(deleting)} title={t('common.delete')} description={t('common.confirmDelete')} danger confirmLabel={t('common.delete')} />
    </>
  );
}
