import type { ExecutionRequest } from "./execution.types";
import { WasmProvider } from "./wasm.provider";
import { validateEnv } from "../config/env";

const limits = { cpuTimeSeconds: 2, wallTimeSeconds: 3, memoryKb: 64_000 };
const req = (
  language: ExecutionRequest["language"],
  sourceCode: string,
  stdin = "",
  more: Partial<ExecutionRequest["limits"]> = {},
): ExecutionRequest => ({ language, sourceCode, stdin, limits: { ...limits, ...more } });

// The C/C++ compiler loads in a few seconds on the first program; slow CI runners take longer.
jest.setTimeout(120_000);

describe("WasmProvider", () => {
  const wasm = new WasmProvider({ concurrency: 2 });
  afterAll(() => wasm.onModuleDestroy());

  describe("Python", () => {
    it("runs with the given input", async () => {
      const r = await wasm.execute(
        req("python", "a, b = map(int, input().split())\nprint(a + b)", "2 40\n"),
      );
      expect(r).toMatchObject({ verdict: "ACCEPTED", stdout: "42\n", providerStatus: "wasm:ok" });
      expect(r.timeSeconds).toBeGreaterThan(0);
      expect(r.memoryKb).toBeGreaterThan(0);
    });

    it("has the standard library", async () => {
      const r = await wasm.execute(
        req(
          "python",
          "import collections, heapq, itertools, math, re, json, bisect, functools, decimal\n" +
            "print(math.comb(10, 3), json.dumps(sorted(collections.Counter('abca').items())))",
        ),
      );
      expect(r).toMatchObject({
        verdict: "ACCEPTED",
        stdout: '120 [["a", 2], ["b", 1], ["c", 1]]\n',
      });
    });

    it("reports exceptions and syntax errors as runtime errors with the traceback", async () => {
      const r = await wasm.execute(req("python", "print(1 // 0)"));
      expect(r).toMatchObject({ verdict: "RUNTIME_ERROR", providerStatus: "wasm:exit_1" });
      expect(r.stderr).toMatch(/ZeroDivisionError/);
      const s = await wasm.execute(req("python", "print('a'"));
      expect(s.verdict).toBe("RUNTIME_ERROR");
      expect(s.stderr).toMatch(/SyntaxError/);
    });

    it("can't see files, the environment, or the network", async () => {
      const r = await wasm.execute(
        req(
          "python",
          [
            "import os, sys",
            "print(dict(os.environ))",
            "for p in ['/', '.', '/etc/passwd', 'C:/Windows/win.ini', '/proc/self/environ']:",
            "    try:",
            "        open(p).read(); print('READ', p)",
            "    except OSError as e:",
            "        print('no', p)",
            "try:",
            "    import socket; socket.socket().connect(('127.0.0.1', 5432)); print('CONNECTED')",
            "except Exception:",
            "    print('no network')",
            "try:",
            "    open('x.txt', 'w').write('hi'); print('WROTE')",
            "except OSError:",
            "    print('no write')",
          ].join("\n"),
        ),
      );
      expect(r.verdict).toBe("ACCEPTED");
      expect(r.stdout).toBe(
        "{}\nno /\nno .\nno /etc/passwd\nno C:/Windows/win.ini\nno /proc/self/environ\nno network\nno write\n",
      );
    });

    it("stops an endless loop", async () => {
      const r = await wasm.execute(
        req("python", "while True:\n    pass", "", { cpuTimeSeconds: 1, wallTimeSeconds: 1 }),
      );
      expect(r).toMatchObject({
        verdict: "TIME_LIMIT_EXCEEDED",
        providerStatus: "wasm:time_limit",
      });
    });

    it("stops a program using more memory than allowed", async () => {
      const r = await wasm.execute(req("python", "x = [0] * (50 * 1000 * 1000)\nprint(len(x))"));
      expect(r).toMatchObject({ verdict: "MEMORY_LIMIT_EXCEEDED" });
      // The same program fits in a larger limit.
      const ok = await wasm.execute(
        req("python", "x = [0] * (5 * 1000 * 1000)\nprint(len(x))", "", { memoryKb: 256_000 }),
      );
      expect(ok).toMatchObject({ verdict: "ACCEPTED", stdout: "5000000\n" });
    });

    it("stops a runaway print loop at 1 MB", async () => {
      const r = await wasm.execute(req("python", "while True:\n    print('x' * 1000)"));
      expect(r).toMatchObject({ verdict: "RUNTIME_ERROR", providerStatus: "wasm:output_limit" });
      expect(r.stderr).toMatch(/more than 1 MB/);
    });

    it("allows deep recursion when the program asks for it", async () => {
      const r = await wasm.execute(
        req(
          "python",
          "import sys\nsys.setrecursionlimit(100000)\n" +
            "def f(n): return 0 if n == 0 else 1 + f(n - 1)\nprint(f(20000))",
        ),
      );
      expect(r).toMatchObject({ verdict: "ACCEPTED", stdout: "20000\n" });
    });
  });

  describe("C and C++", () => {
    it("compiles and runs C with the given input", async () => {
      const r = await wasm.execute(
        req(
          "c",
          '#include <stdio.h>\n#include <math.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d %.1f\\n",a+b,sqrt(16.0));return 0;}',
          "2 40\n",
        ),
      );
      expect(r).toMatchObject({ verdict: "ACCEPTED", stdout: "42 4.0\n" });
    });

    it("runs C++17, including <bits/stdc++.h>", async () => {
      const r = await wasm.execute(
        req(
          "cpp",
          [
            "#include <bits/stdc++.h>",
            "using namespace std;",
            "int main() {",
            "  int n; cin >> n; vector<long long> v(n); for (auto& x : v) cin >> x;",
            "  sort(v.begin(), v.end()); map<long long, int> m; for (auto x : v) m[x]++;",
            "  auto [lo, hi] = minmax_element(v.begin(), v.end());",
            '  cout << accumulate(v.begin(), v.end(), 0LL) << " " << *lo << " " << *hi << " " << m.size() << "\\n";',
            "}",
          ].join("\n"),
          "5\n3 1 4 1 5\n",
        ),
      );
      expect(r).toMatchObject({ verdict: "ACCEPTED", stdout: "14 1 5 4\n" });
    });

    it("reports compile errors with the compiler's message", async () => {
      const r = await wasm.execute(req("c", "int main(void){ return x; }"));
      expect(r).toMatchObject({ verdict: "COMPILE_ERROR", providerStatus: "wasm:compile_error" });
      expect(r.compileOutput).toMatch(/undeclared identifier 'x'/);
    });

    it("ends the program when it throws, like an uncaught exception", async () => {
      const r = await wasm.execute(
        req("cpp", "#include <vector>\nint main(){ std::vector<int> v(3); return v.at(10); }"),
      );
      expect(r.verdict).toBe("RUNTIME_ERROR");
      expect(r.stderr).toMatch(/std::out_of_range/);
    });

    it("gives recursion a deep stack, and stops it when it runs out", async () => {
      // `volatile` keeps the compiler from turning the recursion into a loop.
      const recurse =
        "#include <stdio.h>\nint f(int n){ volatile int x = n & 1; return n == 0 ? 0 : f(n - 1) + x; }\n" +
        'int main(void){ int n; scanf("%d", &n); printf("%d\\n", f(n)); }';
      const deep = await wasm.execute(req("c", recurse, "100000\n"));
      expect(deep).toMatchObject({ verdict: "ACCEPTED", stdout: "50000\n" });
      const endless = await wasm.execute(req("c", recurse, "-1\n"));
      expect(endless.verdict).toBe("RUNTIME_ERROR");
      expect(endless.stderr).toMatch(/stack overflow/);
    });

    it("stops an endless loop", async () => {
      const r = await wasm.execute(
        req("c", "int main(void){ volatile int x = 0; for (;;) x++; }", "", {
          cpuTimeSeconds: 1,
          wallTimeSeconds: 1,
        }),
      );
      expect(r.verdict).toBe("TIME_LIMIT_EXCEEDED");
    });

    it("stops a program using more memory than allowed", async () => {
      const r = await wasm.execute(
        req(
          "cpp",
          '#include <vector>\n#include <cstdio>\nint main(){ std::vector<std::vector<int>> v; for (int i = 0; i < 1000; i++) v.emplace_back(1 << 20, i); printf("%zu\\n", v.size()); }',
        ),
      );
      expect(r.verdict).toBe("MEMORY_LIMIT_EXCEEDED");
    });
  });

  it("is allowed in production; Judge0 needs its address", () => {
    const base = {
      NODE_ENV: "production",
      DATABASE_URL: "postgres://u:p@db:5432/x",
      JWT_SECRET: "a-real-secret-that-is-long-enough-to-pass-validation",
      CORS_ORIGINS: "https://exam.example.edu",
    };
    expect(validateEnv({ ...base, EXECUTION_PROVIDER: "wasm" }).EXECUTION_PROVIDER).toBe("wasm");
    expect(() => validateEnv(base)).toThrow(/JUDGE0_URL/);
  });
});
