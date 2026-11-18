import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { configSources, resolveApiUrl } from "./config";

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

  it("ignores student-writable settings in an installed build", async () => {
    await writeFile(path.join(a, "config.json"), '{"apiUrl":"http://exam.lab:3000"}');
    await writeFile(path.join(b, "config.json"), '{"apiUrl":"http://rogue.example:3000"}');
    const env = { SECURELAB_API_URL: "http://rogue.example" };
    const installed = configSources(true, env, a, b);
    expect(resolveApiUrl(installed.env, installed.dirs).host).toBe("exam.lab:3000");
    const dev = configSources(false, env, a, b);
    expect(resolveApiUrl(dev.env, dev.dirs).host).toBe("rogue.example");
  });
});
