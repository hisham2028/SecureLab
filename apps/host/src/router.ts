import { useEffect, useState } from "react";

/** Minimal hash router: #/exams, #/exams/:id/students, #/questions/new, ... */
export type Route =
  | { page: "exams" }
  | { page: "exam"; id: string; tab: "questions" | "students" | "details" }
  | { page: "pins"; id: string }
  | { page: "questions" }
  | { page: "question-new" }
  | { page: "question-edit"; id: string }
  | { page: "not-found" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [a, b, c] = parts;
  if (!a || (a === "exams" && !b)) return { page: "exams" };
  if (a === "exams" && b && c === "pins") return { page: "pins", id: b };
  if (a === "exams" && b) {
    const tab = c === "students" || c === "details" ? c : "questions";
    return { page: "exam", id: b, tab };
  }
  if (a === "questions" && !b) return { page: "questions" };
  if (a === "questions" && b === "new") return { page: "question-new" };
  if (a === "questions" && b) return { page: "question-edit", id: b };
  return { page: "not-found" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

/** Blocks in-app navigation and tab close while a form has unsaved changes. */
export function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => e.preventDefault();
    const hash = (e: HashChangeEvent) => {
      if (!window.confirm("You have unsaved changes. Leave this page and lose them?")) {
        e.stopImmediatePropagation();
        history.replaceState(null, "", e.oldURL);
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("hashchange", hash, { capture: true });
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("hashchange", hash, { capture: true });
    };
  }, [dirty]);
}
