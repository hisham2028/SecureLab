import { useState, type FormEvent } from "react";
import { StudentIdRuleSchema, validateStudentId } from "@securelab/shared";
import type { ExamSettings, Language } from "../api";
import { Field, LANGUAGE_LABEL } from "../ui/bits";
import { AI_OFF_HINT, useAiEnabled } from "../ui/useAiStatus";

export const DEFAULT_SETTINGS: ExamSettings = {
  title: "",
  instructions: "",
  durationMinutes: 90,
  scheduledStartAt: null,
  lateEntryMinutes: 15,
  allowEarlySubmit: true,
  studentIdRule: {
    minLength: 6,
    maxLength: 12,
    allowDigits: true,
    allowLetters: false,
    separators: "",
    prefix: "",
    caseSensitive: false,
  },
  allowedLanguages: ["c", "cpp", "python"],
  navigationPolicy: "FREE",
  maxSubmissionsPerQuestion: 10,
  showSubmissionVerdicts: false,
  aiMode: "DISABLED",
  lockScreen: true,
};

/** <input type="datetime-local"> works in local time without a zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Props {
  formId: string;
  initial: ExamSettings;
  /** Hides the ID rule when students are already registered (the API refuses changes then). */
  idRuleLocked?: boolean;
  onSubmit: (settings: ExamSettings) => void;
  onDirty?: (dirty: boolean) => void;
}

