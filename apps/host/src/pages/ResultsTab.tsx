import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { Exam, ResultsOverview, Role } from "../api";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ErrorBanner, formatDateTime, Notice } from "../ui/bits";
import { ReasonDialog } from "../ui/ReasonDialog";
import { SeatDrawer } from "./SeatDrawer";

/**
 * Provisional marks (always live), frozen versions ("finalize"), and the one version students
 * can see ("publish"). Students see nothing until a version is published.
 */
export function ResultsTab({ exam, role }: { exam: Exam; role: Role }) {
  const [data, setData] = useState<ResultsOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [passPercent, setPassPercent] = useState(50);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<ResultsOverview["releases"][number] | null>(null);
  const [hiding, setHiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    () => api.resultsOverview(exam.id, passPercent).then(setData, setError),
    [exam.id, passPercent],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <p className="muted">Loading results…</p>;

  const a = data.analytics;
  const latest = data.releases[0];
  const published = data.releases.find((r) => r.published);
  const questions = data.rows[0]?.questions ?? [];

  async function finalize() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.finalizeResults(exam.id);
      setNotice(`Version ${r.version} saved. Publish it when you're ready for students to see it.`);
      await load();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="tab-toolbar">
        <p>
          {published ? (
            <>
              <span className="badge badge-running">Published</span> Version {published.version},
              since {formatDateTime(data.publishedAt)}. Students can see their own result.
            </>
          ) : (
            <>
              <span className="badge">Not published</span> Students can't see any results.
            </>
          )}
        </p>
        <div className="header-actions">
          {published && (
            <button className="btn" onClick={() => setHiding(true)}>
              Hide from students
            </button>
          )}
          {data.canFinalize && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void finalize()}>
              {busy ? "Saving…" : latest ? "Save a new version" : "Finalize results"}
            </button>
          )}
        </div>
      </div>
      {!data.canFinalize && (
        <Notice>
          These marks are provisional and change as grading finishes. You can finalize and publish
          once the exam has ended.
        </Notice>
      )}
      {data.grading.pending > 0 && (
        <Notice>{data.grading.pending} submissions are still being graded.</Notice>
      )}
      {data.grading.failed > 0 && (
        <Notice tone="warning">
          {data.grading.failed} submissions couldn't be graded by the judge. Open the student to
          grade them again or set the mark by hand.
        </Notice>
      )}
      {data.changedSinceLatestRelease && (
        <Notice tone="warning">
          Marks have changed since version {latest?.version}. Save a new version and publish it to
          show students the change.
        </Notice>
      )}
      {notice && <Notice tone="success">{notice}</Notice>}
      <ErrorBanner error={actionError} />

      <h2 className="h3">Summary</h2>
      <div className="stats">
        <Stat label="Registered" value={a.registered} />
        <Stat label="Started" value={a.started} />
        <Stat label="Completed" value={a.completed} />
        <Stat label="Average" value={a.average ?? "—"} />
        <Stat label="Highest" value={a.highest ?? "—"} />
        <Stat label="Lowest" value={a.lowest ?? "—"} />
        <Stat
          label={`Passed (≥ ${a.passMark})`}
          value={a.passRate === null ? "—" : `${a.passRate}%`}
        />
      </div>
      <label className="inline-field">
        Pass mark
        <input
          type="number"
          min={0}
          max={100}
          value={passPercent}
          onChange={(e) => setPassPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
        />
        %
      </label>
      <p className="field-hint">Statistics count students who started the exam.</p>

      <h2 className="h3">By question</h2>
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col" className="num">
                Attempted
              </th>
              <th scope="col" className="num">
                Accepted
              </th>
              <th scope="col" className="num">
                Full marks
              </th>
              <th scope="col" className="num">
                Average
              </th>
              <th scope="col" className="num">
                High / low
              </th>
            </tr>
          </thead>
          <tbody>
            {a.perQuestion.map((q) => (
              <tr key={q.examQuestionId}>
                <td>
                  Q{q.ordinal}. {q.title} <span className="muted">/ {q.points}</span>
                </td>
                <td className="num">{q.attempted}</td>
                <td className="num">{q.accepted}</td>
                <td className="num">{q.fullMarks}</td>
                <td className="num">{q.average ?? "—"}</td>
                <td className="num">
                  {q.highest ?? "—"} / {q.lowest ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.releases.length > 0 && (
        <>
          <h2 className="h3">Saved versions</h2>
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Saved</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.releases.map((r) => (
                  <tr key={r.id}>
                    <td>Version {r.version}</td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>
                      {r.published ? <span className="badge badge-running">Published</span> : "—"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            api.downloadResultsCsv(exam.id, r.id).catch(setActionError)
                          }
                        >
                          Export CSV
                        </button>
                        {!r.published && (
                          <button className="btn btn-sm" onClick={() => setPublishing(r)}>
                            Publish
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="h3">Marks {data.canFinalize ? "(provisional)" : "so far"}</h2>
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col">Student</th>
              {questions.map((q) => (
                <th key={q.examQuestionId} scope="col" className="num">
                  Q{q.ordinal} <span className="muted">/ {q.points}</span>
                </th>
              ))}
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={questions.length + 2} className="empty">
                  No students registered.
                </td>
              </tr>
            )}
            {data.rows.map((r) => (
              <tr
                key={r.registrationId}
                className="row-link"
                onClick={() => setOpen(r.registrationId)}
              >
                <td>
                  <button
                    type="button"
                    className="link strong"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(r.registrationId);
                    }}
                  >
                    {r.fullName}
                  </button>
                  <div className="muted mono">
                    {r.studentId}
                    {!r.started && " · absent"}
                  </div>
                </td>
                {r.questions.map((q) => (
                  <td key={q.examQuestionId} className="num">
                    {q.mark}
                    {q.adjusted && (
                      <span className="muted" title={`Changed by hand (automatic ${q.autoMark})`}>
                        *
                      </span>
                    )}
                  </td>
                ))}
                <td className="num strong">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-hint">
        * changed by hand. Each question counts the best graded submission.
      </p>

      <SeatDrawer
        exam={exam}
        role={role}
        registrationId={open}
        onClose={() => setOpen(null)}
        onChanged={() => void load()}
      />
      <ConfirmDialog
        open={publishing !== null}
        title={`Publish version ${publishing?.version}?`}
        body="Each student can see their own marks for this version with their exam code, student ID and PIN. You can hide it again."
        confirmLabel="Publish results"
        onConfirm={async () => {
          try {
            await api.publishResults(exam.id, publishing!.id);
            setNotice(`Version ${publishing!.version} is published.`);
            await load();
          } catch (err) {
            setActionError(err);
          }
          setPublishing(null);
        }}
        onCancel={() => setPublishing(null)}
      />
      <ReasonDialog
        open={hiding}
        title="Hide results from students?"
        body="Students won't see any result until you publish a version again."
        confirmLabel="Hide results"
        danger
        onConfirm={async (reason) => {
          await api.hideResults(exam.id, reason);
          setHiding(false);
          setNotice("Results are hidden from students.");
          await load();
        }}
        onCancel={() => setHiding(false)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
