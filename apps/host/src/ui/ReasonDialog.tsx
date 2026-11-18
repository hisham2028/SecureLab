import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ErrorBanner } from "./bits";

interface Props {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Destructive actions also require typing this (e.g. the student ID). */
  requireText?: string;
  /** Extra fields shown above the reason. */
  children?: ReactNode;
  reasonLabel?: string;
  reasonOptional?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Asks why before an action that changes a student's exam. The reason goes to the audit log.
 * Errors from the server stay in the dialog so the typed reason isn't lost.
 */
export function ReasonDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  requireText,
  children,
  reasonLabel = "Reason",
  reasonOptional,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setReason("");
      setTyped("");
      setError(null);
      setTouched(false);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const reasonError =
    !reasonOptional && reason.trim().length < 3 ? "Say why, in a few words." : null;
  const blocked = Boolean(requireText) && typed.trim() !== requireText;

  async function submit() {
    setTouched(true);
    if (reasonError || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open && (
        <form
          method="dialog"
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 id={`${id}-title`}>{title}</h2>
          {body && <div className="confirm-body">{body}</div>}
          <ErrorBanner error={error} />
          {children}
          <div className="field">
            <label className="field-label" htmlFor={`${id}-reason`}>
              {reasonLabel}
              {reasonOptional && <span className="muted"> (optional)</span>}
            </label>
            <textarea
              id={`${id}-reason`}
              rows={3}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(touched && reasonError)}
              aria-describedby={`${id}-hint`}
            />
            {touched && reasonError ? (
              <span className="field-error">{reasonError}</span>
            ) : (
              <span id={`${id}-hint`} className="field-hint">
                Saved in the audit log with your name.
              </span>
            )}
          </div>
          {requireText && (
            <div className="field">
              <label className="field-label" htmlFor={`${id}-confirm`}>
                Type <strong>{requireText}</strong> to confirm
              </label>
              <input
                id={`${id}-confirm`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className={danger ? "btn btn-danger" : "btn btn-primary"}
              disabled={busy || blocked}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
