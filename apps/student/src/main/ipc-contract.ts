/** The only channels the renderer can reach. Keep this list short and reviewed. */
export const IpcChannel = {
  ApiRequest: "api:request",
  ApiSignOut: "api:sign-out",
  DraftList: "draft:list",
  DraftSave: "draft:save",
  DraftAdopt: "draft:adopt",
  DraftMarkSynced: "draft:mark-synced",
  EnvironmentInfo: "env:info",
  SystemCheck: "system:check",
  /** Locked-screen exams: the renderer says when the exam screen is showing. */
  Lockdown: "exam:lockdown",
} as const;

export interface EnvironmentInfo {
  platform: NodeJS.Platform;
  appVersion: string;
  electronVersion: string;
  /** Whether OS-level encryption for local drafts is available on this machine. */
  encryptionAvailable: boolean;
  /** Exam server address the app talks to, for display. */
  apiUrl: string;
}

export interface SystemCheck {
  encryptionAvailable: boolean;
  draftsWritable: boolean;
  server: { reachable: boolean; latencyMs: number | null; clockSkewSeconds: number | null };
  secureConnection: boolean;
  screen: { width: number; height: number };
}
