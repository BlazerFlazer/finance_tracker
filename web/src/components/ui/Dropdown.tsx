import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DropdownProps {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; ref: React.RefObject<HTMLElement | null>; open: boolean }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}

/** A small headless dropdown: renders `trigger`, and on click portals `children` (menu content) near it. */
export function Dropdown({ trigger, children, align = 'start' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = rect.bottom + 6 + window.scrollY;
    const left = align === 'end' ? rect.right + window.scrollX : rect.left + window.scrollX;
    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), ref: triggerRef, open })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu"
            style={{ position: 'absolute', top: pos.top, left: align === 'end' ? undefined : pos.left, right: align === 'end' ? window.innerWidth - pos.left : undefined }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
