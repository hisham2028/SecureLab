import type { StudentQuestionSummary } from "@securelab/shared";

interface Props {
  questions: StudentQuestionSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  hasDraft: (id: string) => boolean;
  maxSubmissions: number;
}

export function QuestionList({ questions, currentId, onSelect, hasDraft, maxSubmissions }: Props) {
  return (
    <nav className="qlist" aria-label="Questions">
      <h2 className="sr-only">Questions</h2>
      <ol>
        {questions.map((q) => {
          const selectable = q.access === "open";
          const state =
            q.submissionCount > 0
              ? `Submitted ${q.submissionCount} of ${maxSubmissions}`
              : q.access === "locked"
                ? "Opens later"
                : q.access === "closed"
                  ? "Closed"
                  : hasDraft(q.id)
                    ? "Draft saved"
                    : "Not started";
          return (
            <li key={q.id}>
              <button
                type="button"
                className={`qitem ${q.id === currentId ? "current" : ""} ${q.access}`}
                aria-current={q.id === currentId ? "true" : undefined}
                disabled={!selectable}
                onClick={() => onSelect(q.id)}
              >
                <span className="qnum">{q.ordinal}</span>
                <span className="qtext">
                  <span className="qtitle">{q.title ?? `Question ${q.ordinal}`}</span>
                  <span className="qmeta">
                    {q.points} pts · {state}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
