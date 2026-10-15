import type { Capsule } from "@themis/core";
import raw from "@/data/sample-capsule.json";

/** A real capsule from the WorkSphere demo (draft PR #8: svix 2.0.0 to 2.8.0). */
export const sampleCapsule = raw as unknown as Capsule;
export const SAMPLE_REPO_URL = "https://github.com/ayushsshukla/WorkSphere";
export const SAMPLE_PR_URL = "https://github.com/ayushsshukla/WorkSphere/pull/8";

export function tagCounts(capsule: Capsule) {
  const count = (t: string) => capsule.claims.filter((c) => c.tag === t).length;
  return {
    OBSERVED: count("OBSERVED"),
    EXECUTED: count("EXECUTED"),
    "AI-RECOMMENDED": count("AI-RECOMMENDED"),
    UNVERIFIED: count("UNVERIFIED"),
  };
}
