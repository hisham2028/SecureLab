import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { Exam, MonitorResponse, MonitorRow, Role, SeatStatus } from "../api";
import { ErrorBanner, LANGUAGE_LABEL, Notice, Pagination } from "../ui/bits";
import { ReasonDialog } from "../ui/ReasonDialog";
import { ago, formatRemaining, SEAT_STATUS } from "../ui/live-labels";
import { SeatDrawer } from "./SeatDrawer";

const PAGE_SIZE = 50;
const POLL_MS = 10_000;
const FILTERS: (SeatStatus | "ALL")[] = [
  "ALL",
  "ACTIVE",
  "DISCONNECTED",
  "NOT_STARTED",
  "FINISHED",
  "BLOCKED",
];

/** The exam room: every seat's status, refreshed every few seconds while the exam is live. */
export function LiveTab({ exam, role }: { exam: Exam; role: Role }) {
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<SeatStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [announcing, setAnnouncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const live = exam.status === "RUNNING" || exam.status === "PAUSED";

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const load = useCallback(
    () =>
      api.monitor(exam.id, { status, q: debounced, page, pageSize: PAGE_SIZE }).then((d) => {
        setData(d);
        setError(null);
      }, setError),
    [exam.id, status, debounced, page],
  );

  useEffect(() => {
    void load();
    if (!live) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load, live]);

  const counts = data?.counts;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="tab-toolbar">
        <label className="search">
          <span>Search</span>
          <input
            type="search"
            placeholder="Student ID or name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <div className="header-actions">
          <span className="muted" aria-live="polite">
            {data ? `Updated ${ago(data.serverTime)}` : ""}
          </span>
          <button className="btn" onClick={() => void load()}>
            Refresh
          </button>
          {["PUBLISHED", "RUNNING", "PAUSED"].includes(exam.status) && (
            <button className="btn btn-primary" onClick={() => setAnnouncing(true)}>
              Announce
            </button>
          )}
        </div>
      </div>

      <div className="filter-chips" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={status === f ? "chip active" : "chip"}
            aria-pressed={status === f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
          >
            {f === "ALL" ? "All" : SEAT_STATUS[f].label}
            <span className="chip-count">{counts ? counts[f] : "–"}</span>
          </button>
        ))}
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}
      <ErrorBanner error={error} />
      <p className="field-hint">
        Disconnected means no signal from the student's PC for 45 seconds, usually the network.
        Leaving the exam window is shown for context and is not misconduct by itself.
      </p>

      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Connection</th>
              <th scope="col">Working on</th>
              <th scope="col" className="num">
                Submissions
              </th>
              <th scope="col">Needs a look</th>
              <th scope="col" className="num">
                Time left
              </th>
              <th scope="col" className="num">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && (
              <tr>
                <td colSpan={8} className="empty">
                  Loading the exam room…
                </td>
              </tr>
            )}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  {data.counts.ALL === 0
                    ? "No students are registered for this exam."
                    : "No students match this filter."}{" "}
                  {(status !== "ALL" || query) && (
                    <button
                      className="link"
                      onClick={() => {
                        setStatus("ALL");
                        setQuery("");
                      }}
                    >
                      Show everyone
                    </button>
                  )}
                </td>
              </tr>
            )}
            {data?.rows.map((r) => (
              <Row key={r.registrationId} row={r} onOpen={() => setOpen(r.registrationId)} />
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} pageCount={pageCount} total={data.total} onPage={setPage} />}

      <SeatDrawer
        exam={exam}
        role={role}
        registrationId={open}
        onClose={() => setOpen(null)}
        onChanged={() => void load()}
      />
      <ReasonDialog
        open={announcing}
        title="Announce to all students"
        body="Shown on every student's screen within about 15 seconds. You can't take it back."
        confirmLabel="Send announcement"
        reasonLabel="Message"
        onConfirm={async (message) => {
          await api.announce(exam.id, message);
          setAnnouncing(false);
          setNotice("Announcement sent.");
        }}
        onCancel={() => setAnnouncing(false)}
      />
    </div>
  );
}

function Row({ row: r, onOpen }: { row: MonitorRow; onOpen: () => void }) {
  const s = SEAT_STATUS[r.status];
  return (
    <tr className="row-link" onClick={onOpen}>
      <td>
        <button
          type="button"
          className="link strong"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {r.fullName}
        </button>
        <div className="muted mono">{r.studentId}</div>
      </td>
      <td>
        <span className={`badge ${s.tone}`}>{s.label}</span>
      </td>
      <td>
        {r.connection === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            <span className={r.connection === "ONLINE" ? "dot dot-ok" : "dot dot-off"} />{" "}
            {r.connection === "ONLINE" ? "Online" : `Offline · ${ago(r.lastSeenAt)}`}
          </>
        )}
        {r.reconnectCount > 0 && (
          <div className="muted">
            Reconnected {r.reconnectCount} {r.reconnectCount === 1 ? "time" : "times"}
          </div>
        )}
      </td>
      <td>
        {r.currentQuestion ? (
          <>
            Q{r.currentQuestion.ordinal}
            {r.language && <span className="muted"> · {LANGUAGE_LABEL[r.language]}</span>}
          </>
        ) : (
          <span className="muted">—</span>
        )}
        {r.lastActivityAt && <div className="muted">Active {ago(r.lastActivityAt)}</div>}
      </td>
      <td className="num">
        {r.submissionCount}
        {r.gradingPending > 0 && <div className="muted">{r.gradingPending} grading</div>}
        {r.gradingFailed > 0 && (
          <div className="text-warning">{r.gradingFailed} couldn't grade</div>
        )}
      </td>
      <td>
        <div className="flags">
          {r.flags.includes("PARALLEL_SIGNIN") && (
            <span className="flag flag-warn">Second PC sign-in</span>
          )}
          {r.flags.includes("PIN_LOCKED") && <span className="flag flag-warn">PIN locked</span>}
          {r.flags.includes("LEFT_WINDOW") && (
            <span className="flag">Left window ×{r.focusLostCount}</span>
          )}
          {r.flags.length === 0 && <span className="muted">—</span>}
        </div>
      </td>
      <td className="num">
        {formatRemaining(r.remainingSeconds)}
        {r.extensionMinutes > 0 && <div className="muted">+{r.extensionMinutes} min</div>}
      </td>
      <td className="num">
        {r.score} <span className="muted">/ {r.maxScore}</span>
      </td>
    </tr>
  );
}
