import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { ResearchFS } from "./fs";
import { log } from "./log";
import type { SnapshotManifest } from "./schema";
import { ProjectPhase } from "./schema";

export namespace SnapshotManager {
  const DIR = "snapshots";

  export function resolveDir(id: string): string {
    return ResearchFS.resolve(DIR, id);
  }

  export function manifestPath(id: string): string {
    return ResearchFS.resolve(DIR, id, "manifest.yaml");
  }

  function makeId(now: Date): string {
    // audit#1 P0-6: two snapshots within the same second (e.g. checkpoint
    // confirmed then RQG transition) would collide with second-precision IDs,
    // overwriting the first manifest and possibly its copied refs. Keep millis
    // and append a short random suffix to guarantee uniqueness.
    // Format: snap_2026-05-09T101600123Z_a1b2
    const iso = now.toISOString(); // 2026-05-09T10:16:00.123Z
    const cleaned = iso.replace(/[:.]/g, ""); // 2026-05-09T101600123Z
    const suffix = crypto.randomBytes(2).toString("hex"); // 4 hex chars
    return `snap_${cleaned}_${suffix}`;
  }

  export async function create(params: {
    trigger: string;
    phase?: string;
    next_phase?: string;
    summary: string;
    refs: Record<string, string>;
    copyRefs?: boolean;
  }): Promise<SnapshotManifest> {
    const now = new Date();
    const id = makeId(now);

    // Validate phase params
    if (
      params.phase &&
      !Object.values(ProjectPhase).includes(params.phase as (typeof ProjectPhase)[keyof typeof ProjectPhase])
    ) {
      log.warn("Snapshot", `Invalid phase: ${params.phase}`);
    }
    if (
      params.next_phase &&
      !Object.values(ProjectPhase).includes(params.next_phase as (typeof ProjectPhase)[keyof typeof ProjectPhase])
    ) {
      log.warn("Snapshot", `Invalid next_phase: ${params.next_phase}`);
    }

    // Compute artifact hashes
    const CRITICAL_REFS = ["state", "phase_run"];
    const artifactHashes: Record<string, string> = {};
    for (const [key, refPath] of Object.entries(params.refs)) {
      try {
        const buffer = await Bun.file(ResearchFS.resolve(refPath)).arrayBuffer();
        artifactHashes[key] = `sha256:${crypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex")}`;
      } catch (_err) {
        if (CRITICAL_REFS.includes(key)) {
          throw new Error(`Critical snapshot ref ${key} not found: ${refPath}`);
        } else {
          log.warn("Snapshot", `Non-critical ref missing: ${key} ${refPath}`);
          artifactHashes[key] = "missing";
        }
      }
    }

    const manifest: SnapshotManifest = {
      id,
      created: now.toISOString(),
      trigger: params.trigger,
      phase: params.phase as SnapshotManifest["phase"],
      next_phase: params.next_phase as SnapshotManifest["next_phase"],
      summary: params.summary,
      refs: params.refs,
      artifact_hashes: artifactHashes,
    };

    const snapDir = resolveDir(id);
    await ResearchFS.ensureDir(snapDir);

    if (params.copyRefs) {
      for (const [_key, refPath] of Object.entries(params.refs)) {
        try {
          const src = ResearchFS.resolve(refPath);
          const dest = path.join(snapDir, path.basename(refPath));
          await fs.copyFile(src, dest);
        } catch (err) {
          log.warn("Snapshot", `Failed to copy ref file: ${refPath}`, err);
        }
      }
    }

    await ResearchFS.writeYaml(manifestPath(id), manifest);
    return manifest;
  }

  export async function restore(id: string): Promise<{
    manifest: SnapshotManifest;
    copiedFiles: string[];
  }> {
    const manifest = await read(id);
    if (!manifest) {
      throw new Error(`Snapshot ${id} not found`);
    }

    const snapDir = resolveDir(id);
    const copiedFiles: string[] = [];

    for (const [key, refPath] of Object.entries(manifest.refs)) {
      const src = path.join(snapDir, path.basename(refPath));
      const dest = await ResearchFS.resolveSafe(refPath);
      try {
        // Verify hash before restoring
        const expectedHash = manifest.artifact_hashes?.[key];
        if (expectedHash && expectedHash !== "missing") {
          const srcBuffer = await Bun.file(src).arrayBuffer();
          const actualHash = `sha256:${crypto.createHash("sha256").update(Buffer.from(srcBuffer)).digest("hex")}`;
          if (actualHash !== expectedHash) {
            throw new Error(`Snapshot ${id} artifact ${key} hash mismatch (file may be corrupted)`);
          }
        }
        await ResearchFS.ensureDir(path.dirname(dest));
        await fs.copyFile(src, dest);
        copiedFiles.push(key);
      } catch (err) {
        log.warn("Snapshot", `Failed to restore file: ${dest}`, err);
      }
    }

    if (copiedFiles.length < Object.entries(manifest.refs).length) {
      const failed = Object.entries(manifest.refs).length - copiedFiles.length;
      log.warn("Snapshot", `Restore incomplete: ${failed} file(s) could not be restored`);
    }

    return { manifest, copiedFiles };
  }

  export async function read(id: string): Promise<SnapshotManifest | undefined> {
    return ResearchFS.readYaml<SnapshotManifest>(manifestPath(id));
  }

  export async function list(): Promise<SnapshotManifest[]> {
    const dir = ResearchFS.resolve(DIR);
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      // snapshot directory doesn't exist yet
      return [];
    }

    const manifests: SnapshotManifest[] = [];
    for (const entry of entries) {
      const manifest = await read(entry);
      if (manifest) manifests.push(manifest);
    }
    return manifests.sort((a, b) => a.created.localeCompare(b.created));
  }

  export async function getLatest(): Promise<SnapshotManifest | undefined> {
    const manifests = await list();
    return manifests.length > 0 ? manifests[manifests.length - 1] : undefined;
  }

  /** Create a snapshot when a human checkpoint is confirmed. */
  export async function onCheckpointConfirmed(params: {
    runId: string;
    checkpointKind: string;
    phase?: string;
  }): Promise<SnapshotManifest> {
    return create({
      trigger: "checkpoint.confirmed",
      phase: params.phase,
      summary: `Human checkpoint confirmed: ${params.checkpointKind}`,
      refs: { phase_run: `phase_runs/${params.runId}.yaml` },
    });
  }

  /** Create a snapshot when an RQG report changes status. */
  export async function onRqgStatusChange(params: {
    rqgId: string;
    newStatus: string;
    phase?: string;
    experimentRefs?: string[];
  }): Promise<SnapshotManifest> {
    const refs: Record<string, string> = {
      rqg: `rqg/${params.rqgId}.yaml`,
    };
    if (params.experimentRefs?.length) {
      for (const ref of params.experimentRefs) {
        refs[ref] = `experiments/${ref}.yaml`;
      }
    }
    return create({
      trigger: "rqg.status_changed",
      phase: params.phase,
      summary: `RQG status changed to: ${params.newStatus}`,
      refs,
    });
  }
}
