import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Local draft store: one file per (exam attempt, question). Writes go to a temp file and are
 * renamed into place so a crash mid-write never leaves a truncated draft. The server copy is
 * authoritative; local drafts exist to survive app restarts and short network loss.
 */
export interface Cipher {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface Draft {
  code: string;
  savedAt: string;
  /** Monotonic per question; lets the server reject stale overwrites later (Phase 3). */
  revision: number;
}

export class DraftStore {
  constructor(
    private readonly dir: string,
    private readonly cipher: Cipher,
  ) {}

  private fileFor(attemptId: string, questionId: string): string {
    const key = createHash("sha256").update(`${attemptId}\u0000${questionId}`).digest("hex");
    return path.join(this.dir, `${key}.draft`);
  }

  async load(attemptId: string, questionId: string): Promise<Draft | null> {
    try {
      const data = await fs.readFile(this.fileFor(attemptId, questionId));
      return JSON.parse(this.cipher.decrypt(data)) as Draft;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(attemptId: string, questionId: string, code: string): Promise<Draft> {
    await fs.mkdir(this.dir, { recursive: true });
    const previous = await this.load(attemptId, questionId).catch(() => null);
    const draft: Draft = {
      code,
      savedAt: new Date().toISOString(),
      revision: (previous?.revision ?? 0) + 1,
    };
    const target = this.fileFor(attemptId, questionId);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, this.cipher.encrypt(JSON.stringify(draft)));
    await fs.rename(tmp, target);
    return draft;
  }
}
