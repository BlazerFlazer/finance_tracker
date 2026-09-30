import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/States';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/Field';
import { Dropdown } from '../../components/ui/Dropdown';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { api, ApiError } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { useCategories, categoryLabel, type CategoryDto } from '../../hooks/api';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b'];
const ICONS = ['Tag', 'Utensils', 'Car', 'ShoppingBag', 'Clapperboard', 'GraduationCap', 'HeartPulse', 'Receipt', 'Home', 'Plane', 'Repeat', 'Laptop', 'Users', 'Dumbbell', 'Coffee', 'Gift'];

function CategoryFormModal({ open, onClose, category, kind, parentId, categories }: { open: boolean; onClose: () => void; category?: CategoryDto | null; kind: 'expense' | 'income'; parentId?: string | null; categories: CategoryDto[] }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('Tag');
  const [color, setColor] = useState(COLORS[0]!);
  const [parent, setParent] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setIcon(category?.icon ?? 'Tag');
    setColor(category?.color ?? COLORS[0]!);
    setParent(category?.parentId ?? parentId ?? '');
  }, [open, category?.id, parentId]);

  const mutation = useMutation({
    mutationFn: () => {
      if (category) return api.patch(`/api/categories/${category.id}`, { name, icon, color });
      return api.post('/api/categories', { name, icon, color, kind, parentId: parent || null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); show({ kind: 'success', title: t('common.saved') }); onClose(); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  const topLevel = categories.filter((c) => c.kind === kind && !c.parentId && c.id !== category?.id);

  return (
    <Modal open={open} onClose={onClose} title={category ? t('common.edit') : t('common.add')} footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!name || mutation.isPending} onClick={() => mutation.mutate()}>{t('common.save')}</button></>}>
      <div className="flex-col gap-4">
        <Field label={t('common.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!category && (
          <Field label="Parent category" optional>
            <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">— {t('common.none')} —</option>
              {topLevel.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Color">
          <div className="flex-row gap-2 wrap">
            {COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: color === c ? '2px solid var(--text-primary)' : '2px solid transparent' }} aria-label={c} />)}
          </div>
        </Field>
        <Field label="Icon">
          <div className="flex-row gap-2 wrap">
            {ICONS.map((ic) => <button key={ic} type="button" className={`badge ${icon === ic ? 'badge-brand' : 'badge-neutral'}`} onClick={() => setIcon(ic)}>{ic}</button>)}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function CategoryList({ kind, categories }: { kind: 'expense' | 'income'; categories: CategoryDto[] }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState<string | null | false>(false);
  const [editing, setEditing] = useState<CategoryDto | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); show({ kind: 'success', title: t('common.deleted') }); },
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      show({ kind: 'error', title: t(key, params), description: e instanceof ApiError && e.code === 'CATEGORY_IN_USE' ? 'Reassign its transactions to another category first.' : undefined });
    },
  });

  const top = categories.filter((c) => c.kind === kind && !c.parentId && !c.isArchived);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id && !c.isArchived);

  if (top.length === 0) return <EmptyState icon={<Tag size={22} />} title="No categories" action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(null)}>{t('common.add')}</button>} />;

  return (
    <div className="flex-col gap-2">
      {top.map((cat) => (
        <div className="card card-pad" key={cat.id}>
          <div className="flex-row space-between">
            <div className="flex-row gap-3">
              <div className="icon-chip" style={{ background: `${cat.color}22`, color: cat.color }}><Tag size={15} /></div>
              <div>
                <div className="font-semibold">{categoryLabel(cat, t)}</div>
                <div className="text-tertiary text-sm">{cat.transactionCount} transactions</div>
              </div>
            </div>
            <div className="flex-row gap-1">
              <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setCreating(cat.id)} aria-label={t('common.add')}><Plus size={14} /></button>
              <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setEditing(cat)} aria-label={t('common.edit')}><Pencil size={14} /></button>
              <button className="btn btn-icon btn-ghost btn-sm" onClick={() => deleteMutation.mutate(cat.id)} aria-label={t('common.delete')}><Trash2 size={14} /></button>
            </div>
          </div>
          {childrenOf(cat.id).length > 0 && (
            <div className="flex-col gap-2 mt-3" style={{ paddingLeft: 20, borderLeft: '2px solid var(--border)', marginLeft: 20 }}>
              {childrenOf(cat.id).map((child) => (
                <div key={child.id} className="flex-row space-between text-sm">
                  <span className="flex-row gap-2"><span className="chart-legend-swatch" style={{ background: child.color }} />{categoryLabel(child, t)}<span className="text-tertiary">({child.transactionCount})</span></span>
                  <div className="flex-row gap-1">
                    <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setEditing(child)}><Pencil size={13} /></button>
                    <button className="btn btn-icon btn-ghost btn-sm" onClick={() => deleteMutation.mutate(child.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <CategoryFormModal open={creating !== false} onClose={() => setCreating(false)} kind={kind} parentId={creating || null} categories={categories} />
      <CategoryFormModal open={!!editing} onClose={() => setEditing(null)} category={editing} kind={kind} categories={categories} />
    </div>
  );
}

export default function CategoriesPage() {
  const t = useT();
  const [tab, setTab] = useState<'expense' | 'income'>('expense');
  const [creating, setCreating] = useState(false);
  const { data: categories, isLoading } = useCategories(undefined, true);

  return (
    <>
      <PageHeader title={t('nav.categories')} actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> {t('common.add')}</button>} />
      <div className="tabs mb-4">
        <button className={`tab ${tab === 'expense' ? 'active' : ''}`} onClick={() => setTab('expense')}>{t('common.expense')}</button>
        <button className={`tab ${tab === 'income' ? 'active' : ''}`} onClick={() => setTab('income')}>{t('common.income')}</button>
      </div>
      {!isLoading && categories && <CategoryList kind={tab} categories={categories} />}
      <CategoryFormModal open={creating} onClose={() => setCreating(false)} kind={tab} categories={categories ?? []} />
    </>
  );
}
