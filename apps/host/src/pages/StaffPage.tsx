import { useCallback, useEffect, useId, useRef, useState } from "react";
import * as api from "../api";
import type { Role, StaffMember } from "../api";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ErrorBanner, Field, formatDateTime, Notice } from "../ui/bits";
import { ReasonDialog } from "../ui/ReasonDialog";

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  HOST: "Host",
  INVIGILATOR: "Invigilator",
};
const ROLE_HINT: Record<Role, string> = {
  ADMIN: "Everything, including staff accounts.",
  HOST: "Questions, exams, students, marks and results.",
  INVIGILATOR: "The live exam room: announcements, extra time, block and unblock, notes.",
};

/** A readable temporary password: no 0/O or 1/l/I, so it can be read out or copied by hand. */
export function generatePassword(length = 16): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type Action =
  | { kind: "role"; member: StaffMember }
  | { kind: "deactivate"; member: StaffMember }
  | { kind: "password"; member: StaffMember }
  | { kind: "sessions"; member: StaffMember };

/** Admins only: who can sign in to the dashboard and what they can do. */
export function StaffPage({ me }: { me: api.Me }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [role, setRole] = useState<Role>("HOST");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.listStaff().then(setStaff, setError), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setNotice(done);
      setAction(null);
      await load();
    } catch (err) {
      setActionError(err);
      setAction(null);
    } finally {
      setBusy(false);
    }
  }

  const active = staff?.filter((s) => s.isActive) ?? [];
  const inactive = staff?.filter((s) => !s.isActive) ?? [];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Staff</h1>
          <p className="muted">
            Who can sign in to this dashboard. Changes to a role or account take effect at once.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          Add staff
        </button>
      </header>
      {notice && <Notice tone="success">{notice}</Notice>}
      <ErrorBanner error={error} />
      <ErrorBanner error={actionError} />
      {!staff && !error && <p className="muted">Loading staff…</p>}
      {staff && (
        <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Last signed in</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...inactive].map((m) => {
                const self = m.id === me.id;
                return (
                  <tr key={m.id} className={m.isActive ? undefined : "row-muted"}>
                    <td>
                      <span className="strong">{m.displayName}</span>
                      {self && <span className="muted"> (you)</span>}
                      <div className="muted">{m.email}</div>
                    </td>
                    <td>
                      {ROLE_LABEL[m.role]}
                      {!m.isActive && (
                        <>
                          {" "}
                          <span className="badge">Deactivated</span>
                        </>
                      )}
                    </td>
                    <td>{m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "Never"}</td>
                    <td>
                      <div className="row-actions">
                        {m.isActive && !self && (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              setRole(m.role);
                              setAction({ kind: "role", member: m });
                            }}
                          >
                            Change role
                          </button>
                        )}
                        {m.isActive && !self && (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              setPassword(generatePassword());
                              setAction({ kind: "password", member: m });
                            }}
                          >
                            New password
                          </button>
                        )}
                        {m.isActive && !self && (
                          <button
                            className="btn btn-sm"
                            onClick={() => setAction({ kind: "sessions", member: m })}
                          >
                            Sign out everywhere
                          </button>
                        )}
                        {m.isActive && !self && (
                          <button
                            className="btn btn-sm btn-danger-outline"
                            onClick={() => setAction({ kind: "deactivate", member: m })}
                          >
                            Deactivate
                          </button>
                        )}
                        {!m.isActive && (
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => api.updateStaff(m.id, { isActive: true }),
                                `${m.displayName} can sign in again.`,
                              )
                            }
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="field-hint">
        To change your own password, use Change password at the top. You can't change your own role
        or deactivate yourself; ask another admin.
      </p>

      <AddStaffDialog
        open={adding}
        onCancel={() => setAdding(false)}
        onAdded={async (m, pw) => {
          setAdding(false);
          setNotice(
            `${m.displayName} was added. Give them their temporary password in person: ${pw}`,
          );
          await load();
        }}
      />

      <ConfirmDialog
        open={action?.kind === "role"}
        title={`Change ${action?.member.displayName}'s role?`}
        busy={busy}
        body={
          <>
            <Field label="Role" hint={ROLE_HINT[role]}>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <p className="muted">They'll need to sign in again.</p>
          </>
        }
        confirmLabel="Change role"
        onConfirm={() => {
          const m = action!.member;
          void run(
            () => api.updateStaff(m.id, { role }),
            `${m.displayName} is now ${ROLE_LABEL[role].toLowerCase()}.`,
          );
        }}
        onCancel={() => setAction(null)}
      />

      <ConfirmDialog
        open={action?.kind === "deactivate"}
        title={`Deactivate ${action?.member.displayName}?`}
        body="They're signed out everywhere and can't sign in until an admin reactivates them. Their past actions stay in the audit log."
        confirmLabel="Deactivate"
        danger
        busy={busy}
        onConfirm={() => {
          const m = action!.member;
          void run(
            () => api.updateStaff(m.id, { isActive: false }),
            `${m.displayName} is deactivated.`,
          );
        }}
        onCancel={() => setAction(null)}
      />

      <ReasonDialog
        open={action?.kind === "password"}
        title={`New password for ${action?.member.displayName}`}
        body="Their open sessions end. Give them the password in person and ask them to change it after signing in."
        confirmLabel="Set password"
        onConfirm={async (reason) => {
          const m = action!.member;
          await api.setStaffPassword(m.id, password, reason);
          setAction(null);
          setNotice(`New password for ${m.displayName}: ${password}`);
        }}
        onCancel={() => setAction(null)}
      >
        <Field label="Temporary password" hint="At least 12 characters.">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            className="mono"
          />
        </Field>
      </ReasonDialog>

      <ReasonDialog
        open={action?.kind === "sessions"}
        title={`Sign ${action?.member.displayName} out everywhere?`}
        body="Use this for a lost or shared laptop. They can sign in again with their password."
        confirmLabel="Sign out everywhere"
        onConfirm={async (reason) => {
          const m = action!.member;
          await api.endStaffSessions(m.id, reason);
          setAction(null);
          setNotice(`${m.displayName} is signed out on every device.`);
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  );
}

function AddStaffDialog({
  open,
  onCancel,
  onAdded,
}: {
  open: boolean;
  onCancel: () => void;
  onAdded: (m: StaffMember, password: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("INVIGILATOR");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setName("");
      setEmail("");
      setRole("INVIGILATOR");
      setPassword(generatePassword());
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const m = await api.createStaff({ email, displayName: name, role, password });
      await onAdded(m, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 id={`${id}-title`}>Add staff</h2>
          <ErrorBanner error={error} />
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email" hint="They sign in with this.">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Role" hint={ROLE_HINT[role]}>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Temporary password"
            hint="At least 12 characters. Give it to them in person; they can change it after signing in."
          >
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="mono"
              minLength={12}
              required
            />
          </Field>
          <div className="actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Adding…" : "Add staff"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
