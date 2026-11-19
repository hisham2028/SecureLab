// Runs one student program compiled to WebAssembly (WASI preview 1). Started by the API in its own
// Node process with the permission model on (see wasm.provider.ts):
//
//   node --permission --allow-wasi --allow-fs-read=<dir> --allow-fs-read=<program>
//        --allow-fs-write=<dir>/result.json run-wasm.mjs <dir> <program.wasm> <memory limit in KB>
//
// <dir>/args.json holds the program's command line (for Python, the student's code).
//
// The program gets stdin, stdout and stderr and nothing else: no files (no preopened
// directories), no network (WASI preview 1 has no way to open a socket), no environment
// variables. Its memory is capped by rewriting the module's memory
// limits before it is compiled, so a program asking for more simply fails to grow (malloc
// returns NULL, Python raises MemoryError). The time limit is enforced by the API, which kills
// this whole process.
//
// The result (time, memory, how it ended) goes to <dir>/result.json, which the program itself
// cannot touch, so it cannot pretend to have been faster than it was.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WASI } from "node:wasi";

const PAGE = 64 * 1024;

const [dir, wasmFile, memoryKb] = process.argv.slice(2);
const argv = JSON.parse(readFileSync(path.join(dir, "args.json"), "utf8"));
const maxPages = Math.max(1, Math.floor((Number(memoryKb) * 1024) / PAGE));
let module;
try {
  module = await WebAssembly.compile(limitMemory(readFileSync(wasmFile), maxPages));
} catch (e) {
  finish(dir, { outcome: "invalid", message: String(e?.message ?? e) });
  process.exit(70);
}
const wasi = new WASI({
  version: "preview1",
  args: argv,
  env: {},
  preopens: {},
  returnOnExit: true,
});
let memory;
const started = process.hrtime.bigint();
let r;
try {
  const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
  memory = instance.exports.memory;
  r = { outcome: "exit", code: wasi.start(instance) };
} catch (e) {
  // A trap: out-of-bounds access (including stack overflow), unreachable (abort()), divide by
  // zero, or running out of the native stack.
  r = { outcome: "trap", message: String(e?.message ?? e) };
}
const bytes = memory ? memory.buffer.byteLength : 0;
finish(dir, {
  ...r,
  ms: Number(process.hrtime.bigint() - started) / 1e6,
  memoryKb: memory ? bytes / 1024 : null,
  maxMemory: memory ? bytes >= maxBytes(module) : false,
});
process.exitCode = r.outcome === "exit" ? r.code & 0xff : 134;

function finish(dir, r) {
  writeFileSync(path.join(dir, "result.json"), JSON.stringify(r));
}

function maxBytes(module) {
  // Set by limitMemory; read back from the module itself is not possible, so it is passed along
  // as a custom section.
  const [s] = WebAssembly.Module.customSections(module, "securelab.max_pages");
  return s ? new DataView(s).getUint32(0, true) * PAGE : Infinity;
}

/**
 * Returns a copy of a WebAssembly module whose memory may grow to at most `maxPages` pages
 * (64 KB each), or what it needs to start if that is more, with the number recorded in a custom
 * section. Modules that import their memory
 * are refused: WASI programs define their own.
 */
function limitMemory(bytes, maxPages) {
  const out = [bytes.subarray(0, 8)];
  let p = 8;
  let max = 0;
  const readLeb = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[p++];
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  };
  while (p < bytes.length) {
    const id = bytes[p++];
    const size = readLeb();
    const start = p;
    const end = p + size;
    if (id === 2 && importsMemory(bytes.subarray(start, end))) {
      throw new Error("the program imports its memory");
    }
    if (id === 5) {
      const count = readLeb();
      if (count !== 1) throw new Error(`expected one memory, found ${count}`);
      const flags = bytes[p++];
      if (flags & ~1) throw new Error("shared or 64-bit memory is not supported");
      const min = readLeb();
      if (flags & 1) readLeb();
      // A program that needs more than the limit just to start gets exactly what it needs.
      max = Math.max(min, maxPages);
      const body = [1, 0x01, ...leb(min), ...leb(max)];
      out.push(Uint8Array.of(5, ...leb(body.length), ...body));
    } else {
      out.push(Uint8Array.of(id), Uint8Array.from(leb(size)), bytes.subarray(start, end));
    }
    p = end;
  }
  if (!max) throw new Error("the program has no memory");
  const name = new TextEncoder().encode("securelab.max_pages");
  const value = new Uint8Array(4);
  new DataView(value.buffer).setUint32(0, max, true);
  const custom = [...leb(name.length), ...name, ...value];
  out.push(Uint8Array.of(0, ...leb(custom.length), ...custom));
  return Buffer.concat(out);
}

function leb(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function importsMemory(section) {
  let p = 0;
  const readLeb = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = section[p++];
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  };
  const count = readLeb();
  for (let i = 0; i < count; i++) {
    for (const _name of ["module", "field"]) {
      const length = readLeb();
      p += length;
    }
    const kind = section[p++];
    if (kind === 0) readLeb();
    else if (kind === 1) {
      p++; // reftype
      const f = section[p++];
      readLeb();
      if (f & 1) readLeb();
    } else if (kind === 2) return true;
    else if (kind === 3) p += 2;
    else if (kind === 4) {
      p++;
      readLeb();
    } else throw new Error(`unknown import kind ${kind}`);
  }
  return false;
}
