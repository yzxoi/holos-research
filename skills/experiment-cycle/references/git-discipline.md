# Git Discipline for Research Projects

## Why This Matters

A Nature-level research project runs for months. Without git discipline:
- You cannot trace which code produced which experiment
- You cannot roll back to a known-good state after a bad refactor
- `.research/` state changes are invisible and unrecoverable
- Experiment branches overwrite each other
- The repo fills with 10,000+ untracked files (logs, checkpoints, data)

Git is not optional overhead. It is the **code-level equivalent of the research timeline** — without it, the experiment phase is not reproducible.

---

## Git Initialization

`research_init` automatically handles git setup:
- Initializes `git init` if no `.git/` exists
- Writes a comprehensive `.gitignore`
- Creates the initial commit with `.research/` structure

If the repo already has git, init does not modify it.

---

## .gitignore Strategy

The `.gitignore` is designed around one principle: **track the research control plane and code; exclude everything large or generated.**

### What IS tracked (in git)

```
.research/                     ← Entire research control plane
  state.yaml                   ← Project state
  timeline.jsonl               ← Research history
  ASSETS.md                    ← Resource documentation
  ideas/*.yaml, *.md           ← Idea objects
  plans/*.yaml, *.md           ← Plan objects
  experiments/*.yaml, *.md     ← Experiment metadata (NOT outputs)
  claims/*.yaml, *.md          ← Claim objects
  exhibits/*.yaml, *.md        ← Exhibit metadata
  manuscripts/*.yaml, *.md      ← Paper metadata
  submissions/*.yaml, *.md     ← Submission metadata
  *.reviews.jsonl              ← Review history
  *.review.*.md                ← Review content
  literature/                  ← Full literature wiki
  scripts/                     ← Bundled utility scripts

code/                          ← All experiment source code
configs/                       ← Experiment configurations
paper/                         ← LaTeX source files (.tex, .bib, .sty)
```

### What is NOT tracked (in .gitignore)

```
# Experiment outputs — large, generated, stored on platform
checkpoints/
logs/
runs/
wandb/
outputs/
results/*.pt
results/*.pth
results/*.ckpt
results/*.safetensors

# Data — too large for git
data/
datasets/

# Paper build artifacts
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

# Python
__pycache__/
*.pyc
*.pyo
.venv/
*.egg-info/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Large binary files
*.pt
*.pth
*.ckpt
*.safetensors
*.bin
*.h5
*.hdf5
*.tar.gz
*.zip
```

### Exception: experiment result JSONs ARE tracked

```
# In .gitignore, these are NOT excluded:
# results/*.json   ← Small structured results from stats.py standard format
```

Small JSON result files (< 1MB) should be tracked because they contain the metrics that back claims. Large binary artifacts should not.

---

## Commit Discipline

### When to Commit

Research git commits happen at **structural milestones**, not on every file save.

| Event | What to commit | Message pattern |
|-------|---------------|-----------------|
| After `research_init` | Entire `.research/` initial structure | `research: init project "<name>"` |
| Before experiment submission | All code changes since last commit | `experiment: code for exp_XXX — <description>` |
| After experiment completion | `.research/experiments/exp_XXX.yaml` + result JSON | `experiment: results for exp_XXX — <key metric>` |
| After idea selection | `.research/ideas/idea_XXX.*` | `idea: selected idea_XXX — <title>` |
| After plan approval | `.research/plans/plan_XXX.*` | `plan: approved plan_XXX — <title>` |
| After claim finalization | `.research/claims/claim_XXX.*` | `claim: finalized N claims` |
| After exhibit approval | `.research/exhibits/exh_XXX.*` | `exhibit: approved exh_XXX — <title>` |
| Phase transition | `.research/state.yaml` + related objects | `phase: <from> → <to> — <reason>` |
| Paper milestone | `paper/` + `.research/manuscripts/paper_XXX.*` | `paper: <status> — <description>` |
| Submission event | `.research/submissions/sub_XXX.*` | `submission: <action> — <venue>` |

### Commit Message Convention

```
<category>: <what happened>

Categories: research, experiment, idea, plan, claim, exhibit, phase, paper, submission
```

Examples:
```
research: init project "Factorized Gap in Discrete Diffusion LMs"
experiment: code for exp_007 — main method seed 42
experiment: results for exp_007 — PPL 18.3
phase: design → experiment — plan_002 approved
claim: finalized 5 claims (3 supported, 2 qualified)
paper: drafting complete — all sections written
submission: submitted to ICML 2027
```

### What NOT to Commit

- **Never commit large binary files** (checkpoints, model weights, data)
- **Never commit experiment logs** (stdout/stderr captures) — these belong on the platform or in `logs/`
- **Never commit with uncommitted changes in a dirty state** — always review `git status` first
- **Never force push** unless the user explicitly requests it
- **Never commit credentials, API keys, or tokens**

---

## Pre-Experiment Git Protocol

**This is the most important section.** Before submitting ANY experiment:

### Step 1: Check clean state

```bash
git status
```

If there are uncommitted changes:
- Review them: are they related to this experiment?
- If yes: stage and commit with a descriptive message
- If no: stash them (`git stash`) before committing experiment code
- If uncertain: ask the user

**NEVER submit an experiment with uncommitted code changes.** The `code_commit` hash recorded in the experiment record must accurately reflect the code that will run.

### Step 2: Record commit hash

```bash
git rev-parse HEAD
```

This hash goes into `research_experiment(action="register", code_commit="<hash>")`.

