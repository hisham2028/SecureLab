import { useEffect, useId } from "react";
import { isFinalVerdict, type RunResult, type SubmissionSummary } from "@securelab/shared";
import { api, ApiError } from "../lib/api";
import { LANGUAGE_LABEL, RUN_LABEL, SUBMISSION_LABEL, timeOf } from "../lib/labels";

interface Props {
  stdin: string;
  onStdin: (s: string) => void;
  onRun: () => void;
  running: boolean;
  canRun: boolean;
  result: RunResult | null;
  runError: string | null;
  questionId: string;
  submissions: SubmissionSummary[] | null;
  onSubmissions: (s: SubmissionSummary[]) => void;
  onView: (id: string) => void;
  tab: "run" | "submissions";
  onTab: (t: "run" | "submissions") => void;
}

export function ConsolePanel(p: Props) {
  const inputId = useId();
  const hasPending = p.submissions?.some((s) => !isFinalVerdict(s.status)) ?? false;

  // Status updates for submissions waiting to be graded.
  const { questionId, onSubmissions, tab } = p;
  useEffect(() => {
    if (tab !== "submissions" || !hasPending) return;
    const id = window.setInterval(() => {
      api.submissions(questionId).then(onSubmissions, () => undefined);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [tab, hasPending, questionId, onSubmissions]);

  return (
    <section className="console" aria-label="Run and submissions">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={p.tab === "run"}
          aria-controls="tab-run"
          id="tab-run-btn"
          onClick={() => p.onTab("run")}
        >
          Run
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={p.tab === "submissions"}
          aria-controls="tab-subs"
          id="tab-subs-btn"
          onClick={() => p.onTab("submissions")}
        >
          Submissions{p.submissions ? ` (${p.submissions.length})` : ""}
        </button>
      </div>

      {p.tab === "run" ? (
        <div className="run" id="tab-run" role="tabpanel" aria-labelledby="tab-run-btn">
          <div className="run-input">
            <label htmlFor={inputId}>Input for your program</label>
            <textarea
              id={inputId}
              value={p.stdin}
              onChange={(e) => p.onStdin(e.target.value)}
              spellCheck={false}
              placeholder="e.g. 1 2"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (p.canRun && !p.running) p.onRun();
                }
              }}
            />
            <div className="row">
              <button
                type="button"
                onClick={p.onRun}
                disabled={!p.canRun || p.running}
                title="Run with this input (Ctrl+Enter)"
              >
                {p.running ? "Running…" : "Run"}
                <kbd>Ctrl+Enter</kbd>
              </button>
              <span className="hint">
                Runs use only the input above. They don&apos;t count as submissions.
              </span>
            </div>
          </div>
          <div className="run-output" aria-live="polite">
            {p.runError && <p className="error">{p.runError}</p>}
            {!p.runError && !p.result && <p className="muted">Output appears here.</p>}
            {p.result && !p.runError && <RunOutput r={p.result} />}
          </div>
        </div>
      ) : (
        <div className="subs" id="tab-subs" role="tabpanel" aria-labelledby="tab-subs-btn">
          {p.submissions === null ? (
            <p className="muted">Loading…</p>
          ) : p.submissions.length === 0 ? (
            <p className="muted">
              Nothing submitted for this question yet. Use <strong>Submit</strong> above the editor
              when you&apos;re ready.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Language</th>
                  <th scope="col">Received</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.submissions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sequence}</td>
                    <td>{LANGUAGE_LABEL[s.language]}</td>
                    <td>{timeOf(s.createdAt)}</td>
                    <td>{SUBMISSION_LABEL[s.status]}</td>
                    <td>
                      <button type="button" className="small" onClick={() => p.onView(s.id)}>
                        View code
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function RunOutput({ r }: { r: RunResult }) {
  const bad = r.verdict !== "ACCEPTED" && r.verdict !== "WRONG_ANSWER";
  return (
    <div>
      <p className={bad ? "run-status warn-text" : "run-status"}>
        <strong>{RUN_LABEL[r.verdict]}</strong>
        {r.timeSeconds !== null && <span className="muted"> · {r.timeSeconds.toFixed(2)} s</span>}
        {r.memoryKb !== null && (
          <span className="muted"> · {Math.round(r.memoryKb / 1024)} MB</span>
        )}
      </p>
      {r.compileOutput && (
        <>
          <h3>Compiler messages</h3>
          <pre className="out err">{r.compileOutput}</pre>
        </>
      )}
      <h3>Output</h3>
      <pre className="out">{r.stdout || <span className="muted">(nothing printed)</span>}</pre>
      {r.stderr && (
        <>
          <h3>Errors</h3>
          <pre className="out err">{r.stderr}</pre>
        </>
      )}
      {r.truncated && <p className="hint">Output was cut short because it was very long.</p>}
    </div>
  );
}

export function runErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "Can't reach the exam server. Your code is saved; try again.";
    return err.message;
  }
  return "The run didn't finish. Try again.";
}
