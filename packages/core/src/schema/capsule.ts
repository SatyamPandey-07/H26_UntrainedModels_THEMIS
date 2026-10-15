import { z } from "zod";
import { Claim } from "./claim.js";

export const Verdict = z.enum(["Migrated and verified", "Migrated, gaps remain", "Not recommended"]);
export type Verdict = z.infer<typeof Verdict>;

export const Capsule = z.object({
  schemaVersion: z.literal("1"),
  runId: z.string(),
  generatedAt: z.string(),
  repository: z.string(),
  dependency: z.object({
    name: z.string(),
    from: z.string(),
    to: z.string().optional(),
    strategy: z.string().optional(),
  }),
  verdict: Verdict,
  confidence: z.enum(["low", "medium", "high"]),
  branch: z.string().optional(),
  filesChanged: z.array(z.string()),
  summary: z.object({
    callSites: z.number().int(),
    callSitesCovered: z.number().int(),
    newTestFailures: z.number().int(),
    lintDelta: z.number().int(),
    newSecurityFindings: z.number().int(),
    probeMismatches: z.number().int(),
  }),
  claims: z.array(Claim),
  /** Claims Clio downgraded because their evidence did not hold up. */
  downgraded: z.array(z.object({ claimId: z.string(), from: z.string(), reason: z.string() })),
  toolVersions: z.record(z.string(), z.string()),
});
export type Capsule = z.infer<typeof Capsule>;
