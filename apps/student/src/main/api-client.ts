/**
 * The student app's only network client. It lives in the main process so the renderer never
 * sees the session token and can't make network requests at all (its CSP allows none).
 * The renderer asks for student API paths over IPC; anything else is refused here.
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T = unknown> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export type HttpMethod = "GET" | "POST" | "PUT";

const METHODS = new Set<HttpMethod>(["GET", "POST", "PUT"]);
const PATH = /^\/v1\/student\/[A-Za-z0-9/_-]*(\?[A-Za-z0-9=&_-]*)?$/;
const LOGIN_PATH = "/v1/student/session";
const DEFAULT_TIMEOUT_MS = 15_000;
// Runs wait for the judge; give them its wall-time cap plus headroom.
const RUN_TIMEOUT_MS = 45_000;

export function isAllowedRequest(method: unknown, path: unknown): method is HttpMethod {
  return (
    typeof method === "string" &&
    METHODS.has(method as HttpMethod) &&
    typeof path === "string" &&
    path.length < 300 &&
    PATH.test(path) &&
    !path.includes("..")
  );
}

/** Normalizes and checks a server address from settings. Returns null when unusable. */
export function parseApiUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export class ApiClient {
  private token: string | null = null;

  constructor(
    readonly baseUrl: URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get signedIn(): boolean {
    return this.token !== null;
  }

  signOut(): void {
    this.token = null;
  }

  async request(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> {
    const isLogin = method === "POST" && path === LOGIN_PATH;
    if (isLogin) this.token = null;
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token && !isLogin) headers.authorization = `Bearer ${this.token}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.href.replace(/\/$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(path.endsWith("/run") ? RUN_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
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
      if (res.status === 401) this.token = null;
      const err = (json as { error?: Partial<ApiError> } | null)?.error;
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
      // Keep the token here; the renderer only learns that sign-in worked.
      const token = (json as { accessToken?: unknown } | null)?.accessToken;
      if (typeof token !== "string") {
        return {
          ok: false,
          status: 502,
          error: { code: "ERROR", message: "The server's answer was not understood." },
        };
      }
      this.token = token;
      return { ok: true, status: res.status, data: { signedIn: true } };
    }
    return { ok: true, status: res.status, data: json };
  }

  /** Round trip to the health endpoint: latency and the server's clock, for the system check. */
  async ping(): Promise<{ ok: boolean; latencyMs: number | null; serverDate: string | null }> {
    const started = Date.now();
    try {
      const res = await this.fetchImpl(`${this.baseUrl.href.replace(/\/$/, "")}/health/live`, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      return {
        ok: res.ok,
        latencyMs: Date.now() - started,
        serverDate: res.headers.get("date"),
      };
    } catch {
      return { ok: false, latencyMs: null, serverDate: null };
    }
  }
}
