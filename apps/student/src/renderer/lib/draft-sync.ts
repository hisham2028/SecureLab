/**
 * Keeps each draft (question × language) saved on this computer and on the server.
 *
 * Rules that make it safe:
 * - Edits are written locally first (short debounce), each write getting a higher revision.
 * - At most one server save per draft is in flight, and only a bounded number overall.
 * - A server reply only ever moves the "server has revision N" mark forward. It never touches
 *   the code in the editor, so a slow or stale reply can't overwrite newer typing.
 * - If the server already holds a higher revision (another session wrote it), this computer's
 *   current code is re-saved above it and sent again: the copy the student is looking at wins.
 * - Network failures retry with capped exponential backoff; "you can't save now" answers
 *   (paused, time up) stop syncing until resumed.
 */
export interface DraftRecord {
  questionId: string;
  language: string;
  code: string;
  revision: number;
  savedAt: string;
  syncedRevision: number;
  syncedAt: string | null;
}

export interface ServerDraftLike {
  examQuestionId: string;
  language: string;
  code: string;
  revision: number;
  savedAt: string;
}

export type PushOutcome =
  | { kind: "saved"; revision: number; savedAt: string }
  | { kind: "stale"; currentRevision: number }
  | { kind: "retry"; message: string }
  | { kind: "blocked"; message: string }
  /** This draft can't be saved on the server (e.g. the question closed); others carry on. */
  | { kind: "rejected"; message: string };

export interface DraftSyncDeps {
  saveLocal(
    questionId: string,
    language: string,
    code: string,
    minRevision: number,
  ): Promise<DraftRecord>;
  markSynced(questionId: string, language: string, revision: number, at: string): Promise<unknown>;
  push(questionId: string, language: string, code: string, revision: number): Promise<PushOutcome>;
}

export interface DraftSyncOptions {
  localDelayMs: number;
  pushDelayMs: number;
  maxBackoffMs: number;
  maxConcurrent: number;
}

export interface DraftStatus {
  localRevision: number;
  localSavedAt: string | null;
  serverRevision: number;
  serverSavedAt: string | null;
  /** Typed but not yet written to this computer (inside the debounce window). */
  unsavedEdits: boolean;
  /** This computer has a newer revision than the server. */
  unsynced: boolean;
  problem: string | null;
}

interface Entry {
  questionId: string;
  language: string;
  /** Latest code from the editor. */
  code: string;
  /** Code as of `record.revision` (what a push sends). */
  savedCode: string;
  record: DraftRecord | null;
  dirty: boolean;
  writing: Promise<void> | null;
  localTimer: ReturnType<typeof setTimeout> | null;
  pushing: boolean;
  attempts: number;
  retryAt: number;
  problem: string | null;
}

const keyOf = (q: string, l: string) => `${q}\u0000${l}`;

export class DraftSync {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly opts: DraftSyncOptions;
  private inFlight = 0;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private blockedMessage: string | null = null;
  private disposed = false;
  private version = 0;

  constructor(
    private readonly deps: DraftSyncDeps,
    opts: Partial<DraftSyncOptions> = {},
  ) {
    this.opts = {
      localDelayMs: 400,
      pushDelayMs: 1500,
      maxBackoffMs: 30_000,
      maxConcurrent: 2,
      ...opts,
    };
  }

  // ---- reading -----------------------------------------------------------------------------

