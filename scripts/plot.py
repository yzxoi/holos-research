#!/usr/bin/env python3
"""
Research Plot Templates — Publication-quality figure generation with theme support.

5 built-in themes in scripts/themes/:
  clean-modern, nature-elegant, neurips-vivid, warm-minimal, monochrome-pro

Usage:
    python plot.py bar --data '{"Ours": 18.3, "D3PM": 20.5}' --theme neurips-vivid --output fig.pdf
    python plot.py curves --data curves.json --theme clean-modern --output fig.pdf
    python plot.py --list-themes

As library:
    from plot import use_theme, get_colors, plot_bar, plot_curves
"""

import argparse, json, sys, os
from pathlib import Path

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    HAS_MPL = True
except ImportError:
    HAS_MPL = False

THEMES_DIR = Path(__file__).parent / "themes"
THEMES = {
    "clean-modern": "DeepMind/Google — minimal, airy, soft palette",
    "nature-elegant": "Nature/Science — serif, refined, no grid",
    "neurips-vivid": "NeurIPS/ICML — vibrant, high contrast, bold",
    "warm-minimal": "ICLR warm — warm tones, modern, off-white bg",
    "monochrome-pro": "Print-perfect — grayscale + accent",
}
MARKERS = ["o", "s", "^", "D", "v", "P", "X", "*"]
DOUBLE_COL = 6.875
SINGLE_COL = 3.25


def use_theme(name: str = "clean-modern"):
    if not HAS_MPL:
        print("Error: matplotlib not installed", file=sys.stderr)
        sys.exit(1)
    for d in [THEMES_DIR, Path(".research/scripts/themes")]:
        p = d / f"{name}.mplstyle"
        if p.exists():
            plt.style.use(str(p))
            return
    print(f"Theme '{name}' not found. Available: {', '.join(THEMES)}", file=sys.stderr)
    sys.exit(1)


def get_colors(n: int = 7) -> list:
    return [c["color"] for c in plt.rcParams["axes.prop_cycle"]][:n]


# ── Plot Functions ─────────────────────────────────────────────────────────


