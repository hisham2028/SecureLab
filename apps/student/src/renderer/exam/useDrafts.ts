import { useEffect, useState, useSyncExternalStore } from "react";
import type { Language, StaleDraftDetails } from "@securelab/shared";
import { api, ApiError } from "../lib/api";
import { DraftSync, mergeDrafts, type PushOutcome } from "../lib/draft-sync";

const BLOCKING = new Set(["EXAM_PAUSED", "TIME_UP", "NOT_IN_EXAM", "UNAUTHENTICATED"]);

/** Maps the server's answer to a draft save onto what the sync engine should do next. */
export function toOutcome(err: unknown): PushOutcome {
  if (!(err instanceof ApiError))
    return { kind: "retry", message: "Not saved to the server yet. Retrying…" };
  if (err.code === "STALE_DRAFT") {
    const d = err.details as StaleDraftDetails | undefined;
    return { kind: "stale", currentRevision: d?.currentRevision ?? 0 };
  }
  if (BLOCKING.has(err.code)) return { kind: "blocked", message: err.message };
  if (err.status === 0)
    return { kind: "retry", message: "Offline. Your work is saved on this computer." };
  if (err.status >= 500 || err.status === 429)
    return { kind: "retry", message: "The server is busy. Retrying…" };
  return { kind: "rejected", message: err.message };
}

/** Sets up local + server draft sync for one exam seat, restoring earlier work first. */
export function useDrafts(seatId: string) {
  const [sync] = useState(() => {
    const bridge = window.securelab!;
    return new DraftSync({
      saveLocal: (q, l, code, min) => bridge.saveDraft(seatId, q, l, code, min),
      markSynced: (q, l, rev, at) => bridge.markDraftSynced(seatId, q, l, rev, at),
      push: async (q, l, code, rev) => {
        try {
          const r = await api.saveDraft(q, l as Language, code, rev);
          return { kind: "saved", revision: r.revision, savedAt: r.savedAt };
        } catch (err) {
          return toOutcome(err);
        }
      },
    });
  });
  const [ready, setReady] = useState(false);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bridge = window.securelab!;
      const local = await bridge.listDrafts(seatId).catch(() => []);
      let server: Awaited<ReturnType<typeof api.drafts>> = [];
      try {
        server = await api.drafts();
      } catch {
        if (local.length) setRestoreNote("Offline: showing the work saved on this computer.");
      }
      const { records, adopt } = mergeDrafts(local, server);
      await Promise.all(
        adopt.map((s) =>
          bridge
            .adoptDraft(seatId, s.examQuestionId, s.language, s.code, s.revision, s.savedAt)
            .catch(() => undefined),
        ),
      );
      if (cancelled) return;
      sync.seed(records);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [seatId, sync]);

  useEffect(() => () => sync.dispose(), [sync]);

  // Block closing the window while the server is missing work (Electron asks the student).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (sync.unsyncedCount() > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sync]);

  // Re-render on any sync status change.
  useSyncExternalStore(
    (fn) => sync.subscribe(fn),
    () => sync.snapshotVersion,
  );

  return { sync, ready, restoreNote };
}
