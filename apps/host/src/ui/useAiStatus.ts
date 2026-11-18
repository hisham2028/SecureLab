import { useEffect, useState } from "react";
import * as api from "../api";

let cached: Promise<{ enabled: boolean; model: string | null }> | null = null;

/** Whether AI help is set up on this server. Null while loading or if the check failed. */
export function useAiEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    cached ??= api.aiStatus();
    let live = true;
    cached.then(
      (s) => live && setEnabled(s.enabled),
      () => {
        cached = null;
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}

export const AI_OFF_HINT =
  "AI help isn't set up on this server, so students won't see it. Your admin can turn it on (deployment guide, AI help).";
