import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DraftStore, type Cipher } from "./drafts";

// Reversible stand-in for Electron safeStorage.
const xor: Cipher = {
  encrypt: (s) => Buffer.from(Buffer.from(s, "utf8").map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString("utf8"),
};

describe("DraftStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "drafts-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when nothing is saved", async () => {
    expect(await new DraftStore(dir, xor).load("a1", "q1")).toBeNull();
  });

  it("round-trips and bumps the revision on each save", async () => {
    const store = new DraftStore(dir, xor);
    await store.save("a1", "q1", "int main(){}");
    const second = await store.save("a1", "q1", "int main(){return 0;}");
    expect(second.revision).toBe(2);
    expect((await store.load("a1", "q1"))?.code).toBe("int main(){return 0;}");
  });

  it("keeps questions separate and leaves no temp files", async () => {
    const store = new DraftStore(dir, xor);
    await store.save("a1", "q1", "one");
    await store.save("a1", "q2", "two");
    expect((await store.load("a1", "q1"))?.code).toBe("one");
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("does not store code in plaintext", async () => {
    const store = new DraftStore(dir, xor);
    await store.save("a1", "q1", "SECRET_SOLUTION");
    const [file] = await readdir(dir);
    expect((await readFile(path.join(dir, file))).toString("utf8")).not.toContain(
      "SECRET_SOLUTION",
    );
  });
});
