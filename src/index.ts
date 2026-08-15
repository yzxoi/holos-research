import type { PluginInvocationContext, ToolContribution } from "@ericsanchezok/synergy-plugin";
import {
  agent,
  capability,
  definePlugin,
  event,
  operation,
  skill,
  tool,
  workbenchPanel,
} from "@ericsanchezok/synergy-plugin";
import type { ToolContext, ToolResult } from "@ericsanchezok/synergy-plugin/tool";
import z from "zod";
import { runWithInvocation, type WorkspaceService } from "./ctx";
import { AGENTS } from "./generated/assets";
import { installIndexHooks } from "./index-registry";
import {
  monitorActiveRun,
  monitorAll,
  monitorBrief,
  monitorCheckpointSummary,
  monitorEntities,
  monitorJournal,
  monitorPhase,
  monitorTimeline,
  monitorWorkflow,
} from "./operations";
import { checkpointBrief } from "./tools/checkpoint-brief";
import { researchClaim } from "./tools/claim";
import { computeSubmit } from "./tools/compute";
import { researchExhibit } from "./tools/exhibit";
import { researchExperiment } from "./tools/experiment";
import { researchIdea } from "./tools/idea";
import { researchInit } from "./tools/init";
import { researchJournal } from "./tools/journal";
import { researchMonitor } from "./tools/monitor";
import { researchPaper } from "./tools/paper";
import { researchPlan } from "./tools/plan";
import { researchState } from "./tools/state";
import { researchSubmission } from "./tools/submission";
import { researchTimeline } from "./tools/timeline";
import { researchWiki } from "./tools/wiki";

/**
 * API4 adapter for the baseline API3 tool definitions (`args` + `execute`).
 * Each tool's execute is wrapped to resolve the invocation Scope directory
 * from the workspace Host Service and to run under the AsyncLocalStorage
 * research directory context (runWithDirectory), exactly like the legacy
 * `wrapTool` did.
 */
const MUTATING_TOOL_IDS = new Set([
  "research_init",
  "research_state",
  "research_idea",
  "research_plan",
  "research_experiment",
  "research_claim",
  "research_exhibit",
  "research_paper",
  "research_submission",
  "research_wiki",
  "research_timeline",
  "research_journal",
  "research_checkpoint_brief",
]);

function adaptTool<Args extends z.ZodRawShape>(
  id: string,
  def: {
    description: string;
    args: Args;
    execute(args: z.infer<z.ZodObject<Args>>, ctx: ToolContext): Promise<string | ToolResult>;
  },
): ToolContribution {
  return tool({
    id,
    description: def.description,
    input: z.object(def.args),
    async handler(input, context: PluginInvocationContext) {
      const svc = context.workspace as WorkspaceService | undefined;
      const meta = (await svc?.metadata?.()) as { scopeId?: string; directory?: string } | undefined;
      const directory = meta?.directory;
      const toolCtx: ToolContext = {
        sessionID: context.sessionId ?? "",
        messageID: context.actor.type === "agent" ? context.actor.messageId : "",
        agent: context.actor.type === "agent" ? context.actor.agent : "ui",
        abort: context.signal,
        directory,
      };
      const result = await runWithInvocation(directory, svc, () => def.execute(input as never, toolCtx));
      // Notify the monitor panel that the research state changed so it can
      // re-query its snapshot (event-driven refresh replaces polling).
      if (MUTATING_TOOL_IDS.has(id)) {
        await context.events
          .publish("research.changed", {
            reason: `${id} executed`,
            project: directory,
            ts: new Date().toISOString(),
          })
          .catch(() => {});
      }
      return result;
    },
  });
}

