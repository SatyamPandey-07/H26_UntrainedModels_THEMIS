import type { ChatMessage, ChatTool, ShapedRequest } from "../llm/types.js";

export interface DataBlock {
  label: string;
  content: string;
}

export interface ContextInit {
  /** Full system prompt (agent role plus skills). */
  system: string;
  /** Reduced system prompt with the shared skills digested; used only when the budget demands it. */
  systemDigest?: string;
  task: string;
  blocks: DataBlock[];
  /** Wraps block content as untrusted data. */
  wrap: (label: string, content: string) => string;
  tools: ChatTool[];
}

const DEFAULT_CHARS_PER_TOKEN = 3.0;
/** What is left of an older tool result: which call it was, how large, and how it began. */
function omittedTool(call: { name: string; args: string } | undefined, content: string): string {
  const inner = content.replace(/^<untrusted_data[^>]*>\n?/, "");
  const first = (inner.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 80);
  let args = "";
  try {
    args = Object.entries(JSON.parse(call?.args ?? "{}") as Record<string, unknown>)
      .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
      .join(", ");
  } catch {
    // unparseable arguments: describe the call by name only
  }
  return `[${call?.name ?? "tool"}(${args}) result omitted to save tokens: ${content.length} characters${first ? `, began "${first}"` : ""}. You already saw it; call again only for a different part]`;
}

interface Rank {
  /** 0 = first to be trimmed, 2 = last. */
  rank: 0 | 1 | 2;
  /** Characters a block keeps even under pressure. */
  floor: number;
}

/**
 * Reference material and file lists go first; call sites and usage maps next; the concern, plan, dependency
 * and verifier feedback last. Unknown labels are treated as essential.
 */
export function blockRank(label: string): Rank {
  if (
    /(reference|test-shapes|existing-test-files|importing-files|route-files|modules-imported|candidate-import|fix-rules)/i.test(
      label,
    )
  )
    return { rank: 0, floor: 300 };
  if (/^(call-sites|usage|call-site-tags)/i.test(label)) return { rank: 1, floor: 700 };
  return { rank: 2, floor: 1500 };
}

interface Site {
  file: string;
  line: number;
  symbol?: string;
  snippet?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isPrimitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

/** Call sites grouped by file. Detail 0 keeps a short snippet, 1 drops it, 2 keeps only counts per file. */
function renderSites(sites: Site[], detail: 0 | 1 | 2): string {
  const byFile = new Map<string, Site[]>();
  for (const s of sites) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s]);
  const lines: string[] = ["call sites (file, then line symbol):"];
  for (const [file, list] of byFile) {
    if (detail === 0) {
      lines.push(`${file}:`);
      for (const s of list) {
        const snippet = s.snippet && s.snippet.length <= 100 ? `  \`${s.snippet}\`` : "";
        lines.push(`  ${s.line} ${s.symbol ?? ""}${snippet}`.trimEnd());
      }
    } else if (detail === 1) {
      lines.push(`${file}: ${list.map((s) => `${s.line} ${s.symbol ?? ""}`.trim()).join(", ")}`);
    } else {
      const first = list[0] as Site;
      lines.push(`${file}: ${list.length} site(s), first ${first.line} ${first.symbol ?? ""}`.trimEnd());
    }
  }
  return lines.join("\n");
}

/**
 * JSON in data blocks is re-serialised without indentation; call-site arrays are grouped by file and flat
 * arrays become one row per line. Text that is not JSON is returned unchanged.
 */
export function compactContent(content: string, siteDetail: 0 | 1 | 2 = 0): string {
  const t = content.trim();
  if (!/^[[{]/.test(t)) return content;
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch {
    return content;
  }
  if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) {
    const rows = value as Array<Record<string, unknown>>;
    if (rows.every((r) => typeof r.file === "string" && typeof r.line === "number"))
      return renderSites(rows as unknown as Site[], siteDetail);
    const keys = Object.keys(rows[0] as object);
    if (
      rows.length >= 4 &&
      rows.every(
        (r) =>
          Object.keys(r).length === keys.length &&
          keys.every((k) => k in r) &&
          Object.values(r).every(isPrimitive),
      )
    )
      return [keys.join("|"), ...rows.map((r) => keys.map((k) => String(r[k] ?? "")).join("|"))].join("\n");
  }
  return JSON.stringify(value);
}

/** Cuts text at a line boundary and says how much was left out. */
export function trimLines(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  const head = text.slice(0, cut > maxChars * 0.5 ? cut : maxChars);
  const omitted = text.slice(head.length).split("\n").length - 1;
  return `${head}\n[${omitted > 0 ? `${omitted} more line(s)` : "rest"} omitted to fit the token budget; use list_files, read_file or search_text to see more]`;
}

/** Shortens long string arguments of an already executed tool call (the content is on disk or in git). */
function stubArguments(args: string): string {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    let changed = false;
    for (const [k, v] of Object.entries(parsed))
      if (typeof v === "string" && v.length > 160) {
        parsed[k] = `${v.slice(0, 60)}…[${v.length} characters omitted]`;
        changed = true;
      }
    return changed ? JSON.stringify(parsed) : args;
  } catch {
    return args;
  }
}

