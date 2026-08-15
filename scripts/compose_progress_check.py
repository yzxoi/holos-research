#!/usr/bin/env python3
"""
Compose Progress Check — Stage gate for the paper-compose pipeline.

Inspects the compose directory and reports which stage artifacts exist,
which are missing, and which stage should run next. Stage gates, in order:

    contribution       confirmed_contribution.md
    results_validation results_validation.md
    reviewer_audit     reviewer_audit.md
    planning           section_blueprints.md + writing_rationale_matrix.md
    draft              paper/main.tex or any paper/*.tex
    supplement         paper/supplementary.tex or paper/appendix.tex
    quality            compose_quality_report.md

A missing compose directory means the pipeline has not started yet:
status "empty", exit 0 (start from the contribution gate).

Usage:
    python compose_progress_check.py
    python compose_progress_check.py .research/compose --json
"""

import argparse
import json
import sys
from pathlib import Path

DEFAULT_COMPOSE_DIR = ".research/compose"

STAGES: list[dict] = [
    {
        "gate": "contribution",
        "artifacts": ["confirmed_contribution.md"],
        "require": "all",
    },
    {
        "gate": "results_validation",
        "artifacts": ["results_validation.md"],
        "require": "all",
    },
    {
        "gate": "reviewer_audit",
        "artifacts": ["reviewer_audit.md"],
        "require": "all",
    },
    {
        "gate": "planning",
        "artifacts": ["section_blueprints.md", "writing_rationale_matrix.md"],
        "require": "all",
    },
    {
        "gate": "draft",
        "artifacts": ["paper/main.tex", "paper/*.tex"],
        "require": "any_tex",
    },
    {
        "gate": "supplement",
        "artifacts": ["paper/supplementary.tex", "paper/appendix.tex"],
        "require": "any",
    },
    {
        "gate": "quality",
        "artifacts": ["compose_quality_report.md"],
        "require": "all",
    },
]


def check_stage(compose_dir: Path, stage: dict) -> dict:
    """Check one stage's artifacts under the compose directory."""
    gate = stage["gate"]
    present: list[str] = []
    missing: list[str] = []

    if stage["require"] == "any_tex":
        paper = compose_dir / "paper"
        if not paper.is_dir():
            missing.append("paper/")
        else:
            tex_files = sorted(paper.glob("*.tex"))
            if tex_files:
                present = [str(f.relative_to(compose_dir)) for f in tex_files]
            else:
                missing.append("paper/*.tex")
        return {
            "gate": gate,
            "pass": bool(present),
            "present": present,
            "missing": missing,
        }

    for artifact in stage["artifacts"]:
        if (compose_dir / artifact).exists():
            present.append(artifact)
        else:
            missing.append(artifact)

    passed = not missing if stage["require"] == "all" else bool(present)
    return {"gate": gate, "pass": passed, "present": present, "missing": missing}


def main() -> None:
    parser = argparse.ArgumentParser(description="Compose Progress Check")
    parser.add_argument(
        "compose_dir",
        nargs="?",
        default=DEFAULT_COMPOSE_DIR,
        help=f"Path to the compose directory (default: {DEFAULT_COMPOSE_DIR})",
    )
    parser.add_argument("--json", action="store_true", help="Output structured JSON")
    args = parser.parse_args()

    compose_dir = Path(args.compose_dir)

    if not compose_dir.is_dir():
        result = {
            "status": "empty",
            "compose_dir": str(compose_dir),
            "complete": False,
            "next_gate": "contribution",
            "gates": [],
        }
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print("=== Compose Progress Check ===")
            print(f"⏭️  Compose directory not found: {compose_dir}")
            print("⏭️  First run detected — starting from the contribution gate.")
        return

    gates = [check_stage(compose_dir, stage) for stage in STAGES]
    complete = all(g["pass"] for g in gates)
    next_gate = next((g["gate"] for g in gates if not g["pass"]), None)

    if args.json:
        print(
            json.dumps(
                {
                    "status": "complete" if complete else "incomplete",
                    "compose_dir": str(compose_dir),
                    "complete": complete,
                    "next_gate": next_gate,
                    "gates": gates,
                },
                indent=2,
            )
        )
        if not complete:
            sys.exit(1)
        return

    print("=== Compose Progress Check ===")
    for g in gates:
        icon = "✅" if g["pass"] else "❌"
        detail = f"  (missing: {', '.join(g['missing'])})" if g["missing"] else ""
        print(f"  {icon} {g['gate']}{detail}")
    print()
    if complete:
        print(f"✅ PASS: all {len(gates)} stage gates passed — pipeline complete")
    else:
        print(f"❌ FAIL: next gate is '{next_gate}'")
        sys.exit(1)


if __name__ == "__main__":
    main()
