// Compiles C and C++ to WebAssembly with Clang, itself running as WebAssembly (@yowasp/clang).
// Started by the API with child_process.fork (argument: the path of @yowasp/clang's bundle.js)
// and the Node permission model on; it reads only its own files and the compiler's, and works in
// an in-memory file system. Clang takes about 500 MB once loaded, so this process stops itself
// when it has been idle for a while and the API starts it again on the next C or C++ program.
//
// Messages in:  { id, language: "c" | "cpp", source }
// Messages out: { id, ok: true, wasm: Uint8Array } | { id, ok: false, log: string }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The compiler announces its own loading progress on the console; nobody reads it.
console.log = () => {};

// The compiler's own location (resolved by the API), so this process needs to read nothing else.
const { runClang } = await import(pathToFileURL(process.argv[2]).href);

const IDLE_MS = Number(process.env.SECURELAB_COMPILER_IDLE_MS || 10 * 60_000);
const MAX_LOG = 64 * 1024;
// A deep stack, placed first so overflowing it traps instead of overwriting other memory.
const LINK = ["-Wl,--stack-first", "-Wl,-z,stack-size=8388608"];

const here = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const include = { bits: { "stdc++.h": here("include/bits/stdc++.h") } };
const quiet = { stdout: null, fetchProgress: () => {} };

/** Built once: the C++ exception stand-ins, as an object file linked into every C++ program. */
let exceptionsObject;

async function compile(language, source) {
  let log = "";
  const stderr = (bytes) => {
    if (bytes && log.length < MAX_LOG) log += new TextDecoder().decode(bytes);
  };
  try {
    let out;
    if (language === "c") {
      out = await runClang(
        ["clang", "-O2", "-std=c11", "main.c", "-lm", "-o", "program", ...LINK],
        { "main.c": source },
        { ...quiet, stderr },
      );
    } else {
      exceptionsObject ??= (
        await runClang(
          ["clang++", "-O2", "-c", "exceptions.cpp", "-o", "exceptions.o"],
          { "exceptions.cpp": here("exceptions.cpp") },
          quiet,
        )
      )["exceptions.o"];
      out = await runClang(
        [
          "clang++",
          ...["-O2", "-std=c++17", "-Iinclude", "main.cpp", "exceptions.o", "-o", "program"],
          ...LINK,
        ],
        { "main.cpp": source, "exceptions.o": exceptionsObject, include },
        { ...quiet, stderr },
      );
    }
    return { ok: true, wasm: out.program, log: trim(log) };
  } catch (e) {
    if (e?.files === undefined) throw e; // not a compile error: Clang itself failed
    return { ok: false, log: trim(log) || "Compilation failed." };
  }
}

function trim(s) {
  return (s.length >= MAX_LOG ? `${s.slice(0, MAX_LOG)}\n…` : s).trim();
}

let idle = setTimeout(() => process.exit(0), IDLE_MS);
let queue = Promise.resolve();

process.on("message", (msg) => {
  clearTimeout(idle);
  queue = queue.then(async () => {
    try {
      const r = await compile(msg.language, msg.source);
      process.send({ id: msg.id, ...r });
    } catch (e) {
      process.send({ id: msg.id, ok: false, error: String(e?.stack ?? e) });
    }
    clearTimeout(idle);
    idle = setTimeout(() => process.exit(0), IDLE_MS);
  });
});
process.on("disconnect", () => process.exit(0));
process.send({ ready: true });
