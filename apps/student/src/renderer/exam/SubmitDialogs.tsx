import { useEffect, useState } from "react";
import type { Language, SubmissionDetail } from "@securelab/shared";
import { api, ApiError } from "../lib/api";
import { LANGUAGE_LABEL, SUBMISSION_LABEL, timeOf } from "../lib/labels";
import { Dialog } from "../ui/Dialog";
import { Banner } from "../ui/Banner";

interface SubmitProps {
  open: boolean;
  onClose: () => void;
  questionId: string;
  questionLabel: string;
  language: Language;
  getCode: () => string;
  used: number;
  max: number;
  /** Makes sure the server has the latest draft too (best effort). */
  flush: () => Promise<boolean>;
  onSubmitted: (s: SubmissionDetail) => void;
}

export function SubmitDialog(p: SubmitProps) {
  // One ID per attempt: retrying after a network error can't create a second submission.
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    if (p.open) {
      setClientId(crypto.randomUUID());
      setError(null);
      setUncertain(false);
      setBusy(false);
    }
  }, [p.open]);

  const code = p.open ? p.getCode() : "";
  const lines = code.split("\n").length;
  const left = p.max - p.used;

  async function submit() {
    setBusy(true);
    setError(null);
    await p.flush().catch(() => false);
    try {
      p.onSubmitted(await api.submit(p.questionId, p.language, p.getCode(), clientId));
    } catch (err) {
      const offline = err instanceof ApiError && (err.status === 0 || err.status >= 500);
      setUncertain(offline);
      setError(
        offline
          ? "Couldn't confirm your submission with the server. Try again; it won't be counted twice."
          : err instanceof Error
            ? err.message
            : "Submission failed.",
      );
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={p.open}
      title={`Submit ${p.questionLabel}?`}
      onClose={() => !busy && p.onClose()}
      actions={
        <>
          <button type="button" onClick={p.onClose} disabled={busy}>
            Keep editing
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || left <= 0 || code.trim() === ""}
          >
            {busy ? "Submitting…" : uncertain ? "Try again" : "Submit answer"}
          </button>
        </>
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <p>
        This hands in an exact copy of your current code in{" "}
        <strong>{LANGUAGE_LABEL[p.language]}</strong> ({lines} {lines === 1 ? "line" : "lines"}).
      </p>
      <p>
        {left > 0 ? (
          <>
            After this you&apos;ll have <strong>{left - 1}</strong> of {p.max} submissions left for
            this question.
          </>
        ) : (
          <strong>You&apos;ve used all {p.max} submissions for this question.</strong>
        )}
      </p>
      {code.trim() === "" && <p className="error">The editor is empty.</p>}
    </Dialog>
  );
}

export function SnapshotDialog({
  submission,
  justSubmitted,
  onClose,
}: {
  submission: SubmissionDetail | null;
  justSubmitted: boolean;
  onClose: () => void;
}) {
  const s = submission;
  return (
    <Dialog
      open={s !== null}
      wide
      title={s ? `${justSubmitted ? "Submitted: " : ""}submission #${s.sequence}` : ""}
      onClose={onClose}
      actions={
        <button type="button" className="primary" onClick={onClose}>
          Back to the exam
        </button>
      }
    >
      {s && (
        <>
          {justSubmitted && (
            <Banner tone="success">The exam server received this exact code.</Banner>
          )}
          <dl className="facts compact">
            <div>
              <dt>Received</dt>
              <dd>{timeOf(s.createdAt)}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{LANGUAGE_LABEL[s.language]}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{SUBMISSION_LABEL[s.status]}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd className="mono" title={`SHA-256 ${s.codeSha256}`}>
                {s.codeSha256.slice(0, 16)}…
              </dd>
            </div>
          </dl>
          <pre className="snapshot" aria-label="Submitted code (read-only)">
            {s.code.split("\n").map((line, i) => (
              <span key={i} className="snapline">
                <span className="ln" aria-hidden>
                  {i + 1}
                </span>
                {line || " "}
                {"\n"}
              </span>
            ))}
          </pre>
        </>
      )}
    </Dialog>
  );
}
