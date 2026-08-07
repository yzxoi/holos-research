import { tool } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { DiagnosisManager } from "../diagnosis";
import { ResearchFS } from "../fs";
import { ResearchId } from "../id";
import { ResearchJournal } from "../journal";
import { withLock } from "../lock";
import { log } from "../log";
import { updateActivePhaseRun } from "../phase-run";
import { ResearchReview } from "../review";
import { RQGManager } from "../rqg";
import type { DiagnosisReport, ExperimentYaml, PlanYaml, RQGReport, StateYaml } from "../schema";
import {
  EvidenceAuthenticity,
  ExperimentBackend,
  ExperimentGroup,
  ExperimentStatus,
  RedlineRule,
  type RedlineStatus,
  ReviewerRole,
  ReviewVerdict,
} from "../schema";
import { ResearchTimeline } from "../timeline";
import {
  allRedlinesPassed,
  appendNotes,
  entityMdPath,
  experimentMutex,
  formatAuthenticity,
  formatRedlineStatus,
  initRedlineStatus,
  isTerminalTransition,
  lineageWarning,
  mdMeta,
  missingParam,
  notFound,
  notInitialized,
  validateAuthenticity,
  withGuard,
} from "./shared";

const EXPERIMENT_TRANSITIONS: Record<string, string[]> = {
  registered: ["scheduled", "running", "invalidated"],
  scheduled: ["running", "invalidated"],
  running: ["completed", "failed", "stopped"],
  completed: ["invalidated", "failed"],
  failed: [],
  invalidated: [],
  stopped: ["registered"], // Allow restart of stopped experiments
};

function validateExperimentTransition(from: string, to: string): string | null {
  if (from === to) return null;
  const allowed = EXPERIMENT_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    return `Cannot transition from "${from}" to "${to}". Allowed: ${(allowed ?? []).join(", ") || "none"}`;
  }
  return null;
}

const DESCRIPTION = `Manage experiment records — track the full lifecycle from registration through execution to results and review.

Lifecycle: register → schedule → start → complete / fail. Completed experiments can later be invalidated if results turn out to be unusable.

- action="register": Register a new experiment (auto-assigned ID, e.g. exp_007). Captures current git commit. Creates .yaml + .md template. Appends exp.created.
- action="schedule": Mark an experiment as scheduled/submitted to an execution platform. Appends exp.status.
- action="start": Mark as running. Records started timestamp. Appends exp.status.
- action="complete": Mark as completed with metrics/artifacts. Records finished timestamp. Appends exp.status.
- action="fail": Mark as failed with a reason. Records finished timestamp. Appends exp.status.
- action="invalidate": Mark a completed experiment as invalid (e.g. data leak discovered, wrong baseline, bug in eval). Distinct from failure — the experiment ran successfully but results are unusable. Appends exp.status.
- action="stop": Manually stop an experiment. Appends exp.status.
- action="review": Record a structured review on an experiment. Uses the shared review system. Appends exp.reviewed.
- action="list": List experiments with optional filters by group or status. Only reads .yaml metadata — for full content (notes, analysis, observations), read the .md file at the path shown in md_path.
- action="compare": Compare metrics across multiple experiments in a table.
- action="update": Generic metadata update for fields not covered by semantic actions.
- action="diagnose": Create a DiagnosisReport for one or more experiments. This is the anti-give-up mechanism — before pivoting from experiment to design/ground, a structured L1-L6 diagnosis must be completed.

IMPORTANT:
- This tool only MANAGES the experiment record. It does NOT execute experiments. Execution is done by calling the appropriate submit tool (e.g. inspire_submit for GPU training, bash for local runs) separately, then updating the record here.
- When scheduling or starting, pass the job_id from the submission tool so the record links to the running job.
- The .md file is for your notes, observations, and analysis. Edit it freely.
- Failed experiments are as valuable as successful ones — always record them with failure_reason.
- Invalidation is for experiments that ran correctly but whose results cannot be trusted (data contamination, implementation bug discovered later, wrong evaluation protocol, etc.).

Backend types and execution mapping:
- inspire: use inspire_submit or inspire_submit_hpc to execute. Pass job_id back when scheduling/starting.
- local: execute via bash tool. No job_id needed.
- api: execute via bash (curl/python). No job_id needed.
- manual: user handles execution. Just record results when done.

Typical flow for inspire backend:
  research_experiment(register, title="Method v3", backend="inspire", plan="plan_002")
  → inspire_submit(name="exp_007", command="python train.py", ...)
  → research_experiment(schedule, id="exp_007", job_id="job-xxx")
  → research_experiment(start, id="exp_007")
  → [wait for completion]
  → research_experiment(complete, id="exp_007", metrics={...}, artifacts={...})

Content and Notes:
- Pass content="## Setup\n\n..." on register to document experiment design upfront (replaces empty template).
- Pass notes="..." on complete/fail/invalidate/stop to record analysis and findings (append-only with timestamp).
- Always use notes on complete — document what you learned, not just the metrics.
- .md files are append-only research trail — never delete previous content.

Files: .research/experiments/ (exp_XXX.yaml + exp_XXX.md + exp_XXX.reviews.jsonl)`;

async function loadYaml(id: string) {
  const yamlPath = ResearchFS.resolve("experiments", `${id}.yaml`);
  const yaml = await ResearchFS.readYaml<ExperimentYaml>(yamlPath);
  return { yamlPath, yaml };
}

interface AutoEvaluateRQGParams {
  planRef: string;
  experimentId: string;
  writeRqgNotes?: boolean;
}

