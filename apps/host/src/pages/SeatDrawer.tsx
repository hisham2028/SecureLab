import { useCallback, useEffect, useState } from "react";
import { formatCents, rubricMarkCents, toCents } from "@securelab/shared";
import * as api from "../api";
import type { Exam, Role, SeatDetail } from "../api";
import { Drawer } from "../ui/Drawer";
import { ErrorBanner, Field, formatDateTime, LANGUAGE_LABEL, Notice } from "../ui/bits";
import { ReasonDialog } from "../ui/ReasonDialog";
import {
  ACTION_LABEL,
  EVENT_LABEL,
  formatRemaining,
  SEAT_STATUS,
  time,
  VERDICT,
} from "../ui/live-labels";
import { SubmissionDrawer } from "./SubmissionDrawer";

type Action = "block" | "unblock" | "reentry" | "extend" | "finish" | null;
type Question = SeatDetail["questions"][number];

/** One student: what happened, what they submitted, their marks, and the actions staff can take. */
export function SeatDrawer({
  exam,
  role,
  registrationId,
  onClose,
  onChanged,
}: {
  exam: Exam;
  role: Role;
  registrationId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<SeatDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [action, setAction] = useState<Action>(null);
  const [minutes, setMinutes] = useState(10);
  const [submitDrafts, setSubmitDrafts] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [marking, setMarking] = useState<Question | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<unknown>(null);
  const canManage = role === "ADMIN" || role === "HOST";
  const live = exam.status === "RUNNING" || exam.status === "PAUSED";
  const open = ["PUBLISHED", "RUNNING", "PAUSED"].includes(exam.status);

  const load = useCallback(() => {
    if (!registrationId) return;
    void api.seatDetail(exam.id, registrationId).then(setDetail, setError);
  }, [exam.id, registrationId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setNotice(null);
    setNote("");
    load();
  }, [load]);

  const done = (message: string) => {
    setAction(null);
    setNotice(message);
    load();
    onChanged();
  };

  const s = detail?.seat;
  const name = s ? `${s.fullName} (${s.studentId})` : "Student";

  return (
    <>
      <Drawer open={registrationId !== null} title={s ? s.fullName : "Student"} onClose={onClose}>
        <ErrorBanner error={error} />
        {!detail && !error && <p className="muted">Loading…</p>}
        {detail && s && (
          <div className="seat">
            <p className="meta">
              <span className="mono">{s.studentId}</span>
              <span className={`badge ${SEAT_STATUS[s.status].tone}`}>
                {SEAT_STATUS[s.status].label}
              </span>
              {s.connection && <span>{s.connection === "ONLINE" ? "Online" : "Offline"}</span>}
              {s.remainingSeconds !== null && (
                <span>{formatRemaining(s.remainingSeconds)} left</span>
              )}
              {s.extensionMinutes > 0 && <span>+{s.extensionMinutes} min extra</span>}
            </p>
            {s.status === "BLOCKED" && <Notice tone="warning">Blocked: {s.blockedReason}</Notice>}
            {notice && <Notice tone="success">{notice}</Notice>}

            <div className="row-actions start">
              {open && s.status !== "BLOCKED" && (
                <button className="btn" onClick={() => setAction("block")}>
                  Block
                </button>
              )}
              {s.status === "BLOCKED" && (
                <button className="btn" onClick={() => setAction("unblock")}>
                  Unblock
                </button>
              )}
              {live && (s.status === "FINISHED" || s.status === "NOT_STARTED") && (
                <button className="btn" onClick={() => setAction("reentry")}>
                  Let back in
                </button>
              )}
              {canManage && exam.status !== "ARCHIVED" && exam.status !== "COMPLETED" && (
                <button className="btn" onClick={() => setAction("extend")}>
                  Extra time
                </button>
              )}
              {canManage && (live || exam.status === "COMPLETED") && s.status !== "NOT_STARTED" && (
                <button className="btn btn-danger-outline" onClick={() => setAction("finish")}>
                  {s.status === "FINISHED" ? "Submit saved drafts" : "End this student's exam"}
                </button>
              )}
            </div>

            <h3 className="h3">Questions</h3>
            {detail.questions.map((q) => (
              <section key={q.examQuestionId} className="seat-question">
                <header>
                  <strong>
                    Q{q.ordinal}. {q.title}
                  </strong>
                  <span className="num">
                    {q.mark} / {q.points}
                    {q.adjusted && (
                      <span className="muted" title={`Automatic mark ${q.autoMark}`}>
                        {" "}
                        (changed by hand)
                      </span>
                    )}
                  </span>
                  {canManage && exam.status !== "ARCHIVED" && exam.status !== "DRAFT" && (
                    <button className="btn btn-sm" onClick={() => setMarking(q)}>
                      Change mark
                    </button>
                  )}
                </header>
                {q.submissions.length === 0 ? (
                  <p className="muted">No submissions.</p>
                ) : (
                  <table className="compact">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Time</th>
                        <th scope="col">Language</th>
                        <th scope="col">Result</th>
                        <th scope="col" className="num">
                          Score
                        </th>
                        {canManage && (
                          <th scope="col">
                            <span className="sr-only">Actions</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {q.submissions.map((sub) => (
                        <tr key={sub.id}>
                          <td>{sub.sequence}</td>
                          <td>
                            {time(sub.createdAt)}
                            {sub.submittedBy && <div className="muted">by {sub.submittedBy}</div>}
                          </td>
                          <td>{LANGUAGE_LABEL[sub.language]}</td>
                          <td className={sub.gradingFailed ? "text-warning" : undefined}>
                            {VERDICT[sub.status]}
                            {sub.testsTotal !== null && sub.graded && (
                              <span className="muted">
                                {" "}
                                · {sub.testsPassed}/{sub.testsTotal}
                              </span>
                            )}
                          </td>
                          <td className="num">{sub.score ?? "—"}</td>
                          {canManage && (
                            <td>
                              <button className="link" onClick={() => setViewing(sub.id)}>
                                Review
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {q.adjustments.length > 0 && (
                  <ul className="history">
                    {q.adjustments.map((a) => (
                      <li key={a.id}>
                        {formatDateTime(a.createdAt)}: {a.previousMark} →{" "}
                        <strong>{a.newMark}</strong> by {a.actor}. “{a.reason}”
                        {a.rubric && (
                          <span className="muted">
                            {" "}
                            (rubric:{" "}
                            {a.rubric
                              .map((r) => `${r.label} ${r.points > 0 ? "+" : ""}${r.points}`)
                              .join(", ")}
                            )
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            <h3 className="h3">Notes</h3>
            <form
              className="note-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!note.trim()) return;
                setNoteError(null);
                try {
                  await api.addNote(exam.id, note.trim(), s.registrationId);
                  setNote("");
                  load();
                } catch (err) {
                  setNoteError(err);
                }
              }}
            >
              <ErrorBanner error={noteError} />
              <Field label="Add a note" hint="Notes can't be edited or deleted.">
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <button className="btn btn-sm" type="submit" disabled={!note.trim()}>
                Save note
              </button>
            </form>
            {detail.notes.length > 0 && (
              <ul className="history">
                {detail.notes.map((n) => (
                  <li key={n.id}>
                    {formatDateTime(n.createdAt)}, {n.author}: {n.note}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="h3">Timeline</h3>
            <Timeline detail={detail} />
          </div>
        )}
      </Drawer>

      <ReasonDialog
        open={action === "block"}
        title={`Block ${name}?`}
        body="Their app stops at once and they can't sign in until you unblock them. Their work is kept and their clock keeps running."
        confirmLabel="Block student"
        danger
        onConfirm={async (reason) => {
          await api.blockSeat(exam.id, registrationId!, reason);
          done("Student blocked.");
        }}
        onCancel={() => setAction(null)}
      />
      <ReasonDialog
        open={action === "unblock"}
        title={`Unblock ${name}?`}
        body="They can carry on where they left off."
        confirmLabel="Unblock"
        onConfirm={async (reason) => {
          await api.unblockSeat(exam.id, registrationId!, reason);
          done("Student unblocked.");
        }}
        onCancel={() => setAction(null)}
      />
      <ReasonDialog
        open={action === "reentry"}
        title={`Let ${name} back in?`}
        body="They can enter the exam again even if entry has closed or they finished. Their deadline doesn't change; give extra time separately if needed."
        confirmLabel="Let back in"
        onConfirm={async (reason) => {
          await api.allowReentry(exam.id, registrationId!, reason, minutes);
          done(`They can enter within ${minutes} minutes.`);
        }}
        onCancel={() => setAction(null)}
      >
        <Field label="They must enter within (minutes)">
          <input
            type="number"
            min={1}
            max={60}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </Field>
      </ReasonDialog>
      <ReasonDialog
        open={action === "extend"}
        title={`Extra time for ${name}`}
        confirmLabel="Save extra time"
        onConfirm={async (reason) => {
          await api.setExtension(exam.id, registrationId!, minutes, reason);
          done(`Extra time set to ${minutes} minutes.`);
        }}
        onCancel={() => setAction(null)}
      >
        <Field label="Total extra minutes" hint={`Currently ${s?.extensionMinutes ?? 0}.`}>
          <input
            type="number"
            min={0}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </Field>
      </ReasonDialog>
      <ReasonDialog
        open={action === "finish"}
        title={
          s?.status === "FINISHED" ? `Submit ${name}'s saved drafts?` : `End the exam for ${name}?`
        }
        body={
          s?.status === "FINISHED"
            ? "Each question's latest draft saved on the server is submitted if it differs from their last submission."
            : "They stop at once. You can let them back in later if this was a mistake."
        }
        confirmLabel={s?.status === "FINISHED" ? "Submit drafts" : "End exam for this student"}
        danger
        requireText={s?.studentId}
        onConfirm={async (reason) => {
          const r = await api.forceFinish(exam.id, registrationId!, reason, submitDrafts);
          done(
            r.submitted.length > 0
              ? `Done. ${r.submitted.length} saved ${r.submitted.length === 1 ? "draft was" : "drafts were"} submitted.`
              : "Done. There were no new drafts to submit.",
          );
        }}
        onCancel={() => setAction(null)}
      >
        {s?.status !== "FINISHED" && (
          <label className="check">
            <input
              type="checkbox"
              checked={submitDrafts}
              onChange={(e) => setSubmitDrafts(e.target.checked)}
            />
            Also submit their latest saved drafts
          </label>
        )}
      </ReasonDialog>
      {marking && registrationId && (
        <MarkDialog
          examId={exam.id}
          registrationId={registrationId}
          question={marking}
          onDone={() => {
            setMarking(null);
            done("Mark saved.");
          }}
          onCancel={() => setMarking(null)}
        />
      )}
      <SubmissionDrawer
        examId={exam.id}
        submissionId={viewing}
        onClose={() => setViewing(null)}
        onChanged={() => {
          load();
          onChanged();
        }}
      />
    </>
  );
}

function Timeline({ detail }: { detail: SeatDetail }) {
  const items = [
    ...detail.events.map((e) => ({
      at: e.occurredAt,
      key: `e${e.id}`,
      text:
        EVENT_LABEL[e.type] +
        (e.type === "RECONNECTED" && e.details?.offlineSeconds
          ? ` after ${Math.round(Number(e.details.offlineSeconds))} s offline`
          : ""),
      tone: e.type === "PARALLEL_SIGNIN" ? "text-warning" : "",
    })),
    ...detail.actions.map((a) => ({
      at: a.createdAt,
      key: `a${a.id}`,
      text: `${ACTION_LABEL[a.action] ?? a.action} by ${a.actor}${
        a.metadata && typeof a.metadata.reason === "string" ? `: “${a.metadata.reason}”` : ""
      }`,
      tone: "strong",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (items.length === 0) return <p className="muted">Nothing yet.</p>;
  return (
    <ul className="history">
      {items.slice(0, 100).map((i) => (
        <li key={i.key} className={i.tone}>
          <span className="muted">{time(i.at)}</span> {i.text}
        </li>
      ))}
    </ul>
  );
}

function MarkDialog({
  examId,
  registrationId,
  question,
  onDone,
  onCancel,
}: {
  examId: string;
  registrationId: string;
  question: Question;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<"OVERRIDE" | "RUBRIC">("OVERRIDE");
  const [mark, setMark] = useState(question.mark);
  const [lines, setLines] = useState([{ label: "", points: "" }]);
  const items = lines
    .filter((l) => l.label.trim() && l.points !== "" && Number.isFinite(Number(l.points)))
    .map((l) => ({ label: l.label.trim(), points: Number(l.points) }));
  const preview =
    kind === "OVERRIDE"
      ? mark
      : formatCents(rubricMarkCents(toCents(question.autoMark), items, question.points));
  const markInvalid =
    kind === "OVERRIDE" && (mark === "" || !(Number(mark) >= 0 && Number(mark) <= question.points));

  return (
    <ReasonDialog
      open
      title={`Change the mark for Q${question.ordinal}`}
      body={
        <p>
          Automatic mark <strong>{question.autoMark}</strong>, current mark{" "}
          <strong>{question.mark}</strong> out of {question.points}. Every change is kept.
        </p>
      }
      confirmLabel={`Save mark ${markInvalid ? "" : preview}`.trim()}
      onConfirm={async (reason) => {
        if (markInvalid)
          throw new api.ApiRequestError(422, {
            code: "INVALID",
            message: `Enter a mark from 0 to ${question.points}.`,
          });
        if (kind === "RUBRIC" && items.length === 0)
          throw new api.ApiRequestError(422, {
            code: "INVALID",
            message: "Add at least one rubric line with points.",
          });
        await api.adjustMark(
          examId,
          registrationId,
          question.examQuestionId,
          kind === "OVERRIDE"
            ? { kind, mark: Number(mark), reason }
            : { kind, rubric: items, reason },
        );
        onDone();
      }}
      onCancel={onCancel}
    >
      <fieldset className="fieldset">
        <legend>How</legend>
        <label className="check">
          <input
            type="radio"
            name="kind"
            checked={kind === "OVERRIDE"}
            onChange={() => setKind("OVERRIDE")}
          />
          Set the mark
        </label>
        <label className="check">
          <input
            type="radio"
            name="kind"
            checked={kind === "RUBRIC"}
            onChange={() => setKind("RUBRIC")}
          />
          Automatic mark plus rubric points
        </label>
      </fieldset>
      {kind === "OVERRIDE" ? (
        <Field label={`Mark (0 to ${question.points})`}>
          <input
            type="number"
            step="0.25"
            min={0}
            max={question.points}
            value={mark}
            onChange={(e) => setMark(e.target.value)}
            aria-invalid={markInvalid}
          />
        </Field>
      ) : (
        <div>
          {lines.map((l, i) => (
            <div className="row" key={i}>
              <Field label="Rubric line">
                <input
                  value={l.label}
                  placeholder="e.g. Readable code"
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label="Points (+/−)">
                <input
                  type="number"
                  step="0.25"
                  value={l.points}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
          ))}
          <button
            type="button"
            className="link"
            onClick={() => setLines([...lines, { label: "", points: "" }])}
          >
            Add a line
          </button>
          <p className="field-hint">
            New mark: <strong>{preview}</strong> (kept between 0 and {question.points}).
          </p>
        </div>
      )}
    </ReasonDialog>
  );
}
