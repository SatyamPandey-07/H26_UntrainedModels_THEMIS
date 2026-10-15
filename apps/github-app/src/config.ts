import type { Octokit } from "@octokit/rest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** Optional `.github/themis.yml` in a target repository. Every field has a default; the file is never required. */
export const RepoConfig = z.object({
  /**
   * Automatically migrate the top candidate after a scan. Off by default: Themis proposes, people decide.
   */
  autoMigrate: z.boolean().default(false),
  /** Proposal issues opened after a scan, one per migration candidate. */
  proposals: z.number().int().min(0).max(10).default(5),
  /** Minimum days between automatic migrations. */
  autoMigrateIntervalDays: z.number().int().min(1).max(365).default(7),
  /** Dependencies Themis must never propose. */
  ignore: z.array(z.string()).default([]),
  /** Open Themis pull requests allowed at once. */
  maxOpenPrs: z.number().int().min(1).max(10).default(3),
});
export type RepoConfig = z.infer<typeof RepoConfig>;

export const CONFIG_PATH = ".github/themis.yml";

/** Reads the repo's config; a missing or invalid file yields the defaults plus a warning. */
export async function readRepoConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ config: RepoConfig; warning?: string }> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: CONFIG_PATH });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data))
      return { config: RepoConfig.parse({}) };
    const parsed = RepoConfig.safeParse(
      parseYaml(Buffer.from(data.content, "base64").toString("utf8")) ?? {},
    );
    if (parsed.success) return { config: parsed.data };
    return {
      config: RepoConfig.parse({}),
      warning: `${CONFIG_PATH} is invalid and was ignored: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  } catch {
    return { config: RepoConfig.parse({}) };
  }
}
