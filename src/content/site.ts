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
  category: string;
  role: string;
  stack: string[];
  /** paragraphs for the detail page */
  description: string[];
  /** prism / backdrop tint for this project */
  tint: string;
  link?: string;
  /** cover + optional gallery, relative to /public */
  cover: string;
  images: string[];
  /** headline numbers for the detail page */
  metrics?: { value: string; label: string }[];
  /** how it was built, one line each */
  highlights?: string[];
};

export const person = {
  name: "Thufail Ahamed",
  shortName: "THUFAIL AHAMED",
  role: "Founder & engineer, SynapX",
  location: "Colombo, Sri Lanka",
  email: "thufailahamed627@gmail.com",
  available: true,
  intro:
    "I design and build software end to end — multi-tenant SaaS, AI copilots, marketplaces and ERPs — and run SynapX, an engineering studio in Colombo. From the database schema to the last pixel, so what gets planned is what ships.",
  socials: [
    { label: "LinkedIn", href: "https://www.linkedin.com/company/synapx" },
    { label: "Instagram", href: "https://www.instagram.com/synapx.ai" },
  ],
  /** set NEXT_PUBLIC_SITE_URL to the deployed address (used for canonical / Open Graph URLs) */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};

/** Text beats revealed along the journey, keyed by chapter. */
export const beats = {
  hero: ["Every system starts as a rule."],
  fracture: [
    "Break it apart,",
    "and the rule is still there —",
    "in every piece.",
  ],
  about: [
    "I build systems that hold their shape under load.",
    "Schemas, edges, a little intelligence…",
    "…until the software disappears into the work.",
    "And then it grows.",
  ],
};

export const about = {
  headline: "From schema to screen",
  body: [
    "I'm Thufail Ahamed, founder of SynapX — an engineering studio in Colombo building software, agentic AI, IoT and cloud systems.",
    "I work end to end: data models and row-level security, edge APIs, AI copilots grounded in real records, and the interfaces people use every day. Six of those systems are live above.",
  ],
  annotations: [
    { label: "Studio", value: "SynapX" },
    { label: "Focus", value: "SaaS · AI · Cloud" },
    { label: "Stack", value: "Next.js · Supabase · Workers" },
  ],
  services: ["Software engineering", "Agentic AI", "IoT", "Cloud solutions"],
  /** cities marked on the About globe, each labelled with its live local time */
  places: [
    { city: "Colombo", tz: "Asia/Colombo", lat: 6.93, lon: 79.85 },
    { city: "New York", tz: "America/New_York", lat: 40.71, lon: -74.01 },
    { city: "Los Angeles", tz: "America/Los_Angeles", lat: 34.05, lon: -118.24 },
    { city: "São Paulo", tz: "America/Sao_Paulo", lat: -23.55, lon: -46.63 },
    { city: "London", tz: "Europe/London", lat: 51.51, lon: -0.13 },
    { city: "Dubai", tz: "Asia/Dubai", lat: 25.2, lon: 55.27 },
    { city: "Tokyo", tz: "Asia/Tokyo", lat: 35.68, lon: 139.69 },
    { city: "Sydney", tz: "Australia/Sydney", lat: -33.87, lon: 151.21 },
  ],
};

export const contact = {
  label: "Reach out",
  heading: "Let's build something that runs.",
  note: "Taking on new builds through SynapX — SaaS platforms, AI copilots, marketplaces and ERPs.",
  footer: "Built with three.js, GSAP and Blender.",
  year: 2026,
};

const cover = (slug: string) => ({ cover: `/projects/${slug}/cover.webp`, images: [] as string[] });

