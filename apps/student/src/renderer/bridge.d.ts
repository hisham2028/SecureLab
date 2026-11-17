interface Draft {
  code: string;
  savedAt: string;
  revision: number;
}

interface Window {
  securelab?: {
    loadDraft(attemptId: string, questionId: string): Promise<Draft | null>;
    saveDraft(attemptId: string, questionId: string, code: string): Promise<Draft>;
    environmentInfo(): Promise<{
      platform: string;
      appVersion: string;
      electronVersion: string;
      encryptionAvailable: boolean;
    }>;
  };
}
