import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Language } from "@securelab/shared";
import { monaco } from "./monaco";

export interface CodeEditorHandle {
  find(): void;
  focus(): void;
}

interface Props {
  /** One Monaco model per key, so each draft keeps its own undo history. */
  modelKey: string;
  language: Language;
  /** Used only when the model for `modelKey` is first created. */
  initialValue: string;
  onChange: (modelKey: string, code: string) => void;
  readOnly: boolean;
  fontSize: number;
  dark: boolean;
  label: string;
}

const MONACO_LANGUAGE: Record<Language, string> = { c: "c", cpp: "cpp", python: "python" };

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { modelKey, language, initialValue, onChange, readOnly, fontSize, dark, label },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    find: () => {
      editor.current?.focus();
      void editor.current?.getAction("actions.find")?.run();
    },
    focus: () => editor.current?.focus(),
  }));

  useEffect(() => {
    const ed = monaco.editor.create(host.current!, {
      model: null,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      matchBrackets: "always",
      bracketPairColorization: { enabled: true },
      autoClosingBrackets: "languageDefined",
      autoIndent: "full",
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: false,
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
      // No AI or cross-file suggestions: plain word-based completion only.
      wordBasedSuggestions: "currentDocument",
      quickSuggestions: false,
      ariaLabel: label,
    });
    editor.current = ed;
    const map = models.current;
    return () => {
      ed.dispose();
      for (const m of map.values()) m.dispose();
      map.clear();
    };
    // Created once; props are applied by the effects below.
  }, []);

  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    let model = models.current.get(modelKey);
    if (!model) {
      model = monaco.editor.createModel(initialValue, MONACO_LANGUAGE[language]);
      models.current.set(modelKey, model);
    }
    if (ed.getModel() !== model) ed.setModel(model);
    const m = model;
    const sub = m.onDidChangeContent(() => onChangeRef.current(modelKey, m.getValue()));
    return () => sub.dispose();
    // initialValue only matters when the model is created.
  }, [modelKey, language]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly, fontSize, ariaLabel: label });
  }, [readOnly, fontSize, label]);

  useEffect(() => {
    monaco.editor.setTheme(dark ? "vs-dark" : "vs");
  }, [dark]);

  return <div ref={host} className="editor" />;
});
