import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/app/onboarding-flow";
import { getRepos } from "@/lib/data";
import { installUrl } from "@/lib/github";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Get started" };

export default async function Onboarding() {
  const { user, token } = await requireUser("/onboarding");
  const repos = await getRepos(token).catch(() => []);
  return (
    <div className="py-4 md:py-10">
      <OnboardingFlow
        installUrl={installUrl("/onboarding")}
        login={user.login}
        repos={repos.map((r) => ({ fullName: r.fullName, private: r.private }))}
      />
    </div>
  );
}