export function ExamSettingsForm({ formId, initial, idRuleLocked, onSubmit, onDirty }: Props) {
  const [s, setS] = useState<ExamSettings>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [sampleId, setSampleId] = useState("");
  const aiEnabled = useAiEnabled();

  const set = <K extends keyof ExamSettings>(key: K, value: ExamSettings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    onDirty?.(true);
  };
  const setRule = <K extends keyof ExamSettings["studentIdRule"]>(
    key: K,
    value: ExamSettings["studentIdRule"][K],
  ) => set("studentIdRule", { ...s.studentIdRule, [key]: value });
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  const errors: Record<string, string> = {};
  if (!s.title.trim()) errors.title = "Give the exam a title.";
  if (!(s.durationMinutes >= 1 && s.durationMinutes <= 1440))
    errors.duration = "Enter 1 to 1440 minutes.";
  if (s.allowedLanguages.length === 0) errors.languages = "Choose at least one language.";
  const rule = StudentIdRuleSchema.safeParse(s.studentIdRule);
  if (!rule.success) errors.rule = rule.error.issues[0]?.message ?? "Check the student ID rule.";
  const show = (k: string) => (touched[k] || touched.__submit) && errors[k];

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched((t) => ({ ...t, __submit: true }));
    if (Object.keys(errors).length > 0) return;
    onSubmit({ ...s, title: s.title.trim() });
  }

  const sample = sampleId && rule.success ? validateStudentId(sampleId, rule.data) : null;

  return (
    <form id={formId} onSubmit={submit} className="form" noValidate>
      <Field label="Title">
        <input
          value={s.title}
          onChange={(e) => set("title", e.target.value)}
          onBlur={() => touch("title")}
          aria-invalid={Boolean(show("title"))}
          required
          maxLength={200}
        />
        {show("title") && <span className="field-error">{errors.title}</span>}
      </Field>
      <Field label="Instructions for students" optional hint="Shown before the exam starts.">
        <textarea
          rows={4}
          value={s.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          maxLength={20000}
        />
      </Field>

      <div className="row">
        <Field label="Duration (minutes)">
          <input
            type="number"
            min={1}
            max={1440}
            value={s.durationMinutes}
            onChange={(e) => set("durationMinutes", Number(e.target.value))}
            onBlur={() => touch("duration")}
            aria-invalid={Boolean(show("duration"))}
          />
          {show("duration") && <span className="field-error">{errors.duration}</span>}
        </Field>
        <Field
          label="Late entry (minutes)"
          hint="How long after the start students can still sign in."
        >
          <input
            type="number"
            min={0}
            max={240}
            value={s.lateEntryMinutes}
            onChange={(e) => set("lateEntryMinutes", Number(e.target.value))}
          />
        </Field>
      </div>
      <Field
        label="Planned start"
        optional
        hint="Needed only to mark the exam Scheduled. The clock starts when you press Start."
      >
        <input
          type="datetime-local"
          value={toLocalInput(s.scheduledStartAt)}
          onChange={(e) =>
            set("scheduledStartAt", e.target.value ? new Date(e.target.value).toISOString() : null)
          }
        />
      </Field>

      <fieldset className="fieldset">
        <legend>Languages</legend>
        <div className="checks">
          {(["c", "cpp", "python"] as Language[]).map((l) => (
            <label key={l} className="check">
              <input
                type="checkbox"
                checked={s.allowedLanguages.includes(l)}
                onChange={(e) =>
                  set(
                    "allowedLanguages",
                    e.target.checked
                      ? [...s.allowedLanguages, l]
                      : s.allowedLanguages.filter((x) => x !== l),
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
        <Field label="Question order">
          <select
            value={s.navigationPolicy}
            onChange={(e) =>
              set("navigationPolicy", e.target.value as ExamSettings["navigationPolicy"])
            }
          >
            <option value="FREE">Any order</option>
            <option value="SEQUENTIAL">One after another</option>
          </select>
        </Field>
        <Field label="Submissions per question">
          <input
            type="number"
            min={1}
            max={100}
            value={s.maxSubmissionsPerQuestion}
            onChange={(e) => set("maxSubmissionsPerQuestion", Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="row">
        <Field
          label="AI help (maximum)"
          hint={
            aiEnabled === false && s.aiMode !== "DISABLED"
              ? AI_OFF_HINT
              : "A question can be stricter than this, never looser. Every question students ask is saved for you to read."
          }
        >
          <select
            value={s.aiMode}
            onChange={(e) => set("aiMode", e.target.value as ExamSettings["aiMode"])}
          >
            <option value="DISABLED">Off</option>
            <option value="HINTS_ONLY">Hints only</option>
            <option value="FULL">Full assistance</option>
          </select>
        </Field>
        <label className="check check-field">
          <input
            type="checkbox"
            checked={s.allowEarlySubmit}
            onChange={(e) => set("allowEarlySubmit", e.target.checked)}
          />
          Students can finish early
        </label>
        <label className="check check-field">
          <input
            type="checkbox"
            checked={s.lockScreen}
            onChange={(e) => set("lockScreen", e.target.checked)}
          />
          Lock students’ screens
          <span className="field-hint">
            The exam stays full screen and on top. Closing the app submits their latest code, and
            they can only come back when you unblock them.
          </span>
        </label>
        <label className="check check-field">
          <input
            type="checkbox"
            checked={s.showSubmissionVerdicts}
            onChange={(e) => set("showSubmissionVerdicts", e.target.checked)}
          />
          Show verdicts during the exam
          <span className="field-hint">
            Students see “Accepted”, “Wrong answer” and how many hidden tests passed. Never scores.
          </span>
        </label>
      </div>

      <fieldset className="fieldset" disabled={idRuleLocked}>
        <legend>Student ID format</legend>
        {idRuleLocked && (
          <p className="field-hint">Remove all registered students to change the ID format.</p>
        )}
        <div className="row">
          <Field label="Shortest">
            <input
              type="number"
              min={1}
              max={64}
              value={s.studentIdRule.minLength}
              onChange={(e) => setRule("minLength", Number(e.target.value))}
            />
          </Field>
          <Field label="Longest">
            <input
              type="number"
              min={1}
              max={64}
              value={s.studentIdRule.maxLength}
              onChange={(e) => setRule("maxLength", Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="row">
          <Field
            label="Required prefix"
            optional
            hint='For example "CSE". Counts towards the length.'
          >
            <input
              value={s.studentIdRule.prefix}
              maxLength={16}
              onChange={(e) => setRule("prefix", e.target.value)}
            />
          </Field>
          <Field label="Allowed separators" optional hint='For example "-" or "/".'>
            <input
              value={s.studentIdRule.separators}
              maxLength={4}
              onChange={(e) => setRule("separators", e.target.value)}
            />
          </Field>
        </div>
        <div className="checks">
          <label className="check">
            <input
              type="checkbox"
              checked={s.studentIdRule.allowDigits}
              onChange={(e) => setRule("allowDigits", e.target.checked)}
            />
            Digits
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.studentIdRule.allowLetters}
              onChange={(e) => setRule("allowLetters", e.target.checked)}
            />
            Letters
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.studentIdRule.caseSensitive}
              onChange={(e) => setRule("caseSensitive", e.target.checked)}
            />
            Case-sensitive
          </label>
        </div>
        {show("rule") && <span className="field-error">{errors.rule}</span>}
        <Field label="Try an ID" optional hint="Leading zeros are always kept.">
          <input
            value={sampleId}
            onChange={(e) => setSampleId(e.target.value)}
            placeholder="e.g. 00123456"
          />
        </Field>
        {sample && (
          <p className={sample.ok ? "field-ok" : "field-error"} aria-live="polite">
            {sample.ok ? `Valid. Stored as ${sample.normalized}.` : sample.reason}
          </p>
        )}
      </fieldset>
    </form>
  );
}
