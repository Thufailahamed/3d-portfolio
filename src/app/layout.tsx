import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import GlobalCanvas from "@/components/GlobalCanvas";
import SmoothScroll from "@/components/SmoothScroll";
import { person } from "@/content/site";
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
        <SmoothScroll />
        <GlobalCanvas />
        <main id="main" className="relative z-10">
          {children}
        </main>
      </body>
    </html>
  );
}
