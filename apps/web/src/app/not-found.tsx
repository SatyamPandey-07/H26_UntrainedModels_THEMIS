import { Tiko } from "@/components/tiko";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="page-wash grid min-h-[100dvh] place-items-center px-4 text-center">
      <div className="flex flex-col items-center gap-4">
        <Tiko mood="think" size={120} />
        <h1 className="text-3xl font-bold tracking-tight">Tiko looked everywhere</h1>
        <p className="max-w-[44ch] text-ink-muted">
          This page does not exist, or the Themis App is not installed on that repository.
        </p>
        <div className="mt-2 flex gap-3">
          <ButtonLink href="/dashboard">Dashboard</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Home
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
