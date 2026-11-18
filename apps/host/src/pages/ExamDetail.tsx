import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { Exam, ExamStatus, Me } from "../api";
import { navigate, type ExamTab } from "../router";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Drawer } from "../ui/Drawer";
import { ErrorBanner, formatDateTime, LANGUAGE_LABEL, StatusBadge } from "../ui/bits";
import { ExamSettingsForm } from "./ExamSettingsForm";
import { QuestionsTab } from "./QuestionsTab";
import { StudentsTab } from "./StudentsTab";
import { LiveTab } from "./LiveTab";
import { ResultsTab } from "./ResultsTab";

type Tab = ExamTab;
const EDITABLE: ExamStatus[] = ["DRAFT", "SCHEDULED"];

interface PendingAction {
  to: ExamStatus;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  requireText?: string;
}

export function ExamDetail({ id, tab, me }: { id: string; tab: Tab; me: Me }) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const canManage = me.role === "ADMIN" || me.role === "HOST";

  const reload = useCallback(() => api.getExam(id).then(setExam, setLoadError), [id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // A failed action's message goes stale once the exam changes (e.g. questions were added).
  useEffect(() => setActionError(null), [exam?.revision]);

  // Keep the clock and automatic completion current while an exam is live.
  useEffect(() => {
    if (exam?.status !== "RUNNING" && exam?.status !== "PAUSED") return;
    const t = window.setInterval(() => void reload(), 30_000);
    return () => window.clearInterval(t);
  }, [exam?.status, reload]);

  if (loadError) {
    return (
      <div className="page">
        <ErrorBanner error={loadError} />
        <a href="#/exams">Back to exams</a>
      </div>
    );
  }
  if (!exam) return <div className="page muted">Loading exam…</div>;

  async function run(to: ExamStatus) {
    setBusy(true);
    setActionError(null);
    try {
      setExam(await api.transitionExam(id, to));
      setPending(null);
    } catch (err) {
      setActionError(err);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(settings: api.ExamSettings) {
    setSaveError(null);
    const changes: Partial<api.ExamSettings> = { ...settings };
    // The API refuses ID-format changes once students are registered.
    if (exam!.registrationCount > 0) delete changes.studentIdRule;
    try {
      setExam(await api.updateExam(id, exam!.revision, changes));
      setEditing(false);
    } catch (err) {
      setSaveError(err);
    }
  }

  const actions = actionsFor(exam, me.role);
  const started = !["DRAFT", "SCHEDULED"].includes(exam.status);
  const hasResults =
    canManage && ["RUNNING", "PAUSED", "COMPLETED", "ARCHIVED"].includes(exam.status);
  const editable = EDITABLE.includes(exam.status) && canManage;

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="#/exams">Exams</a> <span aria-hidden>›</span> <span>{exam.title}</span>
      </nav>
      <header className="page-header">
        <div>
          <h1>{exam.title}</h1>
          <p className="meta">
            <StatusBadge status={exam.status} />
            <span>
              Access code <code className="code-strong">{exam.accessCode}</code>
            </span>
            <span>{exam.durationMinutes} min</span>
            <span>{exam.registrationCount} students</span>
            {exam.endsAt && (exam.status === "RUNNING" || exam.status === "PAUSED") && (
              <span>
                {exam.status === "PAUSED" ? "Paused" : `Ends ${formatDateTime(exam.endsAt)}`}
              </span>
            )}
          </p>
        </div>
        <div className="header-actions">
          {editable && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit settings
            </button>
          )}
          {canManage &&
            exam.registrationCount > 0 &&
            !["COMPLETED", "ARCHIVED"].includes(exam.status) && (
              <a className="btn" href={`#/exams/${id}/pins`}>
                PIN slips
              </a>
            )}
          {actions.map((a, i) => (
            <button
              key={a.to}
              className={
                a.danger
                  ? "btn btn-danger-outline"
                  : i === actions.length - 1
                    ? "btn btn-primary"
                    : "btn"
              }
              onClick={() => (a.direct ? void run(a.to) : setPending(a))}
              disabled={busy}
            >
              {a.label}
            </button>
          ))}
          {exam.status === "DRAFT" && canManage && (
            <button className="btn btn-danger-outline" onClick={() => setDeleting(true)}>
              Delete
            </button>
          )}
        </div>
      </header>
      <ErrorBanner error={actionError} />

      <div className="tabs" role="tablist" aria-label="Exam sections">
        {(
          [
            ["questions", `Questions (${exam.questions.length})`],
            ["students", `Students (${exam.registrationCount})`],
            ...(started ? [["live", "Live"]] : []),
            ...(hasResults ? [["results", "Results"]] : []),
            ["details", "Details"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <a
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "tab active" : "tab"}
            href={`#/exams/${id}/${key}`}
          >
            {label}
          </a>
        ))}
      </div>

      <section role="tabpanel" className="tab-body">
        {tab === "questions" && (
          <QuestionsTab exam={exam} canEdit={editable} onChange={setExam} canSeeBank={canManage} />
        )}
        {tab === "students" && (
          <StudentsTab exam={exam} role={me.role} onCountChange={() => void reload()} />
        )}
        {tab === "live" && started && <LiveTab exam={exam} role={me.role} />}
        {tab === "results" && hasResults && <ResultsTab exam={exam} role={me.role} />}
        {tab === "details" && <DetailsTab exam={exam} />}
      </section>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        body={pending?.body ?? ""}
        confirmLabel={pending?.confirmLabel ?? ""}
        danger={pending?.danger}
        requireText={pending?.requireText}
        busy={busy}
        onConfirm={() => pending && void run(pending.to)}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={deleting}
        title="Delete this draft?"
        body="The exam and its question list are deleted. Questions stay in the bank."
        confirmLabel="Delete exam"
        danger
        requireText={exam.title}
        onConfirm={async () => {
          try {
            await api.deleteExam(id);
            navigate("/exams");
          } catch (err) {
            setActionError(err);
            setDeleting(false);
          }
        }}
        onCancel={() => setDeleting(false)}
      />
      <Drawer
        open={editing}
        title="Exam settings"
        onClose={() => setEditing(false)}
        footer={
          <>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="edit-exam">
              Save settings
            </button>
          </>
        }
      >
        <ErrorBanner error={saveError} />
        <ExamSettingsForm
          formId="edit-exam"
          initial={exam}
          idRuleLocked={exam.registrationCount > 0}
          onSubmit={(s) => void saveSettings(s)}
        />
      </Drawer>
    </div>
  );
}

interface ActionDef extends PendingAction {
  label: string;
  /** Low-risk, reversible actions skip the confirm dialog. */
  direct?: boolean;
}

function actionsFor(exam: Exam, role: api.Role): ActionDef[] {
  const n = exam.registrationCount;
  const all: Record<ExamStatus, ActionDef[]> = {
    DRAFT: [
      ...(exam.scheduledStartAt
        ? [
            {
              to: "SCHEDULED" as const,
              label: "Mark scheduled",
              direct: true,
              title: "",
              body: "",
              confirmLabel: "",
            },
          ]
        : []),
      {
        to: "PUBLISHED",
        label: "Publish",
        title: "Publish this exam?",
        body: "Its questions are locked once published. Students can sign in and read the instructions, but can't see questions until you start the exam.",
        confirmLabel: "Publish",
      },
    ],
    SCHEDULED: [
      { to: "DRAFT", label: "Back to draft", direct: true, title: "", body: "", confirmLabel: "" },
      {
        to: "PUBLISHED",
        label: "Publish",
        title: "Publish this exam?",
        body: "Its questions are locked once published.",
        confirmLabel: "Publish",
      },
    ],
    PUBLISHED: [
      { to: "DRAFT", label: "Unpublish", direct: true, title: "", body: "", confirmLabel: "" },
      {
        to: "RUNNING",
        label: "Start exam",
        title: "Start the exam now?",
        body: `The clock starts for all ${n} students and registration locks. This can't be undone.`,
        confirmLabel: "Start exam",
      },
    ],
    RUNNING: [
      {
        to: "COMPLETED",
        label: "End exam",
        title: "End the exam for everyone?",
        body: "All students stop immediately, including anyone with extra time. This can't be undone.",
        confirmLabel: "End exam",
        danger: true,
        requireText: "END",
      },
      { to: "PAUSED", label: "Pause", direct: true, title: "", body: "", confirmLabel: "" },
    ],
    PAUSED: [
      {
        to: "COMPLETED",
        label: "End exam",
        title: "End the exam for everyone?",
        body: "All students stop immediately, including anyone with extra time. This can't be undone.",
        confirmLabel: "End exam",
        danger: true,
        requireText: "END",
      },
      { to: "RUNNING", label: "Resume", direct: true, title: "", body: "", confirmLabel: "" },
    ],
    COMPLETED: [
      {
        to: "ARCHIVED",
        label: "Archive",
        title: "Archive this exam?",
        body: "Archived exams are read-only.",
        confirmLabel: "Archive",
      },
    ],
    ARCHIVED: [],
  };
  const list = all[exam.status];
  if (role === "INVIGILATOR")
    return list.filter(
      (a) => a.to === "PAUSED" || (a.to === "RUNNING" && exam.status === "PAUSED"),
    );
  return list;
}

function DetailsTab({ exam }: { exam: Exam }) {
  const r = exam.studentIdRule;
  const chars = [
    r.allowDigits && "digits",
    r.allowLetters && "letters",
    r.separators && `separators "${r.separators}"`,
  ]
    .filter(Boolean)
    .join(", ");
  const rows: [string, string][] = [
    ["Duration", `${exam.durationMinutes} minutes`],
    ["Late entry", `${exam.lateEntryMinutes} minutes after the start`],
    ["Planned start", formatDateTime(exam.scheduledStartAt)],
    ["Started", formatDateTime(exam.startedAt)],
    ["Languages", exam.allowedLanguages.map((l) => LANGUAGE_LABEL[l]).join(", ")],
    ["Question order", exam.navigationPolicy === "FREE" ? "Any order" : "One after another"],
    ["Submissions per question", String(exam.maxSubmissionsPerQuestion)],
    [
      "AI help",
      { DISABLED: "Off", HINTS_ONLY: "Hints only", FULL: "Full assistance" }[exam.aiMode],
    ],
    ["Finish early", exam.allowEarlySubmit ? "Allowed" : "Not allowed"],
    ["Students’ screens", exam.lockScreen ? "Locked during the exam" : "Not locked"],
    [
      "Student ID format",
      `${r.minLength === r.maxLength ? r.minLength : `${r.minLength}–${r.maxLength}`} characters${r.prefix ? `, starting "${r.prefix}"` : ""}; ${chars}${r.caseSensitive ? "; case-sensitive" : ""}`,
    ],
  ];
  return (
    <div className="details">
      <dl className="dl">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h2 className="h3">Instructions</h2>
      <p className="prewrap">
        {exam.instructions || <span className="muted">No instructions.</span>}
      </p>
    </div>
  );
}
