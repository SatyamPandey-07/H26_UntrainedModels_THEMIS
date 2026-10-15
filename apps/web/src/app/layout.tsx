import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "driver.js/dist/driver.css";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Themis: dependency upgrades you can trust", template: "%s · Themis" },
  description:
    "Themis ranks risky dependencies, migrates one on its own branch, verifies it against your default branch, and opens a draft pull request with an evidence report.",
};

// Applies a saved theme before paint so the page never flashes the wrong colours.
const themeScript = `try{var t=localStorage.getItem("themis-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-bg text-ink">{children}</body>
    </html>
  );
}
