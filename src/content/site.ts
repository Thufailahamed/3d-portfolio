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
  /** label on the live-site button */
  liveLabel?: string;
  /** hero facts strip on the detail page */
  facts?: { label: string; value: string }[];
  /** headline numbers for the detail page */
  metrics?: { value: string; label: string }[];
  /** what was hard, and the move that answered it */
  challenges?: { title: string; problem: string; move: string }[];
  /** the system, from the client down to the data */
  architecture?: { label: string; detail: string }[];
  /** how it was made, in order */
  timeline?: { phase: string; title: string; description: string }[];
  /** the result in one line, then what changed */
  verdict?: { title: string; statement: string };
  outcomes?: string[];
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
    { label: "Based in", value: "Colombo, Sri Lanka" },
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

/** The investigation board behind the About globe (click the globe to open it). */
export const board = {
  label: "The board",
  heading: "Every thread runs back to Colombo.",
  note: "Six systems, one desk. Pick a card to open its file.",
  /** Sketchfab "Investigation Board" by Mkky, CC BY 4.0 — the credit is required */
  credit: {
    label: "Board model by Mkky · CC BY 4.0",
    href: "https://sketchfab.com/3d-models/investigation-board-04eca574acd34c68b0aa6db00e77583e",
  },
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
      "Six portals — platform, admin, teacher, student, parent and library — live behind a single login, with QR-based attendance, exam marks, library circulation, payments and ticketing handled tenant by tenant.",
    ],
    facts: [
      { label: "My role", value: "Full-stack · Architecture" },
      { label: "Timeline", value: "10 weeks to live" },
      { label: "Portals", value: "6 role-based" },
      { label: "Isolation", value: "252 RLS policies" },
    ],
    metrics: [
      { value: "6", label: "Role-based portals" },
      { value: "252", label: "RLS isolation policies" },
      { value: "90s", label: "Rotating QR attendance tokens" },
    ],
    challenges: [
      {
        title: "No shared identity",
        problem: "Every tool had its own login and its own copy of the truth, so nothing reconciled and onboarding a school meant weeks of bespoke setup.",
        move: "Six role-specific portals behind one login, routed by RBAC claims carried in the session JWT.",
      },
      {
        title: "Tenant leakage risk",
        problem: "A shared database was a non-starter while student data could leak between schools — isolation had to be absolute.",
        move: "Every school is a tenant in one Supabase project; 252 row-level security policies make isolation a database guarantee.",
      },
      {
        title: "Attendance you can't fake",
        problem: "Paper registers and static QR codes are trivially shared, copied or replayed.",
        move: "Dual-token QR: printed ID cards plus 90-second rotating HMAC-signed tokens, with replay guard, scan cooldown and geofence.",
      },
    ],
    architecture: [
      { label: "Clients", detail: "Next.js web — six role portals under one login" },
      { label: "Edge", detail: "Server Actions with Zod-validated writes" },
      { label: "Identity", detail: "Supabase Auth — JWT with RBAC claims" },
      { label: "Data", detail: "PostgreSQL — 68 tables, 252 RLS policies per tenant" },
      { label: "Attendance", detail: "Dual-token QR — HMAC-signed, replay-guarded" },
    ],
    timeline: [
      { phase: "Discover", title: "Map the school", description: "Shadowed three institutions to trace where attendance, marks, billing and library data actually lived — and where tenant boundaries had to be absolute." },
      { phase: "Design", title: "One tenant model", description: "A shared schema where every school is a tenant and row-level security makes isolation a database guarantee, not an application promise." },
      { phase: "Build", title: "Six portals, one login", description: "Six role-specific portals behind a single login, with QR attendance, exams, library, payments and ticketing wired tenant by tenant." },
      { phase: "Ship", title: "Live in days, not weeks", description: "A rollout path that takes a new school live in days — real institutions running on a single, auditable codebase." },
    ],
    verdict: {
      title: "Adoption in 48 hours.",
      statement: "Teacher and staff onboarding went from weeks to two days, and per-school isolation is enforced by the database on every release.",
    },
    outcomes: [
      "Teacher and staff adoption collapsed from weeks to two days.",
      "Auditable per-tenant isolation — enforced at the database layer, not by application luck.",
      "Running real institutions in production, not demonstrations.",
    ],
    tint: "#c8ff3d",
    link: "https://lms-ays.vercel.app/",
    liveLabel: "View live platform",
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
      "298 Prisma models, 865 API route handlers and 40 AI features sit behind one multi-tenant login.",
    ],
    facts: [
      { label: "My role", value: "Full-stack · AI systems" },
      { label: "Timeline", value: "12 weeks to live" },
      { label: "Models", value: "298 Prisma" },
      { label: "AI features", value: "40 live" },
    ],
    metrics: [
      { value: "298", label: "Prisma data models" },
      { value: "865", label: "API route handlers" },
      { value: "40", label: "AI copilot features" },
    ],
    challenges: [
      {
        title: "Unstructured intake",
        problem: "Filings arrived with few conventions, metadata lived in associate memory, and compliance depended on someone remembering to check.",
        move: "Filings are OCR'd, Bates-numbered, redacted and versioned on arrival into structured, searchable records.",
      },
      {
        title: "Generic copilots hallucinate",
        problem: "A chat model that doesn't know the practice is worse than none — answers had to cite the firm's own records to be trusted.",
        move: "A 40-feature copilot grounded in the practice's matters and archives through pgvector retrieval. It cites its sources.",
      },
      {
        title: "Firm-by-firm isolation",
        problem: "Every firm on the platform needed hard separation from every other firm, verified on every single release.",
        move: "Hard multi-tenant isolation, with a CI audit script that blocks any tenant leak before a release ships.",
      },
    ],
    architecture: [
      { label: "Inbound", detail: "Filings arrive — OCR, Bates numbering, redaction" },
      { label: "Ingestion", detail: "Metadata extracted into versioned, structured records" },
      { label: "Copilot", detail: "Gemini + pgvector RAG grounded in practice records" },
      { label: "Workspace", detail: "Matters · compliance · real estate · billing" },
      { label: "Data", detail: "298 Prisma models with hard tenant isolation" },
    ],
    timeline: [
      { phase: "Discover", title: "Follow the filing", description: "Sat inside the intake workflow to watch filings arrive with no conventions and metadata living in associate memory." },
      { phase: "Design", title: "Documents that file themselves", description: "Extraction pipelines that OCR, Bates-number, redact and version filings on arrival into structured, searchable records." },
      { phase: "Build", title: "A copilot that knows the practice", description: "A copilot grounded in the practice's own matters and archived records via pgvector retrieval — every answer cites its source." },
      { phase: "Ship", title: "Isolation, enforced in CI", description: "Ten practice modules under one login, with a CI audit that blocks any tenant leak before a release ships." },
    ],
    verdict: {
      title: "Intake runs itself.",
      statement: "The copilot reads filings the way a sharp junior associate would; matter summaries cite the practice's own records, and nobody re-types a filing.",
    },
    outcomes: [
      "Document intake runs itself — zero manual data entry per filing.",
      "Lawyers trust the copilot's matter summaries because they cite the practice's own records.",
      "Ten practice modules live under one login and one data model.",
    ],
    tint: "#e8c27a",
    link: "https://legal-system-chi.vercel.app/",
    liveLabel: "View live workspace",
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
      "205 SQL functions, 327 edge endpoints, six payment gateways and an AI stylist all reconcile to a single source of truth.",
    ],
    facts: [
      { label: "My role", value: "Full-stack · Product owner" },
      { label: "Status", value: "Live · iterating" },
      { label: "Clients", value: "Web + native, one API" },
      { label: "Payment rails", value: "6, reconciled" },
    ],
    metrics: [
      { value: "205", label: "SQL functions" },
      { value: "327", label: "Edge endpoints" },
      { value: "6", label: "Payment gateways" },
    ],
    challenges: [
      {
        title: "Three-codebase drift",
        problem: "Marketplaces usually grow separate codebases per client and let financial reconciliation drift until the ledger stops agreeing.",
        move: "One edge backend — Hono on Cloudflare Workers — in front of 205 Supabase SQL functions, serving every client.",
      },
      {
        title: "Web and native in lockstep",
        problem: "Storefront and mobile app had to share inventory, payouts and loyalty without ever disagreeing.",
        move: "A Next.js storefront and an Expo app on the same API and the same ledger. Nothing to sync, nothing to drift.",
      },
      {
        title: "Payments at scale",
        problem: "Six gateways, nine roles and four loyalty tiers — all reconciling in real time.",
        move: "Stripe, PayPal, PayHere, Razorpay, Koko and wallet wired into one source of truth, with an AI stylist on top.",
      },
    ],
    architecture: [
      { label: "Clients", detail: "Next.js storefront + Expo mobile app" },
      { label: "Edge", detail: "Hono on Cloudflare Workers — 327 endpoints" },
      { label: "AI layer", detail: "Stylist chat · image search · size recommender" },
      { label: "Data", detail: "205 SQL functions — one source of truth" },
      { label: "Payments", detail: "Six rails, reconciled in real time" },
    ],
    timeline: [
      { phase: "Discover", title: "Break the pattern", description: "Set out to prove one backend can serve a storefront, seller and brand dashboards, an admin console and a native app." },
      { phase: "Design", title: "One ledger", description: "One source of truth on Supabase, so payments, payouts and loyalty points can never disagree across clients." },
      { phase: "Build", title: "Edge-first commerce", description: "Hono on Workers proxying 205 SQL functions, with the storefront and Expo app sharing every endpoint." },
      { phase: "Ship", title: "Live, and staying live", description: "Launched at synapstore.shop as a running demonstration of exactly how I build." },
    ],
    verdict: {
      title: "One backend, two clients.",
      statement: "Inventory, seller payouts and brand dashboards reconcile in real time across web and native. It simply runs.",
    },
    outcomes: [
      "Nine roles — customer, seller, brand, admin, delivery and more — on one codebase.",
      "Web and native share the same API and ledger; nothing drifts.",
      "Live at synapstore.shop as permanent proof of the craft.",
    ],
    tint: "#d18cff",
    link: "https://synapstore.shop/",
    liveLabel: "Visit synapstore.shop",
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
    facts: [
      { label: "My role", value: "Full-stack" },
      { label: "Status", value: "Live" },
      { label: "Market", value: "Sri Lankan jewellers" },
      { label: "Runs on", value: "Cloudflare Workers" },
    ],
    challenges: [
      {
        title: "Three rooms, three ledgers",
        problem: "Showroom, vault and workshop each keep their own records, and gold moves between them all day.",
        move: "One console where every piece is tracked across showroom, vault and workshop.",
      },
      {
        title: "Gold moves by the minute",
        problem: "Prices follow the market and the karat; a stale price list is money lost at the counter.",
        move: "Live per-karat pricing applied wherever a piece is priced.",
      },
      {
        title: "Stock that's hard to count",
        problem: "Small, high-value items are slow to count by hand and easy to misplace.",
        move: "Barcode-first stock, with books that always balance.",
      },
    ],
    verdict: {
      title: "Books that always balance.",
      statement: "Showroom, vault and workshop on one console, priced live by karat.",
    },
    tint: "#ffb347",
    link: "https://goldos-web.thufailahamed627.workers.dev",
    liveLabel: "Open GoldOS",
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
    facts: [
      { label: "My role", value: "Full-stack" },
      { label: "Status", value: "Live" },
      { label: "Market", value: "Sri Lankan wholesale" },
      { label: "Runs on", value: "Cloudflare Pages" },
    ],
    challenges: [
      {
        title: "Too many middlemen",
        problem: "Wholesale buyers rarely reach the mill or the importer; every hop adds cost.",
        move: "Buyers source direct from verified mills, importers and distributors.",
      },
      {
        title: "Prices that won't sit still",
        problem: "Wholesale prices change constantly, and quotes go stale.",
        move: "Real-time prices in LKR, always current.",
      },
      {
        title: "Orders split across suppliers",
        problem: "One shopping list usually means several suppliers and several deliveries.",
        move: "Multi-supplier carts with delivery tracking.",
      },
    ],
    verdict: {
      title: "Straight to the source.",
      statement: "Verified suppliers, live LKR prices and one cart across all of them.",
    },
    tint: "#7aa8ff",
    link: "https://vyro-web.pages.dev",
    liveLabel: "Open VYRO",
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
    facts: [
      { label: "My role", value: "Full-stack" },
      { label: "Status", value: "Private beta" },
      { label: "Languages", value: "English · Sinhala · Tamil" },
      { label: "Runs on", value: "Cloudflare Workers" },
    ],
    challenges: [
      {
        title: "Records in a dozen places",
        problem: "Prescriptions, scans and lab results end up in drawers, phones and different clinics.",
        move: "Every prescription, scan and result in one personal record.",
      },
      {
        title: "Hard to read, hard to share",
        problem: "Medical paperwork is dense, and the next doctor rarely sees the full history.",
        move: "A readable, doctor-ready record the patient controls.",
      },
      {
        title: "One language isn't enough",
        problem: "Patients and families across Sri Lanka read in different languages.",
        move: "The whole record in English, Sinhala and Tamil.",
      },
    ],
    verdict: {
      title: "Your health, in one place.",
      statement: "Private, readable and ready for the next doctor — in three languages.",
    },
    tint: "#6ff0c8",
    link: "https://healthcare-web.thufailahamed627.workers.dev",
    liveLabel: "Open HealthHub",
    ...cover("healthhub"),
  },
];

export const getProject = (slug: string) => projects.find((p) => p.slug === slug);