async function autoEvaluateRQG(
  params: AutoEvaluateRQGParams,
): Promise<{ report: RQGReport | null; outputLines: string[] }> {
  const { planRef, experimentId, writeRqgNotes = false } = params;

  const planYaml = await ResearchFS.readYaml<PlanYaml>(ResearchFS.resolve("plans", `${planRef}.yaml`));
  if (!planYaml || (planYaml.kill_set.length === 0 && planYaml.sufficient_set.length === 0)) {
    return { report: null, outputLines: [] };
  }

  const outputLines: string[] = [];

  // Load all experiments for this plan
  const expFiles = await ResearchFS.listYaml(ResearchFS.resolve("experiments"));
  const planExps: ExperimentYaml[] = [];
  for (const f of expFiles) {
    const ey = await ResearchFS.readYaml<ExperimentYaml>(ResearchFS.resolve("experiments", f));
    if (ey && ey.plan_ref === planRef) planExps.push(ey);
  }

  // Find existing RQG for this plan
  const rqgFiles = await ResearchFS.listYaml(ResearchFS.resolve("rqg"));
  let existingRqg: RQGReport | undefined;
  for (const f of rqgFiles) {
    const r = await ResearchFS.readYaml<RQGReport>(ResearchFS.resolve("rqg", f));
    if (r && r.plan_ref === planRef) {
      existingRqg = r;
      break;
    }
  }

  let report: RQGReport;
  if (!existingRqg) {
    report = await RQGManager.create({
      plan_ref: planRef,
      experiment_refs: planExps.map((e) => e.id),
      kill_criteria: planYaml.kill_set,
      sufficient_criteria: planYaml.sufficient_set,
    });
    // Add rqg ref to plan
    if (!planYaml.rqg_refs.includes(report.id)) {
      planYaml.rqg_refs.push(report.id);
      await ResearchFS.writeYaml(ResearchFS.resolve("plans", `${planRef}.yaml`), planYaml);
    }
    outputLines.push(`📊 Created ${report.id} for ${planRef}`);
  } else {
    report = existingRqg;
    // Update experiment refs if needed
    const newRefs = planExps.map((e) => e.id).filter((id) => !report.experiment_refs.includes(id));
    if (newRefs.length > 0) {
      report.experiment_refs.push(...newRefs);
    }
  }

  report = await RQGManager.evaluate({
    report_id: report.id,
    experiments: planExps,
    kill_criteria: planYaml.kill_set,
    sufficient_criteria: planYaml.sufficient_set,
  });

  // Ensure evaluated report's id is in plan's rqg_refs
  if (!planYaml.rqg_refs.includes(report.id)) {
    planYaml.rqg_refs.push(report.id);
    await ResearchFS.writeYaml(ResearchFS.resolve("plans", `${planRef}.yaml`), planYaml);
  }

  if (writeRqgNotes) {
    // Append rqg_contributions to the experiment yaml
    const { yamlPath, yaml } = await loadYaml(experimentId);
    if (!yaml) {
      outputLines.push(`⚠️ Could not load experiment ${experimentId} for RQG contribution write-back`);
    } else {
      yaml.rqg_contributions = [...(yaml.rqg_contributions ?? []), report.id];
      await ResearchFS.writeYaml(yamlPath, yaml);
    }

    await ResearchTimeline.append({
      type: "exp.status",
      id: experimentId,
      summary: `RQG evaluated: ${report.overall}`,
      refs: [report.id, planRef],
    });

    const killSummary = report.kill_set
      .map(
        (k) =>
          `  ${k.passed ? "✅" : "❌"} ${k.id}${k.observed_delta !== undefined ? ` (Δ=${k.observed_delta.toFixed ? k.observed_delta.toFixed(4) : k.observed_delta})` : ""}`,
      )
      .join("\n");
    const suffSummary = report.sufficient_set
      .map(
        (s) =>
          `  ${s.passed ? "✅" : "❌"} ${s.id}${s.observed !== undefined ? ` (obs=${s.observed.toFixed ? s.observed.toFixed(4) : s.observed}${s.target !== undefined ? ` / target=${s.target}` : ""})` : ""}`,
      )
      .join("\n");

    const rqgNote = [
      `## RQG Evaluation: ${report.overall.toUpperCase()}`,
      "",
      `**Report:** ${report.id}`,
      `**Plan:** ${planRef}`,
      "",
      "### Kill Set",
      killSummary || "  (none)",
      "",
      "### Sufficient Set",
      suffSummary || "  (none)",
      "",
      `**Allowed next:** ${report.allowed_next.join(", ") || "—"}`,
      `**Disallowed next:** ${report.disallowed_next.join(", ") || "—"}`,
      "",
    ].join("\n");
    await appendNotes("experiments", experimentId, "RQG", rqgNote);
  }

  outputLines.push(
    `📊 RQG ${report.overall.toUpperCase()} — ${report.id}`,
    `Kill: ${report.kill_set.filter((k) => k.passed).length}/${report.kill_set.length} passed`,
    `Sufficient: ${report.sufficient_set.filter((s) => s.passed).length}/${report.sufficient_set.length} passed`,
    `Next: ${report.allowed_next.join(", ") || "—"}`,
    ...(report.kill_criteria_failed ? ["🚫 KILL CRITERIA FAILED — promotion is blocked"] : []),
  );

  return { report, outputLines };
}

// ── Action Handlers ────────────────────────────────────────────────────────

