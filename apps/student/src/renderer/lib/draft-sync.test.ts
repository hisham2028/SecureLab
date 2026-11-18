import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftSync, mergeDrafts, type DraftRecord, type PushOutcome } from "./draft-sync";

/** In-memory stand-ins for the local DraftStore and the server's draft endpoint. */
function harness() {
  const local = new Map<string, DraftRecord>();
  const server = new Map<string, { code: string; revision: number }>();
  const pushes: { code: string; revision: number }[] = [];
  let gate: Promise<void> | null = null;
  let override: ((code: string, revision: number) => PushOutcome) | null = null;
  const k = (q: string, l: string) => `${q}/${l}`;

  const deps = {
    async saveLocal(q: string, l: string, code: string, minRevision: number) {
      const prev = local.get(k(q, l));
      const rec: DraftRecord = {
        questionId: q,
        language: l,
        code,
        revision: Math.max((prev?.revision ?? 0) + 1, minRevision),
        savedAt: new Date().toISOString(),
        syncedRevision: prev?.syncedRevision ?? 0,
        syncedAt: prev?.syncedAt ?? null,
      };
      local.set(k(q, l), rec);
      return rec;
    },
    async markSynced(q: string, l: string, revision: number, at: string) {
      const prev = local.get(k(q, l))!;
      if (revision > prev.syncedRevision)
        local.set(k(q, l), { ...prev, syncedRevision: revision, syncedAt: at });
    },
    async push(q: string, l: string, code: string, revision: number): Promise<PushOutcome> {
      pushes.push({ code, revision });
      if (gate) await gate;
      if (override) return override(code, revision);
      const cur = server.get(k(q, l));
      if (cur && cur.revision >= revision) return { kind: "stale", currentRevision: cur.revision };
      server.set(k(q, l), { code, revision });
      return { kind: "saved", revision, savedAt: new Date().toISOString() };
    },
  };
  return {
    deps,
    local,
    server,
    pushes,
    hold() {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    answer(fn: ((code: string, revision: number) => PushOutcome) | null) {
      override = fn;
    },
  };
}

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("DraftSync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves locally after a short pause in typing, then to the server", async () => {
    const h = harness();
    const sync = new DraftSync(h.deps, { localDelayMs: 400, pushDelayMs: 1000 });
    sync.edit("q1", "c", "a");
    sync.edit("q1", "c", "ab");
    expect(sync.status("q1", "c")).toMatchObject({ unsavedEdits: true, unsynced: true });
    await settle(400);
    expect(h.local.get("q1/c")).toMatchObject({ code: "ab", revision: 1 });
    expect(h.pushes).toEqual([]);
    await settle(1000);
    expect(h.server.get("q1/c")).toEqual({ code: "ab", revision: 1 });
    expect(sync.status("q1", "c")).toMatchObject({
      localRevision: 1,
      serverRevision: 1,
      unsynced: false,
    });
    expect(h.local.get("q1/c")?.syncedRevision).toBe(1);
  });

  it("acceptance: a slow reply for old code never overwrites newer local code", async () => {
    const h = harness();
    const sync = new DraftSync(h.deps, { localDelayMs: 10, pushDelayMs: 10 });
    sync.edit("q1", "c", "old");
    const release = h.hold();
    await settle(30); // old code saved locally (rev 1) and its push is now stuck in flight
    expect(h.pushes).toEqual([{ code: "old", revision: 1 }]);

    sync.edit("q1", "c", "new");
    await settle(30); // new code saved locally as rev 2 while rev 1 is still in flight
    expect(h.pushes).toHaveLength(1); // only one save per draft in flight

    release();
    await settle(0);
    // The late reply for rev 1 is recorded as such; the editor still has "new".
    expect(sync.code("q1", "c")).toBe("new");
    expect(sync.status("q1", "c")?.serverRevision).toBeGreaterThanOrEqual(1);
    await settle(50);
    expect(h.server.get("q1/c")).toEqual({ code: "new", revision: 2 });
    expect(sync.status("q1", "c")).toMatchObject({
      localRevision: 2,
      serverRevision: 2,
      unsynced: false,
    });
  });

  it("a stale answer re-saves this computer's code above the server's revision", async () => {
    const h = harness();
    h.server.set("q1/c", { code: "from another PC", revision: 7 });
    const sync = new DraftSync(h.deps, { localDelayMs: 10, pushDelayMs: 10 });
    sync.edit("q1", "c", "mine");
    await settle(100);
    expect(h.server.get("q1/c")).toEqual({ code: "mine", revision: 8 });
    expect(sync.status("q1", "c")).toMatchObject({ localRevision: 8, serverRevision: 8 });
  });

  it("retries with backoff while offline and catches up when the network returns", async () => {
    const h = harness();
    h.answer(() => ({ kind: "retry", message: "Can't reach the exam server." }));
    const sync = new DraftSync(h.deps, { localDelayMs: 10, pushDelayMs: 10, maxBackoffMs: 8000 });
    sync.edit("q1", "c", "x");
    await settle(20);
    expect(h.pushes).toHaveLength(1);
    expect(sync.status("q1", "c")).toMatchObject({
      unsynced: true,
      problem: "Can't reach the exam server.",
    });
    await settle(999);
    expect(h.pushes).toHaveLength(1); // waits 1 s
    await settle(1);
    expect(h.pushes).toHaveLength(2);
    await settle(2000);
    expect(h.pushes).toHaveLength(3); // then 2 s, 4 s, … capped
    h.answer(null);
    await settle(4000);
    expect(sync.status("q1", "c")).toMatchObject({ unsynced: false, problem: null });
  });

  it("stops when the server says work can't be saved, and resumes on request", async () => {
    const h = harness();
    h.answer(() => ({ kind: "blocked", message: "The exam is paused." }));
    const sync = new DraftSync(h.deps, { localDelayMs: 10, pushDelayMs: 10 });
    sync.edit("q1", "c", "x");
    await settle(50);
    expect(sync.blocked).toBe("The exam is paused.");
    sync.edit("q1", "c", "xy");
    await settle(5000);
    expect(h.pushes).toHaveLength(1);
    expect(h.local.get("q1/c")?.code).toBe("xy"); // still saved locally
    h.answer(null);
    sync.resume();
    await settle(10);
    expect(h.server.get("q1/c")?.code).toBe("xy");
  });

  it("keeps languages separate and limits concurrent server saves", async () => {
    const h = harness();
    const release = h.hold();
    const sync = new DraftSync(h.deps, { localDelayMs: 10, pushDelayMs: 10, maxConcurrent: 2 });
    sync.edit("q1", "c", "c code");
    sync.edit("q1", "python", "py code");
    sync.edit("q2", "c", "q2 code");
    await settle(30);
    expect(h.pushes).toHaveLength(2);
    release();
    await settle(30);
    expect([...h.server.entries()].sort()).toEqual([
      ["q1/c", { code: "c code", revision: 1 }],
      ["q1/python", { code: "py code", revision: 1 }],
      ["q2/c", { code: "q2 code", revision: 1 }],
    ]);
  });

  it("flush writes pending typing immediately and reports when the server has everything", async () => {
    const h = harness();
    const sync = new DraftSync(h.deps, { localDelayMs: 5000, pushDelayMs: 5000 });
    sync.edit("q1", "c", "last keystrokes");
    const done = sync.flush(2000);
    await settle(0);
    await expect(done).resolves.toBe(true);
    expect(h.server.get("q1/c")?.code).toBe("last keystrokes");

    h.answer(() => ({ kind: "retry", message: "offline" }));
    sync.edit("q1", "c", "more");
    const failed = sync.flush(2000);
    await settle(2000);
    await expect(failed).resolves.toBe(false);
  });

  it("never moves the server mark backwards, whatever a reply says", async () => {
    const h = harness();
    h.answer(() => ({ kind: "saved", revision: 1, savedAt: "late" }));
    const sync = new DraftSync(h.deps, { localDelayMs: 10, pushDelayMs: 10 });
    sync.seed([
      {
        questionId: "q1",
        language: "c",
        code: "x",
        revision: 3,
        savedAt: "t",
        syncedRevision: 2,
        syncedAt: "t2",
      },
    ]);
    await settle(10);
    expect(sync.status("q1", "c")).toMatchObject({ serverRevision: 2, serverSavedAt: "t2" });
    sync.dispose();
  });

  it("seeded drafts that the server lacks are sent on start", async () => {
    const h = harness();
    const sync = new DraftSync(h.deps, { localDelayMs: 10, pushDelayMs: 10 });
    h.local.set("q1/c", {
      questionId: "q1",
      language: "c",
      code: "typed offline",
      revision: 3,
      savedAt: "t",
      syncedRevision: 1,
      syncedAt: "t",
    });
    sync.seed([h.local.get("q1/c")!]);
    await settle(10);
    expect(h.server.get("q1/c")).toEqual({ code: "typed offline", revision: 3 });
  });
});

