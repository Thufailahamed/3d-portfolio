import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import Cursor from "@/components/Cursor";
import Curtain from "@/components/Curtain";
import ExperienceGate from "@/components/ExperienceGate";
import Header from "@/components/Header";
import SmoothScroll from "@/components/SmoothScroll";
import { person } from "@/content/site";
import Toast from "@/components/Toast";
import "./globals.css";

const display = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(person.siteUrl),
  title: { default: `${person.name} — ${person.role}`, template: `%s · ${person.name}` },
  description: person.intro,
  openGraph: { title: person.name, description: person.intro, type: "website" },
};

export const viewport: Viewport = { themeColor: "#0b0b0c" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <noscript>
          <style>{`.loader{display:none!important}`}</style>
        </noscript>
        <a href="#main" className="label fixed left-gutter top-3 z-[80] -translate-y-20 rounded-full bg-fg px-4 py-2 !text-bg focus:translate-y-0">
          Skip to content
        </a>
        <SmoothScroll />
        <ExperienceGate />
        <Header />
        <main id="main" className="relative z-10">
          {children}
        </main>
        <Curtain />
        <Toast />
        <Cursor />
        <div aria-hidden className="grain pointer-events-none fixed inset-0 z-[60]" />
      </body>
    </html>
  );
}
