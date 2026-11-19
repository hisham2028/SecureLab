// Mirror of the preload bridge (src/main/preload.ts). The renderer can't import main-process
// files (they use Node types), so the shapes are repeated here.
interface BridgeDraft {
  questionId: string;
  language: string;
  code: string;
  revision: number;
  savedAt: string;
  syncedRevision: number;
  syncedAt: string | null;
}

type BridgeResponse =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

interface Window {
  securelab?: {
    /** Set by the browser version (src/renderer/web/bridge.ts); absent in the desktop app. */
    kind?: "web";
    /** Browser version: a session survives a reload of the tab. */
    hasSession?(): boolean;
    request(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<BridgeResponse>;
    signOut(): Promise<void>;
    listDrafts(seatId: string): Promise<BridgeDraft[]>;
    saveDraft(
      seatId: string,
      questionId: string,
      language: string,
      code: string,
      minRevision?: number,
    ): Promise<BridgeDraft>;
    adoptDraft(
      seatId: string,
      questionId: string,
      language: string,
      code: string,
      revision: number,
      savedAt: string,
    ): Promise<BridgeDraft>;
    markDraftSynced(
      seatId: string,
      questionId: string,
      language: string,
      revision: number,
      syncedAt: string,
    ): Promise<BridgeDraft | null>;
    environmentInfo(): Promise<{
      platform: string;
      appVersion: string;
      electronVersion: string;
      encryptionAvailable: boolean;
      apiUrl: string;
    }>;
    systemCheck(): Promise<{
      web?: boolean;
      encryptionAvailable: boolean;
      draftsWritable: boolean;
      server: { reachable: boolean; latencyMs: number | null; clockSkewSeconds: number | null };
      secureConnection: boolean;
      screen: { width: number; height: number };
    }>;
    setLockdown(on: boolean): Promise<void>;
  };
}
