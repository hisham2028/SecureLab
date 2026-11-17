import { useEffect, useState } from "react";
import * as api from "../api";
import type { Exam, Registration } from "../api";
import { pinsFor, replacePins } from "../pins-store";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ErrorBanner, Notice } from "../ui/bits";

const NOT_STARTED = ["DRAFT", "SCHEDULED", "PUBLISHED"];

/** Printable PIN slips: one per student, cut along the dashed lines. */
export function PinSheet({ id }: { id: string }) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [regs, setRegs] = useState<Registration[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);

  useEffect(() => {
    api.getExam(id).then(setExam, setError);
    api.listRegistrations(id).then(setRegs, setError);
  }, [id]);

  if (error && !exam)
    return (
      <div className="page">
        <ErrorBanner error={error} />
      </div>
    );
  if (!exam || !regs) return <div className="page muted">Loading…</div>;

  const pins = pinsFor(id);
  const missing = regs.filter((r) => !pins.some((p) => p.registrationId === r.id));
  const canRegenerate = NOT_STARTED.includes(exam.status);

  async function regenerate() {
    setBusy(true);
    try {
      replacePins(id, await api.resetAllPins(id));
      setConfirm(false);
      rerender((n) => n + 1);
    } catch (err) {
      setError(err);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page pin-page">
      <div className="no-print">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <a href="#/exams">Exams</a> <span aria-hidden>›</span>{" "}
          <a href={`#/exams/${id}/students`}>{exam.title}</a> <span aria-hidden>›</span>{" "}
          <span>PIN slips</span>
        </nav>
        <header className="page-header">
          <div>
            <h1>PIN slips</h1>
            <p className="muted">
              {pins.length} of {regs.length} students have a PIN available to print. PINs are kept
              only in this browser tab.
            </p>
          </div>
          <div className="header-actions">
            {canRegenerate && regs.length > 0 && (
              <button className="btn" onClick={() => setConfirm(true)}>
                New PINs for everyone
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => window.print()}
              disabled={pins.length === 0}
            >
              Print
            </button>
          </div>
        </header>
        <ErrorBanner error={error} />
        {missing.length > 0 && (
          <Notice tone="warning">
            {missing.length} {missing.length === 1 ? "student has" : "students have"} no PIN here,
            because PINs are shown only once.{" "}
            {canRegenerate
              ? "Use “New PINs for everyone” to print a full set, or reset a single PIN on the Students tab."
              : "Reset their PINs one at a time on the Students tab."}
          </Notice>
        )}
      </div>

      <div className="slips">
        {pins.map((p) => (
          <article key={p.registrationId} className="slip">
            <header>
              <strong>{exam.title}</strong>
            </header>
            <dl>
              <div>
                <dt>Name</dt>
                <dd>{p.fullName}</dd>
              </div>
              <div>
                <dt>Student ID</dt>
                <dd className="mono">{p.studentId}</dd>
              </div>
              <div>
                <dt>Exam code</dt>
                <dd className="mono">{exam.accessCode}</dd>
              </div>
              <div>
                <dt>PIN</dt>
                <dd className="mono slip-pin">{p.pin}</dd>
              </div>
            </dl>
            <p className="slip-note">
              Open SecureLab and sign in with these details. Keep your PIN private.
            </p>
          </article>
        ))}
      </div>

      <ConfirmDialog
        open={confirm}
        title="Issue new PINs for everyone?"
        body={`All ${regs.length} students get a new PIN. Any PINs you already handed out stop working.`}
        confirmLabel="Issue new PINs"
        busy={busy}
        onConfirm={() => void regenerate()}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