  /** Changes whenever any status changes; handy for React's useSyncExternalStore. */
  get snapshotVersion(): number {
    return this.version;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  code(questionId: string, language: string): string | undefined {
    return this.entries.get(keyOf(questionId, language))?.code;
  }

  status(questionId: string, language: string): DraftStatus | null {
    const e = this.entries.get(keyOf(questionId, language));
    if (!e) return null;
    const r = e.record;
    return {
      localRevision: r?.revision ?? 0,
      localSavedAt: r?.savedAt ?? null,
      serverRevision: r?.syncedRevision ?? 0,
      serverSavedAt: r?.syncedAt ?? null,
      unsavedEdits: e.dirty,
      unsynced: e.dirty || this.needsPush(e),
      problem: e.problem ?? this.blockedMessage,
    };
  }

  /** Drafts with work the server doesn't have yet. */
  unsyncedCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.dirty || this.needsPush(e)) n++;
    return n;
  }

  /** Question of the most recently saved draft, to reopen after a restart. */
  latestQuestion(): string | null {
    let best: Entry | null = null;
    for (const e of this.entries.values()) {
      if (e.record && (!best?.record || e.record.savedAt > best.record.savedAt)) best = e;
    }
    return best?.questionId ?? null;
  }

  get blocked(): string | null {
    return this.blockedMessage;
  }

  // ---- writing ----------------------------------------------------------------------------

  /** Loads saved drafts (after merging local and server copies) without writing anything. */
  seed(records: DraftRecord[]): void {
    for (const r of records) {
      this.entries.set(keyOf(r.questionId, r.language), {
        questionId: r.questionId,
        language: r.language,
        code: r.code,
        savedCode: r.code,
        record: { ...r },
        dirty: false,
        writing: null,
        localTimer: null,
        pushing: false,
        attempts: 0,
        retryAt: 0,
        problem: null,
      });
    }
    this.changed();
    this.schedulePump(0);
  }

  edit(questionId: string, language: string, code: string): void {
    if (this.disposed) return;
    const k = keyOf(questionId, language);
    let e = this.entries.get(k);
    if (!e) {
      e = {
        questionId,
        language,
        code,
        savedCode: "",
        record: null,
        dirty: true,
        writing: null,
        localTimer: null,
        pushing: false,
        attempts: 0,
        retryAt: 0,
        problem: null,
      };
      this.entries.set(k, e);
    }
    if (e.code === code && !e.dirty) return;
    e.code = code;
    e.dirty = true;
    if (e.localTimer) clearTimeout(e.localTimer);
    const entry = e;
    e.localTimer = setTimeout(() => {
      if (entry.dirty) void this.writeLocal(entry);
    }, this.opts.localDelayMs);
    this.changed();
  }

  /** Stops server saves (exam paused, time up). Local saves continue. */
  block(message: string): void {
    this.blockedMessage = message;
    this.changed();
  }

  resume(): void {
    if (this.blockedMessage === null) return;
    this.blockedMessage = null;
    for (const e of this.entries.values()) {
      e.attempts = 0;
      e.retryAt = 0;
    }
    this.changed();
    this.schedulePump(0);
  }

  /**
   * Writes every pending edit locally, then pushes everything to the server.
   * Resolves true once the server has it all, false if that can't happen within `timeoutMs`.
   */
  async flush(timeoutMs = 10_000): Promise<boolean> {
    await Promise.all(
      [...this.entries.values()].map((e) => {
        if (e.localTimer) clearTimeout(e.localTimer);
        e.localTimer = null;
        return e.dirty ? this.writeLocal(e) : e.writing;
      }),
    );
    for (const e of this.entries.values()) e.retryAt = 0;
    this.schedulePump(0);
    if (this.unsyncedCount() === 0) return true;
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      const unsubscribe = this.subscribe(() => {
        if (this.unsyncedCount() === 0) done(true);
        else if (this.blockedMessage !== null) done(false);
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) if (e.localTimer) clearTimeout(e.localTimer);
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.listeners.clear();
  }

  // ---- internals --------------------------------------------------------------------------

  private changed(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  private needsPush(e: Entry): boolean {
    return e.record !== null && e.record.revision > e.record.syncedRevision;
  }

  private writeLocal(e: Entry, minRevision = 0): Promise<void> {
    if (e.writing) {
      // Chain after the current write; it will pick up the latest code.
      return e.writing.then(() =>
        e.dirty || minRevision ? this.writeLocal(e, minRevision) : undefined,
      );
    }
    e.localTimer = null;
    const code = e.code;
    e.writing = this.deps
      .saveLocal(e.questionId, e.language, code, minRevision)
      .then((record) => {
        // Keep the higher server mark we may have learned while writing.
        const synced = Math.max(record.syncedRevision, e.record?.syncedRevision ?? 0);
        const syncedAt =
          synced === record.syncedRevision ? record.syncedAt : (e.record?.syncedAt ?? null);
        e.record = { ...record, syncedRevision: synced, syncedAt };
        e.savedCode = code;
        e.dirty = e.code !== code;
        if (e.problem?.startsWith("Couldn't save on this computer")) e.problem = null;
      })
      .catch(() => {
        e.problem =
          "Couldn't save on this computer. Keep this window open and tell the invigilator.";
      })
      .finally(() => {
        e.writing = null;
        this.changed();
        if (e.dirty && !e.localTimer && !this.disposed) {
          e.localTimer = setTimeout(() => {
            if (e.dirty) void this.writeLocal(e);
          }, this.opts.localDelayMs);
        }
        this.schedulePump(this.opts.pushDelayMs);
      });
    return e.writing;
  }

  private schedulePump(delayMs: number): void {
    if (this.disposed) return;
    if (this.pumpTimer) {
      if (delayMs > 0) return; // one is coming already
      clearTimeout(this.pumpTimer);
    }
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.pump();
    }, delayMs);
  }

  private pump(): void {
    if (this.blockedMessage !== null || this.disposed) return;
    const now = Date.now();
    let nextRetry = Infinity;
    for (const e of this.entries.values()) {
      if (this.inFlight >= this.opts.maxConcurrent) break;
      if (e.pushing || e.writing || !this.needsPush(e)) continue;
      if (e.retryAt > now) {
        nextRetry = Math.min(nextRetry, e.retryAt);
        continue;
      }
      void this.pushOne(e);
    }
    if (nextRetry !== Infinity) this.schedulePump(Math.max(0, nextRetry - now));
  }

  private async pushOne(e: Entry): Promise<void> {
    const record = e.record!;
    const revision = record.revision;
    const code = e.savedCode;
    e.pushing = true;
    this.inFlight++;
    let outcome: PushOutcome;
    try {
      outcome = await this.deps.push(e.questionId, e.language, code, revision);
    } catch {
      outcome = { kind: "retry", message: "Not saved to the server yet. Retrying…" };
    }
    this.inFlight--;
    e.pushing = false;

    switch (outcome.kind) {
      case "saved": {
        e.attempts = 0;
        e.problem = null;
        if (e.record && outcome.revision > e.record.syncedRevision) {
          e.record = { ...e.record, syncedRevision: outcome.revision, syncedAt: outcome.savedAt };
          await this.deps
            .markSynced(e.questionId, e.language, outcome.revision, outcome.savedAt)
            .catch(() => undefined);
        }
        break;
      }
      case "stale": {
        // The server holds a revision at least as high from elsewhere. Re-save this computer's
        // latest code above it so the next push wins.
        e.attempts++;
        if (e.attempts > 5) {
          e.problem = "This draft keeps changing on the server. Tell the invigilator.";
          e.retryAt = Date.now() + this.opts.maxBackoffMs;
          break;
        }
        await this.writeLocal(e, outcome.currentRevision + 1);
        break;
      }
      case "retry": {
        e.attempts++;
        e.problem = outcome.message;
        e.retryAt = Date.now() + Math.min(1000 * 2 ** (e.attempts - 1), this.opts.maxBackoffMs);
        break;
      }
      case "blocked": {
        e.attempts = 0;
        this.blockedMessage = outcome.message;
        break;
      }
      case "rejected": {
        e.problem = outcome.message;
        e.retryAt = Infinity;
        break;
      }
    }
    this.changed();
    this.schedulePump(0);
  }
}

/**
 * Combines drafts found on this computer with the server's copies at sign-in.
 * The higher revision wins. Server copies that win are returned in `adopt` so the caller can
 * store them locally.
 */
export function mergeDrafts(
  local: DraftRecord[],
  server: ServerDraftLike[],
): { records: DraftRecord[]; adopt: ServerDraftLike[] } {
  const byKey = new Map<string, DraftRecord>();
  for (const l of local) byKey.set(keyOf(l.questionId, l.language), l);
  const adopt: ServerDraftLike[] = [];
  for (const s of server) {
    const k = keyOf(s.examQuestionId, s.language);
    const l = byKey.get(k);
    if (!l || s.revision > l.revision) {
      adopt.push(s);
      byKey.set(k, {
        questionId: s.examQuestionId,
        language: s.language,
        code: s.code,
        revision: s.revision,
        savedAt: s.savedAt,
        syncedRevision: s.revision,
        syncedAt: s.savedAt,
      });
    } else if (s.revision === l.revision && s.code === l.code && l.syncedRevision < s.revision) {
      // The server got it but the reply was lost before we could record that.
      byKey.set(k, { ...l, syncedRevision: s.revision, syncedAt: s.savedAt });
    }
  }
  return { records: [...byKey.values()], adopt };
}