async function handleRegister(params: any, activePhaseRun?: string): Promise<any> {
  if (!params.title) return missingParam("title", "Please provide a title for the experiment.");

  const id = await ResearchId.next("exp");
  const now = new Date().toISOString();

  let codeCommit: string | undefined;
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
      cwd: ResearchFS.resolve("..").replace(/\/\.research$/, ""),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) {
      const raw = new TextDecoder().decode(proc.stdout).trim();
      // Only accept valid hex commit hashes (schema enforces this)
      codeCommit = /^[0-9a-f]{7,40}$/.test(raw) ? raw : undefined;
    }
  } catch {
    // intentional: git may not be available outside a repo
  }

  const yaml: ExperimentYaml = {
    id,
    title: params.title,
    group: params.group,
    status: "registered",
    backend: params.backend,
    idea_ref: params.idea_ref,
    plan_ref: params.plan_ref,
    created: now,
    code_commit: codeCommit,
    hyperparameters: params.hyperparameters,
    redlines: params.redlines?.length
      ? {
          rules: params.redlines,
          domain_constraints: params.domain_constraints,
          status: initRedlineStatus(params.redlines),
        }
      : undefined,
    authenticity: params.authenticity ?? "evidence",
    rqg_contributions: [],
    log: [],
    notes: [],
  };
  await ResearchFS.writeYaml(ResearchFS.resolve("experiments", `${id}.yaml`), yaml);

  const md = params.content ?? [`## Notes`, "", "(observations, analysis, and results go here)", ""].join("\n");
  await ResearchFS.writeMd(ResearchFS.resolve("experiments", `${id}.md`), md);

  const refs: string[] = [];
  if (params.idea_ref) refs.push(params.idea_ref);
  if (params.plan_ref) refs.push(params.plan_ref);

  await ResearchTimeline.append({
    type: "exp.created",
    id,
    title: params.title,
    group: params.group,
    summary: params.title,
    refs: refs.length > 0 ? refs : undefined,
  });

  await ResearchJournal.appendAgentNote({
    kind: "experiment_note",
    refs: [id, ...(params.plan_ref ? [params.plan_ref] : []), ...(params.idea_ref ? [params.idea_ref] : [])],
    summary: `Experiment registered: ${params.title}`,
    note: params.content
      ? `Initial experiment design written for ${id}.`
      : `Experiment ${id} registered. Document setup, expected results, and success criteria in the .md.`,
  });

  await updateActivePhaseRun(
    "experiment",
    { incrementAttempts: true, summary: `Registered ${id}: ${params.title}` },
    activePhaseRun,
  );

  // ── Back-link: update plan.experiment_refs ──
  let backLinkWarning: string | undefined;
  if (params.plan_ref) {
    try {
      const plan = await ResearchFS.readYaml<PlanYaml>(ResearchFS.resolve("plans", `${params.plan_ref}.yaml`));
      if (plan) {
        if (!plan.experiment_refs) plan.experiment_refs = [];
        if (!plan.experiment_refs.includes(id)) {
          plan.experiment_refs.push(id);
          await ResearchFS.writeYaml(ResearchFS.resolve("plans", `${params.plan_ref}.yaml`), plan);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("BackLink", "Failed to update plan.experiment_refs:", msg);
      backLinkWarning = `⚠️ Back-link failed: plan ${params.plan_ref}.experiment_refs not updated (${msg})`;
    }
  }

  return {
    title: `Experiment registered: ${id}`,
    output:
      [
        `✅ Registered ${id}: ${params.title}`,
        "",
        `Files:`,
        `  .research/experiments/${id}.yaml (metadata)`,
        `  .research/experiments/${id}.md (${params.content ? "content written" : "template — use notes param on complete/fail to append findings"})`,
        "",
        `Status: registered`,
        ...(params.group ? [`Group: ${params.group}`] : []),
        ...(params.backend ? [`Backend: ${params.backend}`] : []),
        ...(codeCommit ? [`Code commit: ${codeCommit}`] : []),
        ...(params.idea_ref ? [`Idea: ${params.idea_ref}`] : []),
        ...(params.plan_ref ? [`Plan: ${params.plan_ref}`] : []),
        ...(params.redlines?.length ? ["", "Red-lines:", formatRedlineStatus(yaml.redlines!)] : []),
        ...["", `Authenticity: ${formatAuthenticity(yaml.authenticity)}`],
        ...(backLinkWarning ? ["", backLinkWarning] : []),
      ].join("\n") + lineageWarning("experiment", params),
    metadata: mdMeta({ id, path: `.research/experiments/${id}` }),
  };
}

async function handleSchedule(params: any): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to schedule (e.g. "exp_007").');
  const { yamlPath, yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const transitionError = validateExperimentTransition(yaml.status, "scheduled");
  if (transitionError) {
    return {
      title: "Invalid transition",
      output: `❌ ${transitionError}`,
      metadata: mdMeta({ error: "invalid_transition", id: params.id, current: yaml.status, target: "scheduled" }),
    };
  }

  const prevStatus = yaml.status;
  yaml.status = "scheduled";
  if (params.job_id) yaml.job_id = params.job_id;

  await ResearchFS.writeYaml(yamlPath, yaml);

  await ResearchTimeline.append({
    type: "exp.status",
    id: params.id,
    from: prevStatus,
    to: "scheduled",
    summary: `${params.id} scheduled${params.job_id ? ` (${params.job_id})` : ""}`,
    ...(yaml.job_id ? { title: yaml.job_id } : {}),
  });

  return {
    title: `${params.id} scheduled`,
    output: [`✅ ${params.id} marked as scheduled`, ...(params.job_id ? [`Job ID: ${params.job_id}`] : [])].join("\n"),
    metadata: mdMeta({ id: params.id, status: "scheduled" }),
  };
}

async function handleStart(params: any, activePhaseRun?: string): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to start (e.g. "exp_007").');
  const { yamlPath, yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const transitionError = validateExperimentTransition(yaml.status, "running");
  if (transitionError) {
    return {
      title: "Invalid transition",
      output: `❌ ${transitionError}`,
      metadata: mdMeta({ error: "invalid_transition", id: params.id, current: yaml.status, target: "running" }),
    };
  }

  const prevStatus = yaml.status;
  yaml.status = "running";
  yaml.started = new Date().toISOString();
  if (params.job_id) yaml.job_id = params.job_id;

  await ResearchFS.writeYaml(yamlPath, yaml);

  await ResearchTimeline.append({
    type: "exp.status",
    id: params.id,
    from: prevStatus,
    to: "running",
    summary: `${params.id} started${yaml.job_id ? ` (${yaml.job_id})` : ""}`,
    ...(yaml.job_id ? { title: yaml.job_id } : {}),
  });

  await updateActivePhaseRun("experiment", { state: "attempt", summary: `Started ${params.id}` }, activePhaseRun);

  return {
    title: `${params.id} started`,
    output: [
      `✅ ${params.id} marked as running`,
      `Started: ${yaml.started}`,
      ...(yaml.job_id ? [`Job ID: ${yaml.job_id}`] : []),
    ].join("\n"),
    metadata: mdMeta({ id: params.id, status: "running" }),
  };
}

async function handleComplete(params: any, activePhaseRun?: string): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to complete (e.g. "exp_007").');
  const { yamlPath, yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const transitionError = validateExperimentTransition(yaml.status, "completed");
  if (transitionError) {
    return {
      title: "Invalid transition",
      output: `❌ ${transitionError}`,
      metadata: mdMeta({ error: "invalid_transition", id: params.id, current: yaml.status, target: "completed" }),
    };
  }

  // audit#2 P0-3: when authenticity defaults to "evidence" but redlines are
  // not declared, completion is permitted today (existing tests assert this as
  // intentional backward-compat). A proper fix needs a multi-step migration:
  // (1) deprecate the "evidence" default in register, (2) require explicit
  // authenticity, (3) then require redlines for declared evidence. Deferred to
  // a dedicated PR with test updates — see tmp/BUGS_TRIAGE_2026-05-19.md.
  // For now, the integrity backdoor remains; the claim-support / finalize
  // gates in claim.ts catch most downstream misuse.

  // Red-line gate: refuse completion if red-lines are declared but not all passed
  if (yaml.redlines && !allRedlinesPassed(yaml.redlines)) {
    const failed = yaml.redlines.rules.filter(
      (r) => yaml.redlines!.status[r] !== "passed" && yaml.redlines!.status[r] !== "waived",
    );
    return {
      title: "Red-line gate blocked",
      output: [
        `❌ Cannot complete ${params.id}: red-line checks not passed.`,
        "",
        `Failed red-lines: ${failed.join(", ")}`,
        "",
        "Run auditor subagent to verify red-lines, then update status:",
        `  research_experiment(action="update", id="${params.id}", redline_status={...})`,
        "",
        "Or if violations are confirmed, invalidate the experiment:",
        `  research_experiment(action="invalidate", id="${params.id}", invalidation_reason="Red-line violation: ...")`,
      ].join("\n"),
      metadata: mdMeta({ id: params.id, error: "redline_blocked", failed_redlines: failed }),
    };
  }

  // Authenticity gate: refuse completion for prototypes
  const authError = validateAuthenticity(yaml.authenticity, "complete");
  if (authError) {
    return {
      title: "Authenticity gate blocked",
      output: [
        `❌ Cannot complete ${params.id}: ${authError}`,
        "",
        "Prototypes are for debugging pipeline and code. They use synthetic data,",
        "homemade evaluators, or toy subsets — none of which constitute scientific evidence.",
        "",
        "To produce publishable results, register a new experiment with:",
        `  research_experiment(action="register", authenticity="evidence", ...)`,
        "",
        "Or if this is a direction-validation run on real data at reduced scale:",
        `  research_experiment(action="register", authenticity="pilot", ...)`,
      ].join("\n"),
      metadata: mdMeta({ id: params.id, error: "authenticity_blocked" }),
    };
  }

  const prevStatus = yaml.status;
  yaml.status = "completed";
  yaml.finished = new Date().toISOString();
  if (params.metrics) yaml.metrics = { ...yaml.metrics, ...params.metrics };
  if (params.artifacts) yaml.artifacts = { ...yaml.artifacts, ...params.artifacts };

  await ResearchFS.writeYaml(yamlPath, yaml);

  await ResearchTimeline.append({
    type: "exp.status",
    id: params.id,
    from: prevStatus,
    to: "completed",
    summary: yaml.title,
    ...(params.metrics ? { metrics: params.metrics } : {}),
    ...(yaml.job_id ? { title: yaml.job_id } : {}),
  });

  await updateActivePhaseRun("experiment", { state: "evaluate", summary: `Completed ${params.id}` }, activePhaseRun);

  if (params.notes) await appendNotes("experiments", params.id, "Complete", params.notes);

  // ---- RQG auto-evaluation side effect (non-blocking) ----
  let rqgOutput: string[] = [];
  let rqgRef: string | undefined;
  let rqgReport: RQGReport | null = null;
  if (yaml.plan_ref) {
    try {
      const result = await autoEvaluateRQG({ planRef: yaml.plan_ref, experimentId: params.id, writeRqgNotes: true });
      rqgOutput = result.outputLines;
      rqgRef = result.report?.id;
      rqgReport = result.report;
    } catch (err: any) {
      rqgOutput.push(`⚠️ RQG evaluation error: ${err.message ?? String(err)}`);
    }
  }

  // Kill criteria enforcement: warn if promotion is blocked
  if (rqgReport && rqgReport.overall === "failed") {
    const killFailed = rqgReport.kill_set.some((k) => !k.passed);
    if (killFailed) {
      log.warn("KillCriteria", `RQG ${rqgReport.id} has failed kill criteria — promotion is blocked`);
      rqgOutput.push("");
      rqgOutput.push(
        "🚫 KILL CRITERIA FAILED: Promotion is blocked. Resolve kill criteria failures before attempting to promote.",
      );
    }
  }

  await ResearchJournal.appendAgentNote({
    kind: "experiment_note",
    refs: [params.id, ...(yaml.plan_ref ? [yaml.plan_ref] : []), ...(yaml.idea_ref ? [yaml.idea_ref] : [])],
    summary: `Experiment ${params.id} completed`,
    note: params.notes
      ? `Experiment completed with notes. ${rqgOutput.length > 0 ? "RQG evaluated." : ""}`
      : `Experiment ${params.id} marked as completed. Pass notes="..." to append analysis.`,
  });

  return {
    title: `${params.id} completed`,
    output: [
      `✅ ${params.id} marked as completed`,
      `Finished: ${yaml.finished}`,
      ...(params.metrics ? [`Metrics: ${JSON.stringify(params.metrics)}`] : []),
      ...(params.artifacts ? [`Artifacts: ${Object.keys(params.artifacts).join(", ")}`] : []),
      ...(yaml.redlines ? ["", "Red-lines:", formatRedlineStatus(yaml.redlines)] : []),
      ...(rqgOutput.length > 0 ? ["", "RQG:", ...rqgOutput] : []),
      ...(!params.notes ? [`\n💡 Tip: pass notes="your analysis here" to append findings to the .md`] : []),
    ].join("\n"),
    metadata: mdMeta({ id: params.id, status: "completed", ...(rqgRef ? { rqg_ref: rqgRef } : {}) }),
  };
}

async function handleFail(params: any, activePhaseRun?: string): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to mark as failed (e.g. "exp_007").');
  const { yamlPath, yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const validation = validateExperimentTransition(yaml.status, "failed");
  if (validation) {
    return {
      title: "Invalid transition",
      output: validation,
      metadata: mdMeta({ error: "invalid_transition", id: params.id, current: yaml.status, target: "failed" }),
    };
  }

  const prevStatus = yaml.status;
  yaml.status = "failed";
  yaml.finished = new Date().toISOString();
  if (params.failure_reason) yaml.failure_reason = params.failure_reason;

  await ResearchFS.writeYaml(yamlPath, yaml);

  await ResearchTimeline.append({
    type: "exp.status",
    id: params.id,
    from: prevStatus,
    to: "failed",
    summary: params.failure_reason ?? `${params.id} failed`,
    ...(yaml.job_id ? { title: yaml.job_id } : {}),
  });

  await updateActivePhaseRun(
    "experiment",
    {
      state: "evaluate",
      summary: `Failed ${params.id}: ${params.failure_reason ?? "unknown"}`,
    },
    activePhaseRun,
  );

  if (params.notes) await appendNotes("experiments", params.id, "Fail", params.notes);

  await ResearchJournal.appendAgentNote({
    kind: "failure_analysis",
    refs: [params.id, ...(yaml.plan_ref ? [yaml.plan_ref] : []), ...(yaml.idea_ref ? [yaml.idea_ref] : [])],
    summary: `Experiment ${params.id} failed`,
    note: params.failure_reason
      ? `Failure reason: ${params.failure_reason}${params.notes ? "\n\nNotes: " + params.notes : ""}`
      : `Experiment ${params.id} marked as failed. Pass failure_reason="..." to document the root cause.`,
  });

  return {
    title: `${params.id} failed`,
    output: [
      `❌ ${params.id} marked as failed`,
      `Finished: ${yaml.finished}`,
      ...(params.failure_reason ? [`Reason: ${params.failure_reason}`] : []),
    ].join("\n"),
    metadata: mdMeta({ id: params.id, status: "failed" }),
  };
}

async function handleInvalidate(params: any, activePhaseRun?: string): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to invalidate (e.g. "exp_007").');
  const { yamlPath, yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const transitionError = validateExperimentTransition(yaml.status, "invalidated");
  if (transitionError) {
    return {
      title: "Invalid transition",
      output: `❌ ${transitionError}`,
      metadata: mdMeta({ error: "invalid_transition", id: params.id, current: yaml.status, target: "invalidated" }),
    };
  }

  const prevStatus = yaml.status;
  yaml.status = "invalidated";
  if (params.invalidation_reason) yaml.invalidation_reason = params.invalidation_reason;

  await ResearchFS.writeYaml(yamlPath, yaml);

  await ResearchTimeline.append({
    type: "exp.status",
    id: params.id,
    from: prevStatus,
    to: "invalidated",
    summary: params.invalidation_reason ?? `${params.id} invalidated`,
  });

  await updateActivePhaseRun(
    "experiment",
    {
      state: "evaluate",
      summary: `Invalidated ${params.id}: ${params.invalidation_reason ?? "unusable results"}`,
    },
    activePhaseRun,
  );

  if (params.notes) await appendNotes("experiments", params.id, "Invalidate", params.notes);

  return {
    title: `${params.id} invalidated`,
    output: [
      `⚠️ ${params.id} marked as invalidated`,
      ...(params.invalidation_reason ? [`Reason: ${params.invalidation_reason}`] : []),
    ].join("\n"),
    metadata: mdMeta({ id: params.id, status: "invalidated" }),
  };
}

async function handleStop(params: any, activePhaseRun?: string): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to stop (e.g. "exp_007").');
  const { yamlPath, yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const transitionError = validateExperimentTransition(yaml.status, "stopped");
  if (transitionError) {
    return {
      title: "Invalid transition",
      output: `❌ ${transitionError}`,
      metadata: mdMeta({ error: "invalid_transition", id: params.id, current: yaml.status, target: "stopped" }),
    };
  }

  const prevStatus = yaml.status;
  yaml.status = "stopped";

  await ResearchFS.writeYaml(yamlPath, yaml);

  await ResearchTimeline.append({
    type: "exp.status",
    id: params.id,
    from: prevStatus,
    to: "stopped",
    summary: `${params.id} manually stopped`,
  });

  await updateActivePhaseRun(
    "experiment",
    {
      state: "evaluate",
      summary: `Stopped ${params.id}: ${params.reason ?? "manual stop"}`,
    },
    activePhaseRun,
  );

  if (params.notes) await appendNotes("experiments", params.id, "Stop", params.notes);

  return {
    title: `${params.id} stopped`,
    output: `⏹️ ${params.id} manually stopped`,
    metadata: mdMeta({ id: params.id, status: "stopped" }),
  };
}

async function handleReview(params: any, activePhaseRun?: string): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to review (e.g. "exp_007").');
  if (!params.reviewer)
    return missingParam(
      "reviewer",
      `Please provide the reviewer role. Must be one of: ${ReviewerRole.options.join(", ")}`,
    );
  if (!ReviewerRole.options.includes(params.reviewer)) {
    return {
      title: "Invalid reviewer role",
      output: `Invalid reviewer role: "${params.reviewer}". Must be one of: ${ReviewerRole.options.join(", ")}`,
      metadata: mdMeta({ error: "invalid_reviewer_role", reviewer: params.reviewer }),
    };
  }
  if (!params.summary) return missingParam("summary", "Please provide a review summary.");

  const { yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const { round, review_file } = await ResearchReview.addReview("experiments", params.id, {
    reviewer: params.reviewer,
    focus: params.focus,
    verdict: params.verdict,
    summary: params.summary,
    action_items: params.action_items,
    scores: params.scores,
    review_body: params.review_body,
  });

  await ResearchTimeline.append({
    type: "exp.reviewed",
    id: params.id,
    by: params.reviewer,
    summary: params.summary,
  });

  await updateActivePhaseRun(
    "experiment",
    {
      state: "evaluate",
      summary: `Review round ${round}: ${params.verdict ?? "no verdict"} — ${params.summary}`,
    },
    activePhaseRun,
  );

  return {
    title: `${params.id} reviewed (round ${round})`,
    output: ResearchReview.formatReviewOutput(params.id, round, {
      reviewer: params.reviewer,
      verdict: params.verdict,
      summary: params.summary,
      scores: params.scores,
      review_file,
    }),
    metadata: mdMeta({ id: params.id, round, verdict: params.verdict }),
  };
}

async function handleList(params: any): Promise<any> {
  const yamlFiles = await ResearchFS.listYaml(ResearchFS.resolve("experiments"));
  const experiments: ExperimentYaml[] = [];

  for (const file of yamlFiles) {
    const yaml = await ResearchFS.readYaml<ExperimentYaml>(ResearchFS.resolve("experiments", file));
    if (yaml) experiments.push(yaml);
  }

  let filtered = experiments;
  if (params.filter_group) filtered = filtered.filter((e) => e.group === params.filter_group);
  if (params.filter_status) filtered = filtered.filter((e) => e.status === params.filter_status);

  if (filtered.length === 0) {
    return {
      title: "Experiments",
      output: "No experiments found.",
      metadata: mdMeta({ count: 0 }),
    };
  }

  const statusIcon: Record<string, string> = {
    registered: "⏳",
    scheduled: "📋",
    running: "🔄",
    completed: "✅",
    failed: "❌",
    invalidated: "⚠️",
    stopped: "⏹️",
  };

  const lines = [`=== Experiments (${filtered.length}) ===`, ""];

  for (const exp of filtered) {
    const icon = statusIcon[exp.status] ?? "•";
    const groupStr = exp.group ? ` [${exp.group}]` : "";
    const metricStr = exp.metrics
      ? ` — ${Object.entries(exp.metrics)
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join(", ")}`
      : "";
    lines.push(`${icon} ${exp.id}  ${exp.title}${groupStr}  (${exp.status})${metricStr}  → ${entityMdPath(exp.id)}`);
  }

  return {
    title: "Experiments",
    output: lines.join("\n"),
    metadata: mdMeta({
      count: filtered.length,
      experiments: filtered.map((e) => ({ id: e.id, title: e.title, status: e.status, md_path: entityMdPath(e.id) })),
    }),
  };
}

async function handleCompare(params: any): Promise<any> {
  const compareIds = params.ids ?? (params.id ? [params.id] : []);
  if (compareIds.length < 2) {
    return {
      title: "Need more IDs",
      output: 'Please provide at least 2 experiment IDs to compare (use "ids" parameter).',
      metadata: mdMeta({ error: "insufficient_ids" }),
    };
  }

  const experiments: ExperimentYaml[] = [];
  for (const id of compareIds) {
    const { yaml } = await loadYaml(id);
    if (!yaml) return notFound("Experiment", id);
    experiments.push(yaml);
  }

  const lines = [
    `=== Experiment Comparison ===`,
    "",
    `| Metric | ${experiments.map((e) => e.id).join(" | ")} |`,
    `|--------| ${experiments.map(() => "---").join(" | ")} |`,
  ];

  const metricKeys = new Set<string>();
  for (const exp of experiments) {
    if (exp.metrics) {
      for (const key of Object.keys(exp.metrics)) {
        metricKeys.add(key);
      }
    }
  }

  for (const key of metricKeys) {
    const values = experiments.map((exp) => {
      const v = exp.metrics?.[key];
      if (v === undefined) return "—";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    });
    lines.push(`| ${key} | ${values.join(" | ")} |`);
  }

  lines.push(`| status | ${experiments.map((e) => e.status).join(" | ")} |`);

  return {
    title: "Experiment comparison",
    output: lines.join("\n"),
    metadata: mdMeta({ ids: compareIds }),
  };
}

async function handleDiagnose(params: any, activePhaseRun?: string): Promise<any> {
  const refs = params.experiment_refs ?? (params.id ? [params.id] : []);
  if (refs.length === 0) {
    return missingParam("experiment_refs", "Please provide at least one experiment ID to diagnose.");
  }

  for (const ref of refs) {
    const { yaml } = await loadYaml(ref);
    if (!yaml) return notFound("Experiment", ref);
  }

  const report = await DiagnosisManager.create({
    experiment_refs: refs,
    plan_ref: params.plan_ref,
  });

  for (const ref of refs) {
    const { yamlPath, yaml: expYaml } = await loadYaml(ref);
    if (!expYaml) continue;
    expYaml.diagnosis_ref = report.id;
    await ResearchFS.writeYaml(yamlPath, expYaml);
  }

  // ---- RQG evaluation side effect for diagnose (non-blocking) ----
  let rqgRef: string | undefined;
  let rqgOutput: string[] = [];
  const planRef = params.plan_ref ?? (await loadYaml(refs[0])).yaml?.plan_ref;
  if (planRef) {
    try {
      const result = await autoEvaluateRQG({ planRef, experimentId: refs[0], writeRqgNotes: false });
      rqgOutput = result.outputLines;
      rqgRef = result.report?.id;
      if (rqgRef) {
        report.rqg_ref = rqgRef;
        await ResearchFS.writeYaml(DiagnosisManager.resolvePath(report.id), report);
      }
    } catch (err: any) {
      rqgOutput.push(`⚠️ RQG evaluation error: ${err.message ?? String(err)}`);
    }
  }

  await ResearchTimeline.append({
    type: "exp.status",
    id: refs[0],
    summary: `Diagnosis report created: ${report.id}`,
    refs: [report.id, ...refs],
  });

  await updateActivePhaseRun(
    "experiment",
    {
      state: "evaluate",
      summary: `Diagnosed ${refs.join(", ")}: ${report.id}`,
    },
    activePhaseRun,
  );

  const levelNames = [
    "L1_training_health",
    "L2_eval_correctness",
    "L3_data_integrity",
    "L4_hyperparameter_range",
    "L5_seed_stability",
    "L6_benchmark_story_alignment",
  ];

  return {
    title: `Diagnosis report created: ${report.id}`,
    output: [
      `📋 Created ${report.id}`,
      `Experiments: ${refs.join(", ")}`,
      ...(params.plan_ref ? [`Plan: ${params.plan_ref}`] : []),
      ...(rqgOutput.length > 0 ? ["", "RQG:", ...rqgOutput] : []),
      "",
      "Next steps — use update_diagnosis action to populate levels and get routing:",
      `  research_experiment(action="update_diagnosis", diagnosis_id="${report.id}",`,
      `    levels={L1_training_health: {status: "pass|warning|fail", evidence: "..."}},`,
      `    conclusion={likely_cause: "...", recommended_decision: "iterate|pivot|promote|abort"})`,
      "",
      `Diagnosis levels: ${levelNames.join(", ")}`,
    ].join("\n"),
    metadata: mdMeta({ diagnosis_id: report.id, experiment_refs: refs, ...(rqgRef ? { rqg_ref: rqgRef } : {}) }),
  };
}

async function handleUpdate(params: any): Promise<any> {
  if (!params.id) return missingParam("id", 'Please provide the experiment ID to update (e.g. "exp_007").');
  const { yamlPath, yaml } = await loadYaml(params.id);
  if (!yaml) return notFound("Experiment", params.id);

  const prevStatus = yaml.status;

  if (params.status && params.status !== prevStatus && params.force !== true) {
    return {
      title: "Status change requires force=true",
      output: `Status changes via update require force=true. Prefer semantic actions (start, complete, fail, stop, invalidate) for lifecycle transitions. Use force=true only when you have explicit justification to bypass transition validation.`,
      metadata: mdMeta({ error: "force_required", id: params.id, target_status: params.status }),
    };
  }

  // Enforce red-line and authenticity gates for "completed" status
  if (params.status === "completed" && params.status !== prevStatus) {
    if (yaml.redlines && !allRedlinesPassed(yaml.redlines)) {
      const failed = yaml.redlines.rules.filter(
        (r) => yaml.redlines!.status[r] !== "passed" && yaml.redlines!.status[r] !== "waived",
      );
      return {
        title: "Red-line gate blocked",
        output: [
          `❌ Cannot override ${params.id} to "completed": experiment has red-line violations.`,
          "",
          ...failed.map((r) => `  - ${r}: ${yaml.redlines!.status[r]}`),
          "",
          "All red-lines must pass or be waived before an experiment can be completed.",
          "Use the complete action to go through proper validation.",
        ].join("\n"),
        metadata: mdMeta({ id: params.id, error: "redline_blocked", failed }),
      };
    }
    const authError = validateAuthenticity(yaml.authenticity, "complete");
    if (authError) {
      return {
        title: "Authenticity gate blocked",
        output: [
          `❌ Cannot override ${params.id} to "completed": ${authError}`,
          "",
          "Only evidence-grade experiments can be marked as completed.",
        ].join("\n"),
        metadata: mdMeta({ id: params.id, error: "authenticity_blocked" }),
      };
    }
  }

  if (params.status && params.status !== prevStatus) {
    log.warn("Transition", `Bypassing transition validation via update action: ${prevStatus} → ${params.status}`);
  }

  if (params.status) yaml.status = params.status;
  if (params.job_id) yaml.job_id = params.job_id;
  if (params.metrics) yaml.metrics = { ...yaml.metrics, ...params.metrics };
  if (params.artifacts) yaml.artifacts = { ...yaml.artifacts, ...params.artifacts };
  if (params.hyperparameters) yaml.hyperparameters = { ...yaml.hyperparameters, ...params.hyperparameters };
  if (params.failure_reason) yaml.failure_reason = params.failure_reason;
  if (params.invalidation_reason) yaml.invalidation_reason = params.invalidation_reason;
  const VALID_REDLINE_STATUSES = new Set(["pending", "passed", "flagged", "violated", "waived"]);
  const VALID_REDLINE_TRANSITIONS: Record<string, Set<string>> = {
    pending: new Set(["passed", "flagged", "violated"]),
    flagged: new Set(["passed", "violated", "waived"]),
    violated: new Set(["waived"]),
    passed: new Set([]),
    waived: new Set([]),
  };
  if (params.redline_status && yaml.redlines) {
    for (const [rule, status] of Object.entries(params.redline_status)) {
      if (!yaml.redlines.rules.includes(rule as RedlineRule)) continue;
      if (!VALID_REDLINE_STATUSES.has(status as string)) {
        return {
          title: "Invalid redline status",
          output: `Invalid status "${status}" for rule "${rule}". Valid: pending, passed, flagged, violated, waived`,
          metadata: mdMeta({ error: "invalid_redline_status", rule, status }),
        };
      }
      const currentStatus = yaml.redlines.status[rule as RedlineRule];
      const allowedTransitions = VALID_REDLINE_TRANSITIONS[currentStatus];
      if (allowedTransitions && !allowedTransitions.has(status as string)) {
        return {
          title: "Invalid red-line transition",
          output: `Cannot transition red-line "${rule}" from ${currentStatus} → ${status}. This transition is not allowed.`,
          metadata: mdMeta({
            error: "invalid_redline_transition",
            id: params.id,
            rule,
            from: currentStatus,
            to: status,
          }),
        };
      }
      yaml.redlines.status[rule as RedlineRule] = status as RedlineStatus;
    }
  }

  // Write timeline and journal BEFORE yaml to ensure audit trail is recorded first
  if (params.status && params.status !== prevStatus) {
    await ResearchTimeline.append({
      type: "exp.status",
      id: params.id,
      from: prevStatus,
      to: params.status,
      summary: `${params.id} status: ${prevStatus} → ${params.status}`,
    });
    await ResearchTimeline.append({
      type: "entity.status_override",
      phase: "experiment",
      summary: `${params.id} status overridden: ${prevStatus} → ${params.status}`,
      id: params.id,
    });
    await ResearchJournal.appendAgentNote({
      phase: "experiment",
      kind: "status_override",
      refs: [params.id],
      summary: `${params.id} status overridden via update: ${prevStatus} → ${params.status}`,
      note: `Transition validation was bypassed via the update action.`,
      importance: "critical",
    });
    if (isTerminalTransition(prevStatus, params.status, EXPERIMENT_TRANSITIONS)) {
      log.warn(
        "TerminalOverride",
        `CRITICAL: ${params.id} leaving terminal state "${prevStatus}" → "${params.status}"`,
      );
      await ResearchJournal.appendAgentNote({
        phase: "experiment",
        kind: "status_override",
        refs: [params.id],
        summary: `CRITICAL: ${params.id} leaving terminal state "${prevStatus}" → "${params.status}"`,
        note: `Entity was in terminal state "${prevStatus}" (no valid outgoing transitions) and has been moved to "${params.status}" via the update action. This should only happen with explicit justification.`,
        importance: "critical",
      });
    }
  }

  // Write yaml LAST — after all side-effects (timeline, journal) are recorded
  await ResearchFS.writeYaml(yamlPath, yaml);

  return {
    title: `${params.id} updated`,
    output: [
      `✅ Updated ${params.id}`,
      "",
      `Status: ${yaml.status}`,
      ...(params.metrics ? [`Metrics: ${JSON.stringify(params.metrics)}`] : []),
      ...(params.failure_reason ? [`Failure: ${params.failure_reason}`] : []),
      ...(params.invalidation_reason ? [`Invalidation: ${params.invalidation_reason}`] : []),
    ].join("\n"),
    metadata: mdMeta({ id: params.id, status: yaml.status }),
  };
}

async function handleUpdateDiagnosis(params: any): Promise<any> {
  if (!params.diagnosis_id) return missingParam("diagnosis_id", "Please provide the diagnosis report ID.");

  const report = await DiagnosisManager.read(params.diagnosis_id);
  if (!report) return notFound("Diagnosis report", params.diagnosis_id);

  // Update levels
  if (params.levels && typeof params.levels === "object") {
    for (const [level, data] of Object.entries(params.levels) as [string, any][]) {
      const levelData = data as { status?: string; evidence?: string; recommended_action?: string };
      if (levelData.status) {
        await DiagnosisManager.updateLevel(
          params.diagnosis_id,
          level as
            | "L1_training_health"
            | "L2_eval_correctness"
            | "L3_data_integrity"
            | "L4_hyperparameter_range"
            | "L5_seed_stability"
            | "L6_benchmark_story_alignment",
          levelData.status as "pass" | "warning" | "fail" | "pending",
          levelData.evidence,
          levelData.recommended_action,
        );
      }
    }
  }

  // Set conclusion
  if (params.conclusion && typeof params.conclusion === "object") {
    await DiagnosisManager.setConclusion(params.diagnosis_id, params.conclusion as DiagnosisReport["conclusion"]);
  }

  // Reload report after updates
  const updatedReport = await DiagnosisManager.read(params.diagnosis_id);
  if (!updatedReport) return notFound("Diagnosis report", params.diagnosis_id);

  // Determine pivot route using the updated report
  let rqgReport: RQGReport | undefined;
  if (updatedReport.rqg_ref) {
    rqgReport = await RQGManager.read(updatedReport.rqg_ref);
  }
  const pivotRoute = DiagnosisManager.determinePivotRoute(updatedReport, rqgReport);

  const levelSummary = Object.entries(updatedReport.levels)
    .map(
      ([k, v]) =>
        `  ${v?.status === "pass" ? "✅" : v?.status === "fail" ? "❌" : v?.status === "warning" ? "⚠️" : "⏳"} ${k}: ${v?.status ?? "pending"}${v?.evidence ? ` — ${v.evidence}` : ""}`,
    )
    .join("\n");

  return {
    title: `Diagnosis updated: ${params.diagnosis_id}`,
    output: [
      `✅ Updated ${params.diagnosis_id}`,
      "",
      "Levels:",
      levelSummary,
      ...(updatedReport.conclusion
        ? [
            "",
            "Conclusion:",
            `  Likely cause: ${updatedReport.conclusion.likely_cause ?? "—"}`,
            `  Recommended: ${updatedReport.conclusion.recommended_decision ?? "—"}`,
            ...(updatedReport.conclusion.forbidden_decisions?.length
              ? [`  Forbidden: ${updatedReport.conclusion.forbidden_decisions.join(", ")}`]
              : []),
          ]
        : []),
      "",
      "Pivot Route:",
      `  Decision: ${pivotRoute.decision}`,
      ...(pivotRoute.target ? [`  Target: ${pivotRoute.target}`] : []),
      `  Reason: ${pivotRoute.reason}`,
      ...(pivotRoute.forbidden_decisions.length > 0
        ? [`  Forbidden: ${pivotRoute.forbidden_decisions.join(", ")}`]
        : []),
    ].join("\n"),
    metadata: mdMeta({
      diagnosis_id: params.diagnosis_id,
      pivot_decision: pivotRoute.decision,
      pivot_target: pivotRoute.target,
    }),
  };
}

// ── Tool Export ────────────────────────────────────────────────────────────

export const researchExperiment = tool({
  description: DESCRIPTION,
  args: {
    action: z
      .enum([
        "register",
        "schedule",
        "start",
        "complete",
        "fail",
        "invalidate",
        "stop",
        "review",
        "list",
        "compare",
        "update",
        "diagnose",
        "update_diagnosis",
      ])
      .describe("Semantic action on the experiment lifecycle"),

    id: z
      .string()
      .optional()
      .describe("Experiment ID, e.g. 'exp_007'. Required for all actions except register, list."),
    ids: z.array(z.string()).optional().describe("Experiment IDs to compare. Required for compare."),

    title: z.string().optional().describe("Experiment title. Required for register."),
    group: ExperimentGroup.optional().describe(
      "Group: sanity, baselines, main, ablations, robustness, or stress. For register.",
    ),
    backend: ExperimentBackend.optional().describe(
      "Execution backend: inspire, local, api, or manual. For register. Default: local.",
    ),
    idea_ref: z.string().optional().describe("Idea ID this experiment tests, e.g. 'idea_014'. For register."),
    plan_ref: z.string().optional().describe("Plan ID this experiment belongs to, e.g. 'plan_002'. For register."),
    hyperparameters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Hyperparameters dict, e.g. {learning_rate: 1e-4}. For register or update."),

    job_id: z.string().optional().describe("Platform job ID, e.g. 'job-xxx'. For schedule, start, or update."),
    metrics: z.record(z.string(), z.unknown()).optional().describe("Result metrics. For complete or update."),
    artifacts: z.record(z.string(), z.string()).optional().describe("Artifact paths. For complete or update."),
    failure_reason: z.string().optional().describe("Why the experiment failed. For fail or update."),
    invalidation_reason: z.string().optional().describe("Why results are invalid. For invalidate or update."),

    status: ExperimentStatus.optional().describe(
      "New status. Only for update action (semantic actions set status automatically).",
    ),

    reviewer: z
      .enum(["inspector", "auditor", "critic", "editor"])
      .optional()
      .describe("Reviewer role performing the review"),
    summary: z.string().optional().describe("Review summary. Required for review."),
    focus: z.string().optional().describe("Review focus area. For review."),
    verdict: ReviewVerdict.optional().describe("Review verdict: pass, revise, or rethink. For review."),
    action_items: z.array(z.string()).optional().describe("Actionable items from review. For review."),
    scores: z
      .record(z.string(), z.number())
      .optional()
      .describe("Numeric scores, e.g. {reproducibility: 8}. For review."),
    review_body: z
      .string()
      .optional()
      .describe(
        "Reviewer's full markdown feedback. ONLY for review action. Saved as a separate .review.NNN.md file (not the entity's main .md).",
      ),

    filter_group: ExperimentGroup.optional().describe("Filter by group. For list."),
    filter_status: ExperimentStatus.optional().describe("Filter by status. For list."),
    redline_status: z
      .record(z.string(), z.string())
      .optional()
      .describe("Update red-line statuses, e.g. {R1_metric_immutability: 'passed'}. For update."),
    content: z
      .string()
      .optional()
      .describe(
        "Initial .md content for register. Write ## Setup, ## Expected Results, ## Success Criteria. Replaces empty template.",
      ),
    redlines: z
      .array(RedlineRule)
      .optional()
      .describe("Red-line rules that apply to this experiment. For register. Default: all 7."),
    authenticity: EvidenceAuthenticity.optional().describe(
      "Evidence authenticity level. prototype=synthetic/toy (debug only, cannot support claims), pilot=real data reduced scale (direction validation), evidence=full benchmark+official evaluator (can support claims). For register. Default: evidence.",
    ),
    domain_constraints: z
      .array(z.string())
      .optional()
      .describe("Domain-specific constraints for R7. For register. E.g. ['Must use Qwen2.5-7B backbone']."),
    notes: z
      .string()
      .optional()
      .describe(
        "Append to .md on complete/fail/invalidate/stop. Record analysis, root cause, lessons learned. Auto-timestamped, append-only.",
      ),
    experiment_refs: z
      .array(z.string())
      .optional()
      .describe("Experiment IDs to include in the diagnosis report. Required for diagnose action."),
    diagnosis_id: z.string().optional().describe("Diagnosis report ID. Required for update_diagnosis action."),
    diagnosis_levels: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Diagnosis level updates, e.g. {L1_training_health: {status: 'pass', evidence: '...'}}. For update_diagnosis.",
      ),
    diagnosis_conclusion: z
      .object({
        likely_cause: z.string().optional(),
        recommended_decision: z.enum(["iterate", "pivot", "promote", "abort"]).optional(),
        forbidden_decisions: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Diagnosis conclusion. For update_diagnosis."),
    force: z
      .boolean()
      .optional()
      .describe("Set to true to allow status changes via update action. Prefer semantic actions instead."),
  },
  async execute(params) {
    return withGuard(async () => {
      return withLock(experimentMutex, async () => {
        if (!(await ResearchFS.isInitialized())) return notInitialized();
        const state = await ResearchFS.readYaml<StateYaml>(ResearchFS.resolve("state.yaml"));
        const activePhaseRun = state?.focus?.active_phase_run;
        switch (params.action) {
          case "register":
            return handleRegister(params, activePhaseRun);
          case "schedule":
            return handleSchedule(params);
          case "start":
            return handleStart(params, activePhaseRun);
          case "complete":
            return handleComplete(params, activePhaseRun);
          case "fail":
            return handleFail(params, activePhaseRun);
          case "invalidate":
            return handleInvalidate(params, activePhaseRun);
          case "stop":
            return handleStop(params, activePhaseRun);
          case "review":
            return handleReview(params, activePhaseRun);
          case "list":
            return handleList(params);
          case "compare":
            return handleCompare(params);
          case "diagnose":
            return handleDiagnose(params, activePhaseRun);
          case "update_diagnosis":
            return handleUpdateDiagnosis({
              diagnosis_id: params.diagnosis_id,
              levels: params.diagnosis_levels,
              conclusion: params.diagnosis_conclusion,
            });
          case "update":
            return handleUpdate(params);
          default:
            return {
              title: "Unknown action",
              output: `Unknown action: ${params.action}`,
              metadata: mdMeta({ error: "unknown_action" }),
            };
        }
      });
    });
  },
});
