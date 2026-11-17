import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { ExamStatus, ExamSummary } from "../api";
import { navigate } from "../router";
import { Drawer } from "../ui/Drawer";
import { ErrorBanner, formatDateTime, Pagination, StatusBadge } from "../ui/bits";
import { DEFAULT_SETTINGS, ExamSettingsForm } from "./ExamSettingsForm";

const PAGE_SIZE = 20;

export function ExamsList({ canCreate }: { canCreate: boolean }) {
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ExamStatus | "">("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listExams().then(setExams, setError);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (exams ?? []).filter(
      (e) =>
        (!status || e.status === status) &&
        (!q || e.title.toLowerCase().includes(q) || e.accessCode.toLowerCase().includes(q)),
    );
  }, [exams, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function create(settings: api.ExamSettings) {
    setSaving(true);
    setCreateError(null);
    try {
      const exam = await api.createExam(settings);
      navigate(`/exams/${exam.id}`);
    } catch (err) {
      setCreateError(err);
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Exams</h1>
          <p className="muted">
            Create exams, add questions and students, and run them on exam day.
          </p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            New exam
          </button>
        )}
      </header>

      <div className="toolbar">
        <label className="search">
          <span>Search</span>
          <input
            ref={search}
            type="search"
            placeholder="Title or access code"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <kbd>/</kbd>
        </label>
        <label className="filter">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ExamStatus | "");
              setPage(1);
            }}
          >
            <option value="">All</option>
            {(
              [
                "DRAFT",
                "SCHEDULED",
                "PUBLISHED",
                "RUNNING",
                "PAUSED",
                "COMPLETED",
                "ARCHIVED",
              ] as const
            ).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner error={error} />
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Access code</th>
              <th scope="col" className="num">
                Questions
              </th>
              <th scope="col" className="num">
                Students
              </th>
              <th scope="col" className="num">
                Minutes
              </th>
              <th scope="col">Planned start</th>
            </tr>
          </thead>
          <tbody>
            {exams === null && !error && (
              <tr>
                <td colSpan={7} className="empty">
                  Loading exams…
                </td>
              </tr>
            )}
            {exams !== null && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  {exams.length === 0 ? (
                    <>
                      <strong>No exams yet.</strong>{" "}
                      {canCreate ? (
                        <button className="link" onClick={() => setCreating(true)}>
                          Create your first exam
                        </button>
                      ) : (
                        "Exams your team creates appear here."
                      )}
                    </>
                  ) : (
                    <>
                      No exams match.{" "}
                      <button
                        className="link"
                        onClick={() => {
                          setQuery("");
                          setStatus("");
                        }}
                      >
                        Clear search and filter
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id} className="row-link" onClick={() => navigate(`/exams/${e.id}`)}>
                <td>
                  <a href={`#/exams/${e.id}`} onClick={(ev) => ev.stopPropagation()}>
                    {e.title}
                  </a>
                </td>
                <td>
                  <StatusBadge status={e.status} />
                </td>
                <td>
                  <code>{e.accessCode}</code>
                </td>
                <td className="num">{e.questionCount}</td>
                <td className="num">{e.registrationCount}</td>
                <td className="num">{e.durationMinutes}</td>
                <td>{formatDateTime(e.scheduledStartAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} total={filtered.length} onPage={setPage} />

      <Drawer
        open={creating}
        title="New exam"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button className="btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="new-exam" disabled={saving}>
              {saving ? "Creating…" : "Create exam"}
            </button>
          </>
        }
      >
        <ErrorBanner error={createError} />
        <ExamSettingsForm formId="new-exam" initial={DEFAULT_SETTINGS} onSubmit={create} />
      </Drawer>
    </div>
  );
}
