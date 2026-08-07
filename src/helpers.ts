import { ResearchFS } from "./fs";
import type { DiagnosisReport } from "./schema";

/**
 * Load all YAML files from a subdirectory under the research directory.
 * Returns non-null parsed results (skips missing/corrupt files).
 * @param filter Optional filename filter — only files matching the predicate are loaded.
 */
export async function loadAllYaml<T>(subdir: string, filter?: (filename: string) => boolean): Promise<T[]> {
  const dir = ResearchFS.resolve(subdir);
  const files = await ResearchFS.listYaml(dir);
  const results: T[] = [];
  for (const file of files) {
    if (filter && !filter(file)) continue;
    const yaml = await ResearchFS.readYaml<T>(ResearchFS.resolve(subdir, file));
    if (yaml) results.push(yaml);
  }
  return results;
}

/**
 * Count items by a key function.
 */
export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/**
 * Merge state.focus.refs with phaseRun.refs consistently.
 * Run refs take priority over state refs.
 */
export function resolveFocusRefs(
  stateRefs: Record<string, string | string[] | undefined> | undefined,
  runRefs: Record<string, string | string[] | undefined> | undefined,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  // State refs first (lower priority)
  if (stateRefs) {
    for (const [k, v] of Object.entries(stateRefs)) {
      if (v !== undefined) result[k] = v;
    }
  }
  // Run refs override (higher priority)
  if (runRefs) {
    for (const [k, v] of Object.entries(runRefs)) {
      if (v !== undefined) result[k] = v;
    }
  }
  return result;
}

/**
 * Load and return diagnosis reports from the diagnoses directory.
 * Only loads files matching the `diag_*` prefix pattern.
 */
export async function loadDiagnosisReports(): Promise<DiagnosisReport[]> {
  const diagDir = ResearchFS.resolve("diagnoses");
  const allDiagFiles = await ResearchFS.listYaml(diagDir);
  const diagFiles = allDiagFiles.filter((f) => f.startsWith("diag_"));
  const diagnoses: DiagnosisReport[] = [];
  for (const file of diagFiles) {
    try {
      const report = await ResearchFS.readYaml<DiagnosisReport>(ResearchFS.resolve("diagnoses", file));
      if (report) diagnoses.push(report);
    } catch {
      // Skip corrupt or unreadable YAML files gracefully
    }
  }
  return diagnoses;
}
