import { useEffect, useState } from "react";
import * as api from "../api";
import type { Exam, QuestionSummary } from "../api";
import { Drawer } from "../ui/Drawer";
import { ErrorBanner, LANGUAGE_LABEL, Notice } from "../ui/bits";

interface Pick {
  questionId: string;
  /** null = use the latest version when saving. */
  questionVersionId: string | null;
  version: number | null;
  title: string;
  points: number;
}

export function QuestionsTab({
  exam,
  canEdit,
  canSeeBank,
  onChange,
}: {
  exam: Exam;
  canEdit: boolean;
  canSeeBank: boolean;
  onChange: (e: Exam) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = exam.questions.reduce((s, q) => s + q.points, 0);

  return (
    <div>
      <div className="tab-toolbar">
        <p className="muted">
          {exam.questions.length === 0
            ? "No questions yet."
            : `${exam.questions.length} questions · ${total} points. Each question is pinned to the version shown, so later edits in the bank don't change this exam.`}
        </p>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            Choose questions
          </button>
        )}
      </div>
      {!canEdit && exam.status !== "DRAFT" && exam.status !== "SCHEDULED" && (
        <Notice>Questions are locked because this exam is published.</Notice>
      )}
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col" className="num">
                #
              </th>
              <th scope="col">Question</th>
              <th scope="col">Version</th>
              <th scope="col">Languages</th>
              <th scope="col" className="num">
                Hidden tests
              </th>
              <th scope="col" className="num">
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {exam.questions.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  <strong>This exam has no questions.</strong>{" "}
                  {canEdit ? (
                    <button className="link" onClick={() => setOpen(true)}>
                      Choose questions from the bank
                    </button>
                  ) : null}
                </td>
              </tr>
            )}
            {exam.questions.map((q) => (
              <tr key={q.id}>
                <td className="num">{q.ordinal}</td>
                <td>
                  {canSeeBank ? <a href={`#/questions/${q.questionId}`}>{q.title}</a> : q.title}
                </td>
                <td>v{q.version}</td>
                <td>{q.allowedLanguages.map((l) => LANGUAGE_LABEL[l]).join(", ")}</td>
                <td className="num">
                  {q.hiddenTestCount === 0 ? (
                    <span className="text-warning">None (needed to publish)</span>
                  ) : (
                    q.hiddenTestCount
                  )}
                </td>
                <td className="num">{q.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <ChooseQuestions
          exam={exam}
          onClose={() => setOpen(false)}
          onSaved={(e) => (onChange(e), setOpen(false))}
        />
      )}
    </div>
  );
}

function ChooseQuestions({
  exam,
  onClose,
  onSaved,
}: {
  exam: Exam;
  onClose: () => void;
  onSaved: (e: Exam) => void;
}) {
  const [bank, setBank] = useState<QuestionSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [picks, setPicks] = useState<Pick[]>(() =>
    exam.questions.map((q) => ({
      questionId: q.questionId,
      questionVersionId: q.questionVersionId,
      version: q.version,
      title: q.title,
      points: q.points,
    })),
  );

  useEffect(() => {
    api.listQuestions().then((qs) => setBank(qs.filter((q) => !q.archived)), setError);
  }, []);

  const latest = new Map((bank ?? []).map((q) => [q.id, q]));
  const picked = new Set(picks.map((p) => p.questionId));
  const q = filter.trim().toLowerCase();
  const available = (bank ?? []).filter(
    (b) =>
      !picked.has(b.id) &&
      (!q || b.title.toLowerCase().includes(q) || b.tags.some((t) => t.includes(q))),
  );

  const update = (i: number, patch: Partial<Pick>) =>
    setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: -1 | 1) =>
    setPicks((ps) => {
      const next = [...ps];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const resolved = await Promise.all(
        picks.map(async (p) => ({
          questionVersionId: p.questionVersionId ?? (await api.getQuestion(p.questionId)).id,
          points: p.points,
        })),
      );
      onSaved(await api.setExamQuestions(exam.id, exam.revision, resolved));
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title="Choose questions"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving
              ? "Saving…"
              : `Save ${picks.length} ${picks.length === 1 ? "question" : "questions"}`}
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <h3 className="h3">In this exam</h3>
      {picks.length === 0 && <p className="muted">Add questions from the list below.</p>}
      <ol className="pick-list">
        {picks.map((p, i) => {
          const newer =
            p.version !== null && (latest.get(p.questionId)?.latestVersion ?? 0) > p.version;
          return (
            <li key={p.questionId} className="pick">
              <div className="pick-main">
                <strong>{p.title}</strong>
                <span className="muted">
                  {p.version === null ? "latest version" : `v${p.version}`}
                  {newer && (
                    <>
                      {" · "}
                      <button
                        className="link"
                        onClick={() => update(i, { questionVersionId: null, version: null })}
                      >
                        Use latest (v{latest.get(p.questionId)!.latestVersion})
                      </button>
                    </>
                  )}
                </span>
              </div>
              <label className="points">
                <span>Points</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={p.points}
                  onChange={(e) => update(i, { points: Number(e.target.value) })}
                />
              </label>
              <div className="pick-actions">
                <button
                  className="icon-btn"
                  aria-label={`Move ${p.title} up`}
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Move ${p.title} down`}
                  title="Move down"
                  disabled={i === picks.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${p.title}`}
                  title="Remove"
                  onClick={() => setPicks((ps) => ps.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <h3 className="h3">Question bank</h3>
      <label className="search">
        <span>Search</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Title or tag"
        />
      </label>
      {bank === null && !error && <p className="muted">Loading questions…</p>}
      {bank !== null && bank.length === 0 && (
        <p className="muted">
          The bank is empty. <a href="#/questions/new">Write a question</a> first.
        </p>
      )}
      <ul className="bank-list">
        {available.map((b) => (
          <li key={b.id}>
            <div>
              <strong>{b.title}</strong>
              <span className="muted">
                {" "}
                v{b.latestVersion} · {b.allowedLanguages.map((l) => LANGUAGE_LABEL[l]).join(", ")}
                {b.tags.length > 0 && ` · ${b.tags.join(", ")}`}
              </span>
            </div>
            <button
              className="btn btn-sm"
              onClick={() =>
                setPicks((ps) => [
                  ...ps,
                  {
                    questionId: b.id,
                    questionVersionId: null,
                    version: null,
                    title: b.title,
                    points: 10,
                  },
                ])
              }
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
