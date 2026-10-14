/**
 * The whole home page is one scroll journey. Each chapter owns a slice of the
 * master progress p ∈ [0, 1]. Tweak `span` to give a chapter more or less scroll.
 */
export type ChapterId = "hero" | "fracture" | "tunnel" | "projects" | "about" | "contact";

type ChapterDef = { id: ChapterId; span: number; path: string; title: string };

const defs: ChapterDef[] = [
  { id: "hero", span: 3.5, path: "/", title: "Home" },
  { id: "fracture", span: 5, path: "/", title: "Home" },
  { id: "tunnel", span: 2.5, path: "/", title: "Home" },
  { id: "projects", span: 9, path: "/projects", title: "Projects" },
  { id: "about", span: 13, path: "/about", title: "About" },
  { id: "contact", span: 4, path: "/contact", title: "Contact" },
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

/** Where the projects scene lives (far from the monolith; the tunnel hides the jump). */
export const PROJECTS_ORIGIN: [number, number, number] = [0, 0, -120];
/** About (ribbons + bloom) and contact (beam) scenes; dips to black hide the cuts. */
export const ABOUT_ORIGIN: [number, number, number] = [0, 0, -200];
export const CONTACT_ORIGIN: [number, number, number] = [0, 0, -280];
/** The investigation board (/board), off the journey entirely. */
export const BOARD_ORIGIN: [number, number, number] = [0, 0, -360];
/** The 3D flow pavilion (/flow), dedicated architectural space. */
export const FLOW_ORIGIN: [number, number, number] = [0, 0, -480];

/** Where in each chapter a deep link or menu jump lands (fraction of the chapter). */
const LANDING: Record<ChapterId, number> = { hero: 0, fracture: 0.1, tunnel: 0, projects: 0.4, about: 0.72, contact: 0.95 };

/** Master progress of a chapter's landing spot. */
export const landing = (id: ChapterId) => at(id, LANDING[id]);

/** Scroll position (px) of a chapter's landing spot on the journey track. */
export const landingY = (id: ChapterId) =>
  landing(id) * (document.documentElement.scrollHeight - window.innerHeight);

/** Master progress at fraction f of a chapter. */
export const at = (id: ChapterId, f: number) => {
  const c = chapter(id);
  return c.start + (c.end - c.start) * f;
};

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

/**
 * ScrollTrigger start/end (in px) for a chapter, computed from the same master
 * progress the WebGL scene uses — so DOM and 3D stay frame-locked.
 * `from`/`to` select a sub-range of the chapter (0..1).
 */
export const chapterScroll = (id: ChapterId, from = 0, to = 1) => {
  const c = chapter(id);
  const max = () => document.documentElement.scrollHeight - window.innerHeight;
  const at = (f: number) => () => (c.start + (c.end - c.start) * f) * max();
  return { start: at(from), end: at(to) };
};
