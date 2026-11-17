import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IpcChannel } from "./ipc-contract";

describe("preload", () => {
  const src = readFileSync(path.join(__dirname, "preload.ts"), "utf8");

  it("only imports electron at runtime (sandboxed preloads cannot require local files)", () => {
    const runtimeImports = [...src.matchAll(/^import (?!type)[^;]*from "([^"]+)"/gm)].map(
      (m) => m[1],
    );
    expect(runtimeImports).toEqual(["electron"]);
  });

  it("uses the same channel names as the main process", () => {
    for (const channel of Object.values(IpcChannel)) expect(src).toContain(`"${channel}"`);
  });
});
