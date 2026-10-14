import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import Reveal from "@/components/Reveal";
import { getProject, projects } from "@/content/site";

export function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: PageProps<"/projects/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const p = getProject(slug);
  if (!p) return {};
  return {
    title: p.title,
    description: `${p.tagline}. ${p.description[0]}`,
    openGraph: { title: p.title, description: p.tagline, images: [{ url: p.cover }] },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

// URL data (params) is read behind Suspense so the shared shell stays instant
export default function ProjectPage(props: PageProps<"/projects/[slug]">) {
  return (
    <Suspense fallback={null}>
      <ProjectBody params={props.params} />
    </Suspense>
  );
}

async function ProjectBody({ params }: { params: PageProps<"/projects/[slug]">["params"] }) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const i = projects.indexOf(project);
  const next = projects[(i + 1) % projects.length];

  return (
    <Reveal>
      <article className="mx-auto max-w-[1400px] px-gutter pb-24 pt-24 md:pt-28">
        <nav className="reveal mb-10 flex items-center justify-between" aria-label="Project navigation">
          <Link href="/projects" scroll={false} className="label !text-fg hover:text-accent" data-cursor="view">
            ← Close
          </Link>
          <span className="label">
            Project {pad(i + 1)} / {pad(projects.length)}
          </span>
        </nav>

        <header className="grid gap-8 md:grid-cols-12">
          <div className="md:col-span-8">
            <h1 className="reveal display text-[15vw] md:text-[8.5vw]">{project.title}</h1>
            <p className="reveal mt-4 max-w-[30ch] text-balance text-xl text-fg/80 md:text-2xl">
              {project.tagline} — {project.year}
            </p>
          </div>
          <dl className="reveal grid grid-cols-2 gap-x-6 gap-y-4 self-end md:col-span-4 md:grid-cols-1">
            <div>
              <dt className="label">Year</dt>
              <dd className="mt-1">{project.year}</dd>
            </div>
            <div>
              <dt className="label">Role</dt>
              <dd className="mt-1">{project.role}</dd>
            </div>
            <div className="col-span-2 md:col-span-1">
              <dt className="label">Stack</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {project.stack.map((s) => (
                  <span key={s} className="label rounded-full border border-fg/20 px-3 py-1 !text-fg">
                    {s}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </header>

        <figure className="reveal mt-14 overflow-hidden rounded-lg border border-fg/10">
          <Image
            src={project.cover}
            alt={`${project.title} — cover`}
            width={1600}
            height={1000}
            priority
            sizes="(min-width: 1400px) 1400px, 100vw"
            className="h-auto w-full"
          />
        </figure>

        <section className="mt-16 grid gap-10 md:grid-cols-12" aria-label="About the project">
          <h2 className="reveal label md:col-span-3">The project</h2>
          <div className="space-y-6 text-lg leading-relaxed text-fg/85 md:col-span-7 md:text-xl">
            {project.description.map((para, k) => (
              <p key={k} className="reveal">
                {para}
              </p>
            ))}
            {project.link && (
              <a
                href={project.link}
                target="_blank"
                rel="noreferrer"
                className="reveal label inline-block !text-fg underline decoration-accent underline-offset-[6px] hover:text-accent"
              >
                Visit live site ↗
              </a>
            )}
          </div>
        </section>

        <section className="mt-20 grid gap-4 md:grid-cols-2" aria-label="Gallery">
          {project.images.map((src, k) => (
            <figure
              key={src}
              className={`reveal overflow-hidden rounded-lg border border-fg/10 ${k === 2 ? "md:col-span-2" : ""}`}
            >
              <Image
                src={src}
                alt={`${project.title} — image ${k + 1}`}
                width={k === 1 ? 1200 : 1600}
                height={k === 1 ? 1500 : 1000}
                sizes="(min-width: 768px) 50vw, 100vw"
                className="h-full w-full object-cover"
              />
            </figure>
          ))}
        </section>

        <Link
          href={`/projects/${next.slug}`}
          className="reveal group mt-28 block border-t border-fg/15 pt-8"
          data-cursor="view"
        >
          <span className="label">Next project</span>
          <span className="display mt-3 block text-[13vw] transition-colors group-hover:text-accent md:text-[7vw]">
            {next.title} →
          </span>
        </Link>
      </article>
    </Reveal>
  );
}
