import { useEffect, useId, useRef, useState } from "react";
import * as api from "../api";
import { ErrorBanner, Field } from "./bits";

/** Your own password. Other devices are signed out; this one stays signed in. */
export function ChangePasswordDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setCurrent("");
      setNext("");
      setRepeat("");
      setTouched(false);
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const problem =
    next.length < 12
      ? "Use at least 12 characters."
      : next !== repeat
        ? "The two new passwords don't match."
        : null;

  async function submit() {
    setTouched(true);
    if (problem || !current) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      onChanged();
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
        onClose();
      }}
    >
      {open && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 id={`${id}-title`}>Change your password</h2>
          <ErrorBanner error={error} />
          <Field label="Current password">
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password" hint="At least 12 characters.">
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              onBlur={() => setTouched(true)}
              autoComplete="new-password"
              aria-invalid={Boolean(touched && problem)}
            />
          </Field>
          <Field label="New password again">
            <input
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
              aria-invalid={Boolean(touched && problem)}
            />
          </Field>
          {touched && problem && <p className="field-error">{problem}</p>}
          <p className="muted">You'll be signed out on your other devices.</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
