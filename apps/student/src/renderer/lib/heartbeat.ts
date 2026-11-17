import { useEffect, useRef, useState } from "react";
import { HEARTBEAT_SECONDS, type Announcement, type Language } from "@securelab/shared";
import { api } from "./api";
import { readPref, writePref } from "./prefs";

type FocusEvent = { type: "FOCUS_LOST" | "FOCUS_RETURNED"; at: string };

/**
 * Tells the server this seat is alive every few seconds, where the student is working, and
 * when the exam window lost or regained focus. The invigilator sees this as context only.
 * Returns the exam's announcements.
 */
export function useHeartbeat(opts: {
  enabled: boolean;
  currentQuestionId?: string | null;
  language?: Language | null;
}): Announcement[] {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const pending = useRef<FocusEvent[]>([]);
  const where = useRef({ currentQuestionId: opts.currentQuestionId, language: opts.language });
  const send = useRef<() => void>(() => undefined);

  where.current = { currentQuestionId: opts.currentQuestionId, language: opts.language };

  useEffect(() => {
    if (!opts.enabled) return;
    let inFlight = false;
    let stopped = false;
    send.current = () => {
      if (inFlight || stopped) return;
      inFlight = true;
      const events = pending.current.splice(0, 50);
      api
        .heartbeat({ ...where.current, events })
        .then((r) => {
          if (!stopped) setAnnouncements(r.announcements);
        })
        // Offline: keep the events for the next beat (bounded).
        .catch(() => {
          pending.current = [...events, ...pending.current].slice(-50);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const record = (type: FocusEvent["type"]) => {
      const last = pending.current[pending.current.length - 1];
      if (last?.type === type) return;
      pending.current.push({ type, at: new Date().toISOString() });
      if (pending.current.length > 50) pending.current.shift();
      send.current();
    };
    const onBlur = () => record("FOCUS_LOST");
    const onFocus = () => record("FOCUS_RETURNED");
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    send.current();
    const id = window.setInterval(() => send.current(), HEARTBEAT_SECONDS * 1000);
    return () => {
      stopped = true;
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [opts.enabled]);

  // Moving to another question or language is reported right away.
  useEffect(() => {
    if (opts.enabled) send.current();
  }, [opts.enabled, opts.currentQuestionId, opts.language]);

  return announcements;
}

/** Announcements the student hasn't dismissed on this computer. */
export function useUnseen(seatId: string, announcements: Announcement[]) {
  const key = `${seatId}:seen-announcements`;
  const [seen, setSeen] = useState<string[]>(() => {
    try {
      return JSON.parse(readPref(key) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const unseen = announcements.filter((a) => !seen.includes(a.id));
  const dismiss = (id: string) => {
    const next = [...seen, id].slice(-200);
    setSeen(next);
    writePref(key, JSON.stringify(next));
  };
  return { unseen, dismiss };
}