export const projects: Project[] = [
  {
    slug: "school-system",
    title: "School System",
    year: 2026,
    tagline: "One login, six portals, and hundreds of schools trusting a single codebase.",
    category: "Education · Multi-tenant SaaS",
    role: "Full-stack · Architecture",
    stack: ["Next.js", "Supabase + RLS", "Zod Server Actions", "QR Attendance"],
    description: [
      "A school management platform serving multiple institutions from one codebase, with strict per-school data isolation enforced by 252 row-level security policies across 68 database tables.",
      "Six portals — platform, admin, teacher, student, parent and library — live behind a single login, with QR-based attendance, exam marks, library circulation, payments and ticketing handled tenant by tenant. Teacher onboarding went from weeks to 48 hours.",
    ],
    metrics: [
      { value: "6", label: "Role-based portals" },
      { value: "252", label: "RLS isolation policies" },
      { value: "90s", label: "Rotating QR attendance tokens" },
    ],
    highlights: [
      "Every school is a tenant in one Supabase project; isolation is a database guarantee, not an application promise.",
      "RBAC claims ride in the session JWT and route each user to their portal.",
      "Dual-token QR attendance: printed ID cards plus 90-second rotating, HMAC-signed tokens with replay and geofence guards.",
      "A rollout path that takes a new school live in days, not weeks.",
    ],
    tint: "#c8ff3d",
    link: "https://lms-ays.vercel.app/",
    ...cover("school-system"),
  },
  {
    slug: "legal-workspace",
    title: "Legal Workspace",
    year: 2026,
    tagline: "Where documents file themselves and the copilot knows the practice.",
    category: "Legal tech · AI copilot",
    role: "Full-stack · AI systems",
    stack: ["Next.js", "Prisma / Neon", "Gemini AI + RAG", "Multi-tenant"],
    description: [
      "An enterprise workspace for a legal practice: document intelligence that pulls structured metadata out of filings, an AI copilot grounded in the practice's own workflows through vector retrieval, and dedicated modules for matters, compliance, real estate and billing.",
      "298 Prisma models, 865 API route handlers and 40 AI features sit behind one multi-tenant login. Document intake now runs itself — zero manual data entry per filing.",
    ],
    metrics: [
      { value: "298", label: "Prisma data models" },
      { value: "865", label: "API route handlers" },
      { value: "40", label: "AI copilot features" },
    ],
    highlights: [
      "Filings are OCR'd, Bates-numbered, redacted and versioned on arrival.",
      "A copilot grounded in the practice's own matters via pgvector retrieval — it cites its sources.",
      "Ten practice modules under one login and one data model.",
      "A CI audit script blocks any tenant leak before a release ships.",
    ],
    tint: "#e8c27a",
    link: "https://legal-system-chi.vercel.app/",
    ...cover("legal-workspace"),
  },
  {
    slug: "luxe",
    title: "LUXE",
    year: 2026,
    tagline: "A fashion marketplace: one backend, two clients, a ledger that never drifts.",
    category: "E-commerce · Marketplace",
    role: "Full-stack · Product owner",
    stack: ["Next.js + Expo", "Hono / Workers", "Supabase RPCs", "Stripe + PayPal"],
    description: [
      "A fashion marketplace built the way I'd want every project run: one Hono backend on Cloudflare Workers serving a Next.js storefront, an Expo mobile app, and dashboards for sellers, brands and platform admins.",
      "205 SQL functions, 327 edge endpoints, six payment gateways and an AI stylist all reconcile to a single source of truth. It runs live at synapstore.shop.",
    ],
    metrics: [
      { value: "205", label: "SQL functions" },
      { value: "327", label: "Edge endpoints" },
      { value: "6", label: "Payment gateways" },
    ],
    highlights: [
      "A thin Hono orchestration layer on Workers in front of Supabase functions, for very low latency.",
      "Web storefront and native app share one API and one ledger.",
      "AI stylist chat, natural-language and image search, outfit generator and size recommender.",
      "Stripe, PayPal, PayHere, Razorpay, Koko and wallet, plus four loyalty tiers, on one source of truth.",
    ],
    tint: "#d18cff",
    link: "https://synapstore.shop/",
    ...cover("luxe"),
  },
  {
    slug: "goldos",
    title: "GoldOS",
    year: 2026,
    tagline: "One console for showroom, vault and workshop — books that always balance.",
    category: "Jewellery ERP · Sri Lanka",
    role: "Full-stack",
    stack: ["Cloudflare Workers", "ERP", "Barcode inventory"],
    description: [
      "An ERP for jewellers in Sri Lanka: one console for the showroom, the vault and the workshop.",
      "Live per-karat pricing, barcode-first stock and books that always balance.",
    ],
    tint: "#ffb347",
    link: "https://goldos-web.thufailahamed627.workers.dev",
    ...cover("goldos"),
  },
  {
    slug: "vyro",
    title: "VYRO",
    year: 2026,
    tagline: "B2B wholesale, sourced direct from verified mills, importers and distributors.",
    category: "B2B wholesale · Marketplace",
    role: "Full-stack",
    stack: ["Cloudflare Pages", "Marketplace", "Real-time pricing"],
    description: [
      "A B2B wholesale marketplace: buyers source direct from verified mills, importers and distributors.",
      "Real-time LKR prices, multi-supplier carts and delivery tracking.",
    ],
    tint: "#7aa8ff",
    link: "https://vyro-web.pages.dev",
    ...cover("vyro"),
  },
  {
    slug: "healthhub",
    title: "HealthHub",
    year: 2026,
    tagline: "Every prescription, scan and result in one place — private and doctor-ready.",
    category: "HealthTech · Private beta",
    role: "Full-stack",
    stack: ["Cloudflare Workers", "Health records", "Multilingual"],
    description: [
      "A personal health record: every prescription, scan and result in one place.",
      "Private, readable and doctor-ready — in English, Sinhala and Tamil. Currently in private beta.",
    ],
    tint: "#6ff0c8",
    link: "https://healthcare-web.thufailahamed627.workers.dev",
    ...cover("healthhub"),
  },
];

export const getProject = (slug: string) => projects.find((p) => p.slug === slug);
