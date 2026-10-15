import type { Metadata } from "next";
import { CapsuleViewer } from "@/components/capsule/capsule-viewer";
import { TikoGuide } from "@/components/tiko-guide";
import { SAMPLE_PR_URL, SAMPLE_REPO_URL, sampleCapsule } from "@/lib/sample";

export const metadata: Metadata = {
  title: "Sample capsule",
  description: "A real Dependency Exit Capsule from the WorkSphere demo: svix 2.0.0 to 2.8.0.",
};

export default function SampleCapsulePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 md:px-6">
      <p className="mb-6 max-w-[70ch] text-sm text-ink-muted">
        This is a real capsule Themis wrote for a fork of WorkSphere. Every statement below is tagged by how
        it was established, and the evidence links open the source on GitHub.
      </p>
      <CapsuleViewer
        capsule={sampleCapsule}
        repoUrl={SAMPLE_REPO_URL}
        prUrl={SAMPLE_PR_URL}
        jsonHref="/sample-capsule.json"
      />
      <TikoGuide
        id="sample-capsule"
        mood="wave"
        message="This is a capsule. Start with the verdict, then read the gaps: anything there was not proven by a test."
        tour={[
          {
            element: "main h1",
            title: "The change",
            body: "Which package moved, from which version to which.",
          },
          {
            element: "[data-tour=claims-filter]",
            title: "Filter by evidence",
            body: "Show only what was executed, observed, recommended by the model, or unverified.",
          },
        ]}
        tourLabel="Walk me through it"
      />
    </div>
  );
}
