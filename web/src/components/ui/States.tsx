import type { ReactNode } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';
import { useT } from '../../lib/i18n';

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon ?? <Inbox size={24} />}</div>
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-desc">{description}</div>}
      {action && <div className="empty-state-actions">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="error-state">
      <AlertCircle size={28} />
      <div>{message ?? t('common.somethingWrong')}</div>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Skeleton({ width, height = 16, radius, style }: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: width ?? '100%', height, borderRadius: radius, ...style }} />;
}

export function SkeletonRows({ rows = 4, height = 52 }: { rows?: number; height?: number }) {
  return (
    <div className="flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} radius={10} />
      ))}
    </div>
  );
}

export function LoadingBlock({ height = 240 }: { height?: number }) {
  return <Skeleton height={height} radius={14} />;
}
