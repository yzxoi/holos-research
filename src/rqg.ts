import { ResearchFS } from "./fs";
import { getMutex, withLock } from "./lock";
import type { ExperimentYaml, KillCriterion, RQGReport, SufficientCriterion } from "./schema";

const rqgMutex = getMutex("rqg");

// ---------------------------------------------------------------------------
// Statistical helpers (simplified — no external library)
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  const m = mean(values);
  const variance = values.length > 1 ? values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1) : 0;
  return Math.sqrt(variance);
}

function pooledStd(values1: number[], values2: number[]): number {
  const n1 = values1.length;
  const n2 = values2.length;
  const var1 = std(values1) ** 2;
  const var2 = std(values2) ** 2;
  return Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));
}

function cohenD(values1: number[], values2: number[]): number | undefined {
  if (values1.length < 2 || values2.length < 2) return undefined;
  const m1 = mean(values1);
  const m2 = mean(values2);
  const ps = pooledStd(values1, values2);
  if (ps === 0) return undefined;
  return (m1 - m2) / ps;
}

function confidenceInterval(values: number[]): [number, number] | undefined {
  if (values.length < 2) return undefined;
  const m = mean(values);
  const s = std(values);
  const se = s / Math.sqrt(values.length);
  return [m - 1.96 * se, m + 1.96 * se];
}

export namespace RQGManager {
  const DIR = "rqg";

  export function resolvePath(id: string): string {
    return ResearchFS.resolve(DIR, `${id}.yaml`);
  }

