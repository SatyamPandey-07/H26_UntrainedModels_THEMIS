import { z } from "zod";

export const StageName = z.enum(["scout", "planner", "migrator", "verifier", "capsule"]);
export type StageName = z.infer<typeof StageName>;

export const StageStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export type StageStatus = z.infer<typeof StageStatus>;

export const RunMode = z.enum(["scan", "plan", "run"]);
export type RunMode = z.infer<typeof RunMode>;

export const RunState = z.object({
  runId: z.string(),
  mode: RunMode,
  repoPath: z.string(),
  repository: z.string(),
  dependency: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  attempt: z.number().int(),
  stages: z.record(
    StageName,
    z.object({
      status: StageStatus,
      output: z.string().optional(),
      error: z.string().optional(),
      startedAt: z.string().optional(),
      finishedAt: z.string().optional(),
    }),
  ),
  events: z.array(z.object({ at: z.string(), message: z.string() })),
});
export type RunState = z.infer<typeof RunState>;
