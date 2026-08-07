#!/usr/bin/env bash
#
# paper_check.sh — LaTeX compilation + structured diagnostic report
#
# Usage:
#   ./scripts/paper_check.sh paper/              # check the paper/ directory
#   ./scripts/paper_check.sh paper/ --json       # output as JSON
#   ./scripts/paper_check.sh paper/ --limit 9    # check against 9-page limit
#
# Outputs a structured report: compilation status, page count, errors,
# warnings, undefined references, undefined citations, and page limit check.

set -euo pipefail

PAPER_DIR="${1:-.}"
FORMAT="text"
PAGE_LIMIT=""

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) FORMAT="json" ;;
    --limit) PAGE_LIMIT="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# Find main tex file
MAIN_TEX=""
for candidate in main.tex paper.tex manuscript.tex; do
  if [[ -f "$PAPER_DIR/$candidate" ]]; then
    MAIN_TEX="$candidate"
    break
  fi
done

if [[ -z "$MAIN_TEX" ]]; then
  # Try to find any .tex file that contains \documentclass
  MAIN_TEX=$(grep -rl '\\documentclass' "$PAPER_DIR"/*.tex 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)
fi

if [[ -z "$MAIN_TEX" ]]; then
  if [[ "$FORMAT" == "json" ]]; then
    echo '{"compiled": false, "error": "No main .tex file found", "pages": 0, "errors": [], "warnings": [], "undefined_refs": [], "undefined_cites": []}'
  else
    echo "❌ No main .tex file found in $PAPER_DIR"
  fi
  exit 1
fi

# Compile
cd "$PAPER_DIR"
COMPILE_OUTPUT=$(latexmk -pdf -interaction=nonstopmode -halt-on-error "$MAIN_TEX" 2>&1 || true)
LOG_FILE="${MAIN_TEX%.tex}.log"
PDF_FILE="${MAIN_TEX%.tex}.pdf"

# Check compilation success
COMPILED=false
if [[ -f "$PDF_FILE" ]]; then
  COMPILED=true
fi

# Extract errors
ERRORS=()
if [[ -f "$LOG_FILE" ]]; then
  while IFS= read -r line; do
    ERRORS+=("$line")
  done < <(grep -n "^!" "$LOG_FILE" | head -20)
fi

# Extract warnings
WARNINGS=()
if [[ -f "$LOG_FILE" ]]; then
  while IFS= read -r line; do
    WARNINGS+=("$line")
  done < <(grep -i "warning" "$LOG_FILE" | grep -v "^$" | grep -vi "pdf" | head -30)
fi

# Overfull boxes
OVERFULL=()
if [[ -f "$LOG_FILE" ]]; then
  while IFS= read -r line; do
    OVERFULL+=("$line")
  done < <(grep "Overfull" "$LOG_FILE" | head -20)
fi

# Undefined references
UNDEF_REFS=()
if [[ -f "$LOG_FILE" ]]; then
  while IFS= read -r line; do
    UNDEF_REFS+=("$line")
  done < <(grep -o "Reference \`[^']*' on page [0-9]*" "$LOG_FILE" 2>/dev/null || true)
fi

# Undefined citations
UNDEF_CITES=()
if [[ -f "$LOG_FILE" ]]; then
  while IFS= read -r line; do
    UNDEF_CITES+=("$line")
  done < <(grep -o "Citation \`[^']*' on page [0-9]*" "$LOG_FILE" 2>/dev/null || true)
fi

# Page count
PAGES=0
if [[ "$COMPILED" == "true" ]] && command -v pdfinfo &>/dev/null; then
  PAGES=$(pdfinfo "$PDF_FILE" 2>/dev/null | grep -i "pages" | awk '{print $2}' || echo 0)
elif [[ "$COMPILED" == "true" ]]; then
  # Fallback: count from log
  PAGES=$(grep -c "Output written on" "$LOG_FILE" 2>/dev/null || echo 0)
  if [[ "$PAGES" == "0" ]]; then
    PAGES=$(grep -o "[0-9]* pages" "$LOG_FILE" 2>/dev/null | head -1 | awk '{print $1}' || echo 0)
  fi
fi

# Page limit check
WITHIN_LIMIT="null"
if [[ -n "$PAGE_LIMIT" ]]; then
  if [[ "$PAGES" -le "$PAGE_LIMIT" ]]; then
    WITHIN_LIMIT="true"
  else
    WITHIN_LIMIT="false"
  fi
fi

# Output
if [[ "$FORMAT" == "json" ]]; then
  # Build JSON output
  json_array() {
    local arr=("$@")
    if [[ ${#arr[@]} -eq 0 ]]; then
      echo "[]"
      return
    fi
    local result="["
    for i in "${!arr[@]}"; do
      # Escape quotes and backslashes for JSON
      local escaped="${arr[$i]//\\/\\\\}"
      escaped="${escaped//\"/\\\"}"
      escaped="${escaped//$'\n'/\\n}"
      result+="\"$escaped\""
      if [[ $i -lt $((${#arr[@]} - 1)) ]]; then
        result+=","
      fi
    done
    result+="]"
    echo "$result"
  }

  cat <<EOF
{
  "compiled": $COMPILED,
  "main_tex": "$MAIN_TEX",
  "pages": $PAGES,
  "page_limit": ${PAGE_LIMIT:-null},
  "within_limit": $WITHIN_LIMIT,
  "error_count": ${#ERRORS[@]},
  "warning_count": ${#WARNINGS[@]},
  "overfull_count": ${#OVERFULL[@]},
  "undefined_ref_count": ${#UNDEF_REFS[@]},
  "undefined_cite_count": ${#UNDEF_CITES[@]},
  "errors": $(json_array "${ERRORS[@]+"${ERRORS[@]}"}"),
  "warnings": $(json_array "${WARNINGS[@]+"${WARNINGS[@]}"}"),
  "overfull": $(json_array "${OVERFULL[@]+"${OVERFULL[@]}"}"),
  "undefined_refs": $(json_array "${UNDEF_REFS[@]+"${UNDEF_REFS[@]}"}"),
  "undefined_cites": $(json_array "${UNDEF_CITES[@]+"${UNDEF_CITES[@]}"}")
}
EOF

else
  # Human-readable output
  echo "=== Paper Compilation Report ==="
  echo ""
  if [[ "$COMPILED" == "true" ]]; then
    echo "✅ Compiled successfully: $PDF_FILE"
  else
    echo "❌ Compilation FAILED"
  fi
  echo "   Pages: $PAGES"
  if [[ -n "$PAGE_LIMIT" ]]; then
    if [[ "$WITHIN_LIMIT" == "true" ]]; then
      echo "   Page limit: $PAGES/$PAGE_LIMIT ✅"
    else
      echo "   Page limit: $PAGES/$PAGE_LIMIT ❌ OVER LIMIT"
    fi
  fi
  echo ""

  if [[ ${#ERRORS[@]} -gt 0 ]]; then
    echo "❌ Errors (${#ERRORS[@]}):"
    for e in "${ERRORS[@]}"; do echo "   $e"; done
    echo ""
  fi

  if [[ ${#UNDEF_REFS[@]} -gt 0 ]]; then
    echo "⚠️  Undefined references (${#UNDEF_REFS[@]}):"
    for r in "${UNDEF_REFS[@]}"; do echo "   $r"; done
    echo ""
  fi

  if [[ ${#UNDEF_CITES[@]} -gt 0 ]]; then
    echo "⚠️  Undefined citations (${#UNDEF_CITES[@]}):"
    for c in "${UNDEF_CITES[@]}"; do echo "   $c"; done
    echo ""
  fi

  if [[ ${#OVERFULL[@]} -gt 0 ]]; then
    echo "⚠️  Overfull boxes (${#OVERFULL[@]}):"
    for o in "${OVERFULL[@]}"; do echo "   $o"; done
    echo ""
  fi

  if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo "Warnings (${#WARNINGS[@]}):"
    for w in "${WARNINGS[@]}"; do echo "   $w"; done
    echo ""
  fi

  if [[ ${#ERRORS[@]} -eq 0 && ${#UNDEF_REFS[@]} -eq 0 && ${#UNDEF_CITES[@]} -eq 0 ]]; then
    echo "✅ No errors, no undefined references, no undefined citations."
  fi
fi
