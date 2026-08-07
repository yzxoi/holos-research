# Iteration Protocol — Multi-Round Review → Fix → Recompile Cycle

Load this reference during paper-audit Step 8+. It handles the iterative improvement loop after the initial 7-dimension check.

## Why Iteration Is Needed

A one-shot audit is not enough for Nature-level papers. Issues compound:
- Fixing a claim scope may break a figure caption
- Rewriting a section may introduce new notation inconsistencies
- Adding a missing experiment reference may push the paper over the page limit

The iteration loop catches these cascading effects.

## Constants

- `MAX_AUDIT_ROUNDS = 3` — Maximum review→fix→recompile rounds
- `MIN_SCORE_PROGRESS = 0.5` — Minimum score improvement per round to continue
- `FREEZE_THRESHOLD = 8` — Simulated review score required to freeze

---

## Issue Classification

After each audit round, classify every finding into exactly one category:

### PAPER-FIX (resolve within current phase)

Issues fixable by editing the paper, regenerating an exhibit, or updating a caption. No research-level change needed.

Examples:
- Notation inconsistency across sections
- Figure caption doesn't match figure content
- Missing error bars on a table
- Passive voice or AI-isms in prose
- Overfull hbox or formatting issue
- Missing cross-reference
- Acronym not defined at first use

Action: Fix in place → recompile → re-audit the affected dimensions.

### ROLLBACK-CLAIM (return to claim phase)

The paper reveals that claims are overclaimed, unsupported, or inconsistent.

Examples:
- "Significant improvement" but p > 0.05
- Claim in abstract not supported by any table
- Two claims contradict each other
- Writing exposed a claim that has no experiment backing it

Action: `research_state(action="redirect", target_phase="compose", reason="...")` → then invoke claim-build skill. After claim adjustment, return through compose → audit again.

### ROLLBACK-EXPERIMENT (return to experiment phase)

The paper reveals missing evidence that cannot be addressed by narrowing claims.

Examples:
- Reviewer (simulated or real) requests a missing baseline
- Ablation table has only 2 of 5 planned ablations
- Robustness evidence completely absent
- A key claim requires an experiment that was never run

Action: `research_state(action="redirect", target_phase="experiment", reason="...")`. After experiments complete, return through claim → compose → audit.

### ROLLBACK-SPEC (return to spec phase)

The paper reveals a fundamental method issue.

Examples:
- Writing the method section exposed a logical gap in the approach
- Simulated reviewer identifies a flaw in the core mechanism
- The method cannot be described precisely because it was never fully specified

Action: `research_state(action="redirect", target_phase="design", reason="...")`. This is rare but important — it prevents submitting a paper with a broken method.

---

## Multi-Round Loop Protocol

### Round Structure

Each round follows this sequence:

```
audit (7 dimensions)
  → classify findings (PAPER-FIX / ROLLBACK-*)
  → if any ROLLBACK-* → recommend rollback, STOP loop
  → execute PAPER-FIX items
  → recompile (paper_check.sh --json)
  → re-audit (only failed dimensions)
  → record round results
  → check convergence
  → loop or stop
```

### Reviewer Independence Protocol

**Each audit round must use a FRESH reviewer task.** The reviewer must not see:
- Previous round's findings
- What was fixed
- Prior scores

Why: If the reviewer knows what was fixed, they tend to inflate scores ("I see they fixed X, so I'll give a higher score") even when the fix introduced new problems.

```
// CORRECT: fresh, zero-context review each round
task(subagent_type="critic"):
  "You are reviewing a [venue] paper. This is a fresh review.
   Judge the paper ONLY from the current source and PDF.
   [paste current paper text]"

// WRONG: carrying context from prior rounds
task(subagent_type="critic"):
  "Last round you scored 5/10 and found X, Y, Z.
   They fixed X and Y. Please re-review."   // ← BIAS!
```

### Score Tracking

After each round, record:

```json
{
  "round": 2,
  "scores": {
    "data_truthfulness": "pass",
    "citation_accuracy": "pass",
    "claim_evidence": "pass",
    "format": "pass",
    "visual_quality": "pass",
    "reproducibility": "partial",
    "simulated_review": 7.5
  },
  "simulated_overall": 7.5,
  "issues_found": 3,
  "issues_fixed": 2,
  "issues_remaining": 1,
  "rollback_recommended": false
}
```

### Convergence Rules

| Condition | Action |
|-----------|--------|
| All 7 dimensions pass + simulated score ≥ FREEZE_THRESHOLD | **STOP** — ready to freeze |
| Score improved ≥ MIN_SCORE_PROGRESS | Continue to next round |
| Score did NOT improve for 2 consecutive rounds | **STOP** — recommend rollback or user decision |
| MAX_AUDIT_ROUNDS reached | **STOP** — present best version with remaining issues |
| Any ROLLBACK-* finding | **STOP** — recommend rollback to orchestrator |

