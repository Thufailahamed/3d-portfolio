/**
 * The whole home page is one scroll journey. Each chapter owns a slice of the
 * master progress p ∈ [0, 1]. Tweak `span` to give a chapter more or less scroll.
 */
export type ChapterId = "hero" | "fracture" | "tunnel" | "projects" | "about" | "contact";

type ChapterDef = { id: ChapterId; span: number; path: string; title: string };

const defs: ChapterDef[] = [
  { id: "hero", span: 2.5, path: "/", title: "Home" },
  { id: "fracture", span: 5, path: "/", title: "Home" },
  { id: "tunnel", span: 2, path: "/", title: "Home" },
  { id: "projects", span: 5, path: "/projects", title: "Projects" },
  { id: "about", span: 8, path: "/about", title: "About" },
  { id: "contact", span: 3, path: "/contact", title: "Contact" },
];

const total = defs.reduce((s, c) => s + c.span, 0);

export type Chapter = ChapterDef & { start: number; end: number };

let acc = 0;
export const chapters: Chapter[] = defs.map((c) => {
  const start = acc / total;
  acc += c.span;
  return { ...c, start, end: acc / total };
});

export const chapter = (id: ChapterId) => chapters.find((c) => c.id === id)!;

/** Number of viewport heights the journey track is tall (desktop / mobile). */
export const TRACK_VH = { desktop: total * 100, mobile: total * 62 };

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Local 0..1 progress of a chapter for master progress p. */
export const local = (p: number, id: ChapterId) => {
  const c = chapter(id);
  return clamp01((p - c.start) / (c.end - c.start));
};

/** True while p is inside the chapter (plus a little padding so transitions overlap). */
export const active = (p: number, id: ChapterId, pad = 0.02) => {
  const c = chapter(id);
  return p >= c.start - pad && p <= c.end + pad;
};

export const chapterAt = (p: number) =>
  chapters.find((c) => p >= c.start && p < c.end) ?? chapters[chapters.length - 1];
