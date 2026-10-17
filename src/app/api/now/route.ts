import { cacheLife } from "next/cache";
import { person } from "@/content/site";

/**
 * What the studio is working on right now. With GITHUB_USER set it is the repository of the
 * latest public push (and when); otherwise the line in person.now.
 */
export async function GET() {
  return Response.json(await nowBuilding());
}

async function nowBuilding(): Promise<{ label: string; at: number | null }> {
  "use cache";
  cacheLife("minutes");
  const user = process.env.GITHUB_USER;
  if (user) {
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=30`, {
        headers: {
          Accept: "application/vnd.github+json",
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
      if (res.ok) {
        const events = (await res.json()) as { type: string; repo: { name: string }; created_at: string }[];
        const push = events.find((e) => e.type === "PushEvent");
        if (push) return { label: push.repo.name.split("/").pop()!, at: Date.parse(push.created_at) };
      }
    } catch {
      // fall through to the static line
    }
  }
  return { label: person.now, at: null };
}
