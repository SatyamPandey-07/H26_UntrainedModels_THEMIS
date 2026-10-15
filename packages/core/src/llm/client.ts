import Groq from "groq-sdk";
import { requireGroqKey } from "../config.js";
import type { ThemisConfig } from "../config.js";

export type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = Groq.Chat.Completions.ChatCompletionTool;
export type ToolCall = Groq.Chat.Completions.ChatCompletionMessageToolCall;

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ChatTool[];
  toolChoice?: "auto" | "required" | "none";
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number };
}

/** Minimal LLM interface so agents do not depend on a provider SDK. */
export interface LlmClient {
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export const COMPLETION_TOKENS = Number(process.env.THEMIS_MAX_COMPLETION_TOKENS ?? 2500);
const REASONING_EFFORT = (process.env.THEMIS_REASONING_EFFORT ?? "low") as "low" | "medium" | "high";

export class GroqClient implements LlmClient {
  private readonly client: Groq;
  readonly model: string;

  constructor(config: Pick<ThemisConfig, "groqApiKey" | "groqModel">) {
    // groq-sdk retries 408/409/429/5xx with exponential backoff.
    this.client = new Groq({
      apiKey: requireGroqKey(config as ThemisConfig),
      maxRetries: 5,
      timeout: 120_000,
    });
    this.model = config.groqModel;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    let completion: Groq.Chat.Completions.ChatCompletion;
    try {
      completion = await this.create(request);
    } catch (err) {
      const recovered = recoverToolCall(err);
      if (recovered) return recovered;
      throw err;
    }
    const choice = completion.choices[0];
    return {
      content: choice?.message.content ?? "",
      toolCalls: choice?.message.tool_calls ?? [],
      finishReason: choice?.finish_reason ?? "unknown",
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  }

  private create(request: ChatRequest) {
    return this.client.chat.completions.create({
      model: this.model,
      messages: request.messages,
      ...(request.tools && request.tools.length > 0
        ? { tools: request.tools, tool_choice: request.toolChoice ?? "auto", parallel_tool_calls: false }
        : {}),
      temperature: request.temperature ?? 0.2,
      // Groq counts the reserved completion against the per-minute token limit, so keep it modest.
      max_completion_tokens: request.maxTokens ?? COMPLETION_TOKENS,
      ...(this.model.startsWith("openai/gpt-oss") ? { reasoning_effort: REASONING_EFFORT } : {}),
      stream: false,
    });
  }
}

let recoveredSeq = 0;

/**
 * gpt-oss models occasionally emit a tool call under a channel name (e.g. "commentary") that is not a
 * declared tool, and Groq rejects the request with `tool_use_failed`. The intended call is in
 * `failed_generation`; return it so the agent loop can validate it like any other call. When the model wrote
 * plain text instead of a required tool call (`output_parse_failed`), return an empty turn so the loop can nudge it.
 */
function recoverToolCall(err: unknown): ChatResponse | undefined {
  if (!(err instanceof Groq.BadRequestError)) return undefined;
  const body = (err.error as { error?: { code?: string; failed_generation?: string } } | undefined)?.error;
  if (body?.code !== "tool_use_failed" && body?.code !== "output_parse_failed") return undefined;
  const empty: ChatResponse = {
    content: "",
    toolCalls: [],
    finishReason: "tool_use_failed",
    usage: { promptTokens: 0, completionTokens: 0 },
  };
  if (body.code === "output_parse_failed") return { ...empty, finishReason: "output_parse_failed" };
  try {
    const parsed = JSON.parse(body.failed_generation ?? "") as { name?: string; arguments?: unknown };
    if (!parsed.name) return empty;
    recoveredSeq += 1;
    return {
      ...empty,
      toolCalls: [
        {
          id: `recovered_${recoveredSeq}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments:
              typeof parsed.arguments === "string"
                ? parsed.arguments
                : JSON.stringify(parsed.arguments ?? {}),
          },
        },
      ],
    };
  } catch {
    return empty;
  }
}
