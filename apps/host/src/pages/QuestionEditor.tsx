import { useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import type { Language, QuestionContent, QuestionVersion, TestCase } from "../api";
import { navigate, useDirtyGuard } from "../router";
import { ErrorBanner, Field, LANGUAGE_LABEL, Notice } from "../ui/bits";

const BLANK: QuestionContent = {
  title: "",
  statement: "",
  inputFormat: "",
  outputFormat: "",
  constraints: "",
  allowedLanguages: ["c", "cpp", "python"],
  timeLimitMs: 2000,
  memoryLimitKb: 256_000,
  topic: "",
  difficulty: "MEDIUM",
  tags: [],
  aiMode: "DISABLED",
  testCases: [
    { isHidden: false, input: "", expectedOutput: "", weight: 0 },
    { isHidden: true, input: "", expectedOutput: "", weight: 1 },
  ],
};

function toContent(v: QuestionVersion): QuestionContent {
  return {
    title: v.title,
    statement: v.statement,
    inputFormat: v.inputFormat,
    outputFormat: v.outputFormat,
    constraints: v.constraints,
    allowedLanguages: v.allowedLanguages,
    timeLimitMs: v.timeLimitMs,
    memoryLimitKb: v.memoryLimitKb,
    topic: v.topic,
    difficulty: v.difficulty,
    tags: v.tags,
    aiMode: v.aiMode,
    testCases: v.testCases.map(({ isHidden, input, expectedOutput, weight }) => ({
      isHidden,
      input,
      expectedOutput,
      weight,
    })),
  };
}

export function QuestionEditor({ id }: { id?: string }) {
  const [loaded, setLoaded] = useState<QuestionVersion | null>(null);
  const [c, setC] = useState<QuestionContent | null>(id ? null : BLANK);
  const [tagsText, setTagsText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useDirtyGuard(dirty);

  useEffect(() => {
    if (!id) return;
    api.getQuestion(id).then((v) => {
      setLoaded(v);
      setC(toContent(v));
      setTagsText(v.tags.join(", "));
    }, setError);
  }, [id]);

  if (!c) {
    return (
      <div className="page form-page">
        <ErrorBanner error={error} />
        {!error && <p className="muted">Loading question…</p>}
      </div>
    );
  }

  const set = <K extends keyof QuestionContent>(k: K, v: QuestionContent[K]) => {
    setC({ ...c, [k]: v });
    setDirty(true);
    setSaved(null);
  };
  const setTest = (i: number, patch: Partial<TestCase>) =>
    set(
      "testCases",
      c.testCases.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    );

  const errors: Record<string, string> = {};
  if (!c.title.trim()) errors.title = "Give the question a title.";
  if (!c.statement.trim()) errors.statement = "Write the problem statement.";
  if (c.allowedLanguages.length === 0) errors.languages = "Choose at least one language.";
  if (c.testCases.length === 0) errors.tests = "Add at least one test case.";
  else if (!c.testCases.some((t) => t.isHidden))
    errors.tests = "Add at least one hidden test case. Exams can't be published without one.";
  const show = (k: string) => submitted && errors[k];

  async function save(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    // Hidden-test rule is a warning for drafts in the bank; only block on hard errors.
    const blocking = Object.keys(errors).filter((k) => !(k === "tests" && c!.testCases.length > 0));
    if (blocking.length) return;
    const content: QuestionContent = {
      ...c!,
      title: c!.title.trim(),
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    setSaving(true);
    setError(null);
    try {
      const v = loaded
        ? await api.saveQuestionVersion(loaded.questionId, loaded.latestVersion, content)
        : await api.createQuestion(content);
      setDirty(false);
      setLoaded(v);
      setSaved(loaded ? `Saved as version ${v.version}.` : "Question created.");
      if (!id) {
        // Let the dirty guard detach before changing route.
        setTimeout(() => navigate(`/questions/${v.questionId}`), 0);
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    if (!loaded) return;
    try {
      setLoaded(await api.setQuestionArchived(loaded.questionId, !loaded.archived));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="page form-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="#/questions">Question bank</a> <span aria-hidden>›</span>{" "}
        <span>{loaded ? loaded.title : "New question"}</span>
      </nav>
      <header className="page-header">
        <div>
          <h1>{loaded ? "Edit question" : "New question"}</h1>
          {loaded && (
            <p className="meta">
              <span>Version {loaded.version}</span>
              {loaded.archived && <span className="badge badge-archived">Archived</span>}
              <span className="muted">
                Saving creates version {loaded.latestVersion + 1}. Exams using older versions don't
                change.
              </span>
            </p>
          )}
        </div>
        {loaded && (
          <div className="header-actions">
            <button className="btn" type="button" onClick={() => void toggleArchive()}>
              {loaded.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        )}
      </header>
      <ErrorBanner error={error} />
      {saved && <Notice tone="success">{saved}</Notice>}

      <form id="question-form" className="form" onSubmit={save} noValidate>
        <Field label="Title">
          <input
            value={c.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={200}
            aria-invalid={Boolean(show("title"))}
          />
          {show("title") && <span className="field-error">{errors.title}</span>}
        </Field>
        <Field label="Problem statement">
          <textarea
            rows={8}
            value={c.statement}
            onChange={(e) => set("statement", e.target.value)}
            aria-invalid={Boolean(show("statement"))}
          />
          {show("statement") && <span className="field-error">{errors.statement}</span>}
        </Field>
        <div className="row">
          <Field label="Input format" optional>
            <textarea
              rows={3}
              value={c.inputFormat}
              onChange={(e) => set("inputFormat", e.target.value)}
            />
          </Field>
          <Field label="Output format" optional>
            <textarea
              rows={3}
              value={c.outputFormat}
              onChange={(e) => set("outputFormat", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Constraints" optional>
          <textarea
            rows={2}
            value={c.constraints}
            onChange={(e) => set("constraints", e.target.value)}
          />
        </Field>

        <fieldset className="fieldset">
          <legend>Languages</legend>
          <div className="checks">
            {(["c", "cpp", "python"] as Language[]).map((l) => (
              <label key={l} className="check">
                <input
                  type="checkbox"
                  checked={c.allowedLanguages.includes(l)}
                  onChange={(e) =>
                    set(
                      "allowedLanguages",
                      e.target.checked
                        ? [...c.allowedLanguages, l]
                        : c.allowedLanguages.filter((x) => x !== l),
                    )
                  }
                />
                {LANGUAGE_LABEL[l]}
              </label>
            ))}
          </div>
          {show("languages") && <span className="field-error">{errors.languages}</span>}
        </fieldset>
        <div className="row">
          <Field label="Time limit (seconds)" hint="0.1 to 15">
            <input
              type="number"
              step={0.1}
              min={0.1}
              max={15}
              value={c.timeLimitMs / 1000}
              onChange={(e) => set("timeLimitMs", Math.round(Number(e.target.value) * 1000))}
            />
          </Field>
          <Field label="Memory limit (MB)" hint="16 to 512">
            <input
              type="number"
              min={16}
              max={512}
              value={Math.round(c.memoryLimitKb / 1000)}
              onChange={(e) => set("memoryLimitKb", Number(e.target.value) * 1000)}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="Topic" optional>
            <input value={c.topic} onChange={(e) => set("topic", e.target.value)} maxLength={100} />
          </Field>
          <Field label="Difficulty">
            <select
              value={c.difficulty}
              onChange={(e) => set("difficulty", e.target.value as QuestionContent["difficulty"])}
            >
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="Tags" optional hint="Separate with commas.">
            <input
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="AI help">
            <select
              value={c.aiMode}
              onChange={(e) => set("aiMode", e.target.value as QuestionContent["aiMode"])}
            >
              <option value="DISABLED">Off</option>
              <option value="HINTS_ONLY">Hints only</option>
              <option value="FULL">Full assistance</option>
            </select>
          </Field>
        </div>

        <fieldset className="fieldset">
          <legend>Test cases</legend>
          <p className="field-hint">
            Samples are shown to students. Hidden tests are used for marking and never leave the
            server. Score = sum of weights of passed hidden tests.
          </p>
          {show("tests") && <span className="field-error">{errors.tests}</span>}
          <ol className="tests">
            {c.testCases.map((t, i) => (
              <li key={i} className="test">
                <div className="test-head">
                  <strong>Test {i + 1}</strong>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={t.isHidden}
                      onChange={(e) => setTest(i, { isHidden: e.target.checked })}
                    />
                    Hidden
                  </label>
                  <label className="inline-field">
                    <span>Weight</span>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      value={t.weight}
                      onChange={(e) => setTest(i, { weight: Number(e.target.value) })}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove test ${i + 1}`}
                    title="Remove test"
                    onClick={() =>
                      set(
                        "testCases",
                        c.testCases.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
                <div className="row">
                  <Field label="Input">
                    <textarea
                      rows={3}
                      className="mono"
                      value={t.input}
                      onChange={(e) => setTest(i, { input: e.target.value })}
                    />
                  </Field>
                  <Field label="Expected output">
                    <textarea
                      rows={3}
                      className="mono"
                      value={t.expectedOutput}
                      onChange={(e) => setTest(i, { expectedOutput: e.target.value })}
                    />
                  </Field>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn"
            onClick={() =>
              set("testCases", [
                ...c.testCases,
                { isHidden: true, input: "", expectedOutput: "", weight: 1 },
              ])
            }
          >
            Add test case
          </button>
        </fieldset>
      </form>

      <div className="sticky-actions">
        <a className="btn" href="#/questions">
          Cancel
        </a>
        <button className="btn btn-primary" type="submit" form="question-form" disabled={saving}>
          {saving
            ? "Saving…"
            : loaded
              ? `Save as version ${loaded.latestVersion + 1}`
              : "Create question"}
        </button>
      </div>
    </div>
  );
}
