import type { Metadata } from "next";
import BoardView from "@/components/board/BoardView";
import { board } from "@/content/site";

export const metadata: Metadata = {
  title: "The board",
  description: `${board.heading} ${board.note}`,
};

export default function BoardPage() {
  return <BoardView />;
}
