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

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push(...(e.isDirectory() ? await allFiles(p) : [p]));
  }
  return out;
}

describe("DraftStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "drafts-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns nothing when nothing is saved", async () => {
    const store = new DraftStore(dir, xor);
    expect(await store.load("seat", "q1", "c")).toBeNull();
    expect(await store.list("seat")).toEqual([]);
  });

  it("survives a new store instance (an app restart) with code and revisions intact", async () => {
    await new DraftStore(dir, xor).save("seat", "q1", "c", "int main(){}");
    await new DraftStore(dir, xor).save("seat", "q1", "c", "int main(){return 0;}");
    const after = await new DraftStore(dir, xor).load("seat", "q1", "c");
    expect(after).toMatchObject({ code: "int main(){return 0;}", revision: 2, syncedRevision: 0 });
  });

  it("keeps questions, languages and seats apart, and leaves no temp files", async () => {
    const store = new DraftStore(dir, xor);
    await store.save("seat", "q1", "c", "c-one");
    await store.save("seat", "q1", "python", "py-one");
    await store.save("seat", "q2", "c", "c-two");
    await store.save("other", "q1", "c", "not mine");
    const mine = await store.list("seat");
    expect(mine.map((d) => `${d.questionId}/${d.language}=${d.code}`).sort()).toEqual([
      "q1/c=c-one",
      "q1/python=py-one",
      "q2/c=c-two",
    ]);
    expect((await allFiles(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("does not store code in plaintext", async () => {
    await new DraftStore(dir, xor).save("seat", "q1", "c", "SECRET_SOLUTION");
    for (const f of await allFiles(dir)) {
      expect((await readFile(f)).toString("utf8")).not.toContain("SECRET_SOLUTION");
    }
  });

  it("serializes concurrent saves so every save gets its own revision", async () => {
    const store = new DraftStore(dir, xor);
    const saved = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.save("seat", "q1", "c", `v${i}`)),
    );
    expect(saved.map((d) => d.revision).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    expect((await store.load("seat", "q1", "c"))?.revision).toBe(10);
  });

  it("can jump past a revision the server already holds", async () => {
    const store = new DraftStore(dir, xor);
    await store.save("seat", "q1", "c", "a");
    expect((await store.save("seat", "q1", "c", "b", 41)).revision).toBe(41);
    expect((await store.save("seat", "q1", "c", "c", 5)).revision).toBe(42);
  });

  it("adopts the server copy only when it is newer", async () => {
    const store = new DraftStore(dir, xor);
    await store.save("seat", "q1", "c", "local-1");
    await store.save("seat", "q1", "c", "local-2");
    const kept = await store.adopt("seat", "q1", "c", "server-old", 1, "2026-01-01T00:00:00Z");
    expect(kept.code).toBe("local-2");
    const taken = await store.adopt("seat", "q1", "c", "server-new", 7, "2026-01-01T00:00:00Z");
    expect(taken).toMatchObject({ code: "server-new", revision: 7, syncedRevision: 7 });
  });

  it("never moves the synced mark backwards", async () => {
    const store = new DraftStore(dir, xor);
    await store.save("seat", "q1", "c", "a");
    await store.save("seat", "q1", "c", "b");
    await store.markSynced("seat", "q1", "c", 2, "t2");
    await store.markSynced("seat", "q1", "c", 1, "t1");
    expect(await store.load("seat", "q1", "c")).toMatchObject({
      revision: 2,
      syncedRevision: 2,
      syncedAt: "t2",
    });
  });

  it("probe reports whether the drafts folder works", async () => {
    expect(await new DraftStore(dir, xor).probe()).toBe(true);
    const broken: Cipher = { encrypt: xor.encrypt, decrypt: () => "garbage" };
    expect(await new DraftStore(dir, broken).probe()).toBe(false);
  });
});
