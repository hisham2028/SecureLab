import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { Logger } from "@nestjs/common";
import type { Language } from "@securelab/shared";
import type { ExecutionProvider, ExecutionRequest, ExecutionResult } from "./execution.types";

/**
 * Runs student code directly on this computer, with the compilers installed on it.
 *
 * FOR TRYING SECURELAB OUT ONLY (SecureLab Lite). There is no sandbox: a program can read and
 * write files, use the network and use all the memory it wants. Only time and output are
 * limited. The API refuses this provider when NODE_ENV=production; real exams use Judge0.
 */

const IS_WINDOWS = process.platform === "win32";
const COMPILE_TIMEOUT_MS = 30_000;
/** Per stream. Enough for any lab exercise; a runaway print loop is stopped here. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface LocalToolchain {
  cc: string;
  cxx: string;
  /** Command and leading arguments, e.g. ["py", "-3"] on Windows. */
  python: string[];
}

export function defaultToolchain(env: {
  LOCAL_CC?: string;
  LOCAL_CXX?: string;
  LOCAL_PYTHON?: string;
}) {
  const split = (s: string) => s.trim().split(/\s+/).filter(Boolean);
  return {
    cc: env.LOCAL_CC?.trim() || "gcc",
    cxx: env.LOCAL_CXX?.trim() || "g++",
    python: env.LOCAL_PYTHON?.trim()
      ? split(env.LOCAL_PYTHON)
      : [IS_WINDOWS ? "python" : "python3"],
  } satisfies LocalToolchain;
}

interface ProcessResult {
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
function childEnv(): NodeJS.ProcessEnv {
  const keep = IS_WINDOWS
    ? ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"]
    : ["PATH", "LANG", "LC_ALL", "TMPDIR"];
  const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

function killTree(pid: number | undefined): void {
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

function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; stdin: string; timeoutMs: number },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: childEnv(),
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
class Slots {
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

const SOURCE_FILE: Record<Language, string> = { c: "main.c", cpp: "main.cpp", python: "main.py" };

export class LocalProvider implements ExecutionProvider {
  private readonly logger = new Logger(LocalProvider.name);
  private readonly slots = new Slots(Math.max(1, availableParallelism() - 1));

  constructor(private readonly tools: LocalToolchain) {
    this.logger.warn(
      "Running student code WITHOUT a sandbox (EXECUTION_PROVIDER=local). For trying SecureLab out only.",
    );
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const release = await this.slots.take();
    const dir = await mkdtemp(path.join(tmpdir(), "securelab-run-"));
    try {
      return await this.executeIn(dir, req);
    } finally {
      release();
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
        () => undefined,
      );
    }
  }

  private async executeIn(dir: string, req: ExecutionRequest): Promise<ExecutionResult> {
    const source = SOURCE_FILE[req.language];
    await writeFile(path.join(dir, source), req.sourceCode, "utf8");

    let command: string;
    let args: string[];
    if (req.language === "python") {
      [command, ...args] = [...this.tools.python, source];
    } else {
      const exe = IS_WINDOWS ? "program.exe" : "program";
      const compiler = req.language === "c" ? this.tools.cc : this.tools.cxx;
      const flags =
        req.language === "c" ? ["-O2", "-std=c11", source, "-lm"] : ["-O2", "-std=c++17", source];
      const compiled = await runProcess(compiler, [...flags, "-o", exe], {
        cwd: dir,
        stdin: "",
        timeoutMs: COMPILE_TIMEOUT_MS,
      });
      if (compiled.spawnError) throw missingTool(compiler, compiled.spawnError);
      if (compiled.timedOut || compiled.exitCode !== 0) {
        return result("COMPILE_ERROR", {
          compileOutput: compiled.timedOut
            ? "Compilation took longer than 30 seconds."
            : (compiled.stderr + compiled.stdout).trim(),
          status: "compile_error",
        });
      }
      command = path.join(dir, exe);
      args = [];
    }

    const r = await runProcess(command, args, {
      cwd: dir,
      stdin: req.stdin,
      timeoutMs: req.limits.wallTimeSeconds * 1000,
    });
    if (r.spawnError) throw missingTool(command, r.spawnError);
    const common = { stdout: r.stdout, stderr: r.stderr, timeSeconds: r.ms / 1000 };
    if (r.timedOut || r.ms > req.limits.cpuTimeSeconds * 1000) {
      return result("TIME_LIMIT_EXCEEDED", { ...common, status: "time_limit" });
    }
    if (r.outputLimitHit) {
      return result("RUNTIME_ERROR", {
        ...common,
        stderr: `${r.stderr}\nStopped: the program printed more than 1 MB.`.trim(),
        status: "output_limit",
      });
    }
    if (r.exitCode !== 0) {
      return result("RUNTIME_ERROR", {
        ...common,
        status: r.signal ? `signal_${r.signal}` : `exit_${r.exitCode}`,
      });
    }
    // "Ran fine": SecureLab compares the output itself (see grader.ts).
    return result("ACCEPTED", { ...common, status: "ok" });
  }
}

function missingTool(command: string, e: NodeJS.ErrnoException): Error {
  return new Error(
    e.code === "ENOENT"
      ? `"${command}" isn't installed or isn't on PATH (needed to run this language)`
      : `couldn't start "${command}": ${e.message}`,
  );
}

/**
 * On Windows, C, C++ and Python print "\r\n" for each "\n". Turn it back so students see the
 * same output as with Judge0 on Linux. (Grading already ignores the difference.)
 */
function unixLines(s: string): string {
  return IS_WINDOWS ? s.replace(/\r\n/g, "\n") : s;
}

function result(
  verdict: ExecutionResult["verdict"],
  r: {
    stdout?: string;
    stderr?: string;
    compileOutput?: string;
    timeSeconds?: number;
    status: string;
  },
): ExecutionResult {
  return {
    verdict,
    stdout: unixLines(r.stdout ?? ""),
    stderr: unixLines(r.stderr ?? ""),
    compileOutput: unixLines(r.compileOutput ?? ""),
    timeSeconds: r.timeSeconds === undefined ? null : Math.round(r.timeSeconds * 1000) / 1000,
    memoryKb: null,
    providerStatus: `local:${r.status}`,
  };
}
