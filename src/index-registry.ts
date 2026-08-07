import path from "node:path";
import YAML from "yaml";
import z from "zod";
import { researchDir, scopeDir } from "./ctx";
import { type IndexHooks, setIndexHooks, writeTextBypass } from "./fs";
import { getMutex, withLock } from "./lock";
import { log } from "./log";

/**
 * Entity index — replaces readdir-based enumeration with a durable manifest.
 *
 * The workspace Host Service exposes read/write/metadata but no directory
 * listing, so the plugin maintains `.research/index.yaml` as the enumeration
 * source of truth. Every entity/journal/phase-run write registers an entry
 * under the same write mutex; `listYaml`/`loadAllYaml` then read the index
 * instead of scanning the directory.
 *
 * Backwards compatibility: legacy projects (created by the API3 plugin) have
 * no index. `bootstrapResearchIndex()` performs a one-time read-only scan of
 * the known subdirectories and writes the index back. This shim is
 * deliberately narrow.
 *
 * Deadlock note: `index.yaml` itself is written via `writeTextBypass` (never
 * through `ResearchFS.writeYaml`), so index writes never re-enter the index
 * registration hook.
 */

const ENTITY_KINDS = ["idea", "plan", "experiment", "claim", "exhibit", "paper", "submission"] as const;

export const EntityKind = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKind>;

