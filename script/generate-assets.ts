#!/usr/bin/env bun
/**
 * Generate src/generated/assets.ts from agents/ and scripts/.
 *
 * Bun.build (used by plugin-kit to bundle the runtime) does not resolve
 * `?raw` imports for non-JS extensions, so agent prompts and utility
 * scripts are inlined as TS string constants at generation time. The
 * generated module is shipped inside the runtime bundle.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(root, "src", "generated")
const outFile = path.join(outDir, "assets.ts")

function collect(dir: string, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of readdirSync(dir).sort()) {
    // Skip Python bytecode caches and other non-source artifacts.
    if (entry === "__pycache__" || entry.endsWith(".pyc")) continue
    const full = path.join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(full).isDirectory()) {
      Object.assign(result, collect(full, rel))
    } else {
      result[rel] = readFileSync(full, "utf-8")
    }
  }
  return result
}

const agents = collect(path.join(root, "agents"))
const scripts = collect(path.join(root, "scripts"))

function literal(value: string): string {
  return JSON.stringify(value)
}

const lines = [
  "// GENERATED FILE — do not edit by hand. Run `bun run gen` to regenerate.",
  '// Inlines agents/*.md and scripts/** into the runtime bundle (Bun.build',
  "// does not resolve `?raw` for non-JS extensions).",
  "",
  "export const AGENTS: Record<string, string> = {",
  ...Object.entries(agents).map(([name, content]) => `  ${literal(name)}: ${literal(content)},`),
  "}",
  "",
  "export const SCRIPTS: Record<string, string> = {",
  ...Object.entries(scripts).map(([name, content]) => `  ${literal(name)}: ${literal(content)},`),
  "}",
  "",
  "export const AGENT_NAMES = Object.keys(AGENTS)",
  "export const SCRIPT_NAMES = Object.keys(SCRIPTS)",
  "",
]

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, lines.join("\n"))
console.log(`generated ${outFile} (${Object.keys(agents).length} agents, ${Object.keys(scripts).length} scripts)`)
