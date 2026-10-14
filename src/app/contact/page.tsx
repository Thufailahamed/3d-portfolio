import type { Metadata } from "next";
import Journey from "@/components/Journey";
import { contact, person } from "@/content/site";

export const metadata: Metadata = {
  title: "Contact",
  description: `${contact.heading} ${person.email}`,
};

export default function ContactPage() {
  return <Journey initial="contact" />;
}
