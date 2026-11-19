import { type ChildProcess, fork } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Verdict } from "@securelab/shared";
import type { ExecutionProvider, ExecutionRequest, ExecutionResult } from "./execution.types";
import { Slots, childEnv, runProcess } from "./run-process";

/**
 * Runs student code as WebAssembly, inside this server, with nothing to install.
 *
 * - Python: CPython 3.12 built for WASI (@antonz/python-wasi, the VMware Labs build) runs the
 *   program.
 * - C and C++: Clang built as WebAssembly (@yowasp/clang) compiles the program to WebAssembly.
 *
 * Each program runs in a Node process of its own (wasm/run-wasm.mjs) with Node's permission model
 * on. The program itself can only read stdin and write stdout and stderr: WebAssembly can do
 * nothing but compute unless it is given functions to call, and it gets WASI with no directories
 * and no environment. Memory is capped by the program's own memory limits, time by killing the
 * process, output at 1 MB.
 *
 * Compared with Judge0 (an isolate sandbox per run): no Docker, no Linux-only kernel features,
 * works on Windows and on small cloud servers. Programs run about 1.5-3x slower than native,
 * and C++ exceptions end the program (a catch block never runs).
 */

const WASM_DIR = path.resolve(__dirname, "../../wasm");
const RUNNER = path.join(WASM_DIR, "run-wasm.mjs");
/** Node itself, the runner and (for Python) a 26 MB interpreter to compile before the program starts. */
const STARTUP_GRACE_MS = 3_000;
const COMPILE_TIMEOUT_MS = 60_000;

/**
 * How deep programs may recurse, as Node's stack size in KB. The program runs on the runner's
 * main thread, whose stack is 8 MB on Windows (node.exe), macOS and most Linux systems (the
 * "ulimit -s" soft limit); V8 is told about 7 MB of it, leaving room for its own native calls.
 * That is about as deep as a native program with the usual 8 MB stack.
 */
export function stackSizeKb(): number {
  const wanted = 7 * 1024;
  if (process.platform !== "linux") return wanted;
  try {
    const line = readFileSync("/proc/self/limits", "utf8")
      .split("\n")
      .find((l) => l.startsWith("Max stack size"));
    const soft = line?.split(/\s{2,}/)[1];
    if (!soft || soft === "unlimited") return wanted;
    return Math.max(900, Math.min(wanted, Math.floor(Number(soft) / 1024) - 1024));
  } catch {
    return wanted;
  }
}

/** Node 22.13 is the first 22.x with the permission model under its final flag names. */
function checkNode(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(
      `EXECUTION_PROVIDER=wasm needs Node.js 22.13 or newer (this is ${process.versions.node})`,
    );
  }
}

function resolveReal(request: string): string {
  return realpathSync(require.resolve(request));
}

interface RunnerResult {
  outcome: "exit" | "trap" | "crash" | "invalid";
  code?: number;
  message?: string;
  ms?: number;
  memoryKb?: number | null;
  maxMemory?: boolean;
}

export class WasmProvider implements ExecutionProvider, OnModuleDestroy {
  private readonly logger = new Logger(WasmProvider.name);
  private readonly slots: Slots;
  private readonly python = resolveReal("@antonz/python-wasi/dist/python.wasm");
  private readonly compiler = new Compiler();
  private readonly stackKb = stackSizeKb();

  constructor(opts: { concurrency?: number } = {}) {
    checkNode();
    this.slots = new Slots(opts.concurrency ?? Math.max(1, availableParallelism() - 1));
  }

  onModuleDestroy(): void {
    this.compiler.stop();
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    let program = this.python;
    let args = ["python", "-c", req.sourceCode];
    let compiled: Uint8Array | undefined;
    if (req.language !== "python") {
      const c = await this.compiler.compile(req.language, req.sourceCode);
      if (!c.ok) return result("COMPILE_ERROR", { compileOutput: c.log, status: "compile_error" });
      compiled = c.wasm;
      args = ["program"];
    }

    const release = await this.slots.take();
    const dir = await mkdtemp(path.join(tmpdir(), "securelab-wasm-"));
    try {
      if (compiled) {
        program = path.join(dir, "program.wasm");
        await writeFile(program, compiled);
      }
      await writeFile(path.join(dir, "args.json"), JSON.stringify(args));
      return await this.run(dir, program, req);
    } finally {
      release();
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
        () => undefined,
      );
    }
  }

  private async run(dir: string, program: string, req: ExecutionRequest): Promise<ExecutionResult> {
    const resultFile = path.join(dir, "result.json");
    const r = await runProcess(
      process.execPath,
      [
        "--no-warnings",
        `--stack-size=${this.stackKb}`,
        "--permission",
        "--allow-wasi",
        `--allow-fs-read=${RUNNER}`,
        `--allow-fs-read=${dir}`,
        `--allow-fs-read=${program}`,
        `--allow-fs-write=${resultFile}`,
        RUNNER,
        dir,
        program,
        String(req.limits.memoryKb),
      ],
      {
        cwd: dir,
        stdin: req.stdin,
        timeoutMs: req.limits.wallTimeSeconds * 1000 + STARTUP_GRACE_MS,
        env: childEnv(),
      },
    );
    if (r.spawnError) throw r.spawnError;
    const outcome = await readFile(resultFile, "utf8")
      .then((s) => JSON.parse(s) as RunnerResult)
      .catch(() => undefined);
    const seconds = outcome?.ms !== undefined ? outcome.ms / 1000 : undefined;
    const common = {
      stdout: r.stdout,
      stderr: r.stderr,
      timeSeconds: seconds,
      memoryKb: outcome?.memoryKb ?? undefined,
    };

    if (r.timedOut || (seconds ?? 0) > req.limits.cpuTimeSeconds) {
      return result("TIME_LIMIT_EXCEEDED", { ...common, status: "time_limit" });
    }
    if (r.outputLimitHit) {
      return result("RUNTIME_ERROR", {
        ...common,
        stderr: `${r.stderr}\nStopped: the program printed more than 1 MB.`.trim(),
        status: "output_limit",
      });
    }
    if (!outcome || outcome.outcome === "invalid" || outcome.outcome === "crash") {
      this.logger.error(
        `WebAssembly runner failed: ${outcome?.message ?? `exit ${r.exitCode} ${r.signal ?? ""}`} ${r.stderr.slice(0, 500)}`,
      );
      throw new Error("the WebAssembly runner failed; see the server log");
    }
    if (outcome.outcome === "exit" && outcome.code === 0) {
      // "Ran fine": SecureLab compares the output itself (see grader.ts).
      return result("ACCEPTED", { ...common, status: "ok" });
    }
    const outOfMemory =
      outcome.maxMemory || /\bMemoryError\b|\bbad_alloc\b/.test(r.stderr.slice(-2000));
    if (outOfMemory) {
      return result("MEMORY_LIMIT_EXCEEDED", { ...common, status: "memory_limit" });
    }
    if (outcome.outcome === "trap") {
      return result("RUNTIME_ERROR", {
        ...common,
        stderr: `${r.stderr}\n${trapMessage(outcome.message ?? "")}`.trim(),
        status: "trap",
      });
    }
    return result("RUNTIME_ERROR", { ...common, status: `exit_${outcome.code}` });
  }
}

