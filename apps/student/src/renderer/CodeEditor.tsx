import { useEffect, useRef } from "react";
import { monaco } from "./monaco";

interface Props {
  value: string;
  language: "c" | "cpp" | "python";
  onChange: (code: string) => void;
}

export function CodeEditor({ value, language, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const ed = monaco.editor.create(host.current!, {
      value,
      language: language === "python" ? "python" : "cpp",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      // No AI or cross-file suggestions: plain word-based completion only.
      wordBasedSuggestions: "currentDocument",
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "vs",
    });
    const sub = ed.onDidChangeModelContent(() => onChangeRef.current(ed.getValue()));
    editor.current = ed;
    return () => {
      sub.dispose();
      ed.dispose();
    };
    // Create once; external value changes are applied below.
  }, []);

  useEffect(() => {
    const ed = editor.current;
    if (ed && ed.getValue() !== value) ed.setValue(value);
  }, [value]);

  return <div ref={host} className="editor" />;
}
