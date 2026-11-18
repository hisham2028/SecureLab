import { contextBridge, ipcRenderer } from "electron";
import type { EnvironmentInfo, SystemCheck } from "./ipc-contract";
import type { ApiResponse, HttpMethod } from "./api-client";
import type { LocalDraft } from "./drafts";

// Sandboxed preloads cannot require local files, so the channel names are repeated here
// (type-only imports are fine). Keep in sync with ipc-contract.ts; the build test checks it.
const Channel = {
  ApiRequest: "api:request",
  ApiSignOut: "api:sign-out",
  DraftList: "draft:list",
  DraftSave: "draft:save",
  DraftAdopt: "draft:adopt",
  DraftMarkSynced: "draft:mark-synced",
  EnvironmentInfo: "env:info",
  SystemCheck: "system:check",
  Lockdown: "exam:lockdown",
} as const;

/** Narrow, typed bridge. The renderer gets these functions and nothing else from Node/Electron. */
const bridge = {
  request: (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> =>
    ipcRenderer.invoke(Channel.ApiRequest, method, path, body),
  signOut: (): Promise<void> => ipcRenderer.invoke(Channel.ApiSignOut),
  listDrafts: (seatId: string): Promise<LocalDraft[]> =>
    ipcRenderer.invoke(Channel.DraftList, seatId),
  saveDraft: (
    seatId: string,
    questionId: string,
    language: string,
    code: string,
    minRevision = 0,
  ): Promise<LocalDraft> =>
    ipcRenderer.invoke(Channel.DraftSave, seatId, questionId, language, code, minRevision),
  adoptDraft: (
    seatId: string,
    questionId: string,
    language: string,
    code: string,
    revision: number,
    savedAt: string,
  ): Promise<LocalDraft> =>
    ipcRenderer.invoke(Channel.DraftAdopt, seatId, questionId, language, code, revision, savedAt),
  markDraftSynced: (
    seatId: string,
    questionId: string,
    language: string,
    revision: number,
    syncedAt: string,
  ): Promise<LocalDraft | null> =>
    ipcRenderer.invoke(Channel.DraftMarkSynced, seatId, questionId, language, revision, syncedAt),
  environmentInfo: (): Promise<EnvironmentInfo> => ipcRenderer.invoke(Channel.EnvironmentInfo),
  systemCheck: (): Promise<SystemCheck> => ipcRenderer.invoke(Channel.SystemCheck),
  setLockdown: (on: boolean): Promise<void> => ipcRenderer.invoke(Channel.Lockdown, on),
};

contextBridge.exposeInMainWorld("securelab", bridge);
export type SecureLabBridge = typeof bridge;
