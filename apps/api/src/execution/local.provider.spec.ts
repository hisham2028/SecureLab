import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalProvider, defaultToolchain } from "./local.provider";
import type { ExecutionRequest } from "./execution.types";
import { validateEnv } from "../config/env";

const tools = defaultToolchain(process.env);
const has = (cmd: string[]) => {
  try {
    execFileSync(cmd[0], [...cmd.slice(1), "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
// CI sets REQUIRE_LOCAL_TOOLS so a missing compiler fails the run instead of skipping tests.
const required = process.env.REQUIRE_LOCAL_TOOLS === "1";
const withC = required || has([tools.cc]) ? it : it.skip;
const withPython = required || has(tools.python) ? it : it.skip;

const limits = { cpuTimeSeconds: 2, wallTimeSeconds: 3, memoryKb: 128_000 };
const req = (language: ExecutionRequest["language"], sourceCode: string, stdin = "") => ({
  language,
  sourceCode,
  stdin,
  limits,
});

describe("LocalProvider (SecureLab Lite)", () => {
  const local = new LocalProvider(tools);

  withC("compiles and runs C with the given input", async () => {
    const r = await local.execute(
      req(
        "c",
        '#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',
        "2 40\n",
      ),
    );
    expect(r).toMatchObject({ verdict: "ACCEPTED", stdout: "42\n", providerStatus: "local:ok" });
  });

  withC("runs C++", async () => {
    const r = await local.execute(
      req(
        "cpp",
        "#include <iostream>\nint main(){std::string s;std::cin>>s;std::cout<<s.size()<<'\\n';}",
        "hello\n",
      ),
    );
    expect(r).toMatchObject({ verdict: "ACCEPTED", stdout: "5\n" });
  });

  withC("reports compile errors with the compiler's message", async () => {
    const r = await local.execute(req("c", "int main(void){ return x; }"));
    expect(r.verdict).toBe("COMPILE_ERROR");
    expect(r.compileOutput).toMatch(/x/);
  });

  withC("stops an endless loop at the time limit", async () => {
    const started = Date.now();
    const r = await local.execute(req("c", "int main(void){ for(;;){} }"));
    expect(r.verdict).toBe("TIME_LIMIT_EXCEEDED");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  withPython("runs Python and reports a crash as a runtime error", async () => {
    expect(await local.execute(req("python", "print(int(input()) * 2)", "21\n"))).toMatchObject({
      verdict: "ACCEPTED",
      stdout: "42\n",
    });
    const crash = await local.execute(req("python", "raise SystemExit(3)"));
    expect(crash).toMatchObject({ verdict: "RUNTIME_ERROR", providerStatus: "local:exit_3" });
  });

  withPython("stops a program that prints without end", async () => {
    const r = await local.execute(req("python", "while True: print('x' * 1000)"));
    expect(["RUNTIME_ERROR", "TIME_LIMIT_EXCEEDED"]).toContain(r.verdict);
    expect(r.stdout.length).toBeLessThanOrEqual(1024 * 1024);
  });

  withPython("doesn't pass the server's secrets to student code", async () => {
    process.env.JWT_SECRET_FOR_TEST = "top-secret";
    const r = await local.execute(
      req("python", "import os\nprint(os.environ.get('JWT_SECRET_FOR_TEST', 'none'))"),
    );
    delete process.env.JWT_SECRET_FOR_TEST;
    expect(r.stdout).toBe("none\n");
  });

  it("explains a missing compiler instead of failing silently", async () => {
    const missing = new LocalProvider({ ...tools, cc: "no-such-compiler-xyz" });
    await expect(missing.execute(req("c", "int main(void){return 0;}"))).rejects.toThrow(
      /isn't installed/,
    );
  });

  it("keeps a full Python path with spaces in one piece", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "py dir "));
    const exe = path.join(dir, "python.exe");
    writeFileSync(exe, "");
    try {
      expect(defaultToolchain({ LOCAL_PYTHON: exe }).python).toEqual([exe]);
      expect(defaultToolchain({ LOCAL_PYTHON: "py -3" }).python).toEqual(["py", "-3"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is refused in production", () => {
    const base = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      JWT_SECRET: "a".repeat(40),
      JUDGE0_URL: "http://judge0:2358",
      CORS_ORIGINS: "https://exam.example.edu",
    };
    expect(() => validateEnv({ ...base, EXECUTION_PROVIDER: "local" })).toThrow(/sandbox/);
    expect(validateEnv(base).EXECUTION_PROVIDER).toBe("judge0");
  });
});
