/**
 * Loads src/voice TypeScript modules in Node: each file is transpiled to a temporary .mjs with its relative
 * imports pointed at the transpiled siblings, so the scripts test the very code the page runs.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve("src/voice");
const OUT = join(tmpdir(), `voice-ts-${process.pid}`);

function emit(file, seen) {
  const abs = resolve(ROOT, file);
  if (seen.has(abs)) return;
  seen.add(abs);
  const src = readFileSync(abs, "utf8");
  let js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false } }).outputText;
  js = js.replace(/from\s+"(\.{1,2}\/[^"]+)"/g, (_, spec) => {
    const dep = join(dirname(relative(ROOT, abs)), spec);
    emit(`${dep}.ts`, seen);
    return `from "${spec}.mjs"`;
  });
  const out = join(OUT, relative(ROOT, abs)).replace(/\.ts$/, ".mjs");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, js);
}

/** import("src/voice/<file>.ts") */
export async function load(file) {
  emit(file, new Set());
  return import(pathToFileURL(join(OUT, file.replace(/\.ts$/, ".mjs"))).href);
}

/** transpile a module and everything it imports; returns the folder the .mjs files are in */
export function emitTree(file) {
  emit(file, new Set());
  return OUT;
}
