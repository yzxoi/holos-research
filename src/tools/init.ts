import { tool } from "@ericsanchezok/synergy-plugin/tool";
import fs from "fs/promises";
import path from "path";
import z from "zod";
import { scopeDir } from "../ctx";
import { ResearchFS } from "../fs";
import { getMutex, withLock } from "../lock";
import { log } from "../log";
import { PhaseRunManager } from "../phase-run";
import type { StateYaml } from "../schema";
import {
  ComposeConfig,
  DesignConfig,
  ExperimentConfig,
  ExplorationConfig,
  GroundConfig,
  ParticipationMode,
  RealizeConfig,
} from "../schema";
import { ResearchTimeline } from "../timeline";
import { generateAgentsMd } from "./agents-md";
import { mdMeta, withGuard } from "./shared";

const initMutex = getMutex("init");

const GITIGNORE_CONTENT = `# ── Experiment outputs (large, generated) ──────────────────
results/
checkpoints/
runs/
wandb/
outputs/
*.pt
*.pth
*.ckpt
*.safetensors
*.bin
*.h5
*.hdf5

# ── Data (too large for git) ──────────────────────────────
data/
datasets/

# ── Logs ──────────────────────────────────────────────────
logs/
*.log

# ── Reference papers ─────────────────────────────────────
papers/
*.pdf

# ── Paper build artifacts ─────────────────────────────────
paper/*.aux
paper/*.bbl
paper/*.blg
paper/*.fdb_latexmk
paper/*.fls
paper/*.log
paper/*.out
paper/*.synctex.gz
paper/*.pdf
paper/build/

# ── Python ────────────────────────────────────────────────
__pycache__/
*.pyc
*.pyo
.venv/
venv/
*.egg-info/
dist/
build/

# ── OS ────────────────────────────────────────────────────
.DS_Store
Thumbs.db

# ── IDE ───────────────────────────────────────────────────
.vscode/
.idea/
*.swp
*.swo

# ── Archives and large binaries ───────────────────────────
*.tar.gz
*.zip
*.rar
*.7z

# ── Misc ──────────────────────────────────────────────────
.env
*.tmp
`;

const DESCRIPTION = `Initialize a research project in the current scope, or load an existing one.

Creates the \`.research/\` directory with all subdirectories (ideas, plans, experiments, claims, exhibits, papers, submissions, literature), state.yaml, timeline.jsonl, ASSETS.md, and literature stubs. Also generates AGENTS.md at the project root (auto-loaded every session for behavioral rules and state). Auto-appends a research.init event to the timeline.

If \`.research/\` already exists (state.yaml present), returns the current state without overwriting — use this to reload context at the start of any research session.

IMPORTANT:
- Call this BEFORE any other research_* tool. Other tools will return an error if the project is not initialized.
- Re-calling on an existing project is safe and acts as a context reload (returns current state + focus).
- The \`.research/\` directory is the single source of truth — do not move or rename it.

Use this to:
- Start a new research project
- Reload context when starting a new session (call without params — existing project is returned)
- Check the current project status, focus phase, and object counters

After initialization, use research_idea(action="create") to register your first research idea.

Files: Creates the entire .research/ directory tree in the current scope directory + AGENTS.md at project root.
All research tools write EXCLUSIVELY under .research/ — never to the project root.`;