  export async function create(params: {
    plan_ref: string;
    experiment_refs: string[];
    kill_criteria: KillCriterion[];
    sufficient_criteria: SufficientCriterion[];
  }): Promise<RQGReport> {
    return withLock(rqgMutex, async () => {
      const id = `rqg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const report: RQGReport = {
        id,
        plan_ref: params.plan_ref,
        experiment_refs: params.experiment_refs,
        kill_set: params.kill_criteria.map((c) => ({
          id: c.id,
          passed: false,
        })),
        sufficient_set: params.sufficient_criteria.map((c) => ({
          id: c.id,
          passed: false,
        })),
        integrity: {
          metric_recompute: "pending",
          artifact_hash: "pending",
          redlines: "pending",
        },
        overall: "invalid",
        allowed_next: [],
        disallowed_next: [],
        kill_criteria_failed: false,
      };

      await ResearchFS.writeYaml(resolvePath(id), report);
      return report;
    });
  }

  export async function read(id: string): Promise<RQGReport | undefined> {
    return ResearchFS.readYaml<RQGReport>(resolvePath(id));
  }

  export async function evaluate(params: {
    report_id: string;
    experiments: ExperimentYaml[];
    kill_criteria: KillCriterion[];
    sufficient_criteria: SufficientCriterion[];
  }): Promise<RQGReport> {
    return withLock(rqgMutex, async () => {
      const report = await read(params.report_id);
      if (!report) throw new Error(`RQG report not found: ${params.report_id}`);

      // Evaluate kill set
      for (const criterion of params.kill_criteria) {
        const killEntry = report.kill_set.find((k) => k.id === criterion.id);
        if (!killEntry) continue;

        const relevantExps = params.experiments.filter(
          (e) =>
            e.group === criterion.experiment_role ||
            e.id.startsWith(`exp_${criterion.experiment_role}_`) ||
            e.id.startsWith(`exp_${criterion.experiment_role}-`),
        );

        if (relevantExps.length === 0) {
          killEntry.passed = false;
          continue;
        }

        // Gather metric values from completed experiments
        const metricValues: number[] = [];
        for (const e of relevantExps) {
          if (!e.metrics || e.status !== "completed") continue;
          const metricValue = e.metrics[criterion.metric];
          if (typeof metricValue === "number") metricValues.push(metricValue);
        }

        if (metricValues.length === 0) {
          killEntry.passed = false;
          continue;
        }

        const bestValue = criterion.direction === "max" ? Math.max(...metricValues) : Math.min(...metricValues);

        let observedDelta: number | undefined;
        let passed = false;

        if (criterion.baseline_value !== undefined && criterion.target_delta !== undefined) {
          observedDelta =
            criterion.direction === "max" ? bestValue - criterion.baseline_value : criterion.baseline_value - bestValue;
          passed = observedDelta >= criterion.target_delta;
        } else {
          // No quantitative threshold defined — cannot evaluate
          // Kill criteria without checks should not auto-pass
          passed = false;
        }

        killEntry.observed_delta = observedDelta;
        killEntry.passed = passed;

        // Compute Cohen's d if we have baseline and enough data
        if (criterion.baseline_value !== undefined && metricValues.length >= 2) {
          // One-sample Cohen's d: (mean - baseline) / sd(sample)
          // A constant baseline has zero variance; fabricating a fake sample inflates d.
          const m = metricValues.reduce((a, b) => a + b, 0) / metricValues.length;
          const variance = metricValues.reduce((sum, v) => sum + (v - m) ** 2, 0) / (metricValues.length - 1);
          const sd = Math.sqrt(variance);
          const d = sd > 0 ? (m - criterion.baseline_value) / sd : 0;
          killEntry.cohen_d = d;
        }

        // Compute confidence interval if enough data
        if (metricValues.length >= 2) {
          const ci = confidenceInterval(metricValues);
          if (ci !== undefined) killEntry.ci = ci;
        }
      }

      // Evaluate sufficient set
      for (const criterion of params.sufficient_criteria) {
        const suffEntry = report.sufficient_set.find((s) => s.id === criterion.id);
        if (!suffEntry) continue;

        const relevantExps = params.experiments.filter(
          (e) =>
            e.group === criterion.experiment_role ||
            e.id.startsWith(`exp_${criterion.experiment_role}_`) ||
            e.id.startsWith(`exp_${criterion.experiment_role}-`),
        );

        if (relevantExps.length === 0) {
          suffEntry.passed = false;
          continue;
        }

        // Gather metric values from completed experiments
        const metricValues: number[] = [];
        for (const e of relevantExps) {
          if (!e.metrics || e.status !== "completed") continue;
          const metricValue = e.metrics[criterion.metric];
          if (typeof metricValue === "number") metricValues.push(metricValue);
        }

        const hasValidResult =
          metricValues.length > 0 &&
          metricValues.some((v) => {
            if (criterion.target_value !== undefined) {
              return criterion.direction === "max" ? v >= criterion.target_value : v <= criterion.target_value;
            }
            return true;
          });

        suffEntry.passed = hasValidResult;

        if (metricValues.length > 0) {
          const bestValue = criterion.direction === "max" ? Math.max(...metricValues) : Math.min(...metricValues);
          suffEntry.observed = bestValue;
          suffEntry.target = criterion.target_value;
          if (criterion.target_value !== undefined) {
            suffEntry.gap =
              criterion.direction === "max" ? criterion.target_value - bestValue : bestValue - criterion.target_value;
          }
        }
      }

      // Determine overall status
      const hasKillCriteria = report.kill_set.length > 0;
      const _allKillPassed = hasKillCriteria && report.kill_set.every((k) => k.passed);
      const anyKillFailed = hasKillCriteria && report.kill_set.some((k) => !k.passed);
      const allSufficientPassed = report.sufficient_set.length > 0 && report.sufficient_set.every((s) => s.passed);
      const someSufficientPassed = report.sufficient_set.length > 0 && report.sufficient_set.some((s) => s.passed);

      if (anyKillFailed) {
        report.overall = "failed";
        report.allowed_next = ["iterate", "pivot"];
        report.disallowed_next = ["promote"];
        report.kill_criteria_failed = true;
      } else if (allSufficientPassed) {
        report.overall = "passed";
        report.allowed_next = ["promote", "iterate"];
        report.disallowed_next = [];
      } else if (someSufficientPassed) {
        report.overall = "partial";
        report.allowed_next = ["iterate", "pivot", "narrow_claim"];
        report.disallowed_next = ["promote"];
      } else if (_allKillPassed) {
        // All kill criteria passed but no sufficient criteria passed (or none defined)
        // If sufficient criteria exist but none passed, this is "partial" not "passed"
        // If no sufficient criteria defined at all, kill-only pass counts as "passed"
        const hasSufficientCriteria = report.sufficient_set.length > 0;
        if (hasSufficientCriteria) {
          report.overall = "partial";
          report.allowed_next = ["iterate", "pivot", "narrow_claim"];
          report.disallowed_next = ["promote"];
        } else {
          report.overall = "passed";
          report.allowed_next = ["promote", "iterate"];
          report.disallowed_next = [];
        }
      } else {
        report.overall = "failed";
        report.allowed_next = ["iterate", "pivot"];
        report.disallowed_next = ["promote"];
      }

      // Update integrity checks with actual verification.
      // audit#1 P1-5/6/7: these are PRESENCE checks, not verification. The
      // legacy field names (metric_recompute / artifact_hash) are kept for
      // backward compat with monitor / frontend; the integrity_notes array
      // surfaces the actual semantics so agents do not over-trust the labels.
      const completedExperiments = params.experiments.filter((e) => e.status === "completed");
      if (completedExperiments.length > 0) {
        // metric_recompute (presence): at least one completed experiment has non-empty metrics
        const anyMetricsRecorded = completedExperiments.some((e) => e.metrics && Object.keys(e.metrics).length > 0);
        const metricRecompute: "pass" | "fail" = anyMetricsRecorded ? "pass" : "fail";

        // artifact_hash (presence): completed experiments have code artifact references
        const anyArtifactsRegistered = completedExperiments.some(
          (e) => e.code_artifact_ref || (e.artifacts && Object.keys(e.artifacts).length > 0),
        );
        const artifactHash: "pass" | "fail" = anyArtifactsRegistered ? "pass" : "fail";

        // redlines: inspect actual red-line statuses of completed experiments.
        // audit#1 P1-7: `flagged` is "under review" — NOT a pass signal.
        // Map flagged → integrity = "pending" rather than swallowing the signal.
        let anyFlagged = false;
        const allExperimentsHavePassedRedlines = completedExperiments.every((e) => {
          if (!e.redlines?.status) return true; // no redlines declared = pass (presence-only)
          const statuses = Object.values(e.redlines.status);
          if (statuses.some((s) => s === "flagged")) anyFlagged = true;
          return statuses.every((s) => s === "passed" || s === "waived" || s === "flagged");
        });
        const redlinesResult: "pass" | "fail" | "pending" = !allExperimentsHavePassedRedlines
          ? "fail"
          : anyFlagged
            ? "pending"
            : "pass";

        report.integrity = {
          metric_recompute: metricRecompute,
          artifact_hash: artifactHash,
          redlines: redlinesResult,
        };

        // Truthfulness notes for agents. These are presence checks, not verification.
        const notes: string[] = [];
        if (metricRecompute === "pass") {
          notes.push(
            "metric_recompute: PRESENCE-ONLY — metrics fields are populated. NO recomputation against artifacts is performed.",
          );
        } else {
          notes.push("metric_recompute: No metrics recorded");
        }
        if (artifactHash === "pass") {
          notes.push(
            "artifact_hash: PRESENCE-ONLY — code_artifact_ref / artifacts strings are present. NO hash verification is performed.",
          );
        } else {
          notes.push("artifact_hash: No code artifacts registered — hash verification not possible");
        }
        if (redlinesResult === "pending") {
          notes.push(
            "redlines: PENDING — one or more experiments have flagged red-lines under review. Resolve to passed/waived before promote.",
          );
        }
        report.integrity_notes = notes;
      } else {
        report.integrity = {
          metric_recompute: "pending",
          artifact_hash: "pending",
          redlines: "pending",
        };
      }

      await ResearchFS.writeYaml(resolvePath(report.id), report);
      return report;
    });
  }

  export async function updateIntegrity(params: {
    report_id: string;
    metric_recompute?: "pass" | "fail" | "pending";
    artifact_hash?: "pass" | "fail" | "pending";
    redlines?: "pass" | "fail" | "pending";
    experiments?: ExperimentYaml[];
  }): Promise<RQGReport> {
    return withLock(rqgMutex, async () => {
      const report = await read(params.report_id);
      if (!report) throw new Error(`RQG report not found: ${params.report_id}`);

      let redlinesStatus = params.redlines ?? report.integrity?.redlines ?? "pending";

      // Actually check experiment redlines if experiments are provided
      if (params.experiments && redlinesStatus !== "fail") {
        const anyFailed = params.experiments.some((e) => {
          if (!e.redlines?.status) return false;
          return Object.values(e.redlines.status).some((s) => s === "violated");
        });
        if (anyFailed) redlinesStatus = "fail";
      }

      report.integrity = {
        metric_recompute: params.metric_recompute ?? report.integrity?.metric_recompute ?? "pending",
        artifact_hash: params.artifact_hash ?? report.integrity?.artifact_hash ?? "pending",
        redlines: redlinesStatus,
      };

      // If any integrity check fails, mark as invalid
      if (
        report.integrity.metric_recompute === "fail" ||
        report.integrity.artifact_hash === "fail" ||
        report.integrity.redlines === "fail"
      ) {
        report.overall = "invalid";
        report.allowed_next = ["iterate"];
        report.disallowed_next = ["promote", "pivot"];
      }

      await ResearchFS.writeYaml(resolvePath(report.id), report);
      return report;
    });
  }
}