### PDF Version Preservation

After each round's recompile:
```bash
cp paper/main.pdf paper/main_audit_round{N}.pdf
```

Keep all versions. The user and the editor agent need to compare progression.

---

## Kill Argument Exercise (theory papers only)

Run on the FINAL round, only if the paper has ≥ 5 theorem/lemma/proposition environments.

### Thread 1: Attack
```
task(subagent_type="critic"):
  "Construct the single strongest argument to REJECT this paper.
   Focus on: theorem validity, assumption gaps, proof obligations,
   claim/evidence misalignment. 200 words maximum.
   Judge ONLY from the current files. No prior context."
```

### Thread 2: Defense
```
task(subagent_type="methodologist"):
  "Defend the paper against this attack:
   [paste attack memo]
   For each point: already addressed / partially addressed / unresolved.
   Cite specific file locations as evidence."
```

### Merge
- Novel unresolved attack points → add to fix list
- Already addressed points → verify the file evidence
- Record both memos in paper review history

---

## Restatement Regression Test (theory papers only)

After every recompile, check that theorem statements in the main body match their appendix restatements:

- Compare statements only (not proof bodies)
- Normalize: strip labels, refs, formatting macros
- Flag: changed hypotheses, quantifier order, variable names, terminology

This prevents fix rounds from introducing appendix drift.

---

## Integration with Orchestrator

When paper-audit recommends a rollback:

1. Paper-audit records the recommendation in its review output
2. Paper-audit does NOT execute the rollback itself
3. The orchestrator (or the user in collaborative mode) makes the decision
4. If approved: `research_state(action="redirect", target_phase="...", reason="...")`
5. After the earlier phase completes, the orchestrator routes back through compose → audit

This preserves the principle: **audit evaluates, orchestrator decides, user approves.**

---

## Agenda Integration for Long Audits

A full 3-round audit with recompilation can take 30-60 minutes. If you need to yield the session during audit, set up a watch on the audit state file:

```
agenda_watch(
  title="Monitor paper audit completion",
  check={tool: "bash", args: {command: "cat .research/AUDIT_STATE.json"}, interval: "10m"},
  trigger="match",
  match="completed",
  timeout="2h")
```

This wakes you when `AUDIT_STATE.json` contains "completed" (written by the audit loop on final round). No agent session created, no tokens consumed.

Alternatively, if the audit runs within a single session turn (no yield needed), skip the watch entirely and just run the loop synchronously.

---

## State Recovery (Crash / Compaction Recovery)

If the session is compacted or crashes mid-audit, the loop must be resumable. Write `AUDIT_STATE.json` in `.research/` after each round:

```json
{
  "paper_id": "paper_001",
  "current_round": 2,
  "max_rounds": 3,
  "last_simulated_score": 7.0,
  "status": "in_progress",
  "dimensions_passed": ["data_truthfulness", "citation_accuracy", "claim_evidence"],
  "dimensions_failed": ["format", "visual_quality"],
  "rollback_recommended": null,
  "timestamp": "2026-06-18T14:30:00Z"
}
```

**On startup**: If `AUDIT_STATE.json` exists with `status: "in_progress"` AND timestamp is within 24 hours:
1. Read it + `paper_001.reviews.jsonl` to recover context
2. Resume from the next round (don't re-run completed rounds)
3. Re-audit only the `dimensions_failed` from the last round

**On completion**: Set `status: "completed"`. The orchestrator reads this to confirm the paper is ready.

**Staleness**: If timestamp > 24 hours old, start fresh (the paper may have changed significantly).

---

## Location-Aware Format Compliance

When checking LaTeX compilation warnings, classify by source location:

### Classification rules

| Location | Overfull threshold | Action |
|----------|-------------------|--------|
| **Main body** (sections before `\appendix`) | Any size | **BLOCKS** — must fix |
| **Appendix** (after `\appendix`, or files containing "appendix") | > 10pt | Blocks. ≤ 10pt: warn only |
| **Bibliography** (`.bbl`, `references.bib` output) | > 20pt | Blocks. ≤ 20pt: warn only |

### Why location matters

Main body content is what reviewers see first and what determines acceptance. Appendix content supports but doesn't drive the decision. Bibliography formatting is lowest priority.

### Auto-fix patterns

| Issue | Location | Fix |
|-------|----------|-----|
| Overfull in equation | Main body | Split with `aligned`/`split`/`multline` |
| Overfull in table | Main body | Reduce font, `\resizebox`, or restructure |
| Overfull in text | Main body | Rephrase the sentence. Never use global `\sloppy` |
| Overfull in URL | Bibliography | `\url{}` with `breakurl` or `\allowbreak` |
| Over page limit | Main body | Move content to appendix, compress, tighten |

### Check with paper_check.sh

```bash
.research/scripts/paper_check.sh paper/ --json --limit 9
```

Then parse the JSON output's `overfull` array, classify each by location, apply thresholds.