describe("mergeDrafts", () => {
  const rec = (code: string, revision: number, syncedRevision = 0): DraftRecord => ({
    questionId: "q1",
    language: "c",
    code,
    revision,
    savedAt: "local",
    syncedRevision,
    syncedAt: null,
  });
  const srv = (code: string, revision: number) => ({
    examQuestionId: "q1",
    language: "c",
    code,
    revision,
    savedAt: "server",
  });

  it("takes the server copy when this computer has nothing or older work (new PC)", () => {
    expect(mergeDrafts([], [srv("s", 4)]).records[0]).toMatchObject({
      code: "s",
      revision: 4,
      syncedRevision: 4,
    });
    const m = mergeDrafts([rec("l", 2)], [srv("s", 4)]);
    expect(m.records[0].code).toBe("s");
    expect(m.adopt).toHaveLength(1);
  });

  it("keeps newer local work and leaves it marked for sending", () => {
    const m = mergeDrafts([rec("l", 6, 3)], [srv("s", 3)]);
    expect(m.records[0]).toMatchObject({ code: "l", revision: 6, syncedRevision: 3 });
    expect(m.adopt).toEqual([]);
  });

  it("recognises a save whose reply was lost", () => {
    const m = mergeDrafts([rec("same", 5, 4)], [srv("same", 5)]);
    expect(m.records[0].syncedRevision).toBe(5);
    const different = mergeDrafts([rec("mine", 5, 4)], [srv("other", 5)]);
    expect(different.records[0]).toMatchObject({ code: "mine", syncedRevision: 4 });
  });
});
