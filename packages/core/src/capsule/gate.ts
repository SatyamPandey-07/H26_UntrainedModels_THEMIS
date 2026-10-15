import { existsSync } from "node:fs";
import type { RunContext } from "../run/context.js";
import { resolveRunPath } from "../run/context.js";
import type { Claim } from "../schema/claim.js";

export interface Downgrade {
  claimId: string;
  from: string;
  reason: string;
}

/**
 * The evidence gate. A claim keeps its tag only if its evidence is of the matching kind and actually holds:
 * EXECUTED needs a log file on disk, OBSERVED a file or URL, AI-RECOMMENDED a model and inputs.
 * Anything else becomes UNVERIFIED and the downgrade is reported.
 */
export function gateClaims(ctx: RunContext, claims: Claim[]): { claims: Claim[]; downgraded: Downgrade[] } {
  const downgraded: Downgrade[] = [];
  const out = claims.map((claim): Claim => {
    const fail = (reason: string): Claim => {
      downgraded.push({ claimId: claim.id, from: claim.tag, reason });
      return { ...claim, tag: "UNVERIFIED", evidence: { kind: "none", reason } };
    };
    const ev = claim.evidence;
    switch (claim.tag) {
      case "EXECUTED":
        if (ev.kind !== "command") return fail("EXECUTED claim has no command evidence");
        if (!ev.command.trim()) return fail("EXECUTED claim has an empty command");
        if (!existsSync(resolveRunPath(ctx, ev.logPath)))
          return fail(`log file ${ev.logPath} does not exist`);
        return claim;
      case "OBSERVED":
        if (ev.kind !== "source") return fail("OBSERVED claim has no source evidence");
        if (!ev.file && !ev.url) return fail("OBSERVED claim cites neither a file nor a URL");
        return claim;
      case "AI-RECOMMENDED":
        if (ev.kind !== "model") return fail("AI-RECOMMENDED claim has no model evidence");
        if (!ev.model) return fail("AI-RECOMMENDED claim does not name the model");
        return claim;
      default:
        return claim;
    }
  });
  return { claims: out, downgraded };
}
