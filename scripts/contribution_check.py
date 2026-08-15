#!/usr/bin/env python3
"""
Contribution Contract Gate — Verify confirmed_contribution.md is complete.

Enforces the four required sections and their required fields, and rejects
empty or placeholder values (TODO / TBD / ... / xxx / placeholder,
case-insensitive). A non-empty "Evidence missing" field is a normal state,
not a failure; an empty "Main contribution statement" always fails.

Usage:
    python contribution_check.py confirmed_contribution.md
    python contribution_check.py .research/compose --json
"""

import argparse
import json
import re
import sys
from pathlib import Path

REQUIRED_SECTIONS: dict[str, list[str]] = {
    "Core Contribution": [
        "Main contribution statement",
        "Contribution type",
        "One-sentence reviewer payoff",
    ],
    "Why This Contribution Is Needed": [
        "Field problem",
        "Specific gap",
        "Concrete challenge",
        "Why prior work leaves it unresolved",
    ],
    "How This Paper Responds": [
        "Design response",
        "Evidence required",
        "Evidence available",
        "Evidence missing",
    ],
    "Claim Boundary": [
        "Strong claims allowed",
        "Claims to soften or avoid",
        "Novelty risk",
        "Significance risk",
    ],
}

PLACEHOLDER_PATTERN = re.compile(r"todo|tbd|\.\.\.|xxx|placeholder", re.IGNORECASE)


def find_section(text: str, name: str) -> tuple[int, int] | None:
    """Return (start, end) offsets of a `## <name>` section, or None."""
    m = re.search(rf"^##\s*{re.escape(name)}\s*:?\s*$", text, re.MULTILINE)
    if not m:
        return None
    end_match = re.search(r"^##\s", text[m.end() :], re.MULTILINE)
    end = m.end() + end_match.start() if end_match else len(text)
    return m.start(), end


def find_field(body: str, field: str) -> re.Match | None:
    """Find a field as a list line (`- **Field name**: value`) or a markdown table row (`| Field name | value |`)."""
    list_match = re.search(
        rf"^\s*(?:[-*]\s+)?(?:\*\*)?{re.escape(field)}(?:\*\*)?\s*:(.*)$",
        body,
        re.MULTILINE,
    )
    if list_match:
        return list_match
    return re.search(
        rf"^\s*\|\s*(?:\*\*)?{re.escape(field)}(?:\*\*)?\s*\|\s*(.*?)\s*\|\s*$",
        body,
        re.MULTILINE,
    )


def field_value(body: str, m: re.Match) -> str:
    """Value = the text after the colon (list) or the second table cell, plus indented continuation lines."""
    parts = [m.group(1).strip()]
    for line in body[m.end() :].split("\n")[1:]:
        if line.strip() and (line.startswith(" ") or line.startswith("\t")):
            parts.append(line.strip())
        else:
            break
    return "\n".join(p for p in parts if p)


def check_file(path: Path) -> dict:
    """Run the full contract check against one contribution file."""
    text = path.read_text(errors="ignore")
    missing_sections: list[str] = []
    missing_fields: list[str] = []
    empty_fields: list[str] = []
    placeholder_fields: list[str] = []
    sections: list[dict] = []

    for name, fields in REQUIRED_SECTIONS.items():
        span = find_section(text, name)
        entry: dict = {"section": name, "present": span is not None, "fields": []}
        if span is None:
            missing_sections.append(name)
            sections.append(entry)
            continue

        body = text[span[0] : span[1]]
        for field in fields:
            m = find_field(body, field)
            if m is None:
                entry["fields"].append(
                    {"field": field, "status": "missing", "value": ""}
                )
                missing_fields.append(f"{name} / {field}")
                continue
            value = field_value(body, m)
            if not value:
                entry["fields"].append({"field": field, "status": "empty", "value": ""})
                empty_fields.append(f"{name} / {field}")
            elif PLACEHOLDER_PATTERN.search(value):
                entry["fields"].append(
                    {"field": field, "status": "placeholder", "value": value[:80]}
                )
                placeholder_fields.append(f"{name} / {field}")
            else:
                entry["fields"].append(
                    {"field": field, "status": "ok", "value": value[:80]}
                )
        sections.append(entry)

    failed = bool(
        missing_sections or missing_fields or empty_fields or placeholder_fields
    )
    return {
        "status": "fail" if failed else "pass",
        "path": str(path),
        "missing_sections": missing_sections,
        "missing_fields": missing_fields,
        "empty_fields": empty_fields,
        "placeholder_fields": placeholder_fields,
        "sections": sections,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Contribution Contract Gate")
    parser.add_argument(
        "path",
        help="Path to confirmed_contribution.md or its directory",
    )
    parser.add_argument("--json", action="store_true", help="Output structured JSON")
    args = parser.parse_args()

    target = Path(args.path)
    if target.is_dir():
        target = target / "confirmed_contribution.md"

    if not target.is_file():
        result = {
            "status": "missing",
            "path": str(target),
            "missing_sections": [],
            "missing_fields": [],
            "empty_fields": [],
            "placeholder_fields": [],
            "sections": [],
        }
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print("=== Contribution Contract Gate ===")
            print(f"❌ FAIL: {target} not found")
        sys.exit(1)

    result = check_file(target)

    if args.json:
        print(json.dumps(result, indent=2))
        if result["status"] == "fail":
            sys.exit(1)
        return

    print("=== Contribution Contract Gate ===")
    for section in result["sections"]:
        if not section["present"]:
            print(f"  ❌ {section['section']}  (section missing)")
            continue
        print(f"  ✅ {section['section']}")
        for f in section["fields"]:
            icon = {"ok": "✅", "missing": "❌", "empty": "❌", "placeholder": "❌"}[
                f["status"]
            ]
            label = f" {f['status'].upper()}" if f["status"] != "ok" else ""
            print(f"      {icon} {f['field']}{label}")
    print()
    if result["status"] == "fail":
        print(
            f"❌ FAIL: {len(result['missing_sections'])} missing section(s), "
            f"{len(result['missing_fields'])} missing field(s), "
            f"{len(result['empty_fields'])} empty field(s), "
            f"{len(result['placeholder_fields'])} placeholder field(s)"
        )
        sys.exit(1)
    field_count = sum(len(s["fields"]) for s in result["sections"])
    print(f"✅ PASS: all {field_count} required fields present and non-empty")


if __name__ == "__main__":
    main()
