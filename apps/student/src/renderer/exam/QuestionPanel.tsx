import type { StudentQuestion } from "@securelab/shared";

interface Props {
  question: StudentQuestion | null;
  error: string | null;
  onUseSample: (input: string) => void;
}

export function QuestionPanel({ question, error, onUseSample }: Props) {
  if (error)
    return (
      <section className="statement">
        <p className="error">{error}</p>
      </section>
    );
  if (!question) return <section className="statement" aria-busy="true" />;
  const q = question;
  return (
    <section className="statement" aria-labelledby="q-title">
      <p className="muted small">
        Question {q.ordinal} · {q.points} points · time limit {q.timeLimitMs / 1000} s · memory{" "}
        {Math.round(q.memoryLimitKb / 1024)} MB
      </p>
      <h1 id="q-title">{q.title}</h1>
      <div className="prewrap">{q.statement}</div>
      {q.inputFormat && (
        <>
          <h2>Input</h2>
          <div className="prewrap">{q.inputFormat}</div>
        </>
      )}
      {q.outputFormat && (
        <>
          <h2>Output</h2>
          <div className="prewrap">{q.outputFormat}</div>
        </>
      )}
      {q.constraints && (
        <>
          <h2>Constraints</h2>
          <div className="prewrap">{q.constraints}</div>
        </>
      )}
      {q.samples.map((s) => (
        <div key={s.ordinal} className="sample">
          <div className="sample-head">
            <h2>Example {s.ordinal}</h2>
            <button type="button" className="small" onClick={() => onUseSample(s.input)}>
              Use as run input
            </button>
          </div>
          <div className="sample-grid">
            <div>
              <h3>Input</h3>
              <pre>{s.input}</pre>
            </div>
            <div>
              <h3>Output</h3>
              <pre>{s.expectedOutput}</pre>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
