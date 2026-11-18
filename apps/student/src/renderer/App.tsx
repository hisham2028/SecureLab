import { useCallback, useEffect, useState } from "react";
import type { StudentOverview, StudentResult } from "@securelab/shared";
import { api, ApiError, seatBlocked, sessionEnded } from "./lib/api";
import { useStore } from "./lib/store";
import { SignIn } from "./screens/SignIn";
import { PreExam } from "./screens/PreExam";
import { ExamScreen, type FinishReason } from "./screens/ExamScreen";
import { Done } from "./screens/Done";
import { Result } from "./screens/Result";
import { Blocked } from "./screens/Blocked";
import { Banner } from "./ui/Banner";

type Stage =
  | { kind: "signin"; notice: string | null }
  | { kind: "loading" }
  | { kind: "pre" }
  | { kind: "exam" }
  | { kind: "done"; reason: FinishReason }
  | { kind: "result"; result: StudentResult };

/** Where a freshly loaded overview should take the student. */
function stageFor(o: StudentOverview): Stage {
  if (o.seat.finished) return { kind: "done", reason: "finished" };
  if (o.exam.status === "COMPLETED" || o.exam.status === "ARCHIVED")
    return { kind: "done", reason: "ended" };
  const live = o.exam.status === "RUNNING" || o.exam.status === "PAUSED";
  if (o.seat.entered && live) {
    return o.clock.remainingSeconds === 0 && !o.clock.isPaused
      ? { kind: "done", reason: "time" }
      : { kind: "exam" };
  }
  return { kind: "pre" };
}

export function App() {
  const [stage, setStage] = useState<Stage>({ kind: "signin", notice: null });
  const [overview, setOverview] = useState<StudentOverview | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const ended = useStore(sessionEnded);
  const blocked = useStore(seatBlocked);

  useEffect(() => {
    void window.securelab?.environmentInfo().then((i) => setServerUrl(i.apiUrl));
  }, []);

  // The server ended the session (PIN reset, seat removed): back to sign-in, with the reason.
  useEffect(() => {
    if (ended) {
      setOverview(null);
      setStage({ kind: "signin", notice: ended });
      sessionEnded.set(null);
    }
  }, [ended]);

  const load = useCallback(async () => {
    setStage({ kind: "loading" });
    setLoadError(null);
    try {
      const o = await api.overview();
      setOverview(o);
      setStage(stageFor(o));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load your exam.");
    }
  }, []);

  const onOverview = useCallback((o: StudentOverview) => {
    setOverview(o);
    // Entering moves the student from the pre-exam page into the exam.
    setStage((s) => (s.kind === "pre" ? stageFor(o) : s));
  }, []);

  // Locked-screen exams: the app stays full screen and on top while the exam screen shows.
  const locked = stage.kind === "exam" && overview?.exam.lockScreen === true;
  useEffect(() => {
    void window.securelab?.setLockdown(locked);
  }, [locked]);

  const signOut = useCallback(() => {
    void api.signOut();
    setOverview(null);
    setStage({ kind: "signin", notice: null });
  }, []);

  if (!window.securelab) {
    return (
      <div className="center-page">
        <Banner tone="danger">Open SecureLab from the desktop app.</Banner>
      </div>
    );
  }

  if (blocked && stage.kind !== "signin" && stage.kind !== "result") {
    return <Blocked message={blocked} onUnblocked={() => void load()} />;
  }

  switch (stage.kind) {
    case "signin":
      return (
        <SignIn
          onSignedIn={() => void load()}
          onResult={(result) => setStage({ kind: "result", result })}
          notice={stage.notice}
          serverUrl={serverUrl}
        />
      );
    case "result":
      return (
        <Result result={stage.result} onBack={() => setStage({ kind: "signin", notice: null })} />
      );
    case "loading":
      return (
        <div className="center-page">
          {loadError ? (
            <>
              <Banner tone="danger">{loadError}</Banner>
              <button type="button" onClick={() => void load()}>
                Try again
              </button>
            </>
          ) : (
            <p className="muted">Loading your exam…</p>
          )}
        </div>
      );
    case "pre":
      return <PreExam overview={overview!} onOverview={onOverview} onSignOut={signOut} />;
    case "exam":
      return (
        <ExamScreen
          overview={overview!}
          onOverview={onOverview}
          onFinished={(reason) => setStage({ kind: "done", reason })}
        />
      );
    case "done":
      return <Done reason={stage.reason} overview={overview} onSignOut={signOut} />;
  }
}
