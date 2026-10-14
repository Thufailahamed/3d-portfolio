import type { Metadata } from "next";
import FlowView from "@/components/flow/FlowView";

export const metadata: Metadata = {
  title: "3D Flow · Architectural Exhibition",
  description: "Walk inside the grand exhibition gallery and inspect all 6 projects in interactive 3D.",
};

export default function FlowPage() {
  return <FlowView />;
}
