#!/usr/bin/env python3
"""
Research Statistics Toolkit — Reusable statistical testing for experiment analysis.

Designed to be called by the agent or imported by master subagent scripts.
All tests follow the experiment-cycle skill's statistical rigor requirements.

Usage:
    # Compare two methods across seeds
    python stats.py compare --a results/exp_007.json results/exp_008.json results/exp_009.json \
                            --b results/exp_001.json results/exp_002.json results/exp_003.json \
                            --metric ppl

    # Generate a comparison table from multiple experiment result files
    python stats.py table --files results/exp_*.json --metric ppl bleu --format markdown

    # Assess a single method's result reliability
    python stats.py assess --files results/exp_007.json results/exp_008.json results/exp_009.json \
                           --metric ppl

As library:
    from stats import compare_methods, format_comparison_table, assess_reliability
"""

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Optional


# ── Core statistical functions ─────────────────────────────────────────────


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((x - m) ** 2 for x in values) / (len(values) - 1))


def cohens_d(a: list[float], b: list[float]) -> float:
    """Cohen's d effect size (pooled standard deviation)."""
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return float("nan")
    ma, mb = mean(a), mean(b)
    sa, sb = std(a), std(b)
    pooled = math.sqrt(((na - 1) * sa**2 + (nb - 1) * sb**2) / (na + nb - 2))
    if pooled == 0:
        return 0.0
    return (ma - mb) / pooled


def relative_improvement(
    baseline: float, method: float, lower_is_better: bool = False
) -> float:
    """Relative improvement percentage. Correct formula: (method - baseline) / |baseline| * 100."""
    if baseline == 0:
        return float("nan")
    if lower_is_better:
        return (baseline - method) / abs(baseline) * 100
    return (method - baseline) / abs(baseline) * 100


def paired_t_test(a: list[float], b: list[float]) -> dict:
    """Paired t-test. Requires len(a) == len(b) >= 3."""
    n = len(a)
    if n != len(b):
        return {"error": "Arrays must be same length"}
    if n < 3:
        return {
            "error": f"Need >= 3 paired samples, got {n}. Use bootstrap CI instead."
        }

    diffs = [ai - bi for ai, bi in zip(a, b)]
    d_mean = mean(diffs)
    d_std = std(diffs)
    if d_std == 0:
        return {
            "t": float("inf"),
            "p": 0.0,
            "df": n - 1,
            "mean_diff": d_mean,
            "significant": True,
        }

    t_stat = d_mean / (d_std / math.sqrt(n))
    df = n - 1

    # Two-tailed p-value approximation (Student's t-distribution)
    # Using the regularized incomplete beta function approximation
    p_value = _t_distribution_p(abs(t_stat), df)

    return {
        "t": round(t_stat, 4),
        "p": round(p_value, 6),
        "df": df,
        "mean_diff": round(d_mean, 6),
        "significant": p_value < 0.05,
    }


def bootstrap_ci(
    values: list[float], n_bootstrap: int = 10000, ci: float = 0.95, seed: int = 42
) -> dict:
    """Bootstrap confidence interval. Works with any number of samples."""
    import random

    rng = random.Random(seed)
    n = len(values)
    if n == 0:
        return {"error": "Empty values"}

    means = []
    for _ in range(n_bootstrap):
        sample = [rng.choice(values) for _ in range(n)]
        means.append(mean(sample))
    means.sort()

    alpha = 1 - ci
    lo_idx = int(n_bootstrap * alpha / 2)
    hi_idx = int(n_bootstrap * (1 - alpha / 2))

    return {
        "mean": round(mean(values), 6),
        "ci_lower": round(means[lo_idx], 6),
        "ci_upper": round(means[hi_idx], 6),
        "ci_level": ci,
        "n_bootstrap": n_bootstrap,
        "crosses_zero": means[lo_idx] <= 0 <= means[hi_idx],
    }


