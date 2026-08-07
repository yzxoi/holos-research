/**
 * In-memory async mutex for protecting critical write operations.
 * Prevents concurrent modifications when multiple sessions call the same tool.
 *
 * Mutexes are scoped per project directory + resource name, so concurrent
 * operations on *different* projects never block each other.
 */

import { scopeDir } from "./ctx";

export class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Run a function with the mutex held. Automatically releases on completion or error.
 */
export async function withLock<T>(mutex: AsyncMutex, fn: () => Promise<T>): Promise<T> {
  await mutex.acquire();
  try {
    return await fn();
  } finally {
    mutex.release();
  }
}

/**
 * Run a function with a mutex, but with a bounded acquire timeout and
 * AbortSignal support. If the signal fires or the timeout elapses before
 * the lock is acquired, a LockTimeoutError is thrown.
 *
 * This prevents indefinite blocking when a prior holder leaked the lock
 * (e.g. due to an un-handled async cancellation where release() was never
 * called).
 */
export class LockTimeoutError extends Error {
  constructor(mutexName: string, reason: "timeout" | "aborted") {
    const detail =
      reason === "timeout"
        ? `Timed out waiting for lock "${mutexName}" after 30s — a previous holder may have leaked it.`
        : `Aborted while waiting for lock "${mutexName}" (session cancelled).`;
    super(detail);
    this.name = "LockTimeoutError";
  }
}

export async function withLockTimeout<T>(
  mutex: AsyncMutex,
  fn: () => Promise<T>,
  opts?: {
    signal?: AbortSignal;
    /** How long to wait for the lock before giving up (ms). Default: 30_000 */
    acquireTimeoutMs?: number;
    /** A human-readable name for the mutex, used in error messages. */
    name?: string;
  },
): Promise<T> {
  const acquireTimeoutMs = opts?.acquireTimeoutMs ?? 30_000;
  const name = opts?.name ?? "unknown";

  // Race: lock acquisition vs timeout vs abort
  await raceWithTimeoutAndSignal(
    mutex.acquire(),
    acquireTimeoutMs,
    opts?.signal,
    () => {
      throw new LockTimeoutError(name, "timeout");
    },
    () => {
      throw new LockTimeoutError(name, "aborted");
    },
  );

  try {
    return await fn();
  } finally {
    mutex.release();
  }
}

/**
 * Internal helper: race a Promise against a fixed timeout and an optional
 * AbortSignal. If the timeout or signal fires before the promise resolves,
 * the corresponding error factory is called.
 */
async function raceWithTimeoutAndSignal<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onTimeout: () => never,
  onAbort: () => never,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbortHandler);
      reject(onTimeout());
    }, timeoutMs);

    const onAbortHandler = () => {
      clearTimeout(timer);
      reject(onAbort());
    };

    signal?.addEventListener("abort", onAbortHandler, { once: true });

    promise
      .then((result) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbortHandler);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbortHandler);
        reject(err);
      });
  });
}

// Scoped mutexes: key = "projectDir:resourceName"
const mutexes = new Map<string, AsyncMutex>();

/**
 * Get a named mutex scoped to the current project directory.
 * Different projects get different mutex instances for the same resource name,
 * so they never block each other.
 *
 * Resolution is lazy: the scope key is computed at lock-acquire time,
 * not at getMutex() call time. This allows module-level constants like
 * `const m = getMutex("x")` to be declared before initContext() runs.
 */
export function getMutex(name: string): AsyncMutex {
  return new LazyScopedMutex(name);
}

/**
 * Mutex proxy that resolves the real scoped mutex lazily on first acquire.
 * Avoids calling scopeDir() at module-load time.
 */
class LazyScopedMutex extends AsyncMutex {
  private name: string;
  private resolvedMutex: AsyncMutex | null = null;

  constructor(name: string) {
    super();
    this.name = name;
  }

  private resolve(): AsyncMutex {
    const scope = scopeDir();
    const key = `${scope}:${this.name}`;
    let m = mutexes.get(key);
    if (!m) {
      m = new AsyncMutex();
      mutexes.set(key, m);
    }
    return m;
  }

  override async acquire(): Promise<void> {
    this.resolvedMutex = this.resolve();
    return this.resolvedMutex.acquire();
  }

  override release(): void {
    (this.resolvedMutex ?? this.resolve()).release();
    this.resolvedMutex = null;
  }
}
