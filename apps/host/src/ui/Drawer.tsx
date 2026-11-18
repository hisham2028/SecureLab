import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Sticky footer, usually Cancel + primary action. */
  footer?: ReactNode;
}

/** Slide-over built on <dialog>: focus is trapped, Esc closes, focus returns to the opener. */
export function Drawer({ open, title, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className="drawer-inner">
          <header className="drawer-header">
            <h2 id="drawer-title">{title}</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
            >
              ×
            </button>
          </header>
          <div className="drawer-body">{children}</div>
          {footer && <footer className="drawer-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