def _t_distribution_p(t: float, df: int) -> float:
    """Two-tailed p-value for Student's t-distribution (approximation)."""
    # Abramowitz & Stegun approximation for the cumulative t-distribution
    x = df / (df + t * t)
    # Regularized incomplete beta function via continued fraction
    a, b = df / 2, 0.5
    p = _regularized_incomplete_beta(x, a, b)
    return p


def _regularized_incomplete_beta(
    x: float, a: float, b: float, max_iter: int = 200
) -> float:
    """Regularized incomplete beta function I_x(a, b) via Lentz's continued fraction."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0

    # Use the log-beta for numerical stability
    log_beta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    front = math.exp(a * math.log(x) + b * math.log(1 - x) - log_beta)

    # Lentz's algorithm for continued fraction
    f = 1.0
    c = 1.0
    d = 1.0 - (a + b) * x / (a + 1)
    if abs(d) < 1e-30:
        d = 1e-30
    d = 1.0 / d
    f = d

    for m in range(1, max_iter + 1):
        # Even step
        numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
        d = 1.0 + numerator * d
        if abs(d) < 1e-30:
            d = 1e-30
        d = 1.0 / d
        c = 1.0 + numerator / c
        if abs(c) < 1e-30:
            c = 1e-30
        f *= d * c

        # Odd step
        numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
        d = 1.0 + numerator * d
        if abs(d) < 1e-30:
            d = 1e-30
        d = 1.0 / d
        c = 1.0 + numerator / c
        if abs(c) < 1e-30:
            c = 1e-30
        delta = d * c
        f *= delta
        if abs(delta - 1.0) < 1e-10:
            break

    return front * f / a


# ── High-level functions ───────────────────────────────────────────────────


def compare_methods(
    a_values: list[float],
    b_values: list[float],
    metric_name: str = "metric",
    lower_is_better: bool = False,
    a_name: str = "Method A",
    b_name: str = "Method B",
) -> dict:
    """Compare two methods. Automatically selects the appropriate test."""
    na, nb = len(a_values), len(b_values)
    ma, mb = mean(a_values), mean(b_values)
    sa, sb = std(a_values), std(b_values)

    result = {
        "metric": metric_name,
        "lower_is_better": lower_is_better,
        a_name: {
            "mean": round(ma, 4),
            "std": round(sa, 4),
            "n": na,
            "values": a_values,
        },
        b_name: {
            "mean": round(mb, 4),
            "std": round(sb, 4),
            "n": nb,
            "values": b_values,
        },
        "relative_improvement_pct": round(
            relative_improvement(mb, ma, lower_is_better), 2
        ),
    }

    if na >= 3 and nb >= 3 and na == nb:
        t_result = paired_t_test(a_values, b_values)
        d = cohens_d(a_values, b_values)
        result["test"] = "paired_t_test"
        result["test_result"] = t_result
        result["cohens_d"] = round(d, 4)
        result["interpretation"] = _interpret_comparison(
            t_result, d, lower_is_better, ma, mb
        )
    elif na >= 2 or nb >= 2:
        diff_values = (
            [a - b for a, b in zip(a_values, b_values)] if na == nb else a_values
        )
        bs = bootstrap_ci(diff_values if na == nb else a_values)
        result["test"] = "bootstrap_ci"
        result["test_result"] = bs
        result["interpretation"] = (
            f"Bootstrap {'does not cross' if not bs.get('crosses_zero') else 'crosses'} zero → {'reliable' if not bs.get('crosses_zero') else 'inconclusive'}"
        )
    else:
        result["test"] = "none"
        result["interpretation"] = (
            f"Only {na} sample(s) — cannot assess statistical reliability. Report as preliminary observation only."
        )

    return result


def assess_reliability(values: list[float], metric_name: str = "metric") -> dict:
    """Assess the reliability of a single method's results."""
    n = len(values)
    m = mean(values)
    s = std(values)
    cv = (s / abs(m) * 100) if m != 0 else float("nan")

    result = {
        "metric": metric_name,
        "n": n,
        "mean": round(m, 4),
        "std": round(s, 4),
        "min": round(min(values), 4) if values else None,
        "max": round(max(values), 4) if values else None,
        "cv_pct": round(cv, 2),
    }

    if n >= 3:
        bs = bootstrap_ci(values)
        result["bootstrap_ci"] = bs
        result["reliable"] = cv < 5  # CV < 5% is generally stable
        result["interpretation"] = (
            f"CV={cv:.1f}% — {'stable' if cv < 5 else 'high variance, more seeds recommended'}"
        )
    elif n == 2:
        result["reliable"] = False
        result["interpretation"] = (
            "Only 2 seeds — insufficient for reliability assessment. Add ≥1 more seed."
        )
    else:
        result["reliable"] = False
        result["interpretation"] = "Single seed — anecdotal only. Add ≥2 more seeds."

    return result