def plot_bar(
    data,
    ylabel="",
    title="",
    output="bar.pdf",
    errors=None,
    lower_is_better=False,
    highlight=None,
    width=SINGLE_COL,
):
    fig, ax = plt.subplots(figsize=(width, width * 0.7))
    names, values = list(data.keys()), list(data.values())
    C = get_colors(len(names))
    errs = [errors.get(n, 0) for n in names] if errors else None
    best = values.index(min(values) if lower_is_better else max(values))
    colors = [
        C[0]
        if (highlight and n == highlight) or (not highlight and i == best)
        else C[min(i + 1, len(C) - 1)]
        for i, n in enumerate(names)
    ]
    bars = ax.bar(
        names,
        values,
        color=colors,
        edgecolor="white",
        linewidth=0.6,
        yerr=errs,
        capsize=3,
        error_kw={"linewidth": 1},
    )
    for bar, val in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.3,
            f"{val:.1f}",
            ha="center",
            va="bottom",
            fontsize=plt.rcParams["font.size"] - 2,
        )
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title)
    ax.tick_params(axis="x", rotation=15)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_curves(
    data,
    xlabel="Step",
    ylabel="Loss",
    title="",
    output="curves.pdf",
    log_y=False,
    width=DOUBLE_COL,
):
    fig, ax = plt.subplots(figsize=(width, width * 0.55))
    C = get_colors(len(data))
    for i, (name, vals) in enumerate(data.items()):
        ax.plot(
            range(len(vals)),
            vals,
            label=name,
            color=C[i % len(C)],
            marker=MARKERS[i % len(MARKERS)],
            markevery=max(1, len(vals) // 10),
            markeredgecolor="white",
            markeredgewidth=0.6,
        )
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title)
    if log_y:
        ax.set_yscale("log")
    ax.legend(loc="best")
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_scatter(
    x,
    y,
    xlabel="X",
    ylabel="Y",
    title="",
    output="scatter.pdf",
    labels=None,
    groups=None,
    show_regression=True,
    width=SINGLE_COL,
):
    fig, ax = plt.subplots(figsize=(width, width))
    C = get_colors(7)
    if groups:
        for i, (gname, gx, gy) in enumerate(groups):
            ax.scatter(
                gx,
                gy,
                s=50,
                color=C[i % len(C)],
                label=gname,
                marker=MARKERS[i % len(MARKERS)],
                edgecolors="white",
                linewidth=0.6,
                zorder=3,
            )
    else:
        ax.scatter(
            x,
            y,
            s=50,
            color=C[0],
            edgecolors="white",
            linewidth=0.6,
            alpha=0.7,
            zorder=3,
        )
    if labels:
        for xi, yi, lab in zip(x, y, labels):
            ax.annotate(
                lab, (xi, yi), fontsize=7, xytext=(4, 4), textcoords="offset points"
            )
    if show_regression and not groups and len(x) >= 3:
        coeffs = np.polyfit(x, y, 1)
        poly = np.poly1d(coeffs)
        xl = np.linspace(min(x), max(x), 100)
        ax.plot(xl, poly(xl), "--", color=C[1], linewidth=1)
        yp = [poly(xi) for xi in x]
        ss_r = sum((yi - yp) ** 2 for yi, yp in zip(y, yp))
        ss_t = sum((yi - np.mean(y)) ** 2 for yi in y)
        r2 = 1 - ss_r / ss_t if ss_t > 0 else 0
        ax.text(
            0.05,
            0.95,
            f"R²={r2:.3f}",
            transform=ax.transAxes,
            fontsize=8,
            va="top",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8),
        )
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title)
    if groups:
        ax.legend()
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_heatmap(
    data,
    xlabels=None,
    ylabels=None,
    title="",
    output="heatmap.pdf",
    cmap="YlOrRd",
    annotate=True,
    width=SINGLE_COL,
):
    fig, ax = plt.subplots(figsize=(width, width * 0.85))
    arr = np.array(data)
    im = ax.imshow(arr, cmap=cmap, aspect="auto")
    if xlabels:
        ax.set_xticks(range(len(xlabels)))
        ax.set_xticklabels(xlabels, rotation=45, ha="right")
    if ylabels:
        ax.set_yticks(range(len(ylabels)))
        ax.set_yticklabels(ylabels)
    if annotate:
        mid = (arr.max() + arr.min()) / 2
        for i in range(arr.shape[0]):
            for j in range(arr.shape[1]):
                ax.text(
                    j,
                    i,
                    f"{arr[i, j]:.2f}",
                    ha="center",
                    va="center",
                    fontsize=7,
                    color="white" if arr[i, j] > mid else "#333333",
                )
    fig.colorbar(im, ax=ax, shrink=0.8)
    if title:
        ax.set_title(title)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_violin(
    data_list,
    tick_labels=None,
    ylabel="",
    title="",
    output="violin.pdf",
    width=SINGLE_COL,
):
    fig, ax = plt.subplots(figsize=(width, width * 0.85))
    C = get_colors(len(data_list))
    parts = ax.violinplot(
        data_list, positions=range(len(data_list)), showmeans=True, showmedians=True
    )
    for i, pc in enumerate(parts["bodies"]):
        pc.set_facecolor(C[i % len(C)])
        pc.set_alpha(0.6)
        pc.set_edgecolor(C[i % len(C)])
    for key in ["cmeans", "cmedians", "cmins", "cmaxes", "cbars"]:
        parts[key].set_color("#555555")
    if tick_labels:
        ax.set_xticks(range(len(tick_labels)))
        ax.set_xticklabels(tick_labels, rotation=15)
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_radar(dimensions, methods, title="", output="radar.pdf"):
    N = len(dimensions)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist() + [0]
    fig, ax = plt.subplots(figsize=(5, 5), subplot_kw=dict(polar=True))
    C = get_colors(len(methods))
    for i, (name, vals) in enumerate(methods.items()):
        vals_c = vals + vals[:1]
        ax.plot(
            angles,
            vals_c,
            "o-",
            label=name,
            color=C[i % len(C)],
            markersize=5,
            linewidth=1.8,
        )
        ax.fill(angles, vals_c, alpha=0.08, color=C[i % len(C)])
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(dimensions, fontsize=9)
    ax.set_ylim(0, 10)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.1), fontsize=9)
    if title:
        ax.set_title(title, y=1.08)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_waterfall(
    components,
    values,
    title="",
    ylabel="",
    output="waterfall.pdf",
    width=DOUBLE_COL * 0.8,
):
    fig, ax = plt.subplots(figsize=(width, width * 0.6))
    C = get_colors(7)
    deltas = [0] + [values[i] - values[i - 1] for i in range(1, len(values))]
    colors = [C[6]] + [C[2] if d > 0 else C[3] for d in deltas[1:-1]] + [C[0]]
    ax.bar(components, values, color=colors, edgecolor="white", linewidth=0.8)
    for i in range(1, len(values)):
        ax.annotate(
            f"+{deltas[i]:.1f}",
            (i, values[i] + 0.3),
            ha="center",
            fontsize=8,
            color=C[2],
        )
    ax.plot(
        range(len(values)),
        values,
        "o--",
        color="#555555",
        markersize=4,
        linewidth=1,
        zorder=3,
    )
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title)
    ax.tick_params(axis="x", rotation=15)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_hbar(
    methods,
    means,
    errs=None,
    xlabel="",
    title="",
    highlight_last=True,
    output="hbar.pdf",
    width=DOUBLE_COL * 0.8,
):
    fig, ax = plt.subplots(figsize=(width, max(3, len(methods) * 0.55)))
    C = get_colors(7)
    colors = (
        [C[1]] * (len(methods) - 1) + [C[0]]
        if highlight_last
        else [C[0]] * len(methods)
    )
    y_pos = np.arange(len(methods))
    ax.barh(
        y_pos,
        means,
        xerr=errs,
        color=colors,
        edgecolor="white",
        height=0.55,
        capsize=3,
        error_kw={"linewidth": 1},
    )
    ax.set_yticks(y_pos)
    ax.set_yticklabels(methods)
    ax.set_xlabel(xlabel)
    if highlight_last:
        ax.axvline(x=means[-1], color=C[0], linestyle="--", alpha=0.3)
    if title:
        ax.set_title(title)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_pr_curve(methods_data, title="", output="pr.pdf", width=SINGLE_COL * 1.5):
    """methods_data: dict of {name: (recall_array, precision_array)}"""
    fig, ax = plt.subplots(figsize=(width, width * 0.9))
    C = get_colors(len(methods_data))
    for f1 in [0.2, 0.4, 0.6, 0.8]:
        r = np.linspace(0.01, 1, 200)
        p = f1 * r / (2 * r - f1)
        mask = (p > 0) & (p <= 1)
        ax.plot(r[mask], p[mask], color="#DDDDDD", linewidth=0.7, linestyle="--")
        mid = np.where(mask)[0]
        idx = mid[len(mid) // 3] if len(mid) > 0 else 0
        ax.annotate(f"F1={f1}", (r[idx], p[idx]), fontsize=7, color="#BBBBBB")
    for i, (name, (recall, precision)) in enumerate(methods_data.items()):
        ax.plot(recall, precision, label=name, color=C[i % len(C)], linewidth=2)
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.05)
    ax.legend(loc="lower left")
    if title:
        ax.set_title(title)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


