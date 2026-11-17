import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveApiUrl } from "./config";

describe("resolveApiUrl", () => {
  let a: string, b: string;
  beforeEach(async () => {
    a = await mkdtemp(path.join(tmpdir(), "cfg-a-"));
    b = await mkdtemp(path.join(tmpdir(), "cfg-b-"));
  });
  afterEach(async () => {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  });

  it("prefers the environment, then the first valid config file, then localhost", async () => {
    await writeFile(path.join(a, "config.json"), '{"apiUrl":"ftp://nope"}');
    await writeFile(path.join(b, "config.json"), '{"apiUrl":"http://exam.lab:3000"}');
    expect(resolveApiUrl({ SECURELAB_API_URL: "https://env.lab" }, [a, b]).host).toBe("env.lab");
    expect(resolveApiUrl({}, [a, b]).host).toBe("exam.lab:3000");
    expect(resolveApiUrl({}, [a]).href).toBe("http://localhost:3000/");
  });
});
