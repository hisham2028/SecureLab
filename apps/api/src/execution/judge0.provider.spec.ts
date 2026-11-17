import { Judge0Provider, mapJudge0Status } from "./judge0.provider";

describe("mapJudge0Status", () => {
  it("maps core statuses", () => {
    expect(mapJudge0Status(3, 100, 1000)).toBe("ACCEPTED");
    expect(mapJudge0Status(4, 100, 1000)).toBe("WRONG_ANSWER");
    expect(mapJudge0Status(5, 100, 1000)).toBe("TIME_LIMIT_EXCEEDED");
    expect(mapJudge0Status(6, null, 1000)).toBe("COMPILE_ERROR");
    expect(mapJudge0Status(13, null, 1000)).toBe("INTERNAL_ERROR");
  });
  it("classifies runtime errors near the memory limit as MLE", () => {
    expect(mapJudge0Status(11, 1000, 1000)).toBe("MEMORY_LIMIT_EXCEEDED");
    expect(mapJudge0Status(11, 200, 1000)).toBe("RUNTIME_ERROR");
  });
});

describe("Judge0Provider", () => {
  const limits = { cpuTimeSeconds: 2, wallTimeSeconds: 5, memoryKb: 128000 };

  it("sends base64 source with network disabled and decodes the result", async () => {
    let sent:
      { url: string; body: Record<string, unknown>; headers: Record<string, string> } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = {
        url,
        body: JSON.parse(init.body as string),
        headers: init.headers as Record<string, string>,
      };
      return new Response(
        JSON.stringify({
          stdout: Buffer.from("3\n").toString("base64"),
          stderr: null,
          compile_output: null,
          message: null,
          time: "0.012",
          memory: 3200,
          status: { id: 3, description: "Accepted" },
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const provider = new Judge0Provider("http://judge0:2358/", "tok", fakeFetch);
    const result = await provider.execute({
      language: "python",
      sourceCode: "print(1+2)",
      stdin: "",
      expectedOutput: "3\n",
      limits,
    });

    expect(sent!.url).toBe("http://judge0:2358/submissions?base64_encoded=true&wait=true");
    expect(sent!.headers["X-Auth-Token"]).toBe("tok");
    expect(sent!.body.language_id).toBe(71);
    expect(sent!.body.enable_network).toBe(false);
    expect(Buffer.from(sent!.body.source_code as string, "base64").toString()).toBe("print(1+2)");
    expect(result).toMatchObject({
      verdict: "ACCEPTED",
      stdout: "3\n",
      timeSeconds: 0.012,
      memoryKb: 3200,
    });
  });

  it("throws on HTTP errors rather than reporting a verdict", async () => {
    const fakeFetch = (async () =>
      new Response("boom", { status: 503 })) as unknown as typeof fetch;
    const provider = new Judge0Provider("http://judge0:2358", "", fakeFetch);
    await expect(
      provider.execute({ language: "c", sourceCode: "", stdin: "", limits }),
    ).rejects.toThrow("HTTP 503");
  });
});
