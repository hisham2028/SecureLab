import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ExamStatus } from "../api";
import { ApiRequestError } from "../api";

const STATUS_LABEL: Record<ExamStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export function StatusBadge({ status }: { status: ExamStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

/** Shows an API error (possibly several messages) with a recovery hint. */
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const messages =
    error instanceof ApiRequestError ? error.messages : ["Something went wrong. Try again."];
  return (
    <div role="alert" className="banner banner-error">
      {messages.length === 1 ? (
        <p>{messages[0]}</p>
      ) : (
        <ul>
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning";
}) {
  return (
    <div role="status" className={`banner banner-${tone}`}>
      {children}
    </div>
  );
}

/**
 * Label above a control. The label is linked with htmlFor (not wrapped), so a control's
 * accessible name stays the label text and doesn't absorb the typed value. The first child
 * element is the control; anything after it (e.g. an error message) renders below.
 */
export function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  let linked = false;
  const kids = Children.map(children, (child) => {
    if (!linked && isValidElement(child)) {
      linked = true;
      return cloneElement(child as ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": hint ? hintId : undefined,
      });
    }
    return child;
  });
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {optional && <span className="muted"> (optional)</span>}
      </label>
      {kids}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export const LANGUAGE_LABEL = { c: "C", cpp: "C++", python: "Python" } as const;

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Paginates a client-side list. Pagination always renders, per the list pattern. */
export function Pagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted">
        {total} {total === 1 ? "item" : "items"} · Page {page} of {Math.max(1, pageCount)}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
