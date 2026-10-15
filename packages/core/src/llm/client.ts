import Groq from "groq-sdk";
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

export class GroqClient implements LlmClient {
  private readonly client: Groq;
  readonly model: string;

  constructor(config: Pick<ThemisConfig, "groqApiKey" | "groqModel">) {
    // groq-sdk retries 408/409/429/5xx with exponential backoff.
    this.client = new Groq({ apiKey: config.groqApiKey, maxRetries: 5, timeout: 120_000 });
    this.model = config.groqModel;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages,
      ...(request.tools && request.tools.length > 0
        ? { tools: request.tools, tool_choice: request.toolChoice ?? "auto", parallel_tool_calls: false }
        : {}),
      temperature: request.temperature ?? 0.2,
      max_completion_tokens: request.maxTokens ?? 8192,
      ...(this.model.startsWith("openai/gpt-oss") ? { reasoning_effort: "medium" as const } : {}),
    });
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
}
