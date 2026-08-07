import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type z from "zod";
import { researchDir, scopeDir, type WorkspaceService, workspace } from "./ctx";
import { getMutex, withLock } from "./lock";
import { log } from "./log";

/**
 * Index hooks — injected by index-registry.ts to avoid a static circular
 * import between fs.ts and index-registry.ts. `listYaml` replaces readdir
 * enumeration; `register` records a written file in `.research/index.yaml`
 * (a no-op for files that do not belong to an indexed bucket).
 */
export interface IndexHooks {
  listYaml(relDir: string): Promise<string[]>;
  register(absPath: string, data?: unknown): Promise<void>;
}

let indexHooks: IndexHooks | undefined;

export function setIndexHooks(hooks: IndexHooks | undefined): void {
  indexHooks = hooks;
}

const yamlWriteMutex = getMutex("yaml_write");
const jsonlAppendMutex = getMutex("jsonl_append");
const mdMutex = getMutex("md_write");

export class YamlCorruptError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly parseError: string,
  ) {
    super(`YAML parse failed for ${path.basename(filePath)}: ${parseError}`);
    this.name = "YamlCorruptError";
  }
}

export class JsonlCorruptError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly line: number,
    public readonly parseError: string,
  ) {
    super(`JSONL parse failed at ${path.basename(filePath)} line ${line}: ${parseError}`);
    this.name = "JsonlCorruptError";
  }
}

export class SchemaValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly validationError: string,
  ) {
    super(`Schema validation failed for ${path.basename(filePath)}: ${validationError}`);
    this.name = "SchemaValidationError";
  }
}

export class PathTraversalError extends Error {
  constructor(public readonly segments: string[]) {
    super(`Path traversal blocked: ${segments.join("/")}`);
    this.name = "PathTraversalError";
  }
}

/** Absolute path → path relative to the Scope directory (workspace service contract). */
function relToScope(absPath: string): string {
  const rel = path.relative(scopeDir(), absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathTraversalError(absPath.split(path.sep));
  }
  return rel;
}

async function readText(absPath: string): Promise<string | undefined> {
  const s = workspace();
  if (s?.read) {
    try {
      return await s.read(relToScope(absPath));
    } catch {
      return undefined;
    }
  }
  try {
    return await Bun.file(absPath).text();
  } catch {
    return undefined;
  }
}

/**
 * Low-level write WITHOUT lock or index registration — callers must already
 * hold the relevant mutex (or the index mutex for index.yaml itself).
 * Workspace mode uses the host write service (which creates parent dirs);
 * bare/test mode uses tmp+rename for atomicity.
 */
export async function writeTextBypass(absPath: string, text: string): Promise<void> {
  const s = workspace();
  if (s?.write) {
    await s.write(relToScope(absPath), text);
    return;
  }
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmpPath = absPath + ".tmp";
  try {
    await Bun.write(tmpPath, text);
    const fd = await fs.open(tmpPath, "r");
    await fd.sync();
    await fd.close();
    await fs.rename(tmpPath, absPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

async function registerWrite(absPath: string, data?: unknown): Promise<void> {
  await indexHooks?.register(absPath, data);
}

export namespace ResearchFS {
  /**
   * Resolve path segments under the research directory.
   * Throws {@link PathTraversalError} if any segment escapes the research root.
   */
  export function resolve(...segments: string[]): string {
    const base = path.resolve(researchDir());
    const joined = path.join(base, ...segments);
    const resolved = path.resolve(joined);
    if (!resolved.startsWith(base)) {
      throw new PathTraversalError(segments);
    }
    return resolved;
  }

  /** Like {@link resolve} but also resolves symlinks. Falls back on realpath failure. */
  export async function resolveSafe(...segments: string[]): Promise<string> {
    const resolved = resolve(...segments);
    try {
      const [realBase, realPath] = await Promise.all([fs.realpath(researchDir()), fs.realpath(resolved)]);
      if (!realPath.startsWith(realBase)) {
        throw new PathTraversalError(segments);
      }
      return realPath;
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      return resolved;
    }
  }

  export async function exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  export async function ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Read and parse a YAML file. Returns `undefined` if the file does not exist.
   * Throws {@link YamlCorruptError} on parse failure (including schema
   * validation failures, matching the baseline contract).
   */
  export async function readYaml<T>(filePath: string, schema?: z.ZodType<T>): Promise<T | undefined> {
    const text = await readText(filePath);
    if (text === undefined) return undefined;
    try {
      const parsed = YAML.parse(text) as T;
      if (schema) {
        const result = schema.safeParse(parsed);
        if (!result.success) {
          throw new SchemaValidationError(filePath, result.error.message);
        }
        return result.data;
      }
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new YamlCorruptError(filePath, msg);
    }
  }

  export async function writeYaml(filePath: string, data: unknown): Promise<void> {
    await withLock(yamlWriteMutex, async () => {
      await writeTextBypass(filePath, YAML.stringify(data, { lineWidth: 0 }));
      await registerWrite(filePath, data);
    });
  }

  export async function readMd(filePath: string): Promise<string | undefined> {
    return readText(filePath);
  }

  export async function writeMd(filePath: string, content: string): Promise<void> {
    return withLock(mdMutex, async () => writeMdUnlocked(filePath, content));
  }

  /** Unlocked version for callers that already hold mdMutex. */
  export async function writeMdUnlocked(filePath: string, content: string): Promise<void> {
    await writeTextBypass(filePath, content);
    await registerWrite(filePath, {});
  }

  export async function appendJsonl(filePath: string, event: unknown): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    await withLock(jsonlAppendMutex, async () => {
      if (workspace()?.write) {
        // Workspace service has no append — read-modify-write under the mutex.
        const existing = (await readText(filePath)) ?? "";
        await writeTextBypass(filePath, existing + line);
      } else {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, line, "utf-8");
      }
      await registerWrite(filePath, event);
    });
  }

  /**
   * Read and parse a JSONL file. Returns `[]` if the file does not exist.
   * Throws {@link JsonlCorruptError} on malformed lines.
   */
  export async function readJsonl<T>(filePath: string): Promise<T[]> {
    const text = await readText(filePath);
    if (text === undefined) return [];
    const lines = text.split("\n").filter((line) => line.trim());
    return lines.map((line, i) => {
      try {
        return JSON.parse(line) as T;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new JsonlCorruptError(filePath, i + 1, msg);
      }
    });
  }

  /** List `.yaml` filenames in a research-relative directory via the index. */
  export async function listYaml(dirPath: string): Promise<string[]> {
    const rel = path.relative(researchDir(), dirPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return [];
    if (!indexHooks) {
      // Lazy-install the index hooks on first use (dynamic import breaks the
      // static cycle fs.ts ⇄ index-registry.ts). No entry point needs wiring.
      const mod = await import("./index-registry");
      mod.installIndexHooks();
    }
    if (indexHooks) return indexHooks.listYaml(rel);
    // Theoretical fallback (index-registry failed to load): readdir directly.
    try {
      const entries = await fs.readdir(dirPath);
      return entries.filter((e) => e.endsWith(".yaml")).sort();
    } catch {
      return [];
    }
  }

  export async function isInitialized(): Promise<boolean> {
    return exists(resolve("state.yaml"));
  }
}

// Keep `log` referenced (used by index-registry diagnostics path parity).
void log;
