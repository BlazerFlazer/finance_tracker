import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export interface ToastInput {
  title: string;
  description?: string;
  kind?: ToastKind;
  durationMs?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}

interface ToastCtx {
  show: (toast: ToastInput) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

const ICONS: Record<ToastKind, typeof CheckCircle2> = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.durationMs ?? 5000);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {createPortal(
        <div className="toast-region" role="region" aria-label="Notifications">
          {items.map((t) => {
            const Icon = ICONS[t.kind ?? 'info'];
            return (
              <div key={t.id} className={`toast ${t.kind ?? 'info'}`} role="status">
                <span className="toast-icon"><Icon size={18} /></span>
                <div className="toast-body">
                  <div className="toast-title">{t.title}</div>
                  {t.description && <div className="toast-desc">{t.description}</div>}
                </div>
                <button className="btn btn-icon btn-ghost btn-sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
