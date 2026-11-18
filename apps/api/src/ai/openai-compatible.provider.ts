import { AiProviderError, type AiChatMessage, type AiProvider, type AiReply } from "./ai.types";

/** Answers longer than this are cut; the prompt asks for short answers anyway. */
const MAX_OUTPUT_TOKENS = 1200;

/**
 * Talks to any OpenAI-compatible chat API: Ollama (`http://host:11434/v1`), llama.cpp server,
 * vLLM, or a hosted service. Only `POST {base}/chat/completions` is used.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chat(messages: AiChatMessage[], signal: AbortSignal): Promise<AiReply> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
          stream: false,
        }),
        signal,
      });
    } catch (err) {
      throw new AiProviderError(
        signal.aborted ? "timed out" : `unreachable: ${(err as Error).message}`,
      );
    }
    const body = (await res.json().catch(() => null)) as {
      model?: unknown;
      choices?: { message?: { content?: unknown } }[];
      error?: { message?: unknown } | string;
    } | null;
    if (!res.ok) {
      const detail =
        typeof body?.error === "string"
          ? body.error
          : typeof body?.error?.message === "string"
            ? body.error.message
            : "";
      throw new AiProviderError(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AiProviderError("empty answer");
    }
    return { text: content, model: typeof body?.model === "string" ? body.model : this.model };
  }
}

/** Used when AI_BASE_URL is empty: AI help is off. */
export class NoAiProvider implements AiProvider {
  readonly model = null;
  chat(): Promise<AiReply> {
    return Promise.reject(new AiProviderError("AI help is not set up"));
  }
}
