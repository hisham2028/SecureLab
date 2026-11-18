import { useEffect } from "react";
import type { StudentResult } from "@securelab/shared";

/** A student's own published result. Only what the teacher published; never other students. */
export function Result({ result, onBack }: { result: StudentResult; onBack: () => void }) {
  useEffect(() => {
    document.title = `Result · ${result.examTitle} · SecureLab`;
  }, [result.examTitle]);
  return (
    <div className="center-page">
      <main className="card result">
        <h1>{result.examTitle}</h1>
        <p className="muted">
          Student {result.studentId} · published{" "}
          {new Date(result.publishedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <p className="result-total">
          <span className="result-score">{result.total}</span>
          <span className="muted"> out of {result.maxTotal}</span>
        </p>
        <table className="result-table">
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col" className="num">
                Mark
              </th>
            </tr>
          </thead>
          <tbody>
            {result.questions.map((q) => (
              <tr key={q.ordinal}>
                <td>
                  {q.ordinal}. {q.title}
                </td>
                <td className="num">
                  {q.mark} / {q.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Questions about your mark? Ask your teacher.</p>
        <button type="button" onClick={onBack}>
          Done
        </button>
      </main>
    </div>
  );
}
