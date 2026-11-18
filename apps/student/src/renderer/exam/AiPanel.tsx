import { useEffect, useId, useRef, useState } from "react";
import {
  MAX_AI_PROMPT_LENGTH,
  type AiExchangeView,
  type Language,
  type StudentAiAccess,
} from "@securelab/shared";
import { api, ApiError } from "../lib/api";
import { timeOf } from "../lib/labels";

interface Props {
  questionId: string;
  access: StudentAiAccess;
  language: Language | null;
  getCode: () => string;
  canWork: boolean;
  onRemaining: (remaining: number) => void;
}

const MODE_TEXT: Record<StudentAiAccess["mode"], string> = {
  HINTS_ONLY:
    "Hints only: the AI can explain errors and point you in the right direction, but it won't write your answer.",
  FULL: "Full help: the AI can explain, fix and write code for this question.",
};

/** AI help for one question. The server decides the mode and the limit; this only asks. */
export function AiPanel(p: Props) {
  const inputId = useId();
  const [history, setHistory] = useState<AiExchangeView[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const { questionId } = p;
  useEffect(() => {
    setHistory(null);
    setError(null);
    api.aiHistory(questionId).then(setHistory, () => setHistory([]));
  }, [questionId]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [history, asking]);

  const remaining = p.access.remaining;
  const canAsk = p.canWork && !!p.language && !asking && remaining > 0 && prompt.trim().length >= 3;

  async function ask() {
    if (!canAsk || !p.language) return;
    setAsking(true);
    setError(null);
    try {
      const r = await api.askAi(p.questionId, prompt.trim(), p.language, p.getCode());
      setHistory((h) => [...(h ?? []), r.exchange]);
      setPrompt("");
      p.onRemaining(r.remaining);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === "OFFLINE"
            ? "Can't reach the exam server. Your question wasn't sent."
            : err.message
          : "Something went wrong. Try again.",
      );
      api.aiHistory(p.questionId).then(setHistory, () => undefined);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="ai" id="tab-ai" role="tabpanel" aria-labelledby="tab-ai-btn">
      <div className="ai-log" aria-live="polite">
        <p className="hint">{MODE_TEXT[p.access.mode]}</p>
        {history === null && <p className="muted">Loading…</p>}
        {history?.map((e) => (
          <div key={e.id} className="ai-exchange">
            <p className="ai-q">
              <span className="muted small">You, {timeOf(e.createdAt)}</span>
              <br />
              {e.prompt}
            </p>
            <div className={e.status === "FAILED" ? "ai-a failed" : "ai-a"}>
              {e.status === "FAILED" ? "No answer. This didn't use up a question." : e.reply}
            </div>
          </div>
        ))}
        {asking && <p className="muted">The AI is thinking. This can take up to a minute.</p>}
        {error && <p className="error">{error}</p>}
        <div ref={end} />
      </div>
      <div className="ai-ask">
        <label htmlFor={inputId}>Ask about this question</label>
        <textarea
          id={inputId}
          value={prompt}
          maxLength={MAX_AI_PROMPT_LENGTH}
          disabled={!p.canWork || remaining === 0}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. What does this compiler error mean?"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <div className="row">
          <button type="button" onClick={() => void ask()} disabled={!canAsk}>
            {asking ? "Asking…" : "Ask"}
            <kbd>Ctrl+Enter</kbd>
          </button>
          <span className="hint">
            {remaining === 0
              ? "You've used all your AI questions for this question."
              : `${remaining} of ${p.access.limit} left.`}{" "}
            Your current code is sent with each question, and exam staff can read what you ask.
          </span>
        </div>
      </div>
    </div>
  );
}
