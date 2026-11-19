import { spawn } from "node:child_process";

/** Starting programs and collecting their output, shared by the local and WebAssembly runners. */

export const IS_WINDOWS = process.platform === "win32";
/** Per stream. Enough for any lab exercise; a runaway print loop is stopped here. */
export const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitHit: boolean;
  ms: number;
  spawnError?: NodeJS.ErrnoException;
}

/**
 * Student code gets a minimal environment, never the server's own (database URL, JWT secret).
 */
export function childEnv(): NodeJS.ProcessEnv {
  const keep = IS_WINDOWS
    ? [
        ...["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "SystemDrive", "WINDIR"],
        ...["TEMP", "TMP", "COMSPEC", "USERPROFILE", "APPDATA", "LOCALAPPDATA"],
      ]
    : ["PATH", "LANG", "LC_ALL", "TMPDIR"];
  const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (IS_WINDOWS) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL"); // the whole process group, including any children
    }
  } catch {
    // Already gone.
  }
}

export function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; stdin: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? childEnv(),
      detached: !IS_WINDOWS,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let outputLimitHit = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);

    const collect = (chunks: Buffer[], which: "out" | "err") => (b: Buffer) => {
      const size = which === "out" ? (outBytes += b.length) : (errBytes += b.length);
      if (size > MAX_OUTPUT_BYTES) {
        if (!outputLimitHit) {
          outputLimitHit = true;
          killTree(child.pid);
        }
        return;
      }
      chunks.push(b);
    };
    child.stdout.on("data", collect(out, "out"));
    child.stderr.on("data", collect(err, "err"));
    // The program may exit without reading its input.
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.stdin);

    const finish = (r: Partial<ProcessResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        outputLimitHit,
        ms: Number(process.hrtime.bigint() - started) / 1e6,
        ...r,
      });
    };
    child.on("error", (e: NodeJS.ErrnoException) => finish({ spawnError: e }));
    child.on("close", (exitCode, signal) => finish({ exitCode, signal }));
  });
}

/** At most this many programs at once, so a burst of submissions can't freeze the PC. */
export class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];
  constructor(n: number) {
    this.free = n;
  }
  async take(): Promise<() => void> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.waiting.push(r));
    return () => {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    };
  }
}
