import type { AgentName, CapsuleSection, Claim } from "../schema/claim.js";
import type { CommandResult } from "./command.js";

/**
 * Builds provenance-tagged claims. Agents only ever create claims through these helpers,
 * so each tag is paired with the matching evidence kind.
 */
export class ClaimBook {
  private counter: number;
  readonly claims: Claim[] = [];

  /** `startAt` continues numbering after claims an earlier invocation of the same agent already made. */
  constructor(
    private readonly agent: AgentName,
    startAt = 0,
  ) {
    this.counter = startAt;
  }

  private push(claim: Omit<Claim, "id" | "agent">): Claim {
    this.counter += 1;
    const full: Claim = {
      id: `${this.agent}-${String(this.counter).padStart(3, "0")}`,
      agent: this.agent,
      ...claim,
    };
    this.claims.push(full);
    return full;
  }

  observed(
    section: CapsuleSection,
    text: string,
    source: { file?: string; line?: number; url?: string },
  ): Claim {
    return this.push({ tag: "OBSERVED", section, text, evidence: { kind: "source", ...source } });
  }

  executed(
    section: CapsuleSection,
    text: string,
    result: Pick<CommandResult, "command" | "exitCode" | "logPath">,
  ): Claim {
    return this.push({
      tag: "EXECUTED",
      section,
      text,
      evidence: {
        kind: "command",
        command: result.command,
        exitCode: result.exitCode,
        logPath: result.logPath,
      },
    });
  }

  recommended(section: CapsuleSection, text: string, model: string, inputs: string[]): Claim {
    return this.push({ tag: "AI-RECOMMENDED", section, text, evidence: { kind: "model", model, inputs } });
  }

  unverified(section: CapsuleSection, text: string, reason: string): Claim {
    return this.push({ tag: "UNVERIFIED", section, text, evidence: { kind: "none", reason } });
  }
}
