import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { useT } from '../../lib/i18n';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  // Deliberately loose: call sites are typically `() => x && mutation.mutate(x)`, whose inferred return
  // includes the falsy branch's type (null/''/etc). We only ever call and optionally await the result.
  onConfirm: () => unknown;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={handleConfirm} disabled={busy}>
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="text-secondary" style={{ fontSize: 13.5 }}>
        {description}
      </p>
    </Modal>
  );
}
