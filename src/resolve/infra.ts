import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FetchFailure, FetchSource } from "./types";

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = 5000,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException("Aborted", "AbortError");
    }
    const onAbort = () => {
      controller.abort();
      clearTimeout(timer);
    };
    externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private stateFile: string;

  constructor(
    private maxFailures = 3,
    private cooldownMs = 60000,
    name = "default",
  ) {
    this.stateFile = path.join(os.tmpdir(), `hr-circuit-${name}.json`);
    this.loadState();
  }

  private loadState() {
    try {
      const data = JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));
      this.failures = data.failures ?? 0;
      this.lastFailureTime = data.lastFailureTime ?? 0;
    } catch {
      /* no state file = fresh start */
    }
  }

  private saveState() {
    try {
      fs.writeFileSync(
        this.stateFile,
        JSON.stringify({ failures: this.failures, lastFailureTime: this.lastFailureTime }),
      );
    } catch {
      /* non-critical */
    }
  }

  isOpen(): boolean {
    if (this.failures >= this.maxFailures && Date.now() - this.lastFailureTime < this.cooldownMs) return true;
    if (Date.now() - this.lastFailureTime > this.cooldownMs) {
      this.failures = 0;
      this.lastFailureTime = 0;
      this.saveState();
      return false;
    }
    return false;
  }

  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.saveState();
  }

  recordSuccess() {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.saveState();
  }
}

const breakers = new Map<string, CircuitBreaker>();

function getBreaker(source: string): CircuitBreaker {
  let cb = breakers.get(source);
  if (!cb) {
    cb = new CircuitBreaker(3, 60_000, source);
    breakers.set(source, cb);
  }
  return cb;
}

export function isCircuitOpen(source: string): boolean {
  return getBreaker(source).isOpen();
}

export function recordFailure(source: string) {
  getBreaker(source).recordFailure();
}

export function recordSuccess(source: string) {
  getBreaker(source).recordSuccess();
}

export function classifyFetchError(err: unknown, source: FetchSource): FetchFailure {
  const msg = err instanceof Error ? (err as Error & { code?: unknown; status?: number }) : null;
  const rawCode = msg?.code;
  const code = typeof rawCode === "string" ? rawCode.toUpperCase() : String(rawCode ?? "").toUpperCase();
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code.includes("TIMEOUT")) {
    return {
      source,
      reason: `Connection timed out — ${source} may be slow or unreachable from this network`,
      retryable: true,
    };
  }
  if (code === "ENOTFOUND" || code === "ECONNREFUSED") {
    return {
      source,
      reason: `DNS / connection refused — ${source} may be blocked from this network`,
      retryable: false,
    };
  }
  return {
    source,
    reason: `Network error (${code || "unknown"}) — ${source} may be temporarily unreachable`,
    retryable: true,
  };
}

export function httpFailure(source: FetchSource, status: number, label: string): FetchFailure {
  if (status === 429)
    return { source, reason: `Rate limited (HTTP 429) — ${label}. Wait 1-2 minutes before retrying.`, retryable: true };
  if (status === 503 || status === 502)
    return {
      source,
      reason: `${label} returned HTTP ${status} — service temporarily down. Retry later.`,
      retryable: true,
    };
  if (status === 404) return { source, reason: `Not found (404) — ${label}`, retryable: false };
  if (status === 403) return { source, reason: `Access denied (HTTP 403) — ${label}`, retryable: false };
  return { source, reason: `${label} returned HTTP ${status}`, retryable: status >= 500 };
}

export function formatFailure(f: FetchFailure): string {
  const retry = f.retryable ? " [retryable]" : " [permanent]";
  return `${f.source}: ${f.reason}${retry}`;
}
