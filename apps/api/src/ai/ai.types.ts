export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiReply {
  text: string;
  /** The model that answered, as the provider reports it. */
  model: string;
}

/** A chat model. The default is an OpenAI-compatible API (Ollama, or a hosted free tier). */
export interface AiProvider {
  /** Null when AI help isn't set up on this server. */
  readonly model: string | null;
  chat(messages: AiChatMessage[], signal: AbortSignal): Promise<AiReply>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");

/** Why the provider gave no usable answer. Shown to staff in the log, never to students. */
export class AiProviderError extends Error {}
