import { describe, expect, it } from "vitest";
import { ApiClient, isAllowedRequest, parseApiUrl } from "./api-client";

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const base = new URL("http://lab-server:3000");

describe("isAllowedRequest", () => {
  it("allows student API paths only", () => {
    expect(isAllowedRequest("GET", "/v1/student/exam")).toBe(true);
    expect(isAllowedRequest("PUT", "/v1/student/exam/drafts/abc-1/c")).toBe(true);
    expect(isAllowedRequest("GET", "/v1/student/exam/submissions?questionId=ab-1")).toBe(true);
    expect(isAllowedRequest("GET", "/v1/exams")).toBe(false);
    expect(isAllowedRequest("GET", "/v1/student/../exams")).toBe(false);
    expect(isAllowedRequest("GET", "https://evil.example/v1/student/exam")).toBe(false);
    expect(isAllowedRequest("DELETE", "/v1/student/exam")).toBe(false);
    expect(isAllowedRequest("GET", "/v1/student/exam#x")).toBe(false);
  });
});

describe("parseApiUrl", () => {
  it("accepts http(s) addresses and strips trailing slashes", () => {
    expect(parseApiUrl("http://10.0.0.5:3000/")?.href).toBe("http://10.0.0.5:3000/");
    expect(parseApiUrl("https://exam.uni.edu/api/")?.href).toBe("https://exam.uni.edu/api");
  });
  it("rejects other schemes, credentials and junk", () => {
    expect(parseApiUrl("file:///etc/passwd")).toBeNull();
    expect(parseApiUrl("http://user:pw@host")).toBeNull();
    expect(parseApiUrl("not a url")).toBeNull();
    expect(parseApiUrl(undefined)).toBeNull();
  });
});

describe("ApiClient", () => {
  it("keeps the token to itself and sends it on later requests", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { accessToken: "tok-123" } },
      { status: 200, body: { exam: {} } },
    ]);
    const api = new ApiClient(base, fn);
    const login = await api.request("POST", "/v1/student/session", { pin: "123456" });
    expect(login).toEqual({ ok: true, status: 200, data: { signedIn: true } });
    expect(JSON.stringify(login)).not.toContain("tok-123");
    await api.request("GET", "/v1/student/exam");
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer tok-123");
    expect(calls[1].url).toBe("http://lab-server:3000/v1/student/exam");
  });

  it("passes error codes and details through, and forgets the token on 401", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { accessToken: "tok" } },
      {
        status: 409,
        body: { error: { code: "STALE_DRAFT", message: "newer", details: { currentRevision: 4 } } },
      },
      { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Sign in again." } } },
      { status: 200, body: {} },
    ]);
    const api = new ApiClient(base, fn);
    await api.request("POST", "/v1/student/session", {});
    expect(await api.request("PUT", "/v1/student/exam/drafts/q/c", {})).toEqual({
      ok: false,
      status: 409,
      error: { code: "STALE_DRAFT", message: "newer", details: { currentRevision: 4 } },
    });
    await api.request("GET", "/v1/student/exam");
    expect(api.signedIn).toBe(false);
    await api.request("GET", "/v1/student/exam");
    expect((calls[3].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("reports network failures as OFFLINE instead of throwing", async () => {
    const { fn } = fakeFetch([]);
    const res = await new ApiClient(base, fn).request("GET", "/v1/student/exam");
    expect(res).toMatchObject({ ok: false, status: 0, error: { code: "OFFLINE" } });
  });

  it("joins validation messages from the server", async () => {
    const { fn } = fakeFetch([
      { status: 400, body: { error: { code: "BAD_REQUEST", message: ["pin: bad", "id: bad"] } } },
    ]);
    const res = await new ApiClient(base, fn).request("POST", "/v1/student/session", {});
    expect(res).toMatchObject({ ok: false, error: { message: "pin: bad id: bad" } });
  });
});