/**
 * Builds the prompt view for each request. The full history stays with the caller; this class decides what of
 * it is sent. Reductions only start when the view is over budget and, once applied, stay applied, so the start
 * of the prompt is identical from one step to the next (which keeps provider-side prompt caching effective).
 */
export class ContextManager {
  private charsPerToken = DEFAULT_CHARS_PER_TOKEN;
  private readonly toolsChars: number;
  private readonly stubAssistant = new Set<number>();
  private readonly stubTool = new Set<number>();
  private readonly blockCap = new Map<string, number>();
  private siteDetail: 0 | 1 | 2 = 0;
  private digest = false;
  /** Multiplier on every block's floor; halved once as the last reduction before giving up. */
  private floorScale = 1;
  /** History messages before this index are collapsed into one note (always cut between whole exchanges). */
  private droppedUpTo = 2;
  private lastBudgetTokens = 6_000;

  constructor(private readonly init: ContextInit) {
    this.toolsChars = JSON.stringify(init.tools).length;
  }

  /** Learns the real characters-per-token ratio from the provider's prompt token count. */
  calibrate(promptTokens: number, sentChars: number): void {
    if (promptTokens <= 0 || sentChars <= 0) return;
    const ratio = Math.min(4.5, Math.max(1.8, sentChars / promptTokens));
    this.charsPerToken = (this.charsPerToken + ratio) / 2;
  }

  estimate(messages: ChatMessage[]): number {
    return Math.ceil((JSON.stringify(messages).length + this.toolsChars) / this.charsPerToken);
  }

  /** Largest tool result worth keeping for the current budget, in characters. */
  toolResultLimit(): number {
    return Math.max(1_500, Math.min(8_000, Math.floor(this.lastBudgetTokens * this.charsPerToken * 0.3)));
  }

  private renderBlock(b: DataBlock): string {
    const compact = compactContent(b.content, this.siteDetail);
    const cap = this.blockCap.get(b.label);
    return cap !== undefined && compact.length > cap ? trimLines(compact, cap) : compact;
  }

  private render(history: ChatMessage[]): ChatMessage[] {
    const { init } = this;
    const out: ChatMessage[] = [
      { role: "system", content: this.digest && init.systemDigest ? init.systemDigest : init.system },
      {
        role: "user",
        content: [init.task, ...init.blocks.map((b) => init.wrap(b.label, this.renderBlock(b)))].join("\n\n"),
      },
    ];
    if (this.droppedUpTo > 2) {
      const counts = new Map<string, number>();
      for (const m of history.slice(2, this.droppedUpTo))
        if (m.role === "assistant")
          for (const c of m.tool_calls ?? [])
            counts.set(c.function.name, (counts.get(c.function.name) ?? 0) + 1);
      const summary = [...counts].map(([name, n]) => `${name} x${n}`).join(", ");
      out.push({
        role: "user",
        content: `[Earlier steps were omitted to fit the token budget: ${summary || "tool calls"}. Files you wrote are saved; call read_file again if you need their current contents.]`,
      });
    }
    const callById = new Map<string, { name: string; args: string }>();
    for (const m of history)
      if (m.role === "assistant")
        for (const c of m.tool_calls ?? [])
          callById.set(c.id, { name: c.function.name, args: c.function.arguments });
    for (let i = Math.max(2, this.droppedUpTo); i < history.length; i++) {
      const m = history[i] as ChatMessage;
      if (m.role === "assistant" && this.stubAssistant.has(i) && m.tool_calls?.length) {
        out.push({
          ...m,
          tool_calls: m.tool_calls.map((c) => ({
            ...c,
            function: { ...c.function, arguments: stubArguments(c.function.arguments) },
          })),
        });
      } else if (m.role === "tool" && this.stubTool.has(i)) {
        out.push({ ...m, content: omittedTool(callById.get(m.tool_call_id), String(m.content)) });
      } else out.push(m);
    }
    return out;
  }

