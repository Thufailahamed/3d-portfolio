"use client";

import katex from "katex";
import { useMemo } from "react";

const MACROS = {
  "\\ab": "\\bar\\alpha",
  "\\eps": "\\epsilon",
  "\\N": "\\mathcal{N}",
  "\\R": "\\mathbb{R}",
  "\\hz": "\\hat z_0",
  "\\he": "\\hat\\epsilon",
};

/** TeX, typeset by KaTeX */
export function M({ children, block }: { children: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(children, { displayMode: !!block, throwOnError: false, macros: { ...MACROS }, output: "htmlAndMathml" }), [children, block]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** a numbered display equation */
export function Eq({ n, children }: { n: number | string; children: string }) {
  return (
    <div className="dl-eq">
      <M block>{children}</M>
      <span>({n})</span>
    </div>
  );
}
