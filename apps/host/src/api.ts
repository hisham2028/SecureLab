/**
 * Thin API client. The token lives in memory only (lost on reload) until a proper
 * refresh/session strategy is chosen; never put staff tokens in localStorage.
 */
let accessToken: string | null = null;

export interface ApiError {
  code: string;
  message: string | string[];
  correlationId?: string;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(Array.isArray(error.message) ? error.message.join(", ") : error.message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: "NETWORK", message: "Couldn't reach the server." },
    );
  }
  return body as T;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export async function login(email: string, password: string): Promise<void> {
  const { accessToken: token } = await call<{ accessToken: string }>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  accessToken = token;
}

export const me = () => call<Me>("/v1/auth/me");

export function logout(): void {
  accessToken = null;
}
