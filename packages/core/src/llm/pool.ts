import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Groq from "groq-sdk";
import { LlmExhaustedError, PromptTooLargeError } from "./errors.js";
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient, LlmSink, ShapedRequest } from "./types.js";

export const COMPLETION_TOKENS = Number(process.env.THEMIS_MAX_COMPLETION_TOKENS ?? 2500);
const REASONING_EFFORT = (process.env.THEMIS_REASONING_EFFORT ?? "low") as "low" | "medium" | "high";
/** gpt-oss ignores "none"; the qwen fallback runs in instruct mode by default, which spends far fewer tokens. */
const FALLBACK_REASONING = process.env.THEMIS_FALLBACK_REASONING ?? "none";
/** Hard cap on prompt tokens per request, whatever the model allows. */
const PROMPT_CAP = Number(process.env.THEMIS_PROMPT_TOKEN_BUDGET ?? 24_000);

const WINDOW_MS = 60_000;
/** Groq's free tier allows 8K tokens per minute per model; learned from the API once a request is answered. */
const DEFAULT_TPM = 8_000;
const SAFETY_MARGIN = 300;
const MIN_COMPLETION = 600;
const PREFERRED_COMPLETION = 1_500;
/** A rate limit that resets later than this is treated as "exhausted for this run". */
const LONG_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_COOLDOWN_MS = 20_000;
const TRANSIENT_COOLDOWN_MS = 30_000;
const DAILY = /tokens per day|requests per day|\(TPD\)|\(RPD\)/i;

export interface PoolOptions {
  keys: string[];
  /** Primary model first, then fallbacks. The primary is tried on every key before any fallback is used. */
  models: string[];
  maxWaitMs?: number;
  /** Overrides the learned per-model token-per-minute limit. */
  tpmLimit?: number;
  baseURL?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface SlotStats {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  rateLimited: number;
  tooLarge: number;
  errors: number;
}

interface Slot {
  keyIndex: number;
  model: string;
  label: string;
  coolUntil: number;
  coolReason?: string;
  exhausted: boolean;
  window: Array<{ at: number; tokens: number }>;
  /** From x-ratelimit-remaining-tokens on the last response. */
  remaining?: { tokens: number; resetAt: number };
  stats: SlotStats;
}

interface PersistedState {
  slots: Array<{ label: string; coolUntil: number; coolReason?: string; exhausted: boolean }>;
  deadKeys: number[];
  deadModels: string[];
  learnedLimit: Record<string, number>;
}

/** "7.2s", "1m23.4s", "850ms", "2h" or plain seconds ("12") to milliseconds. */
export function parseDurationMs(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000);
  let total = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.round(total) : undefined;
}

function header(h: unknown, name: string): string | undefined {
  if (!h) return undefined;
  const get = (h as { get?: (n: string) => string | null }).get;
  if (typeof get === "function") return get.call(h, name) ?? undefined;
  const v = (h as Record<string, unknown>)[name];
  return typeof v === "string" ? v : undefined;
}

/** The documented message is "... Limit 8000, Requested 9713 ...". */
export function parseRequestLimit(message: string): { limit?: number; requested?: number } {
  const limit = /Limit (\d+)/i.exec(message)?.[1];
  const requested = /Requested (\d+)/i.exec(message)?.[1];
  return { limit: limit ? Number(limit) : undefined, requested: requested ? Number(requested) : undefined };
}

function errorText(err: unknown): string {
  const body = (err as { error?: { error?: { message?: string }; message?: string } }).error;
  return body?.error?.message ?? body?.message ?? (err as Error).message ?? String(err);
}