def plot_tsne(
    clusters,
    xlabel="t-SNE dim 1",
    ylabel="t-SNE dim 2",
    title="",
    output="tsne.pdf",
    width=SINGLE_COL * 1.3,
):
    """clusters: dict of {label: (x_array, y_array)}"""
    fig, ax = plt.subplots(figsize=(width, width))
    C = get_colors(len(clusters))
    for i, (label, (x, y)) in enumerate(clusters.items()):
        ax.scatter(
            x, y, s=15, color=C[i % len(C)], alpha=0.6, label=label, edgecolors="none"
        )
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.legend(markerscale=3)
    if title:
        ax.set_title(title)
    fig.savefig(output)
    plt.close(fig)
    print(f"✅ {output}")


# ── CLI ────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Research Plot Templates")
    parser.add_argument(
        "--theme", default="clean-modern", help=f"Theme: {', '.join(THEMES)}"
    )
    parser.add_argument(
        "--list-themes", action="store_true", help="List available themes"
    )
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("bar")
    p.add_argument("--data", required=True)
    p.add_argument("--errors")
    p.add_argument("--ylabel", default="")
    p.add_argument("--title", default="")
    p.add_argument("--output", default="bar.pdf")
    p.add_argument("--lower-is-better", action="store_true")
    p.add_argument("--highlight")

    p = sub.add_parser("curves")
    p.add_argument("--data", required=True)
    p.add_argument("--xlabel", default="Step")
    p.add_argument("--ylabel", default="Loss")
    p.add_argument("--title", default="")
    p.add_argument("--output", default="curves.pdf")
    p.add_argument("--log-y", action="store_true")

    p = sub.add_parser("scatter")
    p.add_argument("--data", required=True)
    p.add_argument("--xlabel", default="X")
    p.add_argument("--ylabel", default="Y")
    p.add_argument("--title", default="")
    p.add_argument("--output", default="scatter.pdf")

    p = sub.add_parser("heatmap")
    p.add_argument("--data", required=True)
    p.add_argument("--title", default="")
    p.add_argument("--output", default="heatmap.pdf")

    args = parser.parse_args()
    if args.list_themes:
        for name, desc in THEMES.items():
            print(f"  {name:20s} {desc}")
        return

    use_theme(args.theme)
    if args.command == "bar":
        plot_bar(
            json.loads(args.data),
            args.ylabel,
            args.title,
            args.output,
            json.loads(args.errors) if args.errors else None,
            args.lower_is_better,
            args.highlight,
        )
    elif args.command == "curves":
        with open(args.data) as f:
            plot_curves(
                json.load(f),
                args.xlabel,
                args.ylabel,
                args.title,
                args.output,
                args.log_y,
            )
    elif args.command == "scatter":
        with open(args.data) as f:
            d = json.load(f)
            plot_scatter(
                d["x"],
                d["y"],
                args.xlabel,
                args.ylabel,
                args.title,
                args.output,
                d.get("labels"),
            )
    elif args.command == "heatmap":
        with open(args.data) as f:
            d = json.load(f)
            plot_heatmap(
                d if isinstance(d, list) else d["data"],
                d.get("xlabels"),
                d.get("ylabels"),
                args.title,
                args.output,
            )
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