### Step 3: Verify code-commit integrity

After the experiment completes, verify the commit still matches:
- The experiment ran on this exact code version
- No one modified the code between submission and completion

If the code was modified during experiment runtime, the experiment's `code_commit` is stale. Record this in the experiment notes.

---

## Branching Strategy

### When to Branch

Branch when the code needs to **diverge** for different experimental directions that might not merge back.

| Scenario | Branch name | When to create | When to merge/delete |
|----------|-------------|----------------|---------------------|
| New method variant | `exp/method-v2` | Before modifying core method code | After deciding which variant to keep |
| Ablation that requires code changes | `exp/ablation-no-residual` | Before the structural code change | After ablation experiment completes |
| Major refactor | `refactor/training-loop` | Before starting the refactor | After verifying experiments still reproduce |
| Paper-specific code (camera-ready) | `paper/camera-ready` | When preparing final reproducibility package | After paper is accepted |
| Trying a risky approach | `exp/risky-<description>` | Before the risky change | Delete if approach fails; merge if succeeds |

### Branch Rules

1. **`main` is always runnable.** Every commit on main should be able to reproduce the latest completed experiments.
2. **Experiment branches are cheap.** Create them liberally, delete aggressively after conclusions are drawn.
3. **Never leave long-lived branches unmerged.** If a branch is > 2 weeks old and not actively used, either merge or delete it.
4. **Record which branch an experiment ran on.** If `exp_009` ran on `exp/method-v2`, note this in the experiment `.md`.

### Branch Workflow Example

```bash
# Create experiment branch for a method variant
git checkout -b exp/factorized-v2

# Make changes, commit
git add code/model.py code/train.py
git commit -m "experiment: factorized-v2 — separate encoder/decoder paths"

# Record commit hash for experiment registration
git rev-parse HEAD
# → abc123

# Submit experiment with this hash
# research_experiment(action="register", code_commit="abc123", ...)

# After experiment concludes and results are good:
git checkout main
git merge exp/factorized-v2
git branch -d exp/factorized-v2

# Or if results are bad:
git checkout main
git branch -D exp/factorized-v2  # force delete
```

---

## .research/ Tracking

### Why .research/ Must Be in Git

`.research/` is the research control plane. If it's not tracked:
- Phase transitions are invisible
- Idea evolution is lost
- Claim-evidence chains cannot be audited
- Timeline history disappears if the disk fails
- Collaboration is impossible (others can't see the research state)

### Commit Frequency for .research/

`.research/` changes should be committed at every research milestone (see the commit table above). They are always small files (YAML, JSONL, Markdown), so they add negligible overhead to git.

### Review Sidecar Files

`.reviews.jsonl` and `.review.NNN.md` files **should be tracked**. They contain:
- Structured review history (who reviewed, what verdict, what scores)
- Full review text (the critic's/auditor's/editor's complete output)

These are essential for audit trail and reproducibility of the review process.

---

## Recovery Scenarios

### "I forgot to commit before running an experiment"

1. Check if the code has changed since the experiment was submitted
2. If unchanged: commit now and retroactively record the hash
3. If changed: use `git log` to find the closest commit before submission time
4. Record the situation in the experiment's `.md`: "Code commit recorded retroactively; exact match uncertain"

### "The repo has 10,000 untracked files"

1. First: check `.gitignore` is correct (should exclude checkpoints, logs, data, build artifacts)
2. Run `git status --short | wc -l` to see the true count
3. If most are in `data/`, `logs/`, `checkpoints/`: `.gitignore` is probably missing entries
4. Fix `.gitignore`, then `git add .gitignore && git commit -m "fix: update gitignore"`
5. Verify: `git status` should now be clean

### "I want to go back to the code that produced exp_007"

```bash
# Find the commit hash from experiment record
# research_experiment(action="list") → exp_007.code_commit = "abc123"

# View that code state without switching branches
git show abc123:code/model.py

# Or create a temporary branch to explore
git checkout -b explore/exp007-code abc123

# When done exploring
git checkout main
git branch -D explore/exp007-code
```

### "I need to reproduce an old experiment on a new machine"

1. Clone the repo: `git clone <url>`
2. Check out the experiment's commit: `git checkout <code_commit>`
3. Read `.research/experiments/exp_007.yaml` for hyperparameters, environment, image
4. Read `.research/experiments/exp_007.md` for any special setup notes
5. Run the experiment with the recorded command

This only works if git discipline was followed — commit before submit, record the hash.

---

## Integration with research_experiment

The `research_experiment` tool's `code_commit` field is the bridge between git and the experiment record:

```
research_experiment(action="register",
  title="Main method — seed 42",
  code_commit="abc123def456",  ← THIS connects code to experiment
  ...)
```

If `code_commit` is empty when registering, the tool should:
1. Attempt to read it automatically via `git rev-parse HEAD`
2. If the working tree is dirty, warn: "Uncommitted changes exist. Commit before registering."
3. If git is not initialized, warn: "No git repository. Code traceability is not available."

---

## Summary: The 5 Git Rules for Research

1. **Always commit before submitting an experiment.** No exceptions.
2. **Always record `code_commit` in the experiment.** This is non-negotiable for reproducibility.
3. **Track `.research/` in git.** It is the research control plane, not disposable output.
4. **Use `.gitignore` aggressively.** Checkpoints, logs, data, and build artifacts do not belong in git.
5. **Branch when code diverges.** Cheap to create, cheap to delete, essential for clean experiment isolation.