def _interpret_comparison(
    t_result: dict, d: float, lower_is_better: bool, ma: float, mb: float
) -> str:
    if t_result.get("error"):
        return t_result["error"]

    p = t_result["p"]
    sig = "✅ significant" if p < 0.05 else "❌ not significant"

    if math.isnan(d):
        effect = "unknown effect size"
    elif abs(d) >= 0.8:
        effect = f"large effect (d={d:.2f})"
    elif abs(d) >= 0.5:
        effect = f"medium effect (d={d:.2f})"
    elif abs(d) >= 0.2:
        effect = f"small effect (d={d:.2f})"
    else:
        effect = f"negligible effect (d={d:.2f})"

    better = ma < mb if lower_is_better else ma > mb
    direction = "better" if better else "worse"

    return f"p={p:.4f} ({sig}), {effect}, A is {direction} than B"


# ── Result file loading ────────────────────────────────────────────────────


def load_metric_from_file(filepath: str, metric: str) -> Optional[list[float]]:
    """Load metric values from a standardized experiment result JSON."""
    path = Path(filepath)
    if not path.exists():
        return None

    with open(path) as f:
        data = json.load(f)

    metrics = data.get("metrics", {})
    entry = metrics.get(metric)
    if entry is None:
        return None

    if isinstance(entry, dict):
        if "values" in entry:
            return entry["values"]
        if "mean" in entry:
            return [entry["mean"]]
    if isinstance(entry, (int, float)):
        return [entry]

    return None


# ── Table formatting ───────────────────────────────────────────────────────


def format_comparison_table(results: list[dict], fmt: str = "markdown") -> str:
    """Format multiple comparison results into a table."""
    if fmt == "markdown":
        return _format_markdown_table(results)
    elif fmt == "latex":
        return _format_latex_table(results)
    return json.dumps(results, indent=2)


def _format_markdown_table(results: list[dict]) -> str:
    lines = [
        "| Method | Metric | Mean ± Std | n | Stat Test | p-value | Effect | Verdict |",
        "|--------|--------|-----------|---|-----------|---------|--------|---------|",
    ]
    for r in results:
        for name in [
            k
            for k in r
            if k
            not in (
                "metric",
                "lower_is_better",
                "relative_improvement_pct",
                "test",
                "test_result",
                "cohens_d",
                "interpretation",
            )
        ]:
            entry = r[name]
            if not isinstance(entry, dict) or "mean" not in entry:
                continue
            test = r.get("test", "none")
            tr = r.get("test_result", {})
            p = tr.get("p", "—")
            d = r.get("cohens_d", "—")
            interp = r.get("interpretation", "—")
            lines.append(
                f"| {name} | {r['metric']} | {entry['mean']:.4f} ± {entry['std']:.4f} | {entry['n']} | {test} | {p} | d={d} | {interp} |"
            )
    return "\n".join(lines)


