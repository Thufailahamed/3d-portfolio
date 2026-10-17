import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Guestbook storage. With UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN set it keeps the
 * entries in Redis (works on serverless hosts); otherwise in a JSON file under .data/ (local dev
 * and self-hosted servers with a writable disk).
 */

import type { GuestEntry } from "@/store/useApp";
export type { GuestEntry };

export const NAME_MAX = 32;
export const LINE_MAX = 110;
const KEEP = 200;
const KEY = "guestbook";
const FILE = path.join(process.cwd(), ".data", "guestbook.json");

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis<T>(...command: (string | number)[]): Promise<T> {
  const res = await fetch(redisUrl!, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return ((await res.json()) as { result: T }).result;
}

async function readFileEntries(): Promise<GuestEntry[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as GuestEntry[];
  } catch {
    return [];
  }
}

export async function listEntries(limit = 40): Promise<GuestEntry[]> {
  if (redisUrl && redisToken) {
    const rows = await redis<string[]>("LRANGE", KEY, 0, limit - 1);
    return rows.flatMap((r) => {
      try {
        return [JSON.parse(r) as GuestEntry];
      } catch {
        return [];
      }
    });
  }
  return (await readFileEntries()).slice(0, limit);
}

export async function addEntry(entry: GuestEntry) {
  if (redisUrl && redisToken) {
    await redis("LPUSH", KEY, JSON.stringify(entry));
    await redis("LTRIM", KEY, 0, KEEP - 1);
    return;
  }
  const all = [entry, ...(await readFileEntries())].slice(0, KEEP);
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 1));
}

/** One signature per visitor per window (in Redis when available, else in this process). */
const recent = new Map<string, number>();
export async function allowSign(visitor: string, windowSeconds = 60) {
  if (redisUrl && redisToken) {
    const ok = await redis<string | null>("SET", `${KEY}:rl:${visitor}`, 1, "NX", "EX", windowSeconds);
    return ok === "OK";
  }
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > windowSeconds * 1000) recent.delete(k);
  if (recent.has(visitor)) return false;
  recent.set(visitor, now);
  return true;
}

/** Plain text only: no control characters, collapsed whitespace, no links. */
export function clean(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const s = input
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length > max) return null;
  if (/https?:|www\.|\.(com|net|org|io|ru|xyz)\b/i.test(s)) return null;
  return s;
}