/** All research tools write EXCLUSIVELY under .research/ — never to the project root. */
const toolContributions = [
  adaptTool("research_init", researchInit),
  adaptTool("research_state", researchState),
  adaptTool("research_idea", researchIdea),
  adaptTool("research_plan", researchPlan),
  adaptTool("research_experiment", researchExperiment),
  adaptTool("research_claim", researchClaim),
  adaptTool("research_exhibit", researchExhibit),
  adaptTool("research_paper", researchPaper),
  adaptTool("research_submission", researchSubmission),
  adaptTool("research_wiki", researchWiki),
  adaptTool("research_timeline", researchTimeline),
  adaptTool("research_monitor", researchMonitor),
  adaptTool("research_journal", researchJournal),
  adaptTool("compute_submit", computeSubmit),
  adaptTool("research_checkpoint_brief", checkpointBrief),
];

const agentContributions = [
  agent({
    id: "critic",
    agent: {
      name: "critic",
      description:
        "Adversarial academic evaluator. Challenges novelty, contribution claims, method soundness, experiment design quality, and paper quality. Applies structured tests (reduction, engineering-vs-insight, assumption, straw-man, scope, sprawl, simplicity, necessity), scores dimensions 1-10, and demands concrete fixes. Use for idea review, novelty challenge, method review (including benchmark/baseline/evaluation adequacy), claim evaluation, and simulated venue review. Use via task(subagent_type='critic').",
      prompt: AGENTS["critic.md"] ?? "",
      mode: "subagent",
    },
  }),
  agent({
    id: "methodologist",
    agent: {
      name: "methodologist",
      description:
        "Constructive research design expert. Helps design methods, experiment matrices, baselines, ablations, evaluation protocols, validation strategies, and benchmark selection. Provides concrete, implementation-ready advice. NOT adversarial — works WITH the researcher. Use for method route selection, experiment planning, result interpretation, evidence strategy, and optimization diagnosis. Use via task(subagent_type='methodologist').",
      prompt: AGENTS["methodologist.md"] ?? "",
      mode: "subagent",
    },
  }),
  agent({
    id: "auditor",
    agent: {
      name: "auditor",
      description:
        "Forensic research integrity checker. Verifies data provenance, figure-data consistency, citation accuracy, experiment traceability, reproducibility, and red-line compliance (R1-R7). Does NOT judge novelty or quality — only checks whether facts are true, traceable, and methodologically sound. Use for experiment design audit (pre-registration), experiment integrity checks (post-completion), evidence chain verification, paper audit, and reproducibility assessment. Use via task(subagent_type='auditor').",
      prompt: AGENTS["auditor.md"] ?? "",
      mode: "subagent",
    },
  }),
  agent({
    id: "editor",
    agent: {
      name: "editor",
      description:
        "Academic writing specialist. Reviews narrative structure, argument flow, related work fairness, abstract accuracy, figure/table presentation, and technical writing quality. Different from scribe (who writes from scratch) — editor REVIEWS and IMPROVES existing text. Use for paper composition review, narrative coherence checks, and camera-ready preparation. Use via task(subagent_type='editor').",
      prompt: AGENTS["editor.md"] ?? "",
      mode: "subagent",
    },
  }),
];

