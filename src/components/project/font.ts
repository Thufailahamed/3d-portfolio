import localFont from "next/font/local";

/** Overused Grotesk by RandomMaerks (SIL OFL 1.1, see src/fonts/OverusedGrotesk-OFL.txt) — the case study's face */
export const grotesk = localFont({
  src: [
    { path: "../../fonts/OverusedGrotesk-Book.otf", weight: "400", style: "normal" },
    { path: "../../fonts/OverusedGrotesk-Medium.otf", weight: "500", style: "normal" },
  ],
  variable: "--font-grotesk",
  display: "swap",
  fallback: ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
});
