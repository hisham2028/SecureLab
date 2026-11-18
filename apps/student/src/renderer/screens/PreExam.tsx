import { useCallback, useEffect, useId, useState } from "react";
import type { StudentOverview } from "@securelab/shared";
import { api, ApiError } from "../lib/api";
import { LANGUAGE_LABEL } from "../lib/labels";
import { Banner } from "../ui/Banner";
import { Announcements } from "../ui/Announcements";
import { useHeartbeat, useUnseen } from "../lib/heartbeat";

type Check = NonNullable<Awaited<ReturnType<NonNullable<Window["securelab"]>["systemCheck"]>>>;
type Level = "ok" | "warn" | "fail";
interface Row {
  label: string;
  level: Level;
  detail: string;
}

/** Turns raw system facts into rows. "fail" rows block the start button. */
export function checkRows(c: Check): Row[] {
  const skew = c.server.clockSkewSeconds;
  return [
    {
      label: "Exam server",
      level: c.server.reachable ? "ok" : "fail",
      detail: c.server.reachable
        ? `Connected (${c.server.latencyMs ?? "?"} ms)`
        : "Can't reach the exam server. Check the network, then check again.",
    },
    {
      label: "Saving work on this computer",
      level: c.draftsWritable ? "ok" : "fail",
      detail: c.draftsWritable
        ? "Working"
        : "SecureLab can't save files on this computer. Tell the invigilator.",
    },
    {
      label: "Encrypted local copies",
      level: c.encryptionAvailable ? "ok" : "warn",
      detail: c.encryptionAvailable
        ? "On"
        : "Off on this computer. Your work is still saved; tell the invigilator.",
    },
    {
      label: "Secure connection",
      level: c.secureConnection ? "ok" : "warn",
      detail: c.secureConnection
        ? "Yes"
        : "The connection to the exam server isn't encrypted. Tell the invigilator.",
    },
    {
      label: "Computer clock",
      level: skew === null || Math.abs(skew) <= 120 ? "ok" : "warn",
      detail:
        skew === null || Math.abs(skew) <= 120
          ? "Matches the server"
          : `Off by ${Math.round(Math.abs(skew) / 60)} min. Your exam timer comes from the server, so it isn't affected.`,
    },
    {
      label: "Screen size",
      level: c.screen.width >= 1024 && c.screen.height >= 640 ? "ok" : "warn",
      detail: `${c.screen.width} × ${c.screen.height}${
        c.screen.width >= 1024 && c.screen.height >= 640
          ? ""
          : ". The exam is easier on a larger screen."
      }`,
    },
  ];
}

const ICON: Record<Level, string> = { ok: "✓", warn: "!", fail: "✕" };

interface Props {
  overview: StudentOverview;
  onOverview: (o: StudentOverview) => void;
  onSignOut: () => void;
}