  /**
   * Stubs the long arguments of earlier tool calls. Every call in the history already has its result, so the
   * newest one can be stubbed too when `includeLatest` is set.
   */
  private stubAssistantArgs(history: ChatMessage[], includeLatest: boolean): boolean {
    const idx = history
      .map((m, i) => (m.role === "assistant" && m.tool_calls?.length ? i : -1))
      .filter((i) => i >= 2);
    let changed = false;
    for (const i of includeLatest ? idx : idx.slice(0, -1))
      if (!this.stubAssistant.has(i)) {
        this.stubAssistant.add(i);
        changed = true;
      }
    return changed;
  }

  private stubOldTools(history: ChatMessage[], keep: number): boolean {
    const idx = history.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 2);
    let changed = false;
    for (const i of keep > 0 ? idx.slice(0, -keep) : idx)
      if (!this.stubTool.has(i) && String((history[i] as { content: unknown }).content).length > 160) {
        this.stubTool.add(i);
        changed = true;
      }
    return changed;
  }

  private reduceSites(): boolean {
    if (this.siteDetail >= 2) return false;
    this.siteDetail = (this.siteDetail + 1) as 0 | 1 | 2;
    return true;
  }

  /** Halves the lowest-priority block whose content is still above its floor. */
  private trimBlocks(): boolean {
    const candidates = this.init.blocks
      .map((b) => {
        const size = this.blockCap.get(b.label) ?? compactContent(b.content, this.siteDetail).length;
        const rank = blockRank(b.label);
        return { b, rank: rank.rank, floor: Math.floor(rank.floor * this.floorScale), size };
      })
      .filter((c) => c.size > c.floor)
      .sort((a, c) => a.rank - c.rank || c.size - a.size);
    const pick = candidates[0];
    if (!pick) return false;
    this.blockCap.set(pick.b.label, Math.max(pick.floor, Math.floor(pick.size / 2)));
    return true;
  }

  private useDigest(): boolean {
    if (this.digest || !this.init.systemDigest) return false;
    this.digest = true;
    return true;
  }

  /** Collapses the oldest whole exchange (assistant call plus its results); the newest two are never dropped. */
  private dropOldestExchange(history: ChatMessage[]): boolean {
    const starts = history
      .map((m, i) => (m.role === "assistant" && m.tool_calls?.length ? i : -1))
      .filter((i) => i >= Math.max(2, this.droppedUpTo));
    if (starts.length <= 2) return false;
    this.droppedUpTo = starts[1] as number;
    return true;
  }

  private tightenFloors(): boolean {
    if (this.floorScale <= 0.5) return false;
    this.floorScale = 0.5;
    return true;
  }

  shape(history: ChatMessage[], budgetTokens: number, _level = 0): ShapedRequest {
    this.lastBudgetTokens = budgetTokens;
    let messages = this.render(history);
    let tokens = this.estimate(messages);
    const steps: Array<() => boolean> = [
      () => this.stubAssistantArgs(history, false),
      () => this.stubOldTools(history, 2),
      () => this.stubOldTools(history, 1),
      () => this.stubAssistantArgs(history, true),
      () => this.reduceSites(),
      () => this.trimBlocks(),
      () => this.useDigest(),
      () => this.tightenFloors(),
      () => this.dropOldestExchange(history),
    ];
    for (let guard = 0; tokens > budgetTokens && guard < 100; guard++) {
      if (!steps.some((step) => step())) break;
      messages = this.render(history);
      tokens = this.estimate(messages);
    }
    if (tokens > budgetTokens) {
      // Last resort: cut the newest tool result, which the model can fetch again with narrower arguments.
      const last = messages[messages.length - 1];
      if (last && last.role === "tool" && typeof last.content === "string") {
        const excess = Math.ceil((tokens - budgetTokens) * this.charsPerToken) + 200;
        const keep = Math.max(300, last.content.length - excess);
        messages = [...messages.slice(0, -1), { ...last, content: `${trimLines(last.content, keep)}` }];
        tokens = this.estimate(messages);
      }
    }
    const chars = JSON.stringify(messages).length + this.toolsChars;
    return { messages, tokens, chars, fits: tokens <= budgetTokens };
  }
}