function stripThinking(content: string): string {
  return content.includes("<think>") ? content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : content;
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

type Verdict = "next" | "shrink" | "retry";

/**
 * Several Groq API keys. The primary model is tried on key 1, 2, 3 ... and only when every key is rate limited
 * on it do the fallback models come into play (again key by key). A rate-limited slot is skipped at
 * once (no sleeping while another slot is free); requests are paced against each slot's token-per-minute window;
 * a request that is too large is re-shaped for the model's real limit instead of being rotated away.
 */
export class GroqPool implements LlmClient {
  private readonly clients: Groq[];
  private readonly slots: Slot[] = [];
  private readonly deadKeys = new Set<number>();
  private readonly deadModels = new Set<string>();
  private readonly learnedLimit = new Map<string, number>();
  private readonly unsupported = new Map<string, Set<string>>();
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tpmOverride?: number;
  private readonly primary: string;
  private readonly keyCount: number;
  private sink?: LlmSink;
  private lastUsed?: Slot;

  constructor(opts: PoolOptions) {
    if (opts.keys.length === 0) throw new Error("GroqPool needs at least one API key");
    if (opts.models.length === 0) throw new Error("GroqPool needs at least one model");
    this.clients = opts.keys.map(
      // The pool owns retries: the SDK would otherwise sleep on a 429 instead of moving to the next slot.
      (apiKey) => new Groq({ apiKey, maxRetries: 0, timeout: 120_000, baseURL: opts.baseURL }),
    );
    this.keyCount = opts.keys.length;
    this.primary = opts.models[0] as string;
    this.maxWaitMs = opts.maxWaitMs ?? 90_000;
    this.tpmOverride = opts.tpmLimit;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    // Primary model on every key first, then each fallback model on every key: an exhausted key moves to the
    // next key on the same model before any model switch happens.
    for (const model of opts.models)
      opts.keys.forEach((_, keyIndex) => {
        this.slots.push({
          keyIndex,
          model,
          label: `key ${keyIndex + 1}/${this.keyCount} · ${model}`,
          coolUntil: 0,
          exhausted: false,
          window: [],
          stats: { calls: 0, promptTokens: 0, completionTokens: 0, rateLimited: 0, tooLarge: 0, errors: 0 },
        });
      });
  }

  get model(): string {
    return this.lastUsed?.model ?? this.primary;
  }

  attach(sink: LlmSink): void {
    this.sink = sink;
    if (!sink.stateDir) return;
    const file = join(sink.stateDir, "llm-pool.json");
    if (!existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as PersistedState;
      const now = this.now();
      for (const s of saved.slots ?? []) {
        const slot = this.slots.find((x) => x.label === s.label);
        if (!slot) continue;
        slot.exhausted = slot.exhausted || s.exhausted;
        if (s.coolUntil > now) {
          slot.coolUntil = Math.max(slot.coolUntil, s.coolUntil);
          slot.coolReason = s.coolReason;
        }
      }
      for (const k of saved.deadKeys ?? []) if (k < this.keyCount) this.deadKeys.add(k);
      for (const m of saved.deadModels ?? []) this.deadModels.add(m);
      for (const [m, l] of Object.entries(saved.learnedLimit ?? {})) this.learnedLimit.set(m, l);
    } catch {
      // unreadable state: start fresh
    }
  }

  private log(message: string): void {
    this.sink?.log(`llm: ${message}`);
  }

  private persist(): void {
    const dir = this.sink?.stateDir;
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      const state: PersistedState = {
        slots: this.slots.map((s) => ({
          label: s.label,
          coolUntil: s.coolUntil,
          coolReason: s.coolReason,
          exhausted: s.exhausted,
        })),
        deadKeys: [...this.deadKeys],
        deadModels: [...this.deadModels],
        learnedLimit: Object.fromEntries(this.learnedLimit),
      };
      writeFileSync(join(dir, "llm-pool.json"), JSON.stringify(state, null, 2) + "\n");
      writeFileSync(
        join(dir, "llm-usage.json"),
        JSON.stringify(
          this.slots.map((s) => ({ slot: s.label, ...s.stats, exhausted: s.exhausted })),
          null,
          2,
        ) + "\n",
      );
    } catch {
      // state is advisory; never fail a model call because it cannot be written
    }
  }

  private limitFor(model: string): number {
    return this.tpmOverride ?? this.learnedLimit.get(model) ?? DEFAULT_TPM;
  }

  private usable(slot: Slot): boolean {
    return !this.deadKeys.has(slot.keyIndex) && !this.deadModels.has(slot.model) && !slot.exhausted;
  }

  private windowUsed(slot: Slot, now: number): number {
    slot.window = slot.window.filter((w) => w.at > now - WINDOW_MS);
    return slot.window.reduce((n, w) => n + w.tokens, 0);
  }

  /** Tokens this slot can take right now. */
  private headroom(slot: Slot, limit: number, now: number): number {
    let free = limit - this.windowUsed(slot, now);
    if (slot.remaining && slot.remaining.resetAt > now) free = Math.min(free, slot.remaining.tokens);
    return free;
  }

  /** Earliest time at which `need` tokens fit this slot's window again. */
  private releaseTime(slot: Slot, need: number, limit: number, now: number): number {
    let used = this.windowUsed(slot, now);
    let at = now;
    for (const w of [...slot.window].sort((a, b) => a.at - b.at)) {
      used -= w.tokens;
      at = w.at + WINDOW_MS;
      if (limit - used >= need) break;
    }
    if (slot.remaining && slot.remaining.resetAt > now) at = Math.max(at, slot.remaining.resetAt);
    return Math.max(at, now + 250);
  }

  private async choose(request: ChatRequest, level: number, boost: number) {
    for (;;) {
      const now = this.now();
      let soonest = Infinity;
      let tooBig: { tokens: number; limit: number } | undefined;
      let alive = 0;
      const waiting: string[] = [];
      for (const slot of this.slots) {
        if (!this.usable(slot)) continue;
        alive += 1;
        if (slot.coolUntil > now) {
          soonest = Math.min(soonest, slot.coolUntil);
          waiting.push(`${slot.label}: ${slot.coolReason ?? "cooling down"}`);
          continue;
        }
        const limit = this.limitFor(slot.model);
        const maxCompletion = Math.max(MIN_COMPLETION, request.maxTokens ?? COMPLETION_TOKENS) * boost;
        // Roughly a fifth of the window is kept for the answer; tighter models get a proportionally smaller reserve.
        const preferred = Math.min(
          maxCompletion,
          Math.max(MIN_COMPLETION, Math.floor(limit * (PREFERRED_COMPLETION / DEFAULT_TPM))) * boost,
        );
        const promptBudget = Math.max(
          500,
          Math.min(PROMPT_CAP, Math.floor((limit - SAFETY_MARGIN - preferred) * (1 - 0.12 * level))),
        );
        const view: ShapedRequest = request.shape
          ? request.shape(promptBudget, level)
          : {
              messages: request.messages,
              tokens: Math.ceil(JSON.stringify(request.messages).length / 3),
              chars: JSON.stringify(request.messages).length,
              fits: true,
            };
        const room = limit - SAFETY_MARGIN - view.tokens;
        if (!view.fits || room < MIN_COMPLETION) {
          tooBig = { tokens: view.tokens, limit };
          continue;
        }
        const completion = Math.min(maxCompletion, room);
        const need = view.tokens + completion;
        if (need > this.headroom(slot, limit, now)) {
          const at = this.releaseTime(slot, need, limit, now);
          soonest = Math.min(soonest, at);
          waiting.push(`${slot.label}: token window full`);
          continue;
        }
        return { slot, view, completion };
      }
      if (alive === 0)
        throw new LlmExhaustedError(
          "No Groq key/model is usable: every key was rejected or every model was withdrawn.",
          this.slots.map((s) => s.label),
        );
      if (soonest === Infinity && tooBig)
        throw new PromptTooLargeError(
          `The prompt (~${tooBig.tokens} tokens) does not fit the ${tooBig.limit}-token request limit even after shrinking.`,
          tooBig.tokens,
          tooBig.limit,
        );
      const wait = soonest - now;
      if (wait > this.maxWaitMs) {
        throw new LlmExhaustedError(
          `All Groq keys and models are rate limited; the next slot frees in ${Math.ceil(wait / 1000)}s ` +
            `(limit ${Math.ceil(this.maxWaitMs / 1000)}s). ${waiting.join("; ")}`,
          waiting,
        );
      }
      this.log(`all slots busy; waiting ${Math.ceil(wait / 1000)}s (${waiting[0] ?? "token window"})`);
      await this.sleep(wait + 50);
    }
  }

  private paramsFor(model: string): Record<string, unknown> {
    const off = this.unsupported.get(model) ?? new Set<string>();
    const params: Record<string, unknown> = {};
    if (model.startsWith("openai/gpt-oss")) {
      if (!off.has("reasoning_effort")) params.reasoning_effort = REASONING_EFFORT;
    } else if (model.startsWith("qwen/")) {
      if (!off.has("reasoning_effort")) params.reasoning_effort = FALLBACK_REASONING;
      if (FALLBACK_REASONING !== "none" && !off.has("reasoning_format")) params.reasoning_format = "hidden";
    }
    return params;
  }

  /** Decides what to do after a failed call and records what was learned. */
  private classify(slot: Slot, err: unknown, transient: Map<Slot, number>): Verdict {
    if (!(err instanceof Groq.APIError)) throw err;
    const status = err.status;
    const text = errorText(err);
    const now = this.now();

    if (status === 429) {
      slot.stats.rateLimited += 1;
      const retryAfter =
        parseDurationMs(header((err as { headers?: unknown }).headers, "retry-after")) ??
        parseDurationMs(/try again in ([0-9hms.]+)/i.exec(text)?.[1]) ??
        DEFAULT_COOLDOWN_MS;
      const daily = DAILY.test(text);
      const scope = daily
        ? "daily"
        : /requests per minute|\(RPM\)/i.test(text)
          ? "per-minute request"
          : "per-minute token";
      if (daily || retryAfter > LONG_COOLDOWN_MS) {
        slot.exhausted = true;
        slot.coolReason = `${scope} limit used up`;
        this.log(`${slot.label}: ${scope} limit used up; skipping it for this run`);
      } else {
        slot.coolUntil = now + retryAfter + 250;
        slot.coolReason = `${scope} limit, retry in ${Math.ceil(retryAfter / 1000)}s`;
        this.log(
          `${slot.label}: ${scope} limit; retry in ${Math.ceil(retryAfter / 1000)}s, trying the next slot`,
        );
      }
      this.persist();
      return "next";
    }

    if (status === 413) {
      slot.stats.tooLarge += 1;
      const { limit, requested } = parseRequestLimit(text);
      if (limit) this.learnedLimit.set(slot.model, limit);
      this.log(
        `${slot.label}: request too large${requested ? ` (${requested} tokens)` : ""}${limit ? `, limit ${limit}` : ""}; shrinking the prompt`,
      );
      this.persist();
      return "shrink";
    }

    if (status === 401 || status === 403) {
      slot.stats.errors += 1;
      this.deadKeys.add(slot.keyIndex);
      this.log(
        `key ${slot.keyIndex + 1}/${this.keyCount} was rejected (${status}); dropping it for this run`,
      );
      this.persist();
      return "next";
    }

    if (status === 404 || /model.*(decommission|not found|does not exist|no longer supported)/i.test(text)) {
      slot.stats.errors += 1;
      this.deadModels.add(slot.model);
      this.log(`${slot.model} is unavailable (${status ?? "error"}); dropping it for this run`);
      this.persist();
      return "next";
    }

    if (status === 400) {
      const off = this.unsupported.get(slot.model) ?? new Set<string>();
      let learned = false;
      for (const p of ["reasoning_effort", "reasoning_format"])
        if (text.includes(p) && !off.has(p)) {
          off.add(p);
          learned = true;
        }
      if (learned) {
        this.unsupported.set(slot.model, off);
        this.log(`${slot.model} rejected a reasoning parameter; retrying without it`);
        return "retry";
      }
      throw err;
    }

    const transientError = err instanceof Groq.APIConnectionError || status === 408 || (status ?? 0) >= 500;
    if (transientError) {
      slot.stats.errors += 1;
      const n = (transient.get(slot) ?? 0) + 1;
      transient.set(slot, n);
      if (n === 1) {
        this.log(`${slot.label}: transient error (${status ?? "network"}); retrying once`);
        return "retry";
      }
      slot.coolUntil = now + TRANSIENT_COOLDOWN_MS;
      slot.coolReason = `errors (${status ?? "network"})`;
      this.persist();
      return "next";
    }
    throw err;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    let level = 0;
    let boost = 1;
    let shrinks = 0;
    const transient = new Map<Slot, number>();
    for (let guard = 0; guard < 100; guard++) {
      const { slot, view, completion } = await this.choose(request, level, boost);
      if (this.lastUsed && this.lastUsed !== slot) this.log(`using ${slot.label}`);
      try {
        const out = await this.call(slot, view, completion, request);
        this.lastUsed = slot;
        const maxCompletion = Math.max(MIN_COMPLETION, request.maxTokens ?? COMPLETION_TOKENS);
        if (
          out.finishReason === "length" &&
          out.toolCalls.length === 0 &&
          boost === 1 &&
          completion < maxCompletion * 2 &&
          this.limitFor(slot.model) - SAFETY_MARGIN - view.tokens > completion
        ) {
          boost = 2;
          continue;
        }
        return out;
      } catch (err) {
        const recovered = recoverToolCall(err);
        if (recovered) {
          this.lastUsed = slot;
          return { ...recovered, model: slot.model, shapedChars: view.chars };
        }
        const verdict = this.classify(slot, err, transient);
        if (verdict === "shrink") {
          shrinks += 1;
          level += 1;
          if (shrinks > 3)
            throw new PromptTooLargeError(
              `Groq keeps rejecting the request as too large (limit ${this.limitFor(slot.model)}).`,
              view.tokens,
              this.limitFor(slot.model),
            );
        }
        // "next" and "retry" simply loop: choose() skips a cooled slot and picks the next one immediately.
      }
    }
    throw new LlmExhaustedError("No Groq slot produced a response after 100 attempts.");
  }

  private async call(
    slot: Slot,
    view: ShapedRequest,
    completion: number,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const client = this.clients[slot.keyIndex] as Groq;
    const { data: raw, response } = await client.chat.completions
      .create({
        model: slot.model,
        messages: view.messages as ChatMessage[],
        ...(request.tools && request.tools.length > 0
          ? { tools: request.tools, tool_choice: request.toolChoice ?? "auto", parallel_tool_calls: false }
          : {}),
        temperature: request.temperature ?? 0.2,
        // Groq counts the reserved completion against the per-minute token limit, so it is sized per request.
        max_completion_tokens: completion,
        ...this.paramsFor(slot.model),
        stream: false,
      } as unknown as Parameters<Groq["chat"]["completions"]["create"]>[0])
      .withResponse();

    const data = raw as Groq.Chat.Completions.ChatCompletion;
    const now = this.now();
    const prompt = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    slot.window.push({ at: now, tokens: Math.max(0, prompt - cached) + completionTokens });
    slot.stats.calls += 1;
    slot.stats.promptTokens += prompt;
    slot.stats.completionTokens += completionTokens;

    const limitHeader = Number(header(response.headers, "x-ratelimit-limit-tokens"));
    if (Number.isFinite(limitHeader) && limitHeader > 0 && this.tpmOverride === undefined)
      this.learnedLimit.set(slot.model, limitHeader);
    const remaining = Number(header(response.headers, "x-ratelimit-remaining-tokens"));
    const resetIn = parseDurationMs(header(response.headers, "x-ratelimit-reset-tokens"));
    if (Number.isFinite(remaining) && resetIn !== undefined)
      slot.remaining = { tokens: remaining, resetAt: now + resetIn };
    this.persist();

    const choice = data.choices[0];
    return {
      content: stripThinking(choice?.message.content ?? ""),
      toolCalls: choice?.message.tool_calls ?? [],
      finishReason: choice?.finish_reason ?? "unknown",
      usage: { promptTokens: prompt, completionTokens },
      model: slot.model,
      shapedChars: view.chars,
    };
  }
}
