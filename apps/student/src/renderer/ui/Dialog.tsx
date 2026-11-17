import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
  wide?: boolean;
}

/** Modal dialog on the native <dialog>: focus trap, Escape and focus restore come built in. */
export function Dialog({ open, title, onClose, children, actions, wide }: Props) {
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
      className={wide ? "dialog wide" : "dialog"}
      aria-labelledby="dialog-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <h2 id="dialog-title">{title}</h2>
          <div className="dialog-body">{children}</div>
          <div className="dialog-actions">{actions}</div>
        </>
      )}
    </dialog>
  );
}
