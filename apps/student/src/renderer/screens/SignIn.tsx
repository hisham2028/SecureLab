import { useEffect, useId, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { Banner } from "../ui/Banner";

interface Props {
  onSignedIn: () => void;
  notice: string | null;
  serverUrl: string;
}

export function SignIn({ onSignedIn, notice, serverUrl }: Props) {
  const ids = { code: useId(), student: useId(), pin: useId(), pinHint: useId() };
  const [accessCode, setAccessCode] = useState("");
  const [studentId, setStudentId] = useState("");
  const [pin, setPin] = useState("");
  const [pinTouched, setPinTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Sign in · SecureLab";
  }, []);

  const pinInvalid = pinTouched && pin.length > 0 && !/^\d{6}$/.test(pin);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPinTouched(true);
    if (!/^\d{6}$/.test(pin)) return;
    setBusy(true);
    setError(null);
    try {
      await api.signIn(accessCode.trim(), studentId.trim(), pin);
      onSignedIn();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? "Can't reach the exam server. Check the network cable or Wi-Fi, then try again."
          : err instanceof Error
            ? err.message
            : "Sign-in didn't work. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <main className="card signin">
        <h1>Sign in to your exam</h1>
        <p className="muted">
          Use the exam code on the board and the PIN slip from your invigilator.
        </p>
        {notice && <Banner tone="warning">{notice}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={ids.code}>Exam code</label>
            <input
              id={ids.code}
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              maxLength={16}
              className="code-input"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor={ids.student}>Student ID</label>
            <input
              id={ids.student}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={64}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.pin}>PIN</label>
            <input
              id={ids.pin}
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              onBlur={() => setPinTouched(true)}
              autoComplete="off"
              required
              maxLength={6}
              aria-invalid={pinInvalid}
              aria-describedby={ids.pinHint}
              className="code-input"
            />
            <span id={ids.pinHint} className={pinInvalid ? "hint error" : "hint"}>
              {pinInvalid ? "The PIN has 6 digits." : "6 digits, from your PIN slip."}
            </span>
          </div>
          <button type="submit" className="primary block" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
      <p className="muted small">Exam server: {serverUrl}</p>
    </div>
  );
}
