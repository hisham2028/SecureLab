import { useCallback, useEffect, useState } from "react";
import { api, seatBlocked } from "../lib/api";

/**
 * Shown while an invigilator has blocked this seat. The student's work stays saved on this
 * computer and on the server; the app checks every few seconds whether access is back.
 */
export function Blocked({ message, onUnblocked }: { message: string; onUnblocked: () => void }) {
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      await api.overview();
      seatBlocked.set(null);
      onUnblocked();
    } catch {
      // Still blocked (or offline); try again later.
    } finally {
      setChecking(false);
    }
  }, [onUnblocked]);
  useEffect(() => {
    document.title = "Access paused · SecureLab";
    const id = window.setInterval(() => void check(), 15_000);
    return () => window.clearInterval(id);
  }, [check]);
  return (
    <div className="center-page">
      <main className="card done" role="alert">
        <h1>Your access is paused</h1>
        <p>{message}</p>
        <p className="muted">This page checks again on its own every few seconds.</p>
        <button type="button" onClick={() => void check()} disabled={checking}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </main>
    </div>
  );
}