const SKILLS = [
  {
    name: "research",
    description:
      "Start or continue a research project. Routes to the correct phase skill based on current state. Loads AGENTS.md behavioral rules and research state on every session. Use /research 'topic' to begin a new project, or /research to check status and advance. Triggers: 'start research', 'what next', 'where are we', '开始课题', '接下来做什么', '推进研究', '什么进度'.",
    dir: "skills/research",
  },
  {
    name: "idea-explore",
    description:
      "Multi-round, multi-agent idea discovery: layered survey (academia + industry + open-source) via parallel scholar/scout dispatches, structured ideation with anchor alignment, per-claim novelty verification, adversarial review via critic, pilot validation, and proactive wiki ingestion. Triggers: 'explore direction', 'find research gaps', 'generate ideas', '调研', '找idea', '发现idea'.",
    dir: "skills/idea-explore",
  },
  {
    name: "novelty-ground",
    description:
      "Ground novelty claims against existing work: closest-work search via parallel scholar dispatches, contribution-type classification, multi-agent adversarial review (devil's advocate + novelty verification + overclaim audit), positioning matrix construction, drift check, revision loop, and wiki writeback. Triggers: 'position our contribution', 'what is our novelty', '定位贡献'.",
    dir: "skills/novelty-ground",
  },
  {
    name: "method-design",
    description:
      "Design a complete, implementation-ready research method across five co-dependent dimensions: method (algorithm/mechanism), benchmark selection, dataset design, baseline selection and fairness audit, evaluation protocol (metrics/statistics/presentation), and infrastructure (training recipe/reproducibility/efficiency). Dimensions run in parallel via subagent dispatches, converge at synthesis, then undergo multi-round adversarial review via critic. Loads references/benchmark-design.md, references/dataset-design.md, references/baseline-design.md, references/evaluation-design.md, references/training-design.md, and references/experiment-efficiency.md as needed. Triggers: 'design method', 'plan experiments', 'concretize approach', '细化方案', '设计实验'.",
    dir: "skills/method-design",
  },
  {
    name: "method-realize",
    description:
      "Realize the designed method into production-ready code artifacts: implement the algorithm, set up training and evaluation pipelines, enforce sanity and quality contracts, and prepare the experiment matrix. Includes code review gate and reproducibility checklist. Triggers: 'implement method', 'realize design', 'write code', '实现方法', '写代码'.",
    dir: "skills/method-realize",
  },
  {
    name: "experiment-cycle",
    description:
      "Execute the full experiment lifecycle with dual-gate integrity: Gate 1 (inspector subagent) audits code quality before submission, Gate 2 (auditor subagent + R1-R7 red-lines) verifies experiment design before registration and results before completion. Registers experiments from the active plan with red-line declarations, submits to compute platforms (Inspire/local/API) with parallel-by-default execution, monitors health via agenda_watch, collects results, diagnoses failures, and assesses evidence sufficiency. Triggers: 'run experiment', 'submit job', 'check experiments', '跑实验', '看看进度'.",
    dir: "skills/experiment-cycle",
  },
  {
    name: "idea-refine",
    description:
      "Incremental idea optimization from feedback, not full re-survey. Refines an existing explored idea using review results, novelty grounding feedback, or user direction. Includes anchor drift check and feasibility gate. Produces updated idea with preserved provenance. Triggers: 'refine idea', 'improve idea', 'iterate on idea', '优化idea', '迭代idea'.",
    dir: "skills/idea-refine",
  },
  {
    name: "method-iterate",
    description:
      "Feedback-driven plan revision across all five experiment design dimensions. Revises an existing plan using review scores, experiment results, or user feedback. Classifies feedback by category (mechanism/simplification/addition/recipe/scope/feasibility/experiment-driven), checks anchor drift, and creates superseded version. Triggers: 'revise plan', 'iterate method', 'update plan', '修改方案', '迭代方案'.",
    dir: "skills/method-iterate",
  },
  {
    name: "experiment-iterate",
    description:
      "Result-driven optimization cycle with config adequacy guard. Diagnoses experiment outcomes after verifying configuration was adequate (token limits, model scale, seeds), identifies improvements via methodologist, runs next iteration with regression guard. Not for initial experiments — use experiment-cycle instead. Triggers: 'iterate experiment', 'optimize results', 'next iteration', '迭代实验', '优化实验'.",
    dir: "skills/experiment-iterate",
  },
  {
    name: "claim-build",
    description:
      "Transform experiment results into structured claims with evidence chains, strength calibration, and overclaim detection. Includes red-line gate: research_claim(action='support') automatically blocks promotion if any evidence experiment has red-line violations. Uses methodologist for evidence assessment, critic for overclaim detection, and auditor for evidence chain verification. Triggers: 'build claims', 'what can we claim', '提炼结论', '整理claim'.",
    dir: "skills/claim-build",
  },
  {
    name: "lit-knowledge",
    description:
      "Manage the literature knowledge base: ingest papers, build relationship graphs, register research gaps, and generate compressed context views. Uses research_wiki for all operations. Maintains .research/literature/ with paper metadata, gap maps, edge relationships, and LIT_CONTEXT.md. Triggers: 'ingest paper', 'manage literature', '文献管理', '整理论文'.",
    dir: "skills/lit-knowledge",
  },
  {
    name: "paper-audit",
    description:
      "Pre-submission integrity and quality assurance across 7 dimensions: data truthfulness, citation accuracy, claim-evidence consistency, format/completeness, visual quality, reproducibility, and simulated venue review. Deploys auditor, critic, and editor subagents. Includes multi-round fix loop with convergence rules and rollback classification. Triggers: 'audit paper', 'pre-submission check', '检查论文', '审阅'.",
    dir: "skills/paper-audit",
  },
  {
    name: "paper-compose",
    description:
      "From claims to complete manuscript: plan exhibits, generate figures/tables, write sections via scribe+editor, run prose quality audits, and compile LaTeX. StorySpine drives intro arc. Includes claim gate for ambition calibration. Produces paper with status ready and all exhibits approved. Triggers: 'write paper', 'compose manuscript', '写论文', '撰写'.",
    dir: "skills/paper-compose",
  },
  {
    name: "paper-revise",
    description:
      "Feedback-driven manuscript revision: triage feedback, revise targeted sections, update exhibits, audit changed sections, and verify full-paper coherence. Supports user feedback, editor/critic reviews, audit findings, and venue reviewer comments. NOT a full rewrite — targeted changes only. Triggers: 'revise paper', 'update manuscript', '修改论文', '修订'.",
    dir: "skills/paper-revise",
  },
  {
    name: "peer-review",
    description:
      "Structured adversarial evaluation at any research stage. Dispatches critic subagent with reviewer independence protocol (fresh task per round, zero-context for audit, no leading language). Supports parallel independent reviews, sequential deepening, and cross-agent synthesis. Records structured reviews with scores and action items. Triggers: 'review', 'evaluate', '评估', '评审'.",
    dir: "skills/peer-review",
  },
  {
    name: "project-archive",
    description:
      "Freeze, package, and preserve the complete research record. Generates experiment index, claim-evidence map, exhibit provenance table, reproducibility package, and timeline summary. All objects moved to terminal states. Outputs to .research/archive/. Triggers: 'archive project', 'freeze research', '归档', '存档'.",
    dir: "skills/project-archive",
  },
  {
    name: "venue-cycle",
    description:
      "Submission, review, rebuttal, and revision management. Registers submissions, records external reviews, plans rebuttals, executes phase rollbacks for reviewer demands, and handles resubmission. Supports multiple review rounds and terminal states (accepted/rejected/closed). Triggers: 'submit paper', 'handle reviews', '投稿', '审稿回复'.",
    dir: "skills/venue-cycle",
  },
] as const;