def _format_latex_table(results: list[dict]) -> str:
    lines = [
        r"\begin{table}[t]",
        r"\caption{Statistical comparison.}",
        r"\centering",
        r"\begin{tabular}{lccccc}",
        r"\toprule",
        r"Method & Metric & Mean $\pm$ Std & $n$ & $p$-value & Cohen's $d$ \\",
        r"\midrule",
    ]
    for r in results:
        for name in [
            k
            for k in r
            if k
            not in (
                "metric",
                "lower_is_better",
                "relative_improvement_pct",
                "test",
                "test_result",
                "cohens_d",
                "interpretation",
            )
        ]:
            entry = r[name]
            if not isinstance(entry, dict) or "mean" not in entry:
                continue
            tr = r.get("test_result", {})
            p = f"{tr['p']:.4f}" if isinstance(tr.get("p"), float) else "—"
            d = f"{r['cohens_d']:.2f}" if isinstance(r.get("cohens_d"), float) else "—"
            lines.append(
                f"  {name} & {r['metric']} & {entry['mean']:.4f} $\\pm$ {entry['std']:.4f} & {entry['n']} & {p} & {d} \\\\"
            )
    lines.extend([r"\bottomrule", r"\end{tabular}", r"\end{table}"])
    return "\n".join(lines)


# ── CLI ────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Research Statistics Toolkit")
    sub = parser.add_subparsers(dest="command")

    p_compare = sub.add_parser("compare", help="Compare two methods")
    p_compare.add_argument(
        "--a", nargs="+", required=True, help="Result files for method A"
    )
    p_compare.add_argument(
        "--b", nargs="+", required=True, help="Result files for method B"
    )
    p_compare.add_argument("--metric", required=True, help="Metric name to compare")
    p_compare.add_argument("--lower-is-better", action="store_true")
    p_compare.add_argument("--a-name", default="Ours")
    p_compare.add_argument("--b-name", default="Baseline")
    p_compare.add_argument(
        "--format", choices=["json", "markdown", "latex"], default="json"
    )

    p_table = sub.add_parser("table", help="Generate comparison table")
    p_table.add_argument("--files", nargs="+", required=True, help="Result files")
    p_table.add_argument("--metric", nargs="+", required=True, help="Metric names")
    p_table.add_argument(
        "--format", choices=["markdown", "latex", "json"], default="markdown"
    )

    p_assess = sub.add_parser("assess", help="Assess result reliability")
    p_assess.add_argument(
        "--files", nargs="+", required=True, help="Result files (multiple seeds)"
    )
    p_assess.add_argument("--metric", required=True, help="Metric name")

    args = parser.parse_args()

    if args.command == "compare":
        a_vals, b_vals = [], []
        for f in args.a:
            v = load_metric_from_file(f, args.metric)
            if v:
                a_vals.extend(v)
        for f in args.b:
            v = load_metric_from_file(f, args.metric)
            if v:
                b_vals.extend(v)

        if not a_vals or not b_vals:
            print(
                f"Error: Could not load metric '{args.metric}' from files",
                file=sys.stderr,
            )
            sys.exit(1)

        result = compare_methods(
            a_vals, b_vals, args.metric, args.lower_is_better, args.a_name, args.b_name
        )
        if args.format == "json":
            print(json.dumps(result, indent=2))
        else:
            print(format_comparison_table([result], args.format))

    elif args.command == "assess":
        all_vals = []
        for f in args.files:
            v = load_metric_from_file(f, args.metric)
            if v:
                all_vals.extend(v)
        if not all_vals:
            print(
                f"Error: Could not load metric '{args.metric}' from files",
                file=sys.stderr,
            )
            sys.exit(1)
        result = assess_reliability(all_vals, args.metric)
        print(json.dumps(result, indent=2))

    elif args.command == "table":
        print(
            "Table generation requires structured input. Use the library API or compare command."
        )

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