export function PreExam({ overview, onOverview, onSignOut }: Props) {
  const ackId = useId();
  const [ack, setAck] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { exam, clock, seat } = overview;
  const announcements = useHeartbeat({ enabled: true });
  const { unseen, dismiss } = useUnseen(seat.registrationId, announcements);

  useEffect(() => {
    document.title = `${exam.title} · SecureLab`;
  }, [exam.title]);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const c = await window.securelab?.systemCheck();
      if (c) setRows(checkRows(c));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  // Wait for the invigilator: poll while the exam hasn't started.
  useEffect(() => {
    const id = window.setInterval(() => {
      api.overview().then(onOverview, () => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, [onOverview]);

  const blocked = rows?.some((r) => r.level === "fail") ?? true;
  const live = exam.status === "RUNNING" || exam.status === "PAUSED";

  async function start() {
    setStarting(true);
    setError(null);
    try {
      onOverview(await api.enter());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start. Try again.");
      setStarting(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-title">
          <strong>{exam.title}</strong>
          <span className="muted">Student {seat.studentId}</span>
        </div>
        <button type="button" className="link" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <main className="pre-exam">
        <Announcements items={unseen} onDismiss={dismiss} />
        <section className="card" aria-labelledby="rules-h">
          <h2 id="rules-h">Before you start</h2>
          <dl className="facts">
            <div>
              <dt>Time</dt>
              <dd>{exam.durationMinutes} minutes, starting when the invigilator starts the exam</dd>
            </div>
            <div>
              <dt>Languages</dt>
              <dd>{exam.allowedLanguages.map((l) => LANGUAGE_LABEL[l]).join(", ")}</dd>
            </div>
            <div>
              <dt>Questions</dt>
              <dd>
                {exam.navigationPolicy === "SEQUENTIAL"
                  ? "One at a time, in order. Once you move on you can't go back."
                  : "Answer in any order and switch between them freely."}
              </dd>
            </div>
            <div>
              <dt>Submissions</dt>
              <dd>Up to {exam.maxSubmissionsPerQuestion} per question</dd>
            </div>
          </dl>
          {exam.instructions.trim() && (
            <>
              <h3>Instructions from your examiner</h3>
              <p className="prewrap">{exam.instructions}</p>
            </>
          )}
          <h3>How SecureLab works</h3>
          <ul className="rules">
            <li>
              Your code is saved on this computer every few seconds and sent to the exam server. The
              status under the editor shows both.
            </li>
            <li>
              Use <strong>Submit</strong> to hand in an answer. Each submission is an exact copy of
              your code at that moment.
            </li>
            <li>
              The timer comes from the exam server. Changing this computer&apos;s clock doesn&apos;t
              change it.
            </li>
            <li>
              If SecureLab closes or the computer restarts, open it and sign in again. Your work is
              restored.
            </li>
            <li>If anything goes wrong, raise your hand and tell the invigilator.</li>
          </ul>
          <h3>What the exam staff can see</h3>
          <ul className="rules">
            <li>Your code, runs and submissions, and which question and language you have open.</li>
            <li>
              Whether this computer is connected, and when SecureLab stops being the active window.
              A dropped connection or a click outside the window is not treated as cheating on its
              own.
            </li>
            <li>
              SecureLab does not record your screen, camera, microphone, keystrokes or other apps.
              Connection and window records are deleted after the exam&apos;s retention period; your
              marks and submissions are kept as your institution&apos;s exam records.
            </li>
          </ul>
          <label className="check" htmlFor={ackId}>
            <input
              id={ackId}
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I&apos;ve read the instructions and how SecureLab works.
          </label>
        </section>

        <section className="card" aria-labelledby="check-h">
          <div className="section-head">
            <h2 id="check-h">System check</h2>
            <button type="button" onClick={() => void runCheck()} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </div>
          {rows === null ? (
            <p className="muted">Checking this computer…</p>
          ) : (
            <ul className="checks">
              {rows.map((r) => (
                <li key={r.label} className={r.level}>
                  <span className="check-icon" aria-hidden>
                    {ICON[r.level]}
                  </span>
                  <span>
                    <strong>{r.label}</strong>
                    <span className="muted"> · {r.detail}</span>
                  </span>
                  <span className="sr-only">
                    {r.level === "ok" ? "passed" : r.level === "warn" ? "warning" : "failed"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card start" aria-live="polite">
          {error && <Banner tone="danger">{error}</Banner>}
          {exam.status === "PUBLISHED" && (
            <p>
              <strong>Waiting for the invigilator to start the exam.</strong>{" "}
              <span className="muted">This page updates by itself.</span>
            </p>
          )}
          {live && !clock.canEnter && (
            <Banner tone="danger">Entry to this exam has closed. Talk to the invigilator.</Banner>
          )}
          {live && clock.canEnter && (
            <p>
              <strong>The exam has started.</strong>{" "}
              {exam.status === "PAUSED" && <span className="muted">It is paused right now.</span>}
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={!ack || blocked || !live || !clock.canEnter || starting}
            onClick={() => void start()}
          >
            {starting ? "Starting…" : "Start exam"}
          </button>
          {!ack && <p className="hint">Tick the box above to continue.</p>}
          {ack && blocked && rows !== null && (
            <p className="hint error">Fix the failed checks above first.</p>
          )}
        </section>
      </main>
    </div>
  );
}
