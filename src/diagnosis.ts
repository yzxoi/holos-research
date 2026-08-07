import { ResearchFS } from "./fs";
import { getMutex, withLock } from "./lock";
import type { DiagnosisReport, RQGReport } from "./schema";

const diagnosisMutex = getMutex("diagnosis");

export namespace DiagnosisManager {
  export function resolvePath(id: string): string {
    return ResearchFS.resolve("diagnoses", `${id}.yaml`);
  }

  export async function create(params: {
    experiment_refs: string[];
    plan_ref?: string;
    code_artifact_ref?: string;
  }): Promise<DiagnosisReport> {
    return withLock(diagnosisMutex, async () => {
      const id = `diag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      for (const ref of params.experiment_refs) {
        const exists = await ResearchFS.readYaml(ResearchFS.resolve("experiments", `${ref}.yaml`));
        if (!exists) {
          throw new Error(`Diagnosis references non-existent experiment: ${ref}`);
        }
      }

      if (params.plan_ref) {
        const planExists = await ResearchFS.readYaml(ResearchFS.resolve("plans", `${params.plan_ref}.yaml`));
        if (!planExists) throw new Error(`Diagnosis references non-existent plan: ${params.plan_ref}`);
      }

      const report: DiagnosisReport = {
        id,
        experiment_refs: params.experiment_refs,
        plan_ref: params.plan_ref,
        code_artifact_ref: params.code_artifact_ref,
        levels: {},
        conclusion: {
          likely_cause: undefined,
          recommended_decision: undefined,
          forbidden_decisions: [],
        },
      };
      await ResearchFS.writeYaml(resolvePath(id), report);
      return report;
    });
  }

  export async function read(id: string): Promise<DiagnosisReport | undefined> {
    return ResearchFS.readYaml<DiagnosisReport>(resolvePath(id));
  }

  export async function updateLevel(
    reportId: string,
    level: keyof DiagnosisReport["levels"],
    status: "pass" | "warning" | "fail" | "pending",
    evidence?: string,
    recommended_action?: string,
  ): Promise<DiagnosisReport | undefined> {
    return withLock(diagnosisMutex, async () => {
      const report = await read(reportId);
      if (!report) return undefined;

      report.levels = {
        ...report.levels,
        [level]: { status, evidence, recommended_action },
      };

      await ResearchFS.writeYaml(resolvePath(reportId), report);
      return report;
    });
  }

  export async function setConclusion(
    reportId: string,
    conclusion: DiagnosisReport["conclusion"],
  ): Promise<DiagnosisReport | undefined> {
    return withLock(diagnosisMutex, async () => {
      const report = await read(reportId);
      if (!report) return undefined;

      report.conclusion = conclusion;
      await ResearchFS.writeYaml(resolvePath(reportId), report);
      return report;
    });
  }

  /**
   * Anti-give-up rule: before method-failure pivot, verify:
   * 1. L1-L6 report is completed (not all pending)
   * 2. At least one implementation review or justification
   * 3. Min seeds check (if applicable)
   * 4. RQG failure is not caused by metric/data/benchmark mismatch
   * 5. Human checkpoint confirmed (or waived)
   */
  export function checkAntiGiveUp(
    report: DiagnosisReport,
    rqg?: RQGReport,
  ): { allowed: boolean; reason: string; forbidden_decisions: string[] } {
    const forbidden: string[] = [];

    // Check 1: L1-L6 not all pending
    const allPending = Object.values(report.levels).every((l) => !l || l.status === "pending");
    if (allPending) {
      forbidden.push("pivot_to_design");
      forbidden.push("pivot_to_ground");
      return {
        allowed: false,
        reason: "L1-L6 diagnosis not started. Complete diagnosis before pivoting.",
        forbidden_decisions: forbidden,
      };
    }

    // Check 2: L1-L3 must be checked before method-failure pivot
    const l1l2l3Checked =
      report.levels.L1_training_health?.status !== "pending" &&
      report.levels.L2_eval_correctness?.status !== "pending" &&
      report.levels.L3_data_integrity?.status !== "pending";
    if (!l1l2l3Checked) {
      forbidden.push("pivot_to_design");
      return {
        allowed: false,
        reason: "L1-L3 (training, eval, data) must be diagnosed before method-failure pivot.",
        forbidden_decisions: forbidden,
      };
    }

    // Check 4: RQG failure not caused by metric/data/benchmark mismatch
    if (rqg?.integrity) {
      const integrityFailed = rqg.integrity.metric_recompute === "fail" || rqg.integrity.artifact_hash === "fail";
      if (integrityFailed) {
        forbidden.push("pivot_to_design");
        return {
          allowed: false,
          reason:
            "RQG integrity checks failed (metric recompute or artifact hash). Fix implementation/evaluation issues before method-failure pivot.",
          forbidden_decisions: forbidden,
        };
      }
    }

    return { allowed: true, reason: "Anti-give-up checks passed.", forbidden_decisions: forbidden };
  }

  export function determinePivotRoute(
    report: DiagnosisReport,
    rqg?: RQGReport,
  ): {
    decision: "iterate" | "pivot" | "promote" | "abort";
    target?: "explore" | "ground" | "design" | "realize" | "experiment" | "compose";
    reason: string;
    forbidden_decisions: string[];
  } {
    const levels = report.levels;
    const forbidden: string[] = [];

    // Check anti-give-up rules first
    const antiGiveUp = checkAntiGiveUp(report, rqg);
    if (!antiGiveUp.allowed) {
      forbidden.push(...antiGiveUp.forbidden_decisions);
    }

    // L1-L3 fail → realize (code/data/eval bugs)
    if (
      levels.L1_training_health?.status === "fail" ||
      levels.L2_eval_correctness?.status === "fail" ||
      levels.L3_data_integrity?.status === "fail"
    ) {
      return {
        decision: "pivot",
        target: "realize",
        reason: "Implementation, evaluation, or data issues detected (L1-L3). Fix code before reconsidering method.",
        forbidden_decisions: forbidden,
      };
    }

    // L4-L5 fail → iterate (more hp sweep, more seeds)
    if (levels.L4_hyperparameter_range?.status === "fail" || levels.L5_seed_stability?.status === "fail") {
      return {
        decision: "iterate",
        reason: "Hyperparameter or seed issues (L4-L5). Run more experiments before pivoting.",
        forbidden_decisions: forbidden,
      };
    }

    // L6 fail → ground (story/benchmark mismatch)
    if (levels.L6_benchmark_story_alignment?.status === "fail") {
      return {
        decision: "pivot",
        target: "ground",
        reason: "Benchmark or story mismatch (L6). Reconsider paper positioning.",
        forbidden_decisions: forbidden,
      };
    }

    // All pass → check RQG for final routing
    const allPass =
      levels.L1_training_health?.status === "pass" &&
      levels.L2_eval_correctness?.status === "pass" &&
      levels.L3_data_integrity?.status === "pass" &&
      levels.L4_hyperparameter_range?.status === "pass" &&
      levels.L5_seed_stability?.status === "pass" &&
      levels.L6_benchmark_story_alignment?.status === "pass";

    if (allPass) {
      if (rqg) {
        if (rqg.overall === "failed") {
          if (!antiGiveUp.allowed) {
            return {
              decision: "iterate",
              reason: `${antiGiveUp.reason} RQG failed but anti-give-up rules block pivot.`,
              forbidden_decisions: forbidden,
            };
          }
          return {
            decision: "pivot",
            target: "design",
            reason: "L1-L6 passed but RQG strongly failed. Method mechanism may be insufficient.",
            forbidden_decisions: forbidden,
          };
        }
        if (rqg.overall === "partial") {
          return {
            decision: "iterate",
            reason: "L1-L6 passed but RQG partial. Consider narrowing claim or more experiments.",
            forbidden_decisions: forbidden,
          };
        }
      }
      return {
        decision: "promote",
        reason: "All diagnostic levels passed. Evidence is trustworthy.",
        forbidden_decisions: forbidden,
      };
    }

    // Mixed results → iterate with caution
    return {
      decision: "iterate",
      reason: "Diagnostic results are mixed. Continue experimentation with targeted fixes.",
      forbidden_decisions: forbidden,
    };
  }
}
