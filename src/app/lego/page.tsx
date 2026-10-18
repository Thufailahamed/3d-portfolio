import type { Metadata } from "next";
import LegoView from "@/lego/LegoView";

export const metadata: Metadata = {
  title: "Brick Edition",
  description:
    "The portfolio rebuilt from bricks — the name, the work and the contact details are all brick-built, and every piece can be knocked down and rebuilt.",
};

export default function LegoPage() {
  return <LegoView />;
}
