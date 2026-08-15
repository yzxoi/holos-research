import path from "node:path"
import fs from "node:fs/promises"
import YAML from "yaml"
import type { WorkspaceService } from "../src/ctx"

// ── Stub context helpers ─────────────────────────────────────────────────────

/**
 * Legacy stub accessors — accepted (and ignored) by initContext for
 * compatibility with baseline test call sites. The API4 plugin context no
 * longer carries config/auth/cache; these no-ops keep the migrated tests
 * source-compatible while they exercise the filesystem layer.
 */
export function stubAccessor() {
  return { get: async () => ({}), set: async () => {} }
}
export function stubAuth() {
  return { get: async () => undefined, set: async () => {}, delete: async () => {}, has: async () => false }
}
export function stubCache() {
  return { get: async () => undefined, set: async () => {}, delete: async () => {}, directory: "/tmp" }
}

export const stubCtx: any = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test",
  abort: new AbortController().signal,
}

/**
 * Workspace Host Service stub backed by a real temporary directory.
 * Mirrors Synergy's workspace service contract: read/write with paths
 * relative to the scope directory, metadata returning the directory.
 */
export function stubWorkspace(tmpDir: string): WorkspaceService {
  return {
    async read(rel: string): Promise<string> {
      return Bun.file(path.join(tmpDir, rel)).text()
    },
    async write(rel: string, content: string): Promise<void> {
      const abs = path.join(tmpDir, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await Bun.write(abs, content)
    },
    async metadata() {
      return { scopeId: "test-scope", directory: tmpDir }
    },
  }
}

// ── Directory constants ──────────────────────────────────────────────────────

const ALL_DIRS = [
  "ideas", "plans", "experiments", "claims", "exhibits",
  "manuscripts", "submissions", "literature", "literature/by-topic",
  "literature/papers", "phase_runs", "journal", "snapshots",
  "positioning", "code_artifacts", "rqg", "compose", "diagnoses", "checkpoint_briefs",
]

// ── seedProject ──────────────────────────────────────────────────────────────

export interface SeedProjectOverrides {
  /** Partial state fields merged into the default state.yaml */
  state?: Record<string, unknown>
  /** Create extra empty files relative to .research/ (e.g. "literature/edges.jsonl") */
  extraFiles?: string[]
  /** If true, write an empty index.yaml (fresh project already indexed) */
  withIndex?: boolean
}

export async function seedProject(tmpDir: string, overrides?: SeedProjectOverrides): Promise<void> {
  const rd = path.join(tmpDir, ".research")

  // Create all standard directories
  for (const dir of ALL_DIRS) {
    await fs.mkdir(path.join(rd, dir), { recursive: true })
  }

  // Create timeline.jsonl
  await Bun.write(path.join(rd, "timeline.jsonl"), "")

  // Create extra files (e.g. "literature/edges.jsonl", "journal.jsonl")
  if (overrides?.extraFiles) {
    for (const file of overrides.extraFiles) {
      await Bun.write(path.join(rd, file), "")
    }
  }

  // Default state — minimal config, tests override as needed
  const defaultState = {
    project: "test-project",
    schema_version: 2,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    config: { participation_mode: "collaborative" },
    counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
  }

  const state = { ...defaultState, ...overrides?.state }

  await Bun.write(path.join(rd, "state.yaml"), YAML.stringify(state))

  if (overrides?.withIndex) {
    const index = {
      version: 1,
      entities: { idea: [], plan: [], experiment: [], claim: [], exhibit: [], paper: [], submission: [] },
      phaseRuns: [],
      diagnoses: [],
      journalNotes: [],
      files: {},
      updatedAt: new Date().toISOString(),
    }
    await Bun.write(path.join(rd, "index.yaml"), YAML.stringify(index))
  }
}
