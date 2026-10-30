import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import HealthLanding from "@/components/landing/health/HealthLanding";
import LegalLanding from "@/components/landing/legal/LegalLanding";
import SchoolLanding from "@/components/landing/school/SchoolLanding";
import VyroLanding from "@/components/landing/vyro/VyroLanding";
import ProjectDetail from "@/components/project/ProjectDetail";
import { getProject, projects } from "@/content/site";

const LANDINGS: Record<string, typeof LegalLanding> = {
  "legal-workspace": LegalLanding,
  vyro: VyroLanding,
  "school-system": SchoolLanding,
  healthhub: HealthLanding,
};

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
  const prev = projects[(i - 1 + n) % n];
  const next = projects[(i + 1) % n];
  // some projects get a full product landing page of their own
  const Landing = LANDINGS[project.slug];
  if (Landing) return <Landing project={project} prev={prev} next={next} />;
  return (
    <ProjectDetail project={project} index={i} total={n} prev={prev} next={next} />
  );
}
