import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ProjectDetail from "@/components/project/ProjectDetail";
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
    description: `${p.tagline} ${p.description[0]}`,
    openGraph: { title: p.title, description: p.tagline, images: [{ url: p.cover }] },
  };
}

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
  const n = projects.length;
  return (
    <ProjectDetail project={project} index={i} total={n} prev={projects[(i - 1 + n) % n]} next={projects[(i + 1) % n]} />
  );
}
