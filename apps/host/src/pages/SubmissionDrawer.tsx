import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { SubmissionReview } from "../api";
import { Drawer } from "../ui/Drawer";
import { ErrorBanner, formatDateTime, LANGUAGE_LABEL, Notice } from "../ui/bits";
import { ReasonDialog } from "../ui/ReasonDialog";
import { VERDICT } from "../ui/live-labels";

/** Source, grading attempts and per-test results for one submission. Hosts and admins only. */
export function SubmissionDrawer({
  examId,
  submissionId,
  onClose,
  onChanged,
}: {
  examId: string;
  submissionId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [s, setS] = useState<SubmissionReview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [regrading, setRegrading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (submissionId) void api.submissionReview(examId, submissionId).then(setS, setError);
  }, [examId, submissionId]);
  useEffect(() => {
    setS(null);
    setError(null);
    setNotice(null);
    load();
  }, [load]);

  const completed = s?.evaluations.find((e) => e.outcome === "COMPLETED");
  const settings = completed?.settings as
    | {
        cpuTimeSeconds?: number;
        memoryKb?: number;
        comparisonMode?: string;
        scoringMode?: string;
        providerVersion?: string;
        languageId?: number;
      }
    | undefined;

  return (
    <>
      <Drawer
        open={submissionId !== null}
        title={s ? `Submission ${s.sequence}: Q${s.question.ordinal}` : "Submission"}
        onClose={onClose}
      >
        <ErrorBanner error={error} />
        {notice && <Notice tone="success">{notice}</Notice>}
        {s && (
          <div className="seat">
            <dl className="dl">
              <div>
                <dt>Student</dt>
                <dd>
                  {s.fullName} <span className="mono muted">{s.studentId}</span>
                </dd>
              </div>
              <div>
                <dt>Question</dt>
                <dd>
                  Q{s.question.ordinal}. {s.question.title} ({s.question.points} points)
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>
                  {formatDateTime(s.createdAt)}
                  {s.submittedByStaff && " by staff (saved draft)"}
                </dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>{LANGUAGE_LABEL[s.language]}</dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>
                  {VERDICT[s.status]}
                  {s.testsTotal !== null && ` · ${s.testsPassed}/${s.testsTotal} hidden tests`}
                  {s.score !== null && ` · ${s.score} / ${s.maxScore}`}
                </dd>
              </div>
              {settings && (
                <div>
                  <dt>Run with</dt>
                  <dd>
                    {settings.cpuTimeSeconds} s, {Math.round((settings.memoryKb ?? 0) / 1024)} MB,{" "}
                    {settings.comparisonMode === "EXACT"
                      ? "exact output"
                      : "trailing spaces ignored"}
                    , {settings.scoringMode === "ALL_OR_NOTHING" ? "all or nothing" : "weighted"},
                    Judge0 {settings.providerVersion}
                  </dd>
                </div>
              )}
              <div>
                <dt>Fingerprint</dt>
                <dd className="mono">{s.codeSha256.slice(0, 16)}</dd>
              </div>
            </dl>
            {s.job?.status === "FAILED" && (
              <Notice tone="warning">
                The judge couldn't grade this after {s.job.attempts} tries. This is not the
                student's fault.{" "}
                <button className="link" onClick={() => setRegrading(true)}>
                  Grade it again
                </button>
              </Notice>
            )}
            <h3 className="h3">Code</h3>
            <pre className="code-block">{s.code}</pre>
            {completed?.compileOutput && (
              <>
                <h3 className="h3">Compiler output</h3>
                <pre className="code-block">{completed.compileOutput}</pre>
              </>
            )}
            {completed && (
              <>
                <h3 className="h3">Hidden tests</h3>
                <table className="compact">
                  <thead>
                    <tr>
                      <th scope="col">Test</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="num">
                        Weight
                      </th>
                      <th scope="col" className="num">
                        Time
                      </th>
                      <th scope="col" className="num">
                        Memory
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {completed.tests.map((t, i) => (
                      <tr key={t.ordinal}>
                        <td>{i + 1}</td>
                        <td className={t.passed ? undefined : "text-danger"}>
                          {t.passed ? "Passed" : VERDICT[t.verdict]}
                        </td>
                        <td className="num">{t.weight}</td>
                        <td className="num">
                          {t.timeSeconds === null ? "—" : `${t.timeSeconds.toFixed(2)} s`}
                        </td>
                        <td className="num">
                          {t.memoryKb === null ? "—" : `${Math.round(t.memoryKb / 1024)} MB`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {s.evaluations.length > 0 && (
              <>
                <h3 className="h3">Grading attempts</h3>
                <ul className="history">
                  {s.evaluations.map((e) => (
                    <li key={e.attempt}>
                      {formatDateTime(e.finishedAt)}: attempt {e.attempt},{" "}
                      {e.outcome === "COMPLETED"
                        ? `graded ${e.verdict ? VERDICT[e.verdict] : ""}`
                        : `judge problem (${e.error ?? "unknown"})`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Drawer>
      <ReasonDialog
        open={regrading}
        title="Grade this submission again?"
        body="It goes back in the queue with a fresh set of retries."
        confirmLabel="Grade again"
        onConfirm={async (reason) => {
          await api.regrade(examId, submissionId!, reason);
          setRegrading(false);
          setNotice("Queued for grading.");
          load();
          onChanged();
        }}
        onCancel={() => setRegrading(false)}
      />
    </>
  );
}
