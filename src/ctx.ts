import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

/**
 * Minimal workspace Host Service surface used by the research filesystem layer.
 * In production this is backed by Synergy's `context.workspace`; in tests it is
 * backed by a temporary-directory stub.
 */
export interface WorkspaceService {
  read?(path: string): Promise<string>;
  write?(path: string, content: string): Promise<void>;
  metadata?(): Promise<{ scopeId?: string; directory?: string }>;
}

interface ResearchContext {
  directory: string;
  workspace?: WorkspaceService;
  runtimeDirectory?: string;
}

const store = new AsyncLocalStorage<ResearchContext>();

let _defaultContext: ResearchContext | undefined;
/**
 * Initialize the process-wide default research context.
 *
 * `workspace` is the Synergy workspace Host Service (production) or a
 * temporary-directory stub (tests). The legacy `config`/`auth`/`cache`
 * fields are accepted for source compatibility with migrated baseline
 * tests and ignored — API4 provides no such accessors.
 */
export function initContext(input: {
  directory: string;
  workspace?: WorkspaceService;
  config?: unknown;
  auth?: unknown;
  cache?: unknown;
}) {
  _defaultContext = {
    directory: input.directory,
    workspace: input.workspace,
  };
}
export function runWithDirectory<T>(directory: string | undefined, fn: () => Promise<T>): Promise<T> {
  const base = _defaultContext;
  if (!base) {
    throw new Error("ResearchFS not initialized — call initContext() first");
  }
  return store.run({ ...base, runtimeDirectory: directory }, fn);
}

/**
 * Run with a full invocation context (directory + workspace Host Service).
 * Production handlers bind the host-injected `context.workspace` here so the
 * filesystem layer and operations resolve the same service the host granted.
 * Unlike `runWithDirectory`, this does not require `initContext()` first —
 * the invocation supplies its own directory and workspace service.
 */
export function runWithInvocation<T>(
  directory: string | undefined,
  svc: WorkspaceService | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const base = _defaultContext;
  const ctx: ResearchContext = base
    ? { ...base, runtimeDirectory: directory, workspace: svc }
    : { directory: directory ?? "", runtimeDirectory: directory, workspace: svc };
  return store.run(ctx, fn);
}

export function scopeDir(): string {
  const ctx = store.getStore() ?? _defaultContext;
  if (!ctx) {
    throw new Error("ResearchFS not initialized — call initContext() first");
  }
  return ctx.runtimeDirectory ?? ctx.directory ?? "";
}

export function researchDir(): string {
  return path.join(scopeDir(), ".research");
}

/** The workspace Host Service bound to the current invocation (undefined in bare tests). */
export function workspace(): WorkspaceService | undefined {
  const ctx = store.getStore() ?? _defaultContext;
  return ctx?.workspace;
}
