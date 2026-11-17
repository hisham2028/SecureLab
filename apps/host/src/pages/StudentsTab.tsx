import { useEffect, useMemo, useState } from "react";
import { StudentIdRuleSchema, validateStudentId } from "@securelab/shared";
import * as api from "../api";
import type { Credential, Exam, ImportResult, Registration, Role } from "../api";
import { forgetPin, rememberPins } from "../pins-store";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Drawer } from "../ui/Drawer";
import { ErrorBanner, Field, Notice, Pagination } from "../ui/bits";

const LOCKED = ["RUNNING", "PAUSED", "COMPLETED", "ARCHIVED"];
const PAGE_SIZE = 50;

function seatStatus(r: Registration): string {
  if (r.lockedAt) return "Locked out";
  if (r.finishedAt) return "Finished";
  if (r.firstEnteredAt) return "In exam";
  return "Not entered";
}

export function StudentsTab({
  exam,
  role,
  onCountChange,
}: {
  exam: Exam;
  role: Role;
  onCountChange: () => void;
}) {
  const [regs, setRegs] = useState<Registration[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<"add" | "import" | null>(null);
  const [shownPin, setShownPin] = useState<Credential | null>(null);
  const [confirmReset, setConfirmReset] = useState<Registration | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Registration | null>(null);
  const [extending, setExtending] = useState<Registration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = role === "ADMIN" || role === "HOST";
  const locked = LOCKED.includes(exam.status);
  const ended = exam.status === "COMPLETED" || exam.status === "ARCHIVED";

  const load = () => api.listRegistrations(exam.id).then(setRegs, setError);
  useEffect(() => {
    void load();
  }, [exam.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (regs ?? []).filter(
      (r) => !q || r.studentId.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q),
    );
  }, [regs, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const changed = () => {
    void load();
    onCountChange();
  };

  return (
    <div>
      <div className="tab-toolbar">
        <label className="search">
          <span>Search</span>
          <input
            type="search"
            placeholder="Student ID or name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {canManage && !locked && (
          <div className="header-actions">
            <button className="btn" onClick={() => setDrawer("import")}>
              Import CSV
            </button>
            <button className="btn btn-primary" onClick={() => setDrawer("add")}>
              Add student
            </button>
          </div>
        )}
      </div>
      {locked && !ended && (
        <Notice>
          Registration is locked because the exam has started. You can still reset PINs and give
          extra time.
        </Notice>
      )}
      {notice && <Notice tone="success">{notice}</Notice>}
      <ErrorBanner error={error} />

      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col">Student ID</th>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Extra time
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {regs === null && !error && (
              <tr>
                <td colSpan={5} className="empty">
                  Loading students…
                </td>
              </tr>
            )}
            {regs !== null && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  {regs.length === 0 ? (
                    <>
                      <strong>No students registered.</strong>{" "}
                      {canManage && !locked && (
                        <button className="link" onClick={() => setDrawer("import")}>
                          Import a CSV of students
                        </button>
                      )}
                    </>
                  ) : (
                    "No students match your search."
                  )}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <code>{r.studentId}</code>
                </td>
                <td>{r.fullName}</td>
                <td>
                  <span className={r.lockedAt ? "text-danger" : undefined}>{seatStatus(r)}</span>
                </td>
                <td className="num">{r.extensionMinutes ? `+${r.extensionMinutes} min` : "—"}</td>
                <td>
                  <div className="row-actions">
                    {!ended && (
                      <button className="btn btn-sm" onClick={() => setConfirmReset(r)}>
                        Reset PIN
                      </button>
                    )}
                    {canManage && !ended && (
                      <button className="btn btn-sm" onClick={() => setExtending(r)}>
                        Extra time
                      </button>
                    )}
                    {canManage && !locked && (
                      <button
                        className="btn btn-sm btn-danger-outline"
                        onClick={() => setConfirmRemove(r)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} total={filtered.length} onPage={setPage} />

      {drawer === "add" && (
        <AddStudent
          exam={exam}
          onClose={() => setDrawer(null)}
          onAdded={(c) => {
            rememberPins(exam.id, [c]);
            setShownPin(c);
            changed();
          }}
        />
      )}
      {drawer === "import" && (
        <ImportStudents
          exam={exam}
          onClose={() => setDrawer(null)}
          onImported={(creds) => {
            rememberPins(exam.id, creds);
            setDrawer(null);
            setNotice(
              `Imported ${creds.length} students. Print their PIN slips now: PINs are shown only once.`,
            );
            changed();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmReset !== null}
        title={`Reset the PIN for ${confirmReset?.studentId}?`}
        body="The old PIN stops working and the student is signed out. Their saved work is not affected."
        confirmLabel="Reset PIN"
        onConfirm={async () => {
          try {
            const c = await api.resetPin(exam.id, confirmReset!.id);
            rememberPins(exam.id, [c]);
            setConfirmReset(null);
            setShownPin(c);
            void load();
          } catch (err) {
            setError(err);
            setConfirmReset(null);
          }
        }}
        onCancel={() => setConfirmReset(null)}
      />
      <ConfirmDialog
        open={confirmRemove !== null}
        title={`Remove ${confirmRemove?.studentId} from this exam?`}
        body={`${confirmRemove?.fullName ?? ""} won't be able to sign in. You can add them again before the exam starts.`}
        confirmLabel="Remove student"
        danger
        onConfirm={async () => {
          try {
            await api.removeRegistration(exam.id, confirmRemove!.id);
            forgetPin(exam.id, confirmRemove!.id);
            setConfirmRemove(null);
            changed();
          } catch (err) {
            setError(err);
            setConfirmRemove(null);
          }
        }}
        onCancel={() => setConfirmRemove(null)}
      />
      <ConfirmDialog
        open={shownPin !== null}
        title={`PIN for ${shownPin?.studentId}`}
        body={
          <>
            <p className="pin-big" aria-label={`PIN ${shownPin?.pin.split("").join(" ")}`}>
              {shownPin?.pin}
            </p>
            <p>
              Give this to {shownPin?.fullName}. It is shown only once, but it is kept in this
              browser tab for <a href={`#/exams/${exam.id}/pins`}>PIN slips</a> until you reload.
            </p>
          </>
        }
        confirmLabel="Done"
        onConfirm={() => setShownPin(null)}
        onCancel={() => setShownPin(null)}
      />
      {extending && (
        <ExtraTime
          exam={exam}
          reg={extending}
          onClose={() => setExtending(null)}
          onSaved={() => {
            setExtending(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AddStudent({
  exam,
  onClose,
  onAdded,
}: {
  exam: Exam;
  onClose: () => void;
  onAdded: (c: Credential) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [fullName, setFullName] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const rule = StudentIdRuleSchema.parse(exam.studentIdRule);
  const check = studentId ? validateStudentId(studentId, rule) : null;
  const idError =
    touched && !studentId
      ? "Enter a student ID."
      : touched && check && !check.ok
        ? check.reason
        : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!check?.ok || !fullName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      onAdded(await api.registerStudent(exam.id, studentId, fullName.trim()));
      setStudentId("");
      setFullName("");
      setTouched(false);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title="Add student"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" type="submit" form="add-student" disabled={saving}>
            {saving ? "Adding…" : "Add student"}
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <form id="add-student" className="form" onSubmit={submit} noValidate>
        <Field label="Student ID" hint="Leading zeros are kept.">
          <input
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={Boolean(idError)}
            autoComplete="off"
          />
          {idError && <span className="field-error">{idError}</span>}
        </Field>
        <Field label="Full name">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} />
          {touched && !fullName.trim() && (
            <span className="field-error">Enter the student's name.</span>
          )}
        </Field>
      </form>
    </Drawer>
  );
}

function ImportStudents({
  exam,
  onClose,
  onImported,
}: {
  exam: Exam;
  onClose: () => void;
  onImported: (c: Credential[]) => void;
}) {
  const [csv, setCsv] = useState("");
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(file: File) {
    setCsv(await file.text());
    setCheck(null);
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.importStudents(exam.id, csv, dryRun);
      if (!dryRun && res.errors.length === 0) onImported(res.credentials);
      else setCheck(res);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const ready = check && check.errors.length === 0 && check.validRows > 0;
  return (
    <Drawer
      open
      title="Import students from CSV"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {ready ? (
            <button className="btn btn-primary" onClick={() => void run(false)} disabled={busy}>
              {busy ? "Importing…" : `Import ${check.validRows} students`}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void run(true)}
              disabled={busy || !csv.trim()}
            >
              {busy ? "Checking…" : "Check file"}
            </button>
          )}
        </>
      }
    >
      <p className="muted">
        The first row must be a header with <code>student_id</code> and <code>name</code> columns.
        Nothing is imported until every row is valid.
      </p>
      <Field label="CSV file">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}
        />
      </Field>
      <Field label="Or paste CSV">
        <textarea
          rows={8}
          className="mono"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setCheck(null);
          }}
          placeholder={"student_id,name\n00123,Ayesha Rahman"}
        />
      </Field>
      <ErrorBanner error={error} />
      {check && check.errors.length > 0 && (
        <div className="banner banner-error" role="alert">
          <p>
            Fix {check.errors.length} {check.errors.length === 1 ? "problem" : "problems"}, then
            check again. Nothing was imported.
          </p>
          <table className="compact">
            <thead>
              <tr>
                <th scope="col" className="num">
                  Line
                </th>
                <th scope="col">Problem</th>
              </tr>
            </thead>
            <tbody>
              {check.errors.map((e, i) => (
                <tr key={i}>
                  <td className="num">{e.line}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ready && (
        <Notice tone="success">All {check.validRows} rows are valid. Ready to import.</Notice>
      )}
      {check && check.errors.length === 0 && check.validRows === 0 && (
        <Notice tone="warning">The file has no student rows.</Notice>
      )}
    </Drawer>
  );
}

function ExtraTime({
  exam,
  reg,
  onClose,
  onSaved,
}: {
  exam: Exam;
  reg: Registration;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [minutes, setMinutes] = useState(reg.extensionMinutes);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!reason.trim()) return;
    try {
      await api.setExtension(exam.id, reg.id, minutes, reason.trim());
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Drawer
      open
      title={`Extra time for ${reg.studentId}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="extra-time">
            Save extra time
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <form id="extra-time" className="form" onSubmit={submit} noValidate>
        <Field
          label="Extra minutes"
          hint="Added to this student's deadline. Use 0 to remove extra time."
        >
          <input
            type="number"
            min={0}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </Field>
        <Field label="Reason" hint="Recorded in the audit log.">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={500}
          />
          {touched && !reason.trim() && (
            <span className="field-error">
              Give a reason, for example an approved accommodation.
            </span>
          )}
        </Field>
      </form>
    </Drawer>
  );
}
