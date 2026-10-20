import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import LegoView from "@/lego/LegoView";
import "@/lego/brick.css";

/** Brick edition type: Archivo throughout, its width axis doing the box-art headings. */
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Brick Edition",
  description:
    "The portfolio rebuilt from bricks — the name, the work and the contact details are all brick-built, and every piece can be knocked down and rebuilt.",
};

export default function LegoPage() {
  return (
    <div className={archivo.variable}>
      <LegoView />
    </div>
  );
}