/** What a student should read instead of the engine's wording. */
function trapMessage(message: string): string {
  if (/call stack/i.test(message)) return "Runtime error: stack overflow (recursion too deep).";
  if (/out of bounds/i.test(message))
    return "Runtime error: invalid memory access (or the stack overflowed).";
  if (/unreachable/i.test(message)) return "Runtime error: the program was aborted.";
  if (/divide by zero|integer overflow/i.test(message)) return "Runtime error: division by zero.";
  return `Runtime error: ${message}`;
}

/**
 * The C/C++ compiler process (wasm/compile-server.mjs): started on the first C or C++ program,
 * one program at a time, restarted if it takes too long or stops.
 */
class Compiler {
  private readonly logger = new Logger("WasmCompiler");
  private child: ChildProcess | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;

  compile(
    language: "c" | "cpp",
    source: string,
  ): Promise<{ ok: true; wasm: Uint8Array } | { ok: false; log: string }> {
    const job = this.queue.then(() => this.send(language, source));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private start(): ChildProcess {
    const bundle = resolveReal("@yowasp/clang");
    const clangDir = path.resolve(path.dirname(bundle), "..");
    const child = fork(path.join(WASM_DIR, "compile-server.mjs"), [bundle], {
      execArgv: [
        "--no-warnings",
        "--permission",
        `--allow-fs-read=${WASM_DIR}`,
        `--allow-fs-read=${clangDir}`,
      ],
      env: childEnv(),
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    // An idle compiler must not keep the server (or a test run) from exiting.
    child.unref();
    child.channel?.unref();
    let stderr = "";
    child.stderr?.on("data", (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-4000);
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (code !== 0 && signal !== "SIGKILL") {
        this.logger.warn(`compiler stopped (${code ?? signal}) ${stderr.trim()}`);
      }
    });
    return child;
  }

  private send(
    language: "c" | "cpp",
    source: string,
  ): Promise<{ ok: true; wasm: Uint8Array } | { ok: false; log: string }> {
    const child = (this.child ??= this.start());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
      };
      const onMessage = (m: {
        id?: number;
        ok?: boolean;
        wasm?: Uint8Array;
        log?: string;
        error?: string;
      }) => {
        if (m.id !== id) return;
        done();
        if (m.error) reject(new Error(`C/C++ compiler failed: ${m.error}`));
        else if (m.ok && m.wasm) resolve({ ok: true, wasm: m.wasm });
        else resolve({ ok: false, log: m.log ?? "Compilation failed." });
      };
      const onExit = () => {
        done();
        reject(new Error("the C/C++ compiler stopped unexpectedly"));
      };
      const timer = setTimeout(() => {
        done();
        child.kill("SIGKILL");
        if (this.child === child) this.child = undefined;
        resolve({ ok: false, log: "Compilation took longer than 60 seconds." });
      }, COMPILE_TIMEOUT_MS);
      child.on("message", onMessage);
      child.on("exit", onExit);
      child.send({ id, language, source });
    });
  }

  stop(): void {
    this.child?.kill("SIGKILL");
    this.child = undefined;
  }
}

function result(
  verdict: Verdict,
  r: {
    stdout?: string;
    stderr?: string;
    compileOutput?: string;
    timeSeconds?: number;
    memoryKb?: number;
    status: string;
  },
): ExecutionResult {
  return {
    verdict,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    compileOutput: r.compileOutput ?? "",
    timeSeconds: r.timeSeconds === undefined ? null : Math.round(r.timeSeconds * 1000) / 1000,
    memoryKb: r.memoryKb === undefined ? null : Math.round(r.memoryKb),
    providerStatus: `wasm:${r.status}`,
  };
}
