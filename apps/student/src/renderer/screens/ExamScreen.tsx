import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Language,
  RunResult,
  StudentOverview,
  StudentQuestion,
  SubmissionDetail,
  SubmissionSummary,
} from "@securelab/shared";
import { api, ApiError, connection, serverClock } from "../lib/api";
import { useStore } from "../lib/store";
import { formatCountdown } from "../lib/server-clock";
import { LANGUAGE_LABEL, STARTER, timeOf } from "../lib/labels";
import { useHeartbeat, useUnseen } from "../lib/heartbeat";
import { Announcements } from "../ui/Announcements";
import { readPref, writePref } from "../lib/prefs";
import { CodeEditor, type CodeEditorHandle } from "../CodeEditor";
import { useDrafts } from "../exam/useDrafts";
import { SaveStatus } from "../exam/SaveStatus";
import { QuestionList } from "../exam/QuestionList";
import { QuestionPanel } from "../exam/QuestionPanel";
import { ConsolePanel, runErrorMessage } from "../exam/ConsolePanel";
import { SnapshotDialog, SubmitDialog } from "../exam/SubmitDialogs";
import { Dialog } from "../ui/Dialog";
import { Banner } from "../ui/Banner";

export type FinishReason = "finished" | "time" | "ended";

interface Props {
  overview: StudentOverview;
  onOverview: (o: StudentOverview) => void;
  onFinished: (reason: FinishReason) => void;
}

const FONT_SIZES = [12, 14, 16, 18, 20, 24];
const POLL_MS = 15_000;

