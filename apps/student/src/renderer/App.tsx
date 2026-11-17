import { useEffect, useRef, useState } from "react";
import { CodeEditor } from "./CodeEditor";

// Placeholder identifiers until exam login exists (Phase 3).
const ATTEMPT = "demo-attempt";
const QUESTION = "q1";
const STARTER = "#include <stdio.h>\n\nint main(void) {\n    return 0;\n}\n";

type SaveState =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error" };

export function App() {
  const [code, setCode] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [env, setEnv] = useState<string>("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const bridge = window.securelab;
    if (!bridge) {
      setCode(STARTER);
      setEnv("Running outside the desktop app: local drafts are off.");
      return;
    }
    void bridge.loadDraft(ATTEMPT, QUESTION).then((d) => setCode(d?.code ?? STARTER));
    void bridge
      .environmentInfo()
      .then((i) =>
        setEnv(
          `${i.platform} · app ${i.appVersion} · Electron ${i.electronVersion}` +
            (i.encryptionAvailable ? "" : " · warning: draft encryption unavailable"),
        ),
      );
  }, []);

  function onChange(next: string) {
    setCode(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      if (!window.securelab) return;
      setSave({ kind: "saving" });
      try {
        const d = await window.securelab.saveDraft(ATTEMPT, QUESTION, next);
        setSave({ kind: "saved", at: new Date(d.savedAt).toLocaleTimeString() });
      } catch {
        setSave({ kind: "error" });
      }
    }, 800);
  }

  return (
    <div className="layout">
      <header>
        <strong>SecureLab</strong>
        <span className="status" aria-live="polite">
          {save.kind === "saving" && "Saving…"}
          {save.kind === "saved" && `Saved locally at ${save.at}`}
          {save.kind === "error" &&
            "Couldn't save locally. Keep this window open and tell the invigilator."}
        </span>
      </header>
      <main>
        {code === null ? (
          <p className="muted">Loading draft…</p>
        ) : (
          <CodeEditor value={code} language="c" onChange={onChange} />
        )}
      </main>
      <footer className="muted">{env}</footer>
    </div>
  );
}
