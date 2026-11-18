import { AiProviderError } from "./ai.types";
import { OpenAiCompatibleProvider } from "./openai-compatible.provider";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAiCompatibleProvider", () => {
  it("posts an OpenAI-style chat request and reads the answer", async () => {
    const fetchImpl = jest.fn(async () =>
      json(200, { model: "qwen2.5-coder:7b", choices: [{ message: { content: "A hint." } }] }),
    );
    const p = new OpenAiCompatibleProvider(
      "http://ollama:11434/v1/",
      "qwen2.5-coder:7b",
      "",
      fetchImpl,
    );
    const r = await p.chat([{ role: "user", content: "hi" }], new AbortController().signal);
    expect(r).toEqual({ text: "A hint.", model: "qwen2.5-coder:7b" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ollama:11434/v1/chat/completions");
    expect(init.headers).not.toHaveProperty("authorization");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "qwen2.5-coder:7b", stream: false });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("sends the key only when one is set", async () => {
    const fetchImpl = jest.fn(async () => json(200, { choices: [{ message: { content: "x" } }] }));
    const p = new OpenAiCompatibleProvider("https://api.example.com/v1", "m", "k-123", fetchImpl);
    await p.chat([], new AbortController().signal);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ authorization: "Bearer k-123" });
  });

  it("reports provider errors, empty answers and timeouts", async () => {
    const err = new OpenAiCompatibleProvider("http://x/v1", "m", "", async () =>
      json(404, { error: { message: 'model "m" not found' } }),
    );
    await expect(err.chat([], new AbortController().signal)).rejects.toThrow(
      new AiProviderError('HTTP 404: model "m" not found'),
    );
    const empty = new OpenAiCompatibleProvider("http://x/v1", "m", "", async () =>
      json(200, { choices: [{ message: { content: " " } }] }),
    );
    await expect(empty.chat([], new AbortController().signal)).rejects.toThrow("empty answer");
    const ac = new AbortController();
    ac.abort();
    const slow = new OpenAiCompatibleProvider("http://x/v1", "m", "", async () => {
      throw new Error("aborted");
    });
    await expect(slow.chat([], ac.signal)).rejects.toThrow("timed out");
  });
});
