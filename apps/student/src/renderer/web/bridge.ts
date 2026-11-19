/**
 * The browser version of the desktop app's bridge (src/main/preload.ts), so the same exam screens
 * run as a web page: students open a link instead of installing the app.
 *
 * Differences from the desktop app:
 * - The session token is kept in this tab's sessionStorage (it survives a reload, not closing
 *   the tab). The page's CSP allows scripts from this site only.
 * - Drafts are kept in the browser's localStorage, not encrypted.
 * - A browser can't stop students from switching apps. Locked-screen exams ask for full screen,
 *   cover the exam when the student leaves full screen, and the server records focus loss as
 *   usual. Closing the tab submits the latest saved code and blocks the seat, like closing the
 *   desktop app; signing in again needs the invigilator either way.
 */

type HttpMethod = "GET" | "POST" | "PUT";
type Draft = BridgeDraft;
type Response = BridgeResponse;

const PATH = /^\/v1\/student\/[A-Za-z0-9/_-]*(\?[A-Za-z0-9=&_-]*)?$/;
const LOGIN_PATH = "/v1/student/session";
const TOKEN_KEY = "securelab:session";
const DEFAULT_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 45_000;
const AI_TIMEOUT_MS = 120_000;

/** The API sits behind this site at /api (the Lite server and Caddy both do this). */
const apiBase = `${location.origin}/api`;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

let token: string | null = storage("session")?.getItem(TOKEN_KEY) ?? null;
function setToken(t: string | null) {
  token = t;
  const s = storage("session");
  if (!s) return;
  if (t) s.setItem(TOKEN_KEY, t);
  else s.removeItem(TOKEN_KEY);
}

async function request(method: HttpMethod, path: string, body?: unknown): Promise<Response> {
  if (!["GET", "POST", "PUT"].includes(method) || !PATH.test(path) || path.includes("..")) {
    return { ok: false, status: 400, error: { code: "ERROR", message: "Not allowed." } };
  }
  const isLogin = method === "POST" && path === LOGIN_PATH;
  if (isLogin) setToken(null);
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token && !isLogin) headers.authorization = `Bearer ${token}`;

  let res: globalThis.Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(
        path.endsWith("/run")
          ? RUN_TIMEOUT_MS
          : path.endsWith("/ai") && method === "POST"
            ? AI_TIMEOUT_MS
            : DEFAULT_TIMEOUT_MS,
      ),
      credentials: "omit",
      redirect: "error",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "OFFLINE", message: "Can't reach the exam server." },
    };
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    const err = (
      json as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null
    )?.error;
    const message = Array.isArray(err?.message) ? err.message.join(" ") : err?.message;
    return {
      ok: false,
      status: res.status,
      error: {
        code: typeof err?.code === "string" ? err.code : "ERROR",
        message: typeof message === "string" ? message : `The server answered ${res.status}.`,
        ...(err?.details !== undefined ? { details: err.details } : {}),
      },
    };
  }
  if (isLogin) {
    const t = (json as { accessToken?: unknown } | null)?.accessToken;
    if (typeof t !== "string") {
      return {
        ok: false,
        status: 502,
        error: { code: "ERROR", message: "The server's answer was not understood." },
      };
    }
    setToken(t);
    return { ok: true, status: res.status, data: { signedIn: true } };
  }
  return { ok: true, status: res.status, data: json };
}

// ---------------------------------------------------------------- drafts (localStorage)

const draftKey = (seatId: string, questionId: string, language: string) =>
  `securelab:draft:${seatId}:${questionId}:${language}`;

function readDraft(key: string): Draft | null {
  try {
    const raw = storage("local")?.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, d: Draft): Draft {
  // A full browser storage throws; the server copy still saves, so carry on.
  try {
    storage("local")?.setItem(key, JSON.stringify(d));
  } catch {
    /* ignore */
  }
  return d;
}

const drafts = {
  listDrafts: async (seatId: string): Promise<Draft[]> => {
    const s = storage("local");
    if (!s) return [];
    const prefix = `securelab:draft:${seatId}:`;
    const out: Draft[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(prefix)) {
        const d = readDraft(k);
        if (d) out.push(d);
      }
    }
    return out;
  },
  saveDraft: async (
    seatId: string,
    questionId: string,
    language: string,
    code: string,
    minRevision = 0,
  ): Promise<Draft> => {
    const key = draftKey(seatId, questionId, language);
    const prev = readDraft(key);
    return writeDraft(key, {
      questionId,
      language,
      code,
      revision: Math.max((prev?.revision ?? 0) + 1, minRevision),
      savedAt: new Date().toISOString(),
      syncedRevision: prev?.syncedRevision ?? 0,
      syncedAt: prev?.syncedAt ?? null,
    });
  },
  adoptDraft: async (
    seatId: string,
    questionId: string,
    language: string,
    code: string,
    revision: number,
    savedAt: string,
  ): Promise<Draft> => {
    const key = draftKey(seatId, questionId, language);
    const prev = readDraft(key);
    if (prev && prev.revision >= revision) return prev;
    return writeDraft(key, {
      questionId,
      language,
      code,
      revision,
      savedAt,
      syncedRevision: revision,
      syncedAt: savedAt,
    });
  },
  markDraftSynced: async (
    seatId: string,
    questionId: string,
    language: string,
    revision: number,
    syncedAt: string,
  ): Promise<Draft | null> => {
    const key = draftKey(seatId, questionId, language);
    const prev = readDraft(key);
    if (!prev || prev.syncedRevision >= revision) return prev;
    return writeDraft(key, { ...prev, syncedRevision: revision, syncedAt });
  },
};