const skillContributions = SKILLS.map((s) =>
  skill({
    id: s.name,
    skill: { name: s.name, description: s.description, dir: s.dir },
  }),
);

export default definePlugin({
  id: "holos-research",
  version: "1.1.1",
  description:
    "Structured research management — from idea discovery through paper submission, with full state machine tracking, adversarial review, and audit trail.",
  author: "yzxoi <y@yzxoi.top> (https://github.com/yzxoi)",
  homepage: "https://github.com/yzxoi/holos-research",
  repository: "https://github.com/yzxoi/holos-research",
  license: "MIT",
  capabilities: [capability("workspace.read"), capability("workspace.write")],
  activate: async () => {
    installIndexHooks();
  },
  contributions: [
    event({
      id: "research.changed",
      payload: z.object({
        reason: z.string(),
        project: z.string().optional(),
        ts: z.string(),
      }),
    }),
    ...toolContributions,
    ...agentContributions,
    ...skillContributions,
    monitorAll,
    monitorWorkflow,
    monitorPhase,
    monitorEntities,
    monitorTimeline,
    monitorJournal,
    monitorActiveRun,
    monitorBrief,
    workbenchPanel({
      id: "monitor",
      label: "Research Monitor",
      icon: "microscope",
      surface: "side",
      cardinality: "multi",
      requiresSession: false,
      defaultResource: { id: "overview", title: "Overview" },
      component: { source: "./src/ui/monitor-panel.tsx" },
    }),
  ],
});
