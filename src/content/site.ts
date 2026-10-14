/**
 * All editable site content lives here.
 * Swap the placeholder persona / projects for your own — components read only from this file.
 */

export type Project = {
  slug: string;
  title: string;
  year: number;
  /** one-liner shown in the carousel */
  tagline: string;
  role: string;
  stack: string[];
  /** paragraphs for the detail page */
  description: string[];
  /** prism / backdrop tint for this project */
  tint: string;
  link?: string;
  /** cover + gallery, relative to /public */
  cover: string;
  images: string[];
};

export const person = {
  name: "Ari Vale",
  shortName: "ARI VALE",
  role: "Creative developer & designer",
  location: "Based somewhere on Earth",
  email: "hello@arivale.dev",
  available: true,
  intro:
    "I design and build immersive websites and interactive pieces for studios and brands. Concept, motion, shaders, code — one hand on the whole process, so what gets imagined is what ships.",
  socials: [
    { label: "GitHub", href: "https://github.com/" },
    { label: "X", href: "https://x.com/" },
    { label: "LinkedIn", href: "https://www.linkedin.com/" },
  ],
  siteUrl: "https://arivale.dev",
};

/** Text beats revealed along the journey, keyed by chapter. */
export const beats = {
  hero: ["Every object starts as a rule."],
  fracture: [
    "Break it apart,",
    "and the rule is still there —",
    "in every piece.",
  ],
  about: [
    "I write systems that behave like materials.",
    "Light, motion, a little noise…",
    "…until code stops looking like code.",
    "And then it blooms.",
  ],
};

export const about = {
  headline: "I shape signal into form",
  body: [
    "For eight years I've worked between design and engineering — art-directing WebGL scenes, writing the shaders, and shipping the production code that carries them.",
    "I care about the feeling a page leaves behind: how weight, timing and light make an interface feel physical.",
  ],
  annotations: [
    { label: "Freelance", value: "Open for Q1" },
    { label: "Focus", value: "WebGL · Motion · Product" },
    { label: "Tools", value: "Three.js · GLSL · GSAP" },
  ],
  services: ["Creative development", "WebGL & shaders", "Motion design", "Design engineering"],
};

const img = (slug: string) => ({
  cover: `/projects/${slug}/cover.webp`,
  images: [`/projects/${slug}/1.webp`, `/projects/${slug}/2.webp`, `/projects/${slug}/3.webp`],
});

export const projects: Project[] = [
  {
    slug: "halcyon",
    title: "Halcyon",
    year: 2026,
    tagline: "A weather-driven generative identity",
    role: "Design engineer",
    stack: ["Three.js", "GLSL", "Next.js"],
    description: [
      "Halcyon is a brand system that never renders the same way twice: live weather data drives a field of fluid noise that becomes the logo, the posters and the website background.",
      "I built the generator, the export pipeline for print, and the realtime web version that runs at 60fps on phones.",
    ],
    tint: "#c8ff3d",
    link: "https://example.com",
    ...img("halcyon"),
  },
  {
    slug: "atlas-of-sound",
    title: "Atlas of Sound",
    year: 2025,
    tagline: "Mapping a city by what it sounds like",
    role: "Creative developer",
    stack: ["WebAudio", "React Three Fiber", "GSAP"],
    description: [
      "An interactive map where 1,200 field recordings become a terrain you can fly through. Loudness lifts the ground, pitch colours it.",
      "I wrote the audio analysis, the GPU terrain and the scroll-driven guided tour.",
    ],
    tint: "#7aa8ff",
    link: "https://example.com",
    ...img("atlas-of-sound"),
  },
  {
    slug: "parallel",
    title: "Parallel",
    year: 2025,
    tagline: "A studio site built from one fold",
    role: "Design & development",
    stack: ["Next.js", "WebGL", "GSAP"],
    description: [
      "Parallel's identity is a single folded plane. The site unfolds it section by section, each transition a new crease in the same sheet.",
      "Concept, art direction and every line of front-end code.",
    ],
    tint: "#ff7a59",
    link: "https://example.com",
    ...img("parallel"),
  },
  {
    slug: "kiln",
    title: "Kiln",
    year: 2024,
    tagline: "Configurator for hand-thrown ceramics",
    role: "Design engineer",
    stack: ["Three.js", "Zustand", "TypeScript"],
    description: [
      "A realtime 3D configurator for a ceramics studio: glaze, form and firing are simulated so customers see the piece they'll receive.",
      "I built the procedural glaze shader and a lathe-based modelling tool for the potters.",
    ],
    tint: "#e8c27a",
    link: "https://example.com",
    ...img("kiln"),
  },
  {
    slug: "northbound",
    title: "Northbound",
    year: 2024,
    tagline: "Editorial scrollytelling for an expedition",
    role: "Creative developer",
    stack: ["GSAP", "Mapbox", "Astro"],
    description: [
      "A long-form story following a 900 km ski crossing. Scroll drives a 3D route, weather overlays and pinned photo essays.",
      "I designed the motion system and rebuilt every sequence for mobile instead of scaling it down.",
    ],
    tint: "#9ff0ff",
    link: "https://example.com",
    ...img("northbound"),
  },
  {
    slug: "glasshouse",
    title: "Glasshouse",
    year: 2023,
    tagline: "A greenhouse that grows from your commits",
    role: "Solo project",
    stack: ["WebGPU", "L-systems", "Vite"],
    description: [
      "An experiment that turns a GitHub history into a garden: every commit grows a branch, every merge a flower.",
      "Procedural L-system plants rendered with instancing — 40,000 leaves in a single draw call.",
    ],
    tint: "#d18cff",
    link: "https://example.com",
    ...img("glasshouse"),
  },
];

export const getProject = (slug: string) => projects.find((p) => p.slug === slug);
