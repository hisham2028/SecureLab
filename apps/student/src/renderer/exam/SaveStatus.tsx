import { useEffect, useState } from "react";
import type { DraftStatus } from "../lib/draft-sync";
import { timeOf } from "../lib/labels";

/**
 * Shows the two saves separately: on this computer, and on the exam server. Warns when the
 * server has been behind for more than a few seconds.
 */
export function SaveStatus({ status }: { status: DraftStatus | null }) {
  const [now, setNow] = useState(() => Date.now());
  const [behindSince, setBehindSince] = useState<number | null>(null);
  const unsynced = status?.unsynced ?? false;

  useEffect(() => {
    setBehindSince((prev) => (unsynced ? (prev ?? Date.now()) : null));
  }, [unsynced]);
  useEffect(() => {
    if (!unsynced) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [unsynced]);

  if (!status) {
    return <span className="save-status muted">Not changed yet</span>;
  }
  const lagging = behindSince !== null && now - behindSince > 8000;
  return (
    <span className="save-status" aria-live="polite">
      <span title="Saved on this computer">
        <span className="dot local" aria-hidden />
        {status.unsavedEdits
          ? "Saving…"
          : status.localSavedAt
            ? `Saved here ${timeOf(status.localSavedAt)}`
            : "Not saved yet"}
      </span>
      <span title="Saved on the exam server" className={lagging ? "warn-text" : undefined}>
        <span className={`dot ${unsynced ? "pending" : "server"}`} aria-hidden />
        {!unsynced && status.serverSavedAt
          ? `On server ${timeOf(status.serverSavedAt)}`
          : lagging
            ? (status.problem ?? "Not on the server yet")
            : unsynced
              ? "Sending to server…"
              : "Not on the server yet"}
      </span>
    </span>
  );
}
