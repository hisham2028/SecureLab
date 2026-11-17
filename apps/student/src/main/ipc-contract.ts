/** The only channels the renderer can reach. Keep this list short and reviewed. */
export const IpcChannel = {
  DraftLoad: "draft:load",
  DraftSave: "draft:save",
  EnvironmentInfo: "env:info",
} as const;

export interface EnvironmentInfo {
  platform: NodeJS.Platform;
  appVersion: string;
  electronVersion: string;
  /** Whether OS-level encryption for local drafts is available on this machine. */
  encryptionAvailable: boolean;
}