function prefersDark(): boolean {
  const saved = readPref("theme");
  if (saved) return saved === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ExamScreen({ overview, onOverview, onFinished }: Props) {
  const { exam, seat, clock } = overview;
  const seatId = seat.registrationId;
  const { sync, ready, restoreNote } = useDrafts(seatId);
  const conn = useStore(connection);
  const editorRef = useRef<CodeEditorHandle>(null);

  // ---- overview polling -------------------------------------------------------------------
  const refresh = useCallback(() => api.overview().then(onOverview, () => undefined), [onOverview]);
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (conn.state === "online") void refresh();
  }, [conn.state, refresh]);

  // ---- countdown -------------------------------------------------------------------------
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = clock.isPaused
    ? clock.remainingSeconds
    : (serverClock.secondsUntil(clock.deadline) ?? clock.remainingSeconds);
  const live = exam.status === "RUNNING" || exam.status === "PAUSED";
  const timeUp = live && !clock.isPaused && remaining !== null && remaining <= 0;
  const canWork = exam.status === "RUNNING" && clock.canWork && !timeUp && !seat.finished;

  // Announce time milestones once each.
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(new Set<number>());
  useEffect(() => {
    if (remaining === null || clock.isPaused) return;
    for (const mins of [10, 5, 1]) {
      if (remaining <= mins * 60 && remaining > mins * 60 - 5 && !announced.current.has(mins)) {
        announced.current.add(mins);
        setAnnouncement(`${mins} minute${mins === 1 ? "" : "s"} left.`);
      }
    }
  }, [remaining, clock.isPaused]);

  // Pause stops server saves; resuming restarts them.
  useEffect(() => {
    if (clock.isPaused) sync.block("The exam is paused. Your work is kept on this computer.");
    else if (canWork) sync.resume();
  }, [clock.isPaused, canWork, sync]);

  // Leaving: time up, finished elsewhere, or the exam ended. Save what we can first.
  const [leaving, setLeaving] = useState<FinishReason | null>(null);
  useEffect(() => {
    if (leaving) return;
    const reason: FinishReason | null = seat.finished
      ? "finished"
      : exam.status === "COMPLETED" || exam.status === "ARCHIVED"
        ? "ended"
        : timeUp
          ? "time"
          : null;
    if (!reason) return;
    setLeaving(reason);
    void sync.flush(5000).finally(() => {
      void refresh();
      onFinished(reason);
    });
  }, [seat.finished, exam.status, timeUp, leaving, sync, refresh, onFinished]);

  // ---- current question --------------------------------------------------------------------
  const openQuestions = overview.questions.filter((q) => q.access === "open");
  const [currentId, setCurrentId] = useState<string | null>(() => readPref(`${seatId}:current`));
  useEffect(() => {
    if (!openQuestions.some((q) => q.id === currentId)) {
      setCurrentId(openQuestions[0]?.id ?? null);
    }
  }, [openQuestions, currentId]);
  useEffect(() => {
    if (currentId) writePref(`${seatId}:current`, currentId);
  }, [seatId, currentId]);
  // On sign-in (including after a crash, when the preference may not have reached disk),
  // reopen the question the student last edited.
  const restoredCurrent = useRef(false);
  useEffect(() => {
    if (!ready || restoredCurrent.current) return;
    restoredCurrent.current = true;
    const latest = sync.latestQuestion();
    if (latest && openQuestions.some((q) => q.id === latest)) setCurrentId(latest);
  }, [ready, seatId, sync, openQuestions]);
  const summary = overview.questions.find((q) => q.id === currentId) ?? null;

  const [questions, setQuestions] = useState<Record<string, StudentQuestion>>({});
  const [questionError, setQuestionError] = useState<string | null>(null);
  useEffect(() => {
    if (!currentId || questions[currentId]) return;
    setQuestionError(null);
    api.question(currentId).then(
      (q) => setQuestions((all) => ({ ...all, [q.id]: q })),
      (err) =>
        setQuestionError(
          err instanceof ApiError && err.status !== 0
            ? err.message
            : "Couldn't load this question. It will appear when the connection is back.",
        ),
    );
  }, [currentId, questions, conn.state]);
  const question = currentId ? (questions[currentId] ?? null) : null;

  // ---- language per question: each language keeps its own draft --------------------------
  const [languages, setLanguages] = useState<Record<string, Language>>({});
  const language: Language | null = useMemo(() => {
    if (!question) return null;
    const chosen =
      languages[question.id] ?? (readPref(`${seatId}:${question.id}:lang`) as Language | null);
    if (chosen && question.languages.includes(chosen)) return chosen;
    // Default: a language this student already wrote in, else the first allowed one.
    return (
      question.languages.find((l) => sync.code(question.id, l) !== undefined) ??
      question.languages[0]
    );
  }, [question, languages, seatId, sync, ready]); // `ready`: drafts restored
  function chooseLanguage(l: Language) {
    if (!question) return;
    setLanguages((all) => ({ ...all, [question.id]: l }));
    writePref(`${seatId}:${question.id}:lang`, l);
  }

  // ---- editor preferences -----------------------------------------------------------------
  const [fontSize, setFontSize] = useState(() => {
    const n = Number(readPref("fontSize"));
    return FONT_SIZES.includes(n) ? n : 16;
  });
  const [dark, setDark] = useState(prefersDark);
  useEffect(() => {
    writePref("fontSize", String(fontSize));
  }, [fontSize]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const bumpFont = (dir: 1 | -1) =>
    setFontSize(
      (f) => FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, FONT_SIZES.indexOf(f) + dir))],
    );

  // ---- heartbeat and announcements ---------------------------------------------------------
  const announcements = useHeartbeat({
    enabled: !leaving,
    currentQuestionId: currentId,
    language,
  });
  const { unseen, dismiss } = useUnseen(seatId, announcements);

  const draftStatus = question && language ? sync.status(question.id, language) : null;
  const currentCode = () =>
    (question && language ? sync.code(question.id, language) : undefined) ??
    (language ? STARTER[language] : "");

  // Ctrl+S: write everything now (students press it out of habit; make it useful).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void sync.flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sync]);

  // ---- run -------------------------------------------------------------------------------
  const [stdin, setStdin] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Record<string, RunResult>>({});
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  async function run() {
    if (!question || !language) return;
    setRunning(true);
    setRunError(null);
    try {
      const r = await api.run(question.id, language, currentCode(), stdin[question.id] ?? "");
      setRuns((all) => ({ ...all, [question.id]: r }));
    } catch (err) {
      setRunError(runErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  // ---- submissions ------------------------------------------------------------------------
  const [tab, setTab] = useState<"run" | "submissions">("run");
  const [subs, setSubs] = useState<Record<string, SubmissionSummary[]>>({});
  const loadSubs = useCallback(
    (id: string) =>
      api.submissions(id).then(
        (list) => setSubs((all) => ({ ...all, [id]: list })),
        () => undefined,
      ),
    [],
  );
  useEffect(() => {
    if (currentId) void loadSubs(currentId);
  }, [currentId, loadSubs]);
  const onSubmissions = useCallback(
    (list: SubmissionSummary[]) => currentId && setSubs((all) => ({ ...all, [currentId]: list })),
    [currentId],
  );

  const [submitOpen, setSubmitOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{ s: SubmissionDetail; fresh: boolean } | null>(null);
  function onSubmitted(s: SubmissionDetail) {
    setSubmitOpen(false);
    setSnapshot({ s, fresh: true });
    setTab("submissions");
    void loadSubs(s.examQuestionId);
    void refresh();
  }
  async function view(id: string) {
    try {
      setSnapshot({ s: await api.submission(id), fresh: false });
    } catch (err) {
      setRunError(runErrorMessage(err));
    }
  }

  // ---- sequential "next" and finishing --------------------------------------------------------
  const [confirmNext, setConfirmNext] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLast = summary
    ? summary.ordinal === Math.max(...overview.questions.map((q) => q.ordinal))
    : true;

  async function goNext() {
    if (!summary) return;
    setBusy(true);
    setActionError(null);
    await sync.flush(5000);
    try {
      onOverview(await api.next(summary.id));
      setConfirmNext(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't move on.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setActionError(null);
    await sync.flush(5000);
    try {
      onOverview(await api.finish());
      setConfirmFinish(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't finish the exam.");
      setBusy(false);
    }
  }

  const unsubmitted = overview.questions.filter((q) => q.submissionCount === 0);
  const unsynced = sync.unsyncedCount();
  const low = remaining !== null && remaining <= 300;

  return (
    <div className="exam">
      <header className="topbar">
        <div className="topbar-title">
          <strong>{exam.title}</strong>
          <span className="muted">Student {seat.studentId}</span>
        </div>
        <div className="topbar-status">
          <span
            className={`pill ${conn.state === "online" ? "ok" : "bad"}`}
            title={conn.state === "online" ? "Connected to the exam server" : undefined}
          >
            <span className="dot" aria-hidden />
            {conn.state === "online"
              ? "Online"
              : `Offline since ${timeOf(new Date(conn.since).toISOString())}`}
          </span>
          <span
            className={`countdown ${clock.isPaused ? "paused" : low ? "low" : ""}`}
            role="timer"
            aria-label="Time left"
          >
            {clock.isPaused ? "Paused · " : ""}
            {remaining === null ? "--:--" : formatCountdown(remaining)}
          </span>
          <span className="sr-only" aria-live="assertive">
            {announcement}
          </span>
          {exam.allowEarlySubmit && (
            <button type="button" onClick={() => setConfirmFinish(true)} disabled={!canWork}>
              Finish exam
            </button>
          )}
        </div>
      </header>

      {conn.state === "offline" && (
        <Banner tone="warning">
          You&apos;re offline. Keep working: everything is saved on this computer and will be sent
          when the connection is back.
        </Banner>
      )}
      {clock.isPaused && (
        <Banner tone="info">
          The invigilator has paused the exam. The timer is stopped and editing is off until it
          resumes.
        </Banner>
      )}
      <Announcements items={unseen} onDismiss={dismiss} />
      {restoreNote && <Banner tone="info">{restoreNote}</Banner>}
      {leaving && (
        <Banner tone="info">
          {leaving === "time" ? "Time is up. " : ""}Saving your last changes…
        </Banner>
      )}

      <div className="exam-body">
        <QuestionList
          questions={overview.questions}
          currentId={currentId}
          onSelect={setCurrentId}
          hasDraft={(id) => exam.allowedLanguages.some((l) => sync.code(id, l) !== undefined)}
          maxSubmissions={exam.maxSubmissionsPerQuestion}
        />

        <QuestionPanel
          question={question}
          error={questionError}
          onUseSample={(input) => {
            if (!currentId) return;
            setStdin((all) => ({ ...all, [currentId]: input }));
            setTab("run");
          }}
        />

        <section className="work" aria-label="Your answer">
          <div className="toolbar">
            <label className="inline">
              <span>Language</span>
              <select
                value={language ?? ""}
                onChange={(e) => chooseLanguage(e.target.value as Language)}
                disabled={!question}
              >
                {question?.languages.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
            <div className="btn-group" role="group" aria-label="Font size">
              <button
                type="button"
                className="icon"
                aria-label="Smaller text"
                title="Smaller text"
                onClick={() => bumpFont(-1)}
              >
                A−
              </button>
              <button
                type="button"
                className="icon"
                aria-label="Larger text"
                title="Larger text"
                onClick={() => bumpFont(1)}
              >
                A+
              </button>
            </div>
            <button
              type="button"
              className="icon"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              title={dark ? "Light theme" : "Dark theme"}
              aria-pressed={dark}
              onClick={() => {
                setDark((d) => {
                  writePref("theme", d ? "light" : "dark");
                  return !d;
                });
              }}
            >
              {dark ? "☀" : "☾"}
            </button>
            <button
              type="button"
              className="icon"
              aria-label="Find in code"
              title="Find (Ctrl+F)"
              onClick={() => editorRef.current?.find()}
            >
              ⌕
            </button>
            <div className="toolbar-end">
              {exam.navigationPolicy === "SEQUENTIAL" && !isLast && (
                <button
                  type="button"
                  onClick={() => setConfirmNext(true)}
                  disabled={!canWork || !summary}
                >
                  Next question
                </button>
              )}
              <button
                type="button"
                className="primary"
                onClick={() => setSubmitOpen(true)}
                disabled={!canWork || !question || !language}
              >
                Submit…
              </button>
            </div>
          </div>
          {sync.blocked && !clock.isPaused && canWork && (
            <Banner tone="warning">{sync.blocked}</Banner>
          )}
          {draftStatus?.problem &&
            draftStatus.problem.startsWith("Couldn't save on this computer") && (
              <Banner tone="danger">{draftStatus.problem}</Banner>
            )}
          <div className="editor-wrap">
            {ready && question && language ? (
              <CodeEditor
                ref={editorRef}
                modelKey={`${question.id}:${language}`}
                language={language}
                initialValue={sync.code(question.id, language) ?? STARTER[language]}
                onChange={(key, code) => {
                  const [qid, lang] = key.split(":");
                  sync.edit(qid, lang, code);
                }}
                readOnly={!canWork}
                fontSize={fontSize}
                dark={dark}
                label={`Code for question ${question.ordinal} in ${LANGUAGE_LABEL[language]}`}
              />
            ) : (
              <p className="muted pad">{ready ? "Choose a question." : "Restoring your work…"}</p>
            )}
          </div>
          <div className="editor-status">
            <SaveStatus status={draftStatus} />
            {!canWork && !clock.isPaused && <span className="muted small">Editing is off.</span>}
          </div>
          {currentId && (
            <ConsolePanel
              stdin={stdin[currentId] ?? ""}
              onStdin={(s) => setStdin((all) => ({ ...all, [currentId]: s }))}
              onRun={() => void run()}
              running={running}
              canRun={canWork && !!question}
              result={runs[currentId] ?? null}
              runError={runError}
              questionId={currentId}
              submissions={subs[currentId] ?? null}
              onSubmissions={onSubmissions}
              onView={(id) => void view(id)}
              tab={tab}
              onTab={setTab}
            />
          )}
        </section>
      </div>

      {question && language && summary && (
        <SubmitDialog
          open={submitOpen}
          onClose={() => setSubmitOpen(false)}
          questionId={question.id}
          questionLabel={`question ${question.ordinal}`}
          language={language}
          getCode={currentCode}
          used={summary.submissionCount}
          max={exam.maxSubmissionsPerQuestion}
          flush={() => sync.flush(5000)}
          onSubmitted={onSubmitted}
        />
      )}
      <SnapshotDialog
        submission={snapshot?.s ?? null}
        justSubmitted={snapshot?.fresh ?? false}
        onClose={() => setSnapshot(null)}
      />

      <Dialog
        open={confirmNext}
        title={`Move on to question ${(summary?.ordinal ?? 0) + 1}?`}
        onClose={() => !busy && setConfirmNext(false)}
        actions={
          <>
            <button type="button" onClick={() => setConfirmNext(false)} disabled={busy}>
              Stay here
            </button>
            <button type="button" className="primary" onClick={() => void goNext()} disabled={busy}>
              {busy ? "Moving on…" : "Move on"}
            </button>
          </>
        }
      >
        {actionError && <Banner tone="danger">{actionError}</Banner>}
        <p>
          This exam is answered in order. <strong>You won&apos;t be able to come back</strong> to
          question {summary?.ordinal}.
        </p>
        {summary?.submissionCount === 0 && (
          <p className="warn-text">You haven&apos;t submitted an answer for this question yet.</p>
        )}
      </Dialog>

      <Dialog
        open={confirmFinish}
        title="Finish the exam now?"
        onClose={() => !busy && setConfirmFinish(false)}
        actions={
          <>
            <button type="button" onClick={() => setConfirmFinish(false)} disabled={busy}>
              Keep working
            </button>
            <button
              type="button"
              className="primary danger"
              onClick={() => void finish()}
              disabled={busy}
            >
              {busy ? "Finishing…" : "Finish exam"}
            </button>
          </>
        }
      >
        {actionError && <Banner tone="danger">{actionError}</Banner>}
        <p>You won&apos;t be able to change or submit anything after this.</p>
        {unsubmitted.length > 0 && (
          <p className="warn-text">
            No submission yet for {unsubmitted.map((q) => `question ${q.ordinal}`).join(", ")}.
          </p>
        )}
        {unsynced > 0 && (
          <p className="warn-text">
            Some changes haven&apos;t reached the server yet; we&apos;ll send them first.
          </p>
        )}
      </Dialog>
    </div>
  );
}
