import type { Metadata } from "next";
import Journey from "@/components/Journey";
import { projects } from "@/content/site";

export const metadata: Metadata = {
  title: "Projects",
  description: `Selected work: ${projects.map((p) => p.title).join(", ")}.`,
};

export default function ProjectsPage() {
  return <Journey initial="projects" />;
}
