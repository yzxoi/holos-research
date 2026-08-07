import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { ResearchFS, YamlCorruptError, PathTraversalError } from "../src/fs"
import { initContext, runWithDirectory } from "../src/ctx"
import { stubAccessor, stubAuth, stubCache } from "./helpers"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import z from "zod"

// ── Setup helpers ─────────────────────────────────────────────────────────────

const TMP = path.join(process.env.TMPDIR || "/tmp", `holos-fs-atomic-test-${Date.now()}`)

async function initWithProject() {
  initContext({ directory: TMP, config: stubAccessor() as any, auth: stubAuth() as any, cache: stubCache() as any })
  await runWithDirectory(undefined, async () => {
    const researchDir = path.join(TMP, ".research")
    await fs.mkdir(researchDir, { recursive: true })
  })
}

async function cleanup() {
  await fs.rm(TMP, { recursive: true, force: true })
}

// ── writeMd ───────────────────────────────────────────────────────────────────

describe("writeMd", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("creates file with correct content", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("test.md")
      const content = "# Hello World\n\nThis is a test."
      await ResearchFS.writeMd(filePath, content)
      const read = await ResearchFS.readMd(filePath)
      expect(read).toBe(content)
    })
  })

  test("creates parent directories if needed", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("subdir", "nested", "test.md")
      await ResearchFS.writeMd(filePath, "nested content")
      const read = await ResearchFS.readMd(filePath)
      expect(read).toBe("nested content")
    })
  })

  test("uses temp-rename: no .tmp file left after write", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("atomic.md")
      await ResearchFS.writeMd(filePath, "atomic content")
      // Check that no .tmp file remains
      const tmpPath = filePath + ".tmp"
      const tmpExists = await ResearchFS.exists(tmpPath)
      expect(tmpExists).toBe(false)
      // The actual file should exist
      const read = await ResearchFS.readMd(filePath)
      expect(read).toBe("atomic content")
    })
  })
})

// ── writeYaml ─────────────────────────────────────────────────────────────────

describe("writeYaml", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("creates file with correct YAML content", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("test.yaml")
      const data = { id: "test_001", title: "Test", status: "active", count: 42 }
      await ResearchFS.writeYaml(filePath, data)
      const read = await ResearchFS.readYaml<typeof data>(filePath)
      expect(read).toEqual(data)
    })
  })

  test("uses temp-rename: no .tmp file left after write", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("atomic.yaml")
      await ResearchFS.writeYaml(filePath, { key: "value" })
      const tmpPath = filePath + ".tmp"
      const tmpExists = await ResearchFS.exists(tmpPath)
      expect(tmpExists).toBe(false)
    })
  })

  test("preserves nested objects", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("nested.yaml")
      const data = {
        inner: {
          deep: { value: "nested" },
          list: [1, 2, 3],
        },
      }
      await ResearchFS.writeYaml(filePath, data)
      const read = await ResearchFS.readYaml<typeof data>(filePath)
      expect(read).toEqual(data)
    })
  })
})

// ── readYaml ──────────────────────────────────────────────────────────────────

describe("readYaml", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("reads back written content correctly", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("roundtrip.yaml")
      const data = { id: "rt_001", title: "Round Trip", tags: ["a", "b"] }
      await ResearchFS.writeYaml(filePath, data)
      const read = await ResearchFS.readYaml<typeof data>(filePath)
      expect(read).toEqual(data)
    })
  })

  test("returns undefined for missing file", async () => {
    await runWithDirectory(undefined, async () => {
      const read = await ResearchFS.readYaml(ResearchFS.resolve("nonexistent.yaml"))
      expect(read).toBeUndefined()
    })
  })

  test("with schema parameter validates and warns on mismatch", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("schema-test.yaml")
      const validData = { id: "test_001", title: "Valid", status: "proposed", created: new Date().toISOString() }
      await ResearchFS.writeYaml(filePath, validData)

      // Valid schema should pass
      const schema = z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        created: z.string(),
      })
      const read = await ResearchFS.readYaml<typeof validData>(filePath, schema)
      expect(read).toEqual(validData)
    })
  })

  test("with schema parameter throws YamlCorruptError when schema validation fails", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("schema-fail.yaml")
      const data = { id: "test_001", wrong_field: true }
      await ResearchFS.writeYaml(filePath, data)

      const strictSchema = z.object({
        id: z.string(),
        required_field: z.string(),
      })
      // SchemaValidationError is caught by the outer catch and re-thrown as YamlCorruptError
      try {
        await ResearchFS.readYaml(filePath, strictSchema)
        expect(true).toBe(false) // should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(YamlCorruptError)
        expect((err as YamlCorruptError).parseError).toContain("Schema validation failed")
      }
    })
  })

  test("throws YamlCorruptError for invalid YAML", async () => {
    await runWithDirectory(undefined, async () => {
      const filePath = ResearchFS.resolve("corrupt.yaml")
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await Bun.write(filePath, "invalid: [yaml: {broken")
      await expect(ResearchFS.readYaml(filePath)).rejects.toThrow(YamlCorruptError)
    })
  })
})

// ── resolveSafe ───────────────────────────────────────────────────────────────

describe("resolveSafe", () => {
  beforeAll(async () => { await initWithProject() })
  afterAll(async () => { await cleanup() })

  test("rejects symlink path traversal", async () => {
    await runWithDirectory(undefined, async () => {
      const researchDir = path.join(TMP, ".research")
      // Create a symlink inside research dir pointing outside
      const symlinkPath = path.join(researchDir, "escape_link")
      const targetOutside = "/etc/passwd"
      try {
        await fs.symlink(targetOutside, symlinkPath)
      } catch {
        // Symlink creation might fail in restricted environments; skip gracefully
        return
      }

      // resolveSafe should detect the symlink pointing outside
      await expect(ResearchFS.resolveSafe("escape_link")).rejects.toThrow(PathTraversalError)
    })
  })

  test("accepts normal paths within research dir", async () => {
    await runWithDirectory(undefined, async () => {
      const resolved = await ResearchFS.resolveSafe("ideas", "idea_001.yaml")
      expect(resolved).toContain(".research")
      expect(resolved).toContain("idea_001.yaml")
    })
  })

  test("falls back to basic resolve if file doesn't exist", async () => {
    await runWithDirectory(undefined, async () => {
      const resolved = await ResearchFS.resolveSafe("nonexistent", "file.yaml")
      expect(resolved).toContain(".research")
    })
  })
})

// ── PathTraversalError ────────────────────────────────────────────────────────

describe("PathTraversalError", () => {
  test("resolve throws for path traversal with ..", async () => {
    await runWithDirectory(undefined, async () => {
      expect(() => ResearchFS.resolve("../../../etc/passwd")).toThrow(PathTraversalError)
    })
  })

  test("resolve throws for absolute path escape (../../etc/passwd)", async () => {
    await runWithDirectory(undefined, async () => {
      expect(() => ResearchFS.resolve("../../etc/passwd")).toThrow(PathTraversalError)
    })
  })
})