export const researchInit = tool({
  description: DESCRIPTION,
  args: {
    project: z
      .string()
      .describe(
        "Research project name, e.g. 'Factorized Gap in Discrete Diffusion LMs'. Ignored if project already exists.",
      ),
    anchor: z
      .string()
      .describe(
        "The user's research direction in their own words — what problem to solve, what mechanism to explore. Evolves over time via research_state.",
      ),
    venue: z.string().optional().describe("Target venue, e.g. 'ICML 2027'. Set later via research_state if unsure."),
    participation_mode: ParticipationMode.optional().describe(
      "How involved the user is: collaborative (pause at every stage, default), guided (pause at milestones), autonomous (pause only on anomalies)",
    ),
  },
  async execute(params) {
    // audit#2 P1-12: wrap in withGuard so corrupt state.yaml (during reload
    // path) returns actionable repair guidance instead of bubbling YamlCorruptError.
    return withGuard(async () =>
      withLock(initMutex, async () => {
        const statePath = ResearchFS.resolve("state.yaml");

        if (await ResearchFS.exists(statePath)) {
          const state = await ResearchFS.readYaml<StateYaml>(statePath);
          if (state) {
            // Ensure AGENTS.md exists (migration for pre-AGENTS.md projects)
            const projectRoot = scopeDir();
            const agentsMdPath = path.join(projectRoot, "AGENTS.md");
            const agentsMdExists = await fs
              .stat(agentsMdPath)
              .then(() => true)
              .catch(() => false);
            if (!agentsMdExists) {
              await ResearchFS.writeMd(agentsMdPath, generateAgentsMd(state));
            }

            const lines = [
              "=== Research project already initialized ===",
              "",
              `Project: ${state.project}`,
              `Venue: ${state.config.venue ?? "(not set)"}`,
              `Mode: ${state.config.participation_mode}`,
              `Exploration: depth=${state.config.exploration.depth}, pilot=${state.config.exploration.pilot}`,
              `Created: ${state.created}`,
              `Updated: ${state.updated}`,
              "",
              "Counters:",
              `  Ideas: ${state.counters.idea}`,
              `  Plans: ${state.counters.plan}`,
              `  Experiments: ${state.counters.exp}`,
              `  Claims: ${state.counters.claim}`,
              `  Exhibits: ${state.counters.exh}`,
              `  Papers: ${state.counters.paper}`,
              `  Submissions: ${state.counters.sub}`,
            ];

            if (state.focus) {
              lines.push(
                "",
                "Current focus:",
                `  Phase: ${state.focus.phase}`,
                `  Since: ${state.focus.since}`,
                ...(state.focus.summary ? [`  Summary: ${state.focus.summary}`] : []),
                ...(state.focus.next ? [`  Next: ${state.focus.next}`] : []),
              );
            }

            return {
              title: state.project,
              output: lines.join("\n"),
              metadata: mdMeta({ state }),
            };
          }
        }

        const dirs = [
          "",
          "ideas",
          "plans",
          "experiments",
          "claims",
          "exhibits",
          "manuscripts",
          "submissions",
          "literature",
          "literature/by-topic",
          "literature/papers",
          "phase_runs",
          "journal",
          "snapshots",
          "positioning",
          "code_artifacts",
          "rqg",
          "compose",
          "diagnoses",
          "checkpoint_briefs",
        ];

        for (const dir of dirs) {
          await ResearchFS.ensureDir(ResearchFS.resolve(dir));
        }

        const now = new Date().toISOString();
        const state: StateYaml = {
          project: params.project,
          anchor: params.anchor,
          schema_version: 2,
          created: now,
          updated: now,
          config: {
            participation_mode: params.participation_mode ?? "collaborative",
            venue: params.venue,
            stalled_days: 7,
            exploration: ExplorationConfig.parse({}),
            ground: GroundConfig.parse({}),
            design: DesignConfig.parse({}),
            realize: RealizeConfig.parse({}),
            experiment: ExperimentConfig.parse({}),
            compose: ComposeConfig.parse({}),
          },
          counters: {
            idea: 0,
            plan: 0,
            exp: 0,
            claim: 0,
            exh: 0,
            paper: 0,
            sub: 0,
          },
          focus: {
            since: now,
            phase: "explore",
            reason: "Project initialized — starting with exploration",
            blocked_on: null,
          },
        };

        // Create initial phase run for the explore phase BEFORE writing state
        // NOTE: Init bypasses the two-step advance+checkpoint flow intentionally
        // for the initial explore phase — no checkpoint gating is needed here.
        const phaseRun = await PhaseRunManager.create({
          phase: "explore",
          refs: {},
          summary: "Project initialized — starting with exploration",
        });

        // Single atomic write with active_phase_run included
        state.focus!.active_phase_run = phaseRun.id;
        await ResearchFS.writeYaml(statePath, state);

        await PhaseRunManager.refreshContext(phaseRun.id, {
          trigger: "phase_entry",
          anchor: params.anchor,
          active_refs: {},
        });

        await ResearchTimeline.append({
          type: "research.init",
          summary: `Initialized research project: ${params.project}`,
        });

        await ResearchTimeline.append({
          type: "focus.changed",
          phase: "explore",
          to: "explore",
          summary: "Initial phase set to explore on project creation",
        });

        const assetsMd = [
          "# Research Assets",
          "",
          "## Models (API)",
          "",
          "(add model endpoints here)",
          "",
          "## Datasets",
          "",
          "(add dataset paths here)",
          "",
          "## Checkpoints",
          "",
          "(add checkpoint paths here)",
          "",
        ].join("\n");
        await ResearchFS.writeMd(ResearchFS.resolve("ASSETS.md"), assetsMd);

        await ResearchFS.writeMd(
          ResearchFS.resolve("literature/survey.md"),
          "# Literature Survey\n\n(placeholder — will be populated by idea-explore skill)\n",
        );

        await Bun.write(ResearchFS.resolve("literature/references.bib"), "");

        await ResearchFS.writeYaml(ResearchFS.resolve("literature/gap_map.yaml"), { gaps: [] });
        await Bun.write(ResearchFS.resolve("literature/edges.jsonl"), "");
        await Bun.write(ResearchFS.resolve("literature/log.jsonl"), "");

        const projectRoot = scopeDir();

        // Create pyproject.toml for uv-managed Python environment (if not exists)
        const pyprojectPath = path.join(projectRoot, "pyproject.toml");
        const pyprojectExists = await fs
          .stat(pyprojectPath)
          .then(() => true)
          .catch(() => false);
        if (!pyprojectExists) {
          const slug = params.project
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const pyproject = [
            `[project]`,
            `name = "${slug}"`,
            `version = "0.1.0"`,
            `requires-python = ">=3.10"`,
            ``,
            `# Core deps for research utility scripts (stats, plotting, diagrams)`,
            `dependencies = [`,
            `    "matplotlib>=3.8",`,
            `    "numpy>=1.26",`,
            `]`,
            ``,
            `# Add experiment-specific deps as needed:`,
            `#   uv add --optional train torch transformers datasets`,
            `[project.optional-dependencies]`,
            `train = []`,
            ``,
          ].join("\n");
          await Bun.write(pyprojectPath, pyproject);
        }

        // Materialize bundled utility scripts and themes from the generated
        // assets module (inlined at build time — Bun.build cannot resolve
        // `?raw` for non-JS extensions, and `__dirname` is unreliable in the
        // bundled runtime). Same behavior as the baseline: skip existing files.
        const scriptsDir = ResearchFS.resolve("scripts");
        await ResearchFS.ensureDir(scriptsDir);
        try {
          const { SCRIPTS } = await import("../generated/assets");
          for (const [rel, content] of Object.entries(SCRIPTS)) {
            const dest = path.join(scriptsDir, rel);
            if (!(await ResearchFS.exists(dest))) {
              await ResearchFS.ensureDir(path.dirname(dest));
              await Bun.write(dest, content);
              if (rel.endsWith(".sh")) {
                await fs.chmod(dest, 0o755);
              }
            }
          }
        } catch (err) {
          log.warn("Init", "Script copying failed (non-fatal):", err instanceof Error ? err.message : err);
        }
        let gitInitialized = false;
        const gitDir = path.join(projectRoot, ".git");
        try {
          const gitExists = await fs
            .stat(gitDir)
            .then(() => true)
            .catch(() => false);
          if (!gitExists) {
            const proc = Bun.spawn(["git", "init"], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
            await proc.exited;
            if (proc.exitCode === 0) {
              gitInitialized = true;
            }
          }

          // Write .gitignore if it doesn't exist
          const gitignorePath = path.join(projectRoot, ".gitignore");
          const gitignoreExists = await fs
            .stat(gitignorePath)
            .then(() => true)
            .catch(() => false);
          if (!gitignoreExists) {
            await Bun.write(gitignorePath, GITIGNORE_CONTENT);
          }

          // Generate AGENTS.md at project root BEFORE commit (survives context compaction)
          const agentsMdPath = path.join(projectRoot, "AGENTS.md");
          const agentsMdContent = generateAgentsMd(state);
          await ResearchFS.writeMd(agentsMdPath, agentsMdContent);

          // Auto-commit the initial research structure
          if (gitInitialized) {
            const filesToAdd = [".research/", ".gitignore", "AGENTS.md"];
            if (!pyprojectExists) filesToAdd.push("pyproject.toml");
            const add = Bun.spawn(["git", "add", ...filesToAdd], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
            await add.exited;
            if (add.exitCode === 0) {
              const commit = Bun.spawn(["git", "commit", "-m", `research: init project "${params.project}"`], {
                cwd: projectRoot,
                stdout: "pipe",
                stderr: "pipe",
              });
              await commit.exited;
            }
          }
        } catch (err) {
          log.warn("Init", "Git initialization failed (non-fatal):", err instanceof Error ? err.message : err);
        }

        const lines = [
          "=== Research project initialized ===",
          "",
          `Project: ${params.project}`,
          `Venue: ${params.venue ?? "(not set)"}`,
          `Mode: ${state.config.participation_mode}`,
          `Exploration: depth=${state.config.exploration.depth}, pilot=${state.config.exploration.pilot}`,
          "",
          "Focus:",
          `  Phase: ${state.focus!.phase}`,
          `  Since: ${state.focus!.since}`,
          "",
          "Created:",
          "  .research/state.yaml",
          "  .research/timeline.jsonl",
          "  .research/ASSETS.md",
          "  .research/ideas/",
          "  .research/plans/",
          "  .research/experiments/",
          "  .research/claims/",
          "  .research/exhibits/",
          "  .research/manuscripts/",
          "  .research/submissions/",
          "  .research/literature/",
          "  .research/scripts/ (stats.py, plot.py, paper_check.sh)",
          "  AGENTS.md (auto-loaded every session — behavioral rules + state)",
          "",
          `Git: ${gitInitialized ? "initialized + initial commit created" : "already existed (no changes)"}`,
          ".gitignore: configured for research project",
          `pyproject.toml: ${pyprojectExists ? "already existed" : "created (use uv sync to install deps)"}`,
          "",
          "⚠️  FILE RULES — All research artifacts MUST go under .research/:",
          "  Survey & literature → .research/literature/ (use research_wiki tool)",
          "  Ideas → .research/ideas/ (use research_idea tool)",
          "  Plans → .research/plans/ (use research_plan tool)",
          "  Experiments → .research/experiments/ (use research_experiment tool)",
          "  Claims → .research/claims/ (use research_claim tool)",
          "  Exhibits → .research/exhibits/ (use research_exhibit tool)",
          "  Manuscripts → .research/manuscripts/ (use research_paper tool)",
          "  Submissions → .research/submissions/ (use research_submission tool)",
          "  DO NOT write research files to the project root directory.",
          "  DO NOT use note_write for research content.",
          "",
          'Next: load skill(name="idea-explore") and begin the exploration phase.',
          "",
          "📝 Set a project summary for the monitor board (concise ≤60 chars):",
          `  research_state(action="read", project_summary="<one-line summary>")`,
          "  Generate the summary from the anchor — capture the core research goal in one phrase.",
        ];

        return {
          title: params.project,
          output: lines.join("\n"),
          metadata: mdMeta({ state }),
        };
      }),
    );
  },
});
