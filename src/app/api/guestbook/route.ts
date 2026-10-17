import { connection } from "next/server";
import { LINE_MAX, NAME_MAX, addEntry, allowSign, clean, listEntries } from "@/lib/guestbook";

export async function GET() {
  await connection();
  try {
    return Response.json({ entries: await listEntries() });
  } catch {
    return Response.json({ entries: [] }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  // a field people never see: anything filling it in is a bot
  if (body.website) return Response.json({ ok: true });

  const name = clean(body.name, NAME_MAX);
  const line = clean(body.line, LINE_MAX);
  if (!name || !line) {
    return Response.json({ error: `A name (up to ${NAME_MAX}) and a line (up to ${LINE_MAX}), no links.` }, { status: 400 });
  }

  const visitor = (request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "local").trim();
  try {
    if (!(await allowSign(visitor))) {
      return Response.json({ error: "You signed a moment ago. Try again in a minute." }, { status: 429 });
    }
    const entry = { id: crypto.randomUUID(), name, line, at: Date.now() };
    await addEntry(entry);
    return Response.json({ entry });
  } catch {
    return Response.json({ error: "The guestbook can't be written to right now." }, { status: 503 });
  }
}
