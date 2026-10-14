import type { Metadata } from "next";
import Journey from "@/components/Journey";
import { about } from "@/content/site";

export const metadata: Metadata = {
  title: "About",
  description: about.body[0],
};

export default function AboutPage() {
  return <Journey initial="about" />;
}