export const IndexEntry = z.object({
  id: z.string(),
  file: z.string(),
  status: z.string().optional(),
  title: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type IndexEntry = z.infer<typeof IndexEntry>;

export const PhaseRunIndexEntry = z.object({
  id: z.string(),
  file: z.string(),
  phase: z.string().optional(),
  status: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type PhaseRunIndexEntry = z.infer<typeof PhaseRunIndexEntry>;

export const ResearchIndex = z.object({
  version: z.literal(1),
  entities: z.record(EntityKind, z.array(IndexEntry).default([])).default(() => ({
    idea: [],
    plan: [],
    experiment: [],
    claim: [],
    exhibit: [],
    paper: [],
    submission: [],
  })),
  phaseRuns: z.array(PhaseRunIndexEntry).default([]),
  diagnoses: z.array(z.object({ file: z.string(), updatedAt: z.string().optional() })).default([]),
  journalNotes: z.array(z.object({ file: z.string(), updatedAt: z.string().optional() })).default([]),
  /** File manifests for auxiliary directories that need enumeration (positioning, rqg, literature/*). */
  files: z.record(z.string(), z.array(z.string()).default([])).default({}),
  updatedAt: z.string(),
});
export type ResearchIndex = z.infer<typeof ResearchIndex>;

export const INDEX_FILE = "index.yaml";

/** Entity kind → directory name (mirrors ENTITY_DIR in id.ts). */
const KIND_DIR: Record<EntityKind, string> = {
  idea: "ideas",
  plan: "plans",
  experiment: "experiments",
  claim: "claims",
  exhibit: "exhibits",
  paper: "manuscripts",
  submission: "submissions",
};
const DIR_KIND = Object.fromEntries(Object.entries(KIND_DIR).map(([k, d]) => [d, k])) as Record<string, EntityKind>;

/** Directories that are enumerated as "auxiliary files" (not first-class entities). */
const AUX_DIRS = ["positioning", "rqg", "diagnoses", "literature", "literature/by-topic", "literature/papers"];

const indexMutex = getMutex("index");

function emptyIndex(): ResearchIndex {
  return {
    version: 1,
    entities: { idea: [], plan: [], experiment: [], claim: [], exhibit: [], paper: [], submission: [] },
    phaseRuns: [],
    diagnoses: [],
    journalNotes: [],
    files: {},
    updatedAt: new Date().toISOString(),
  };
}

/** Relative path from `.research/` to an absolute file path. */
export function toRelPath(absPath: string): string {
  const base = researchDir();
  const rel = path.relative(base, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes research dir: ${absPath}`);
  }
  return rel;
}

async function readIndex(): Promise<ResearchIndex | undefined> {
  const file = path.join(researchDir(), INDEX_FILE);
  const raw = await Bun.file(file)
    .text()
    .catch(() => undefined);
  if (raw === undefined) return undefined;
  try {
    const parsed = YAML.parse(raw) as unknown;
    const result = ResearchIndex.safeParse(parsed);
    if (!result.success) {
      log.warn("index", "index.yaml invalid, treating as missing", result.error.message);
      return undefined;
    }
    return result.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("index", "index.yaml parse failed, treating as missing", msg);
    return undefined;
  }
}

/** Write index.yaml bypassing the index registration hook (no re-entry). Caller holds indexMutex. */
async function writeIndex(index: ResearchIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await writeTextBypass(path.join(researchDir(), INDEX_FILE), YAML.stringify(index, { lineWidth: 0 }));
}

/** Load the current index (may trigger bootstrap for legacy projects). */
export async function loadIndex(): Promise<ResearchIndex> {
  const existing = await readIndex();
  if (existing) return existing;
  return withLock(indexMutex, async () => {
    const recheck = await readIndex();
    if (recheck) return recheck;
    return bootstrapResearchIndex();
  });
}

/**
 * One-time migration shim: legacy projects have `.research/` files but no
 * index. Scan the known subdirectories once (read-only) and write the index.
 * Returns an empty index when the project is not initialized.
 * Caller must already hold indexMutex (loadIndex does).
 */
export async function bootstrapResearchIndex(): Promise<ResearchIndex> {
  const index = emptyIndex();
  const stateExists = await Bun.file(path.join(researchDir(), "state.yaml"))
    .exists()
    .catch(() => false);
  if (!stateExists) return index;

  const { readdir } = await import("node:fs/promises");
  const rd = researchDir();
  try {
    for (const [dir, kind] of Object.entries(DIR_KIND)) {
      const abs = path.join(rd, dir);
      const names = await readdir(abs).catch(() => [] as string[]);
      for (const name of names.sort()) {
        if (!name.endsWith(".yaml")) continue;
        const id = name.replace(/\.yaml$/, "");
        let bucket = index.entities[kind];
        if (!bucket) bucket = index.entities[kind] = [];
        bucket.push({ id, file: `${dir}/${name}` });
      }
    }
    for (const dir of ["phase_runs", "diagnoses", "journal"]) {
      const abs = path.join(rd, dir);
      const names = await readdir(abs).catch(() => [] as string[]);
      for (const name of names.sort()) {
        const file = `${dir}/${name}`;
        if (dir === "phase_runs" && name.endsWith(".yaml")) {
          index.phaseRuns.push({ id: name.replace(/\.yaml$/, ""), file });
        } else if (dir === "diagnoses" && name.endsWith(".yaml")) {
          index.diagnoses.push({ file });
        } else if (dir === "journal" && name.endsWith(".jsonl")) {
          index.journalNotes.push({ file });
        }
      }
    }
    for (const dir of AUX_DIRS) {
      const abs = path.join(rd, dir);
      const names = await readdir(abs).catch(() => [] as string[]);
      index.files[dir] = names.filter((n) => n.endsWith(".yaml")).sort();
    }
  } catch (err) {
    log.warn("index", "bootstrap scan failed", err);
  }

  await writeIndex(index);
  log.info("index", `bootstrapped index for ${scopeDir()}`);
  return index;
}

/** Map a research-relative file path to the index bucket it belongs to. */
function bucketFor(
  relPath: string,
): { key: "entities" | "phaseRuns" | "diagnoses" | "journalNotes" | "files"; sub?: string } | null {
  const parts = relPath.split("/");
  const dir = parts[0]!;
  const name = parts[parts.length - 1]!;
  const kind = DIR_KIND[dir];
  if (kind) return { key: "entities", sub: kind };
  if (dir === "phase_runs") return { key: "phaseRuns" };
  if (dir === "diagnoses") return { key: "diagnoses" };
  if (dir === "journal") return { key: "journalNotes" };
  // Match the longest AUX_DIRS prefix so nested buckets (literature/papers,
  // literature/by-topic) register under their full relative-path bucket
  // instead of the top-level dir. Without this, files written under
  // literature/papers/x.yaml land in files["literature"] while
  // listIndexedYaml("literature/papers") reads files["literature/papers"].
  const dirPath = parts.slice(0, -1).join("/");
  const matched = AUX_DIRS.filter((a) => dirPath === a || dirPath.startsWith(`${a}/`)).sort(
    (a, b) => b.length - a.length,
  )[0];
  if (matched) return { key: "files", sub: matched };
  void name;
  return null;
}

/** Register a written file in the index (call under the write mutex). */
export async function registerIndexedFile(absPath: string, data?: unknown): Promise<void> {
  const rel = toRelPath(absPath);
  const bucket = bucketFor(rel);
  if (!bucket) return;
  const name = rel.split("/").pop() ?? rel;

  // Buckets are extension-scoped: entity/phase-run/diagnosis/aux buckets only
  // index `.yaml`; the journal bucket only indexes `.jsonl`. Markdown and
  // other files must never be enumerated by listYaml (baseline readdir
  // semantics: only `.yaml` files are listed).
  if (bucket.key !== "journalNotes" && !name.endsWith(".yaml")) return;
  if (bucket.key === "journalNotes" && !name.endsWith(".jsonl")) return;

  await withLock(indexMutex, async () => {
    const index = (await readIndex()) ?? emptyIndex();
    const updatedAt = new Date().toISOString();
    const record = (data as Record<string, unknown> | undefined) ?? {};
    const status = typeof record.status === "string" ? record.status : undefined;
    const title = typeof record.title === "string" ? record.title : undefined;

    if (bucket.key === "entities") {
      const kind = bucket.sub as EntityKind;
      const id = (typeof record.id === "string" ? record.id : name.replace(/\.yaml$/, "")) || name;
      let entries = index.entities[kind];
      if (!entries) entries = index.entities[kind] = [];
      const existing = entries.find((e) => e.file === rel);
      if (existing) {
        existing.id = id;
        existing.status = status ?? existing.status;
        existing.title = title ?? existing.title;
        existing.updatedAt = updatedAt;
      } else {
        entries.push({ id, file: rel, status, title, updatedAt });
      }
    } else if (bucket.key === "phaseRuns") {
      const id = (typeof record.id === "string" ? record.id : name.replace(/\.yaml$/, "")) || name;
      const phase = typeof record.phase === "string" ? record.phase : undefined;
      const st = typeof record.status === "string" ? record.status : undefined;
      const existing = index.phaseRuns.find((e) => e.file === rel);
      if (existing) {
        existing.id = id;
        existing.phase = phase ?? existing.phase;
        existing.status = st ?? existing.status;
        existing.updatedAt = updatedAt;
      } else {
        index.phaseRuns.push({ id, file: rel, phase, status: st, updatedAt });
      }
    } else if (bucket.key === "diagnoses") {
      const existing = index.diagnoses.find((e) => e.file === rel);
      if (existing) existing.updatedAt = updatedAt;
      else index.diagnoses.push({ file: rel, updatedAt });
    } else if (bucket.key === "journalNotes") {
      const existing = index.journalNotes.find((e) => e.file === rel);
      if (existing) existing.updatedAt = updatedAt;
      else index.journalNotes.push({ file: rel, updatedAt });
    } else {
      const sub = bucket.sub!;
      let list = index.files[sub];
      if (!list) list = index.files[sub] = [];
      if (!list.includes(name)) {
        list.push(name);
        list.sort();
      }
    }
    await writeIndex(index);
  });
}

/** List `.yaml` filenames in a research-relative directory, from the index. */
export async function listIndexedYaml(relDir: string): Promise<string[]> {
  const index = await loadIndex();
  const kind = DIR_KIND[relDir];
  if (kind) {
    return (index.entities[kind] ?? []).map((e) => e.file.split("/").pop() ?? e.file).sort();
  }
  if (relDir === "phase_runs") {
    return index.phaseRuns.map((e) => e.file.split("/").pop() ?? e.file).sort();
  }
  if (relDir === "diagnoses") {
    return index.diagnoses.map((e) => e.file.split("/").pop() ?? e.file).sort();
  }
  return [...(index.files[relDir] ?? [])].sort();
}

/** Install the fs.ts index hooks (listYaml + register). */
export function installIndexHooks(): void {
  const hooks: IndexHooks = {
    listYaml: listIndexedYaml,
    register: registerIndexedFile,
  };
  setIndexHooks(hooks);
}
