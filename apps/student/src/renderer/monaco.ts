// Bundle Monaco locally. Never load the editor from a CDN inside an exam client.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
// Editor features used by the exam screen: find/replace, bracket matching, folding, comments.
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding";
import "monaco-editor/esm/vs/editor/contrib/comment/browser/comment";
import "monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations";
import "monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };
