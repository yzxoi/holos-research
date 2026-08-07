import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { initContext, runWithDirectory, scopeDir, researchDir } from "../src/ctx"
import path from "path"
import fs from "fs/promises"

// Minimal stubs matching the plugin interfaces
function stubAccessor() {
  return { get: async () => ({}), set: async () => {} }
}
function stubAuth() {
  return { get: async () => undefined, set: async () => {}, delete: async () => {}, has: async () => false }
}
function stubCache() {
  return { get: async () => undefined, set: async () => {}, delete: async () => {}, directory: "/tmp" }
}

describe("ctx: AsyncLocalStorage context propagation", () => {
  const baseDir = "/tmp/holos-test-base"

  beforeEach(() => {
    initContext({
      directory: baseDir,
      config: stubAccessor() as any,
      auth: stubAuth() as any,
      cache: stubCache() as any,
    })
  })

  test("scopeDir returns base directory after init", () => {
    expect(scopeDir()).toBe(baseDir)
  })

  test("researchDir appends .research", () => {
    expect(researchDir()).toBe(path.join(baseDir, ".research"))
  })

  test("runWithDirectory overrides scopeDir inside callback", async () => {
    const override = "/tmp/holos-test-override"
    let captured = ""
    await runWithDirectory(override, async () => {
      captured = scopeDir()
    })
    expect(captured).toBe(override)
  })

  test("runWithDirectory restores scopeDir after callback", async () => {
    const override = "/tmp/holos-test-override"
    await runWithDirectory(override, async () => {
      // inner scope
    })
    expect(scopeDir()).toBe(baseDir)
  })

  test("runWithDirectory(undefined) falls back to base directory", async () => {
    let captured = ""
    await runWithDirectory(undefined, async () => {
      captured = scopeDir()
    })
    expect(captured).toBe(baseDir)
  })

  test("nested runWithDirectory: inner overrides, outer restores", async () => {
    const inner = "/tmp/holos-inner"
    const outer = "/tmp/holos-outer"
    let innerCaptured = ""
    let afterInner = ""

    await runWithDirectory(outer, async () => {
      await runWithDirectory(inner, async () => {
        innerCaptured = scopeDir()
      })
      afterInner = scopeDir()
    })

    expect(innerCaptured).toBe(inner)
    expect(afterInner).toBe(outer)
  })
})
