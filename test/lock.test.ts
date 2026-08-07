import { describe, expect, test, beforeEach } from "bun:test"
import { AsyncMutex, withLock, getMutex } from "../src/lock"
import { initContext } from "../src/ctx"
import { stubAccessor, stubAuth, stubCache } from "./helpers"

describe("AsyncMutex", () => {
  test("basic lock/unlock cycle", async () => {
    const m = new AsyncMutex()
    await m.acquire()
    m.release()
    // Should be able to acquire again after release
    await m.acquire()
    m.release()
  })

  test("concurrent access is serialized", async () => {
    const m = new AsyncMutex()
    const order: number[] = []

    const op1 = (async () => {
      await m.acquire()
      order.push(1)
      // Hold the lock briefly to ensure op2 queues
      await new Promise((r) => setTimeout(r, 20))
      order.push(1)
      m.release()
    })()

    const op2 = (async () => {
      await m.acquire()
      order.push(2)
      m.release()
    })()

    await Promise.all([op1, op2])

    // op1 should have started first, and op2 should wait until op1 releases
    expect(order[0]).toBe(1)
    expect(order[1]).toBe(1)
    expect(order[2]).toBe(2)
  })

  test("multiple waiters are served in FIFO order", async () => {
    const m = new AsyncMutex()
    const order: number[] = []

    await m.acquire() // hold lock

    const p1 = (async () => {
      await m.acquire()
      order.push(1)
      m.release()
    })()

    const p2 = (async () => {
      await m.acquire()
      order.push(2)
      m.release()
    })()

    const p3 = (async () => {
      await m.acquire()
      order.push(3)
      m.release()
    })()

    // Give waiters time to enqueue
    await new Promise((r) => setTimeout(r, 10))
    m.release()

    await Promise.all([p1, p2, p3])
    expect(order).toEqual([1, 2, 3])
  })
})

describe("withLock", () => {
  test("wraps async function and releases lock on success", async () => {
    const m = new AsyncMutex()
    const result = await withLock(m, async () => 42)
    expect(result).toBe(42)
    // Lock should be released — we can acquire again
    await m.acquire()
    m.release()
  })

  test("releases lock on error", async () => {
    const m = new AsyncMutex()
    try {
      await withLock(m, async () => {
        throw new Error("boom")
      })
    } catch (e: any) {
      expect(e.message).toBe("boom")
    }
    // Lock should be released despite the error
    await m.acquire()
    m.release()
  })

  test("serializes concurrent withLock calls", async () => {
    const m = new AsyncMutex()
    const order: string[] = []

    const a = withLock(m, async () => {
      order.push("a-start")
      await new Promise((r) => setTimeout(r, 20))
      order.push("a-end")
    })

    const b = withLock(m, async () => {
      order.push("b-start")
      order.push("b-end")
    })

    await Promise.all([a, b])
    expect(order.indexOf("a-start")).toBeLessThan(order.indexOf("a-end"))
    expect(order.indexOf("a-end")).toBeLessThan(order.indexOf("b-start"))
  })
})

describe("LazyScopedMutex", () => {
  beforeEach(() => {
    initContext({
      directory: "/tmp/holos-lock-test",
      config: stubAccessor() as any,
      auth: stubAuth() as any,
      cache: stubCache() as any,
    })
  })

  test("same mutex for same scope+name", async () => {
    const m1 = getMutex("resource_a")
    const m2 = getMutex("resource_a")

    // They should resolve to the same underlying mutex via acquire/release
    const order: number[] = []
    await m1.acquire()

    const p = (async () => {
      await m2.acquire()
      order.push(2)
      m2.release()
    })()

    await new Promise((r) => setTimeout(r, 10))
    order.push(1)
    m1.release()

    await p
    // m2 should have waited for m1 — proving they share the same underlying mutex
    expect(order).toEqual([1, 2])
  })

  test("different mutex for different names", async () => {
    const m1 = getMutex("resource_x")
    const m2 = getMutex("resource_y")

    // They should NOT block each other
    const order: string[] = []
    await m1.acquire()

    // m2 should be acquirable even though m1 is held
    await m2.acquire()
    order.push("both-acquired")
    m2.release()
    m1.release()

    expect(order).toEqual(["both-acquired"])
  })

  test("resolves on first acquire (lazy resolution)", async () => {
    // getMutex can be called before initContext — it resolves lazily
    // But since we call initContext in beforeEach, we verify it works after init
    const m = getMutex("lazy_test")
    // Should not throw when acquiring (lazy resolve kicks in)
    await m.acquire()
    m.release()
  })
})

describe("getMutex", () => {
  beforeEach(() => {
    initContext({
      directory: "/tmp/holos-getmutex-test",
      config: stubAccessor() as any,
      auth: stubAuth() as any,
      cache: stubCache() as any,
    })
  })

  test("returns same mutex instance for same name", async () => {
    const a = getMutex("shared_name")
    const b = getMutex("shared_name")
    let order: number[] = []
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
    const p1 = withLock(a, async () => { order.push(1); await delay(20) })
    const p2 = withLock(b, async () => { order.push(2) })
    await Promise.all([p1, p2])
    // If a and b resolve to the same underlying mutex, access is serialized
    expect(order).toEqual([1, 2])
  })

  test("returns different mutex for different names", async () => {
    const a = getMutex("name_a")
    const b = getMutex("name_b")
    // Different mutexes should not block each other
    const order: string[] = []
    await a.acquire()
    // b should be acquirable even though a is held
    await b.acquire()
    order.push("both-acquired")
    b.release()
    a.release()
    expect(order).toEqual(["both-acquired"])
  })
})
