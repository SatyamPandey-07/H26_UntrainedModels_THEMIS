import { z } from "zod";

/** How a claim was established. Only Clio decides the final tag (see capsule gate). */
export const ProvenanceTag = z.enum(["OBSERVED", "EXECUTED", "AI-RECOMMENDED", "UNVERIFIED"]);
export type ProvenanceTag = z.infer<typeof ProvenanceTag>;

export const AgentName = z.enum(["hermes", "argus", "athena", "hephaestus", "minos", "clio"]);
export type AgentName = z.infer<typeof AgentName>;

export const AGENT_ROLES: Record<AgentName, string> = {
  hermes: "Orchestrator",
  argus: "Scout",
  athena: "Planner",
  hephaestus: "Migrator",
  minos: "Verifier",
  clio: "Capsule Writer",
};

export const Evidence = z.discriminatedUnion("kind", [
  /** A script read the repository or a registry API. */
  z.object({
    kind: z.literal("source"),
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
    url: z.string().optional(),
  }),
  /** A command ran; the log file is the proof. */
  z.object({
    kind: z.literal("command"),
    command: z.string(),
    exitCode: z.number().int(),
    logPath: z.string(),
  }),
  /** A model reasoned over the listed inputs. */
  z.object({
    kind: z.literal("model"),
    model: z.string(),
    inputs: z.array(z.string()),
  }),
  /** Nothing backs this claim. */
  z.object({
    kind: z.literal("none"),
    reason: z.string(),
  }),
]);
export type Evidence = z.infer<typeof Evidence>;

export const CapsuleSection = z.enum([
  "maintenance-problem",
  "dependency-details",
  "risk-indicators",
  "usage-locations",
  "ai-analysis",
  "proposed-changes",
  "suggested-tests",
  "executed-results",
  "gaps",
  "unresolved",
]);
export type CapsuleSection = z.infer<typeof CapsuleSection>;

export const Claim = z.object({
  id: z.string(),
  tag: ProvenanceTag,
  agent: AgentName,
  section: CapsuleSection,
  text: z.string(),
  evidence: Evidence,
});
export type Claim = z.infer<typeof Claim>;
