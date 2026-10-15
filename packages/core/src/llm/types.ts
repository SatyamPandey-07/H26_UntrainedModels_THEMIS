import type Groq from "groq-sdk";

export type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = Groq.Chat.Completions.ChatCompletionTool;
export type ToolCall = Groq.Chat.Completions.ChatCompletionMessageToolCall;

/** A prompt view sized for one model: what to send, its estimated size, and whether it fits the budget. */
export interface ShapedRequest {
  messages: ChatMessage[];
  /** Estimated prompt tokens (messages plus tool schemas). */
  tokens: number;
  /** Characters of the serialized view, used to calibrate the estimator against real usage. */
  chars: number;
  fits: boolean;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ChatTool[];
  /** `{ name }` forces one specific tool (used to make an agent submit its result). */
  toolChoice?: "auto" | "required" | "none" | { name: string };
  temperature?: number;
  maxTokens?: number;
  /**
   * Builds the view of `messages` to send for a prompt-token budget. The pool calls it once per candidate
   * model, so each model gets a prompt sized to its own limit. `level` > 0 asks for stricter shrinking
   * (used after a "request too large" answer). Without it, `messages` is sent as is.
   */
  shape?: (budgetTokens: number, level: number) => ShapedRequest;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number };
  /** The model that actually answered (differs from the primary after a fallback). */
  model?: string;
  /** Characters of the prompt view that was sent, for estimator calibration. */
  shapedChars?: number;
  /** The completion-token cap this request was sent with (explains `finish_reason: length`). */
  completionCap?: number;
}

/** Where a client reports key/model switches and persists run-scoped state. */
export interface LlmSink {
  log(message: string): void;
  /** Run directory; the pool stores cooldown state and a usage summary there. */
  stateDir?: string;
}

/** Minimal LLM interface so agents do not depend on a provider SDK. */
export interface LlmClient {
  /** The model most recently used (the configured primary before the first call). */
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  attach?(sink: LlmSink): void;
}