// ---------------------------------------------------------------- locked-screen exams

let locked = false;
let overlay: HTMLDivElement | null = null;

function isFullscreen() {
  return document.fullscreenElement !== null;
}

function enterFullscreen() {
  if (!isFullscreen()) {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }
}

/** Covers the exam while it isn't full screen; the button is the click a browser requires. */
function updateOverlay() {
  const show = locked && !isFullscreen();
  if (show && !overlay) {
    overlay = document.createElement("div");
    overlay.className = "web-lock";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const box = document.createElement("div");
    box.className = "web-lock-box";
    const title = document.createElement("h2");
    title.textContent = "This exam runs full screen";
    const text = document.createElement("p");
    text.textContent =
      "Leaving full screen or switching to another tab or app is recorded, and the invigilator sees it. Closing this tab submits your latest saved code and you will need the invigilator's permission to come back.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary";
    button.textContent = "Return to the exam";
    button.addEventListener("click", enterFullscreen);
    box.append(title, text, button);
    overlay.append(box);
    document.body.append(overlay);
    button.focus();
  } else if (!show && overlay) {
    overlay.remove();
    overlay = null;
  }
}

document.addEventListener("fullscreenchange", updateOverlay);

// Closing the tab (or reloading) during a locked exam: ask first, and if the page goes anyway,
// tell the server so it submits the latest saved code and blocks the seat.
window.addEventListener("beforeunload", (e) => {
  if (!locked) return;
  e.preventDefault();
  e.returnValue = "";
});
window.addEventListener("pagehide", () => {
  if (!locked || !token) return;
  void fetch(`${apiBase}/v1/student/exam/leave`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
});

// ---------------------------------------------------------------- the bridge

async function ping(): Promise<{
  ok: boolean;
  latencyMs: number | null;
  serverDate: string | null;
}> {
  const started = performance.now();
  try {
    const res = await fetch(`${apiBase}/health/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return {
      ok: res.ok,
      latencyMs: Math.round(performance.now() - started),
      serverDate: res.headers.get("date"),
    };
  } catch {
    return { ok: false, latencyMs: null, serverDate: null };
  }
}

function storageWorks(): boolean {
  const s = storage("local");
  if (!s) return false;
  try {
    s.setItem("securelab:probe", "1");
    const ok = s.getItem("securelab:probe") === "1";
    s.removeItem("securelab:probe");
    return ok;
  } catch {
    return false;
  }
}

export function installWebBridge(): void {
  if (window.securelab) return; // the desktop app's own bridge
  window.securelab = {
    kind: "web",
    hasSession: () => token !== null,
    request,
    signOut: async () => setToken(null),
    ...drafts,
    environmentInfo: async () => ({
      platform: "web",
      appVersion: "web",
      electronVersion: "",
      encryptionAvailable: false,
      apiUrl: location.origin,
    }),
    systemCheck: async () => {
      const p = await ping();
      const serverMs = p.serverDate ? Date.parse(p.serverDate) : Number.NaN;
      return {
        web: true,
        encryptionAvailable: false,
        draftsWritable: storageWorks(),
        server: {
          reachable: p.ok,
          latencyMs: p.latencyMs,
          clockSkewSeconds: Number.isNaN(serverMs)
            ? null
            : Math.round((Date.now() - serverMs) / 1000),
        },
        secureConnection:
          location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname),
        screen: { width: window.screen.width, height: window.screen.height },
      };
    },
    setLockdown: async (on: boolean) => {
      locked = on;
      if (on) enterFullscreen();
      else if (isFullscreen()) await document.exitFullscreen().catch(() => undefined);
      updateOverlay();
    },
  };
}
