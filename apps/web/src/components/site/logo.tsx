import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-xl">
      <Image src="/logo.svg" alt="" width={34} height={34} priority />
      <span className="text-lg font-bold tracking-tight">Themis</span>
    </Link>
  );
}
