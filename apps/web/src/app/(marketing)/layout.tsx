import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { getSession } from "@/lib/session";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession().catch(() => undefined);
  return (
    <div className="page-wash">
      <SiteNav signedIn={Boolean(session?.user)} />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
