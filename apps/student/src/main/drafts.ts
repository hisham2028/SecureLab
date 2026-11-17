import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Local draft store: one encrypted file per (exam seat, question, language). Writes go to a
 * temp file and are renamed into place, so a crash mid-write never leaves a truncated draft.
 *
 * Each record carries two revisions:
 * - `revision` goes up on every local save of new code;
 * - `syncedRevision` is the highest revision the server has confirmed.
 * When `revision > syncedRevision`, this computer holds work the server hasn't got yet.
 */
export interface Cipher {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface LocalDraft {
  questionId: string;
  language: string;
  code: string;
  revision: number;
  savedAt: string;
  syncedRevision: number;
  syncedAt: string | null;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class DraftStore {
  /** Operations on one draft run one after another, so a save and a sync mark can't race. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dir: string,
    private readonly cipher: Cipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private seatDir(seatId: string): string {
    return path.join(this.dir, sha(seatId));
  }

  private fileFor(seatId: string, questionId: string, language: string): string {
    return path.join(this.seatDir(seatId), `${sha(`${questionId}\u0000${language}`)}.draft`);
  }

  private serial<T>(file: string, op: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(file) ?? Promise.resolve();
    const next = prev.then(op, op);
    const settled = next.catch(() => undefined);
    this.queues.set(file, settled);
    void settled.then(() => {
      if (this.queues.get(file) === settled) this.queues.delete(file);
    });
    return next;
  }

  private async read(file: string): Promise<LocalDraft | null> {
    try {
      return JSON.parse(this.cipher.decrypt(await fs.readFile(file))) as LocalDraft;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private async write(file: string, draft: LocalDraft): Promise<LocalDraft> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, this.cipher.encrypt(JSON.stringify(draft)));
    await fs.rename(tmp, file);
    return draft;
  }

  async load(seatId: string, questionId: string, language: string): Promise<LocalDraft | null> {
    return this.read(this.fileFor(seatId, questionId, language));
  }

  /** Every draft saved on this computer for one exam seat. Unreadable files are skipped. */
  async list(seatId: string): Promise<LocalDraft[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.seatDir(seatId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const drafts = await Promise.all(
      names
        .filter((n) => n.endsWith(".draft"))
        .map((n) => this.read(path.join(this.seatDir(seatId), n)).catch(() => null)),
    );
    return drafts.filter((d): d is LocalDraft => d !== null);
  }

  /**
   * Saves new code with the next revision. `minRevision` lets the caller jump past a revision
   * the server already holds from another session.
   */
  save(
    seatId: string,
    questionId: string,
    language: string,
    code: string,
    minRevision = 0,
  ): Promise<LocalDraft> {
    const file = this.fileFor(seatId, questionId, language);
    return this.serial(file, async () => {
      const prev = await this.read(file).catch(() => null);
      return this.write(file, {
        questionId,
        language,
        code,
        revision: Math.max((prev?.revision ?? 0) + 1, minRevision),
        savedAt: this.now().toISOString(),
        syncedRevision: prev?.syncedRevision ?? 0,
        syncedAt: prev?.syncedAt ?? null,
      });
    });
  }

  /** Takes the server's copy, but only when it is newer than what this computer has. */
  adopt(
    seatId: string,
    questionId: string,
    language: string,
    code: string,
    revision: number,
    savedAt: string,
  ): Promise<LocalDraft> {
    const file = this.fileFor(seatId, questionId, language);
    return this.serial(file, async () => {
      const prev = await this.read(file).catch(() => null);
      if (prev && prev.revision >= revision) return prev;
      return this.write(file, {
        questionId,
        language,
        code,
        revision,
        savedAt,
        syncedRevision: revision,
        syncedAt: savedAt,
      });
    });
  }

  /** Records that the server confirmed `revision`. Never moves the mark backwards. */
  markSynced(
    seatId: string,
    questionId: string,
    language: string,
    revision: number,
    syncedAt: string,
  ): Promise<LocalDraft | null> {
    const file = this.fileFor(seatId, questionId, language);
    return this.serial(file, async () => {
      const prev = await this.read(file);
      if (!prev || prev.syncedRevision >= revision) return prev;
      return this.write(file, { ...prev, syncedRevision: revision, syncedAt });
    });
  }

  /** Writes, reads back and removes a probe file. Used by the pre-exam system check. */
  async probe(): Promise<boolean> {
    const file = path.join(this.dir, `probe-${process.pid}.tmp`);
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const marker = sha(String(Math.random()));
      await fs.writeFile(file, this.cipher.encrypt(marker));
      const ok = this.cipher.decrypt(await fs.readFile(file)) === marker;
      await fs.rm(file, { force: true });
      return ok;
    } catch {
      return false;
    }
  }
}
