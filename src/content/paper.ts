/**
 * Copy for the paper edition (/lite) that site.ts doesn't already hold.
 * Every number here is lifted from the project entries in site.ts — keep them in step.
 */

/** Hero and finale captions: the front half reads first, the back half finishes the line. */
export const story = {
  open: { front: ["Every AI", "product"], back: ["has two", "minds…"] },
  pick: ["Most engineers", "pick a side."],
  hood: ["This one builds", "both."],
  close: { front: ["From", "data"], back: ["to", "decisions."] },
  finale: { front: ["Let's build"], back: ["something", "that learns."] },
};

/** The training floor: parts every live system is built from. `project` is a slug in site.ts. */
export const crates: { name: string; thin: string; desc: string; project: string; stat: string; legendary?: boolean }[] = [
  { name: "tenant", thin: "-isolation", desc: "Row-level security over 68 tables. Each school's data stays its own.", project: "school-system", stat: "252 policies", legendary: true },
  { name: "qr", thin: "-attendance", desc: "Dual-token QR, HMAC-signed and replay-guarded.", project: "school-system", stat: "90s rotation" },
  { name: "practice", thin: "-copilot", desc: "Gemini with pgvector RAG, grounded in the practice's own records.", project: "legal-workspace", stat: "40 AI features", legendary: true },
  { name: "doc", thin: "-intake", desc: "OCR, Bates numbering and redaction. Filings land as versioned records.", project: "legal-workspace", stat: "298 models" },
  { name: "route", thin: "-handlers", desc: "Typed API routes over a hard-isolated Prisma schema.", project: "legal-workspace", stat: "865 routes" },
  { name: "edge", thin: "-api", desc: "Hono on Cloudflare Workers. One API for the web and native clients.", project: "luxe", stat: "327 endpoints", legendary: true },
  { name: "ledger", thin: "-sql", desc: "SQL functions as the single source of truth for stock and payouts.", project: "luxe", stat: "205 functions" },
  { name: "payment", thin: "-rails", desc: "Six gateways, reconciled in real time.", project: "luxe", stat: "6 rails" },
  { name: "karat", thin: "-pricing", desc: "Live per-karat gold pricing across showroom, vault and workshop.", project: "goldos", stat: "24K live" },
  { name: "barcode", thin: "-stock", desc: "Every piece barcode-tracked on one ledger, three rooms.", project: "goldos", stat: "100% tracked" },
  { name: "unified", thin: "-cart", desc: "One cart across verified suppliers, priced against live LKR benchmarks.", project: "vyro", stat: "N → 1" },
  { name: "scan", thin: "-index", desc: "Paper to digital, readable in English, Sinhala and Tamil.", project: "healthhub", stat: "3.8s indexing" },
];

/** "Choose your objective": the four kinds of build, each tied to the live systems that prove it. */
export const missions: { name: string; desc: string; loadout: string[]; projects: string[] }[] = [
  {
    name: "AI copilots",
    desc: "Assistants grounded in your own records, not the open internet. Retrieval, document intake and features people use daily.",
    loadout: ["Gemini AI", "pgvector RAG", "OCR pipelines", "Structured output"],
    projects: ["legal-workspace", "luxe"],
  },
  {
    name: "Multi-tenant SaaS",
    desc: "One codebase, many organisations. Role-based portals, a single login, and isolation the database enforces on every release.",
    loadout: ["Next.js", "Supabase + RLS", "Prisma / Neon", "Zod Server Actions"],
    projects: ["school-system", "legal-workspace"],
  },
  {
    name: "Marketplaces",
    desc: "Storefronts, seller tooling and payment rails that reconcile, on the web and in native apps from one backend.",
    loadout: ["Next.js + Expo", "Hono / Workers", "Stripe + PayPal", "Real-time pricing"],
    projects: ["luxe", "vyro"],
  },
  {
    name: "ERPs & edge systems",
    desc: "Operations software for real businesses: ledgers that balance, stock you can count, and records that travel. All at the edge.",
    loadout: ["Cloudflare Workers", "Barcode inventory", "Multilingual", "Edge SQL"],
    projects: ["goldos", "healthhub", "vyro"],
  },
];

/** Headline numbers on the player card. */
export const stats = [
  { value: "06", label: "Systems live" },
  { value: "40", label: "AI features live" },
  { value: "252", label: "RLS policies" },
  { value: "327", label: "Edge endpoints" },
];

/** The chapter rail, in page order. */
export const chapters = [
  { id: "top", label: "Handshake" },
  { id: "two-minds", label: "Two minds" },
  { id: "work", label: "Inference row" },
  { id: "engine-room", label: "Training floor" },
  { id: "about", label: "The engineer" },
  { id: "missions", label: "Objectives" },
  { id: "contact", label: "Deploy" },
];

/** The ticker bands: what the work is made of. */
export const marquee = [
  "Agentic AI",
  "RAG copilots",
  "pgvector",
  "Multi-tenant SaaS",
  "Row-level security",
  "Edge APIs",
  "Gemini",
  "Cloudflare Workers",
  "Next.js + Expo",
  "Real-time ledgers",
];

/** How the work runs, from first call to production. */
export const process = [
  { title: "Frame", text: "Start from the decision the software has to make, not the screen it will live on." },
  { title: "Model", text: "Schema first. Tenants, permissions and records shaped so the data can't drift or leak." },
  { title: "Ground", text: "AI that answers from your own records, with citations, never from guesswork." },
  { title: "Ship", text: "Deploy to the edge, watch it in production, and keep improving on what people actually do." },
];

/** The phone hero has no room for devices, so it shows the exchange instead. */
export const exchange = {
  human: "Summarise this matter for the partner.",
  machine: "Done. Every line cites the firm's own files.",
};

/** The handshake hero. */
export const hero = {
  title: ["I build the", "handshake", "between people", "and AI."],
  intro:
    "Software end to end: the interface people trust, and the AI, data and edge systems doing the work behind it. Built from Colombo, running in production.",
  human: "Human — judgement, craft, trust",
  machine: "Machine — memory, scale, speed",
  after: ["Human craft.", "Machine scale."],
  afterNote: "One system · SynapX · Colombo",
};
