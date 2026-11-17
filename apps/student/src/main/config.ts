import { readFileSync } from "node:fs";
import path from "node:path";
import { parseApiUrl } from "./api-client";

export const DEFAULT_API_URL = "http://localhost:3000";

/**
 * Where the exam server is, first match wins:
 * 1. SECURELAB_API_URL environment variable (development, scripted labs);
 * 2. config.json next to SecureLab.exe (set once by lab IT for every user);
 * 3. config.json in the user's app data folder;
 * 4. http://localhost:3000.
 * config.json looks like {"apiUrl": "http://exam-server.lab:3000"}.
 */
export function resolveApiUrl(env: NodeJS.ProcessEnv, configDirs: string[]): URL {
  const fromEnv = parseApiUrl(env.SECURELAB_API_URL);
  if (fromEnv) return fromEnv;
  for (const dir of configDirs) {
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8")) as {
        apiUrl?: unknown;
      };
      const url = typeof raw.apiUrl === "string" ? parseApiUrl(raw.apiUrl) : null;
      if (url) return url;
    } catch {
      // Missing or unreadable config: try the next place.
    }
  }
  return new URL(DEFAULT_API_URL);
}
