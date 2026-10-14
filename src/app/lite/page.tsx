import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import CopyEmail from "@/components/CopyEmail";
import FullExperienceLink from "@/components/FullExperienceLink";
import Reveal from "@/components/Reveal";
import { about, beats, contact, person, projects } from "@/content/site";

export const metadata: Metadata = {
  title: "Lite",
  description: `${person.intro} A fast, motion-light version of the site.`,
  alternates: { canonical: "/lite" },
};

/** The whole site without WebGL: same content, editorial layout. */
export default function LitePage() {
  return (
    <Reveal>
      <div className="px-gutter pb-10 pt-28 md:pt-36">
        <section aria-labelledby="lite-title" className="border-b border-fg/10 pb-16 md:pb-24">
          <p className="label mb-4">
            <span className="text-accent">●</span> {person.location} — Lite version
          </p>
          <h1 id="lite-title" className="display text-[19vw] md:text-[11.5vw]">
            {person.shortName}
          </h1>
          <p className="display mt-1 text-[7.2vw] text-fg/80 md:text-[4.1vw]">{person.role}</p>
          <p className="reveal mt-10 max-w-[52ch] text-lg leading-relaxed text-fg/75 md:text-xl">{person.intro}</p>
          <FullExperienceLink className="reveal label mt-8 inline-block !text-fg underline decoration-accent underline-offset-[6px] hover:!text-accent" />
        </section>

        <section aria-label="Manifesto" className="border-b border-fg/10 py-16 md:py-24">
          {[...beats.hero, beats.fracture.join(" "), ...beats.about].map((b, i) => (
            <p key={i} className="reveal max-w-[28ch] font-display text-3xl font-medium leading-tight tracking-[-0.03em] md:text-5xl">
              {b}
            </p>
          ))}
        </section>

        <section id="work" aria-labelledby="work-title" className="scroll-mt-24 border-b border-fg/10 py-16 md:py-24">
          <div className="mb-10 flex items-end justify-between">
            <h2 id="work-title" className="display text-[12vw] md:text-[6vw]">
              Selected work
            </h2>
            <p className="label">{String(projects.length).padStart(2, "0")} projects</p>
          </div>
          <ol className="grid gap-x-6 gap-y-14 md:grid-cols-2">
            {projects.map((p, i) => (
              <li key={p.slug} className="reveal">
                <Link href={`/projects/${p.slug}`} className="group block">
                  <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-fg/5">
                    <Image
                      src={p.cover}
                      alt={`${p.title} — cover`}
                      fill
                      sizes="(min-width: 768px) 50vw, 100vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="mt-4 flex items-baseline justify-between gap-4">
                    <h3 className="display text-4xl transition-colors group-hover:text-accent md:text-5xl">{p.title}</h3>
                    <span className="label">
                      {String(i + 1).padStart(2, "0")} · {p.year}
                    </span>
                  </div>
                  <p className="mt-2 text-fg/70">{p.tagline}</p>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section id="about" aria-labelledby="about-lite-title" className="scroll-mt-24 grid gap-10 border-b border-fg/10 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="label mb-4">About</p>
            <h2 id="about-lite-title" className="display text-[12vw] md:text-[5.4vw]">
              {about.headline}
            </h2>
          </div>
          <div className="space-y-5 text-lg leading-relaxed text-fg/75">
            {about.body.map((b, i) => (
              <p key={i} className="reveal">
                {b}
              </p>
            ))}
            <dl className="reveal grid grid-cols-1 gap-2 pt-4 sm:grid-cols-3">
              {about.annotations.map((n) => (
                <div key={n.label} className="hud-card">
                  <dt>{n.label}</dt>
                  <dd className="mt-1 text-xs tracking-normal text-fg normal-case">{n.value}</dd>
                </div>
              ))}
            </dl>
            <ul className="reveal flex flex-wrap gap-2" aria-label="Services">
              {about.services.map((s) => (
                <li key={s} className="label rounded-full border border-fg/15 px-3 py-1.5 !text-fg/80">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="contact" aria-labelledby="contact-lite-title" className="scroll-mt-24 py-16 md:py-24">
          <p className="label mb-4">
            <span className="text-accent">●</span> {contact.label}
          </p>
          <h2 id="contact-lite-title" className="display max-w-[16ch] text-[11.5vw] md:text-[5.6vw]">
            {contact.heading}
          </h2>
          <CopyEmail className="mt-8 font-display text-[6.4vw] font-medium tracking-[-0.03em] md:text-[2.6vw]" />
          <p className="mt-3 max-w-[44ch] text-fg/60">{contact.note}</p>
        </section>

        <footer className="flex flex-col gap-3 border-t border-fg/10 pt-4 md:flex-row md:justify-between">
          <ul className="flex gap-5" aria-label="Elsewhere">
            {person.socials.map((s) => (
              <li key={s.label}>
                <a href={s.href} target="_blank" rel="noreferrer" className="label !text-fg hover:!text-accent">
                  {s.label} ↗
                </a>
              </li>
            ))}
          </ul>
          <p className="label">
            © {contact.year} {person.name} · {contact.footer}
          </p>
        </footer>
      </div>
    </Reveal>
  );
}
