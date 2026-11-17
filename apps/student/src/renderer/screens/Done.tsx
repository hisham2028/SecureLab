import { useEffect } from "react";
import type { StudentOverview } from "@securelab/shared";
import type { FinishReason } from "./ExamScreen";

const TITLE: Record<FinishReason, string> = {
  finished: "You've finished the exam",
  time: "Time is up",
  ended: "The exam has ended",
};

export function Done({
  reason,
  overview,
  onSignOut,
}: {
  reason: FinishReason;
  overview: StudentOverview | null;
  onSignOut: () => void;
}) {
  useEffect(() => {
    document.title = `${TITLE[reason]} · SecureLab`;
  }, [reason]);
  return (
    <div className="center-page">
      <main className="card done">
        <h1>{TITLE[reason]}</h1>
        <p>Your submissions are stored on the exam server. You can&apos;t change them now.</p>
        {overview && overview.questions.length > 0 && (
          <ul className="done-list">
            {overview.questions.map((q) => (
              <li key={q.id}>
                Question {q.ordinal}
                {q.title ? `: ${q.title}` : ""} ·{" "}
                {q.submissionCount === 0
                  ? "nothing submitted"
                  : `${q.submissionCount} submission${q.submissionCount === 1 ? "" : "s"}`}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">Follow the invigilator&apos;s instructions before you leave.</p>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </main>
    </div>
  );
}
