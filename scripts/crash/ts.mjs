/**
 * Loads the site's TypeScript modules in Node for the crash lab and comparison scripts: each file is
 * transpiled to a temporary .mjs with its imports (relative ones and the "@/" alias for src/) pointed
 * at the transpiled siblings, so the scripts test the very code the page runs. Type-only imports
 * vanish in the transpile; modules that touch the DOM or three.js at import time can't be loaded.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SRC = resolve("src");
const OUT = join(tmpdir(), `crash-ts-${process.pid}`);

function target(fromAbs, spec) {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : resolve(dirname(fromAbs), spec);
  for (const cand of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(cand)) return cand;
  throw new Error(`cannot resolve ${spec} from ${fromAbs}`);
}

function emit(abs, seen) {
  if (seen.has(abs)) return;
  seen.add(abs);
  const src = readFileSync(abs, "utf8");
  let js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  js = js.replace(/(from\s+|import\s*\()"((?:\.{1,2}\/|@\/)[^"]+)"/g, (_, pre, spec) => {
    const dep = target(abs, spec);
    emit(dep, seen);
    let rel = relative(dirname(outPath(abs)), outPath(dep)).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${pre}"${rel}"`;
  });
  const out = outPath(abs);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, js);
}

const outPath = (abs) => join(OUT, relative(SRC, abs)).replace(/\.ts$/, ".mjs");

/** import("src/<file>.ts"), e.g. load("crash/sim/solve.ts") */
export async function load(file) {
  const abs = resolve(SRC, file);
  emit(abs, new Set());
  return import(pathToFileURL(outPath(abs)).href);
}
