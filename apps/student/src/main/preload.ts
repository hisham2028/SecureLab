import { contextBridge, ipcRenderer } from "electron";
import type { EnvironmentInfo } from "./ipc-contract";

// Sandboxed preloads cannot require local files, so the channel names are repeated here
// (type-only imports are fine). Keep in sync with ipc-contract.ts; the build test checks it.
const Channel = {
  DraftLoad: "draft:load",
  DraftSave: "draft:save",
  EnvironmentInfo: "env:info",
} as const;

/** Narrow, typed bridge. The renderer gets these functions and nothing else from Node/Electron. */
const bridge = {
  loadDraft: (attemptId: string, questionId: string) =>
    ipcRenderer.invoke(Channel.DraftLoad, attemptId, questionId),
  saveDraft: (attemptId: string, questionId: string, code: string) =>
    ipcRenderer.invoke(Channel.DraftSave, attemptId, questionId, code),
  environmentInfo: (): Promise<EnvironmentInfo> => ipcRenderer.invoke(Channel.EnvironmentInfo),
};

contextBridge.exposeInMainWorld("securelab", bridge);
export type SecureLabBridge = typeof bridge;
