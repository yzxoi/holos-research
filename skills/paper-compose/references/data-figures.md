# Data Figures — All 17 Chart Types + LaTeX Table Templates

All data-driven figures use `plot.py` with the project's selected theme. Always call `use_theme()` before plotting.

```python
from plot import use_theme, get_colors, plot_bar, plot_curves, plot_scatter, ...
use_theme("neurips-vivid")
```

## Standard Sizes

| Context | Width | figsize |
|---------|-------|---------|
| Single column | 3.25" | `(3.25, 2.5)` |
| Double column | 6.875" | `(6.875, 4)` |
| Full page | 6.875" | `(6.875, 8)` |

---

## 1. Line Plot / Training Curves

**When**: Training progress, learning curves, metric over time
**Function**: `plot_curves(data, xlabel, ylabel, title, output, log_y)`

```python
data = {"Ours": [loss_values], "Baseline": [loss_values]}
plot_curves(data, xlabel="Epoch", ylabel="Loss", output="fig_curves.pdf")
```

Tips: Use `log_y=True` for loss curves. Subsample markers auto-applied (every 10th point).

## 2. Bar Chart

**When**: Single metric across methods (the "main result" figure)
**Function**: `plot_bar(data, ylabel, output, errors, lower_is_better)`

```python
data = {"Ours": 92.1, "D3PM": 88.4, "MDLM": 86.7}
errors = {"Ours": 0.3, "D3PM": 0.5, "MDLM": 0.4}
plot_bar(data, ylabel="Accuracy (%)", output="fig_bar.pdf", errors=errors)
```

Best method auto-highlighted. Override with `highlight="MethodName"`.

## 3. Grouped Bar (multi-metric)

**When**: Multiple metrics × multiple methods

```python
fig, ax = plt.subplots(figsize=(7, 4))
x = np.arange(len(methods))
width = 0.22
for i, (metric, vals) in enumerate(metrics.items()):
    ax.bar(x + i*width - width, vals, width, label=metric, color=colors[i], edgecolor="white")
ax.set_xticks(x); ax.set_xticklabels(methods)
ax.legend()
```

## 4. Horizontal Bar

**When**: Method ranking, forest plot style
**Function**: `plot_hbar(methods, means, errs, xlabel, output, highlight_last)`

```python
plot_hbar(["NNShot", "StructShot", "Ours"], [0.31, 0.42, 0.65], xlabel="F1", output="fig_hbar.pdf")
```

Last method highlighted by default. Dashed vertical reference line at best score.

## 5. Scatter Plot

**When**: Two continuous variables, correlation analysis, compute-accuracy tradeoffs
**Function**: `plot_scatter(x, y, xlabel, ylabel, output, labels, groups, show_regression)`

```python
# Simple scatter with regression
plot_scatter(x, y, xlabel="FLOPs", ylabel="Accuracy", output="fig_scatter.pdf")

# Grouped scatter (like ViT paper: Transformer vs ResNet vs Hybrid)
groups = [("ViT", vit_x, vit_y), ("ResNet", rn_x, rn_y), ("Hybrid", h_x, h_y)]
plot_scatter(None, None, groups=groups, xlabel="Compute", ylabel="Accuracy", output="fig_groups.pdf")
```

## 6. Pareto Frontier

**When**: Accuracy vs speed/size tradeoff

Same as grouped scatter but with connecting line on frontier:
```python
groups = [("Ours", ours_lat, ours_acc), ("Baseline", bl_lat, bl_acc)]
plot_scatter(None, None, groups=groups, show_regression=False, ...)
# Add Pareto line manually: ax.plot(sorted_x, sorted_y, "--", alpha=0.5)
```

Use `ax.set_xscale("log")` for latency/compute axes.

## 7. Convergence Plot (log scale)

Same as line plot with `log_y=True`:
```python
plot_curves(data, ylabel="Loss (log)", output="fig_conv.pdf", log_y=True)
```

## 8. PR Curve + Iso-F1

**When**: Detection/classification precision-recall analysis
**Function**: `plot_pr_curve(methods_data, title, output)`

```python
methods_data = {
    "Ours": (recall_array, precision_array),
    "Baseline": (recall_array, precision_array),
}
plot_pr_curve(methods_data, output="fig_pr.pdf")
```

Iso-F1 curves drawn automatically at F1={0.2, 0.4, 0.6, 0.8}.

## 9. Heatmap / Confusion Matrix

**When**: Transfer matrix, attention weights, cross-task scores
**Function**: `plot_heatmap(data, xlabels, ylabels, output, cmap, annotate)`

```python
plot_heatmap(matrix, xlabels=tasks, ylabels=tasks, cmap="YlOrRd", output="fig_heat.pdf")
```

Colormap recommendations: `YlOrRd` (warm), `viridis` (perceptually uniform), `RdBu_r` (diverging).

## 10. Violin Plot

**When**: Distribution comparison across methods (better than box plot)
**Function**: `plot_violin(data_list, tick_labels, ylabel, output)`

```python
plot_violin([scores_ours, scores_bl1, scores_bl2], tick_labels=["Ours","BL1","BL2"],
            ylabel="Accuracy (%)", output="fig_violin.pdf")
```

## 11. Box Plot

Standard matplotlib:
```python
fig, ax = plt.subplots(figsize=(4.5, 4))
bp = ax.boxplot(data_list, tick_labels=labels, patch_artist=True)
for patch, color in zip(bp["boxes"], colors):
    patch.set_facecolor(color); patch.set_alpha(0.7)
```

## 12. Radar / Spider Chart

**When**: Multi-dimensional comparison (review scores, capability profiles)
**Function**: `plot_radar(dimensions, methods, output)`

```python
dims = ["Novelty", "Soundness", "Significance", "Clarity", "Reproducibility"]
methods = {"Ours": [8.5, 9.0, 8.0, 8.5, 9.0], "Baseline": [7.0, 8.0, 7.5, 7.0, 6.5]}
plot_radar(dims, methods, output="fig_radar.pdf")
```

## 13. Ablation Waterfall

**When**: Show stepwise contribution of each component
**Function**: `plot_waterfall(components, values, ylabel, output)`

```python
plot_waterfall(["Base", "+Module A", "+Module B", "Full"], [82, 85.3, 88.4, 92.1],
               ylabel="Accuracy (%)", output="fig_waterfall.pdf")
```

Positive deltas shown in green, negative in red. Connected by dotted trend line.

## 14. Stacked Area

**When**: Composition breakdown over a continuous axis (compute distribution across layers)

```python
fig, ax = plt.subplots(figsize=(6, 3.8))
ax.stackplot(x, y1, y2, y3, labels=["Attn", "FFN", "Embed"], colors=colors[:3], alpha=0.7)
ax.legend(loc="upper left")
```

## 15. Bubble Chart

**When**: Three dimensions on 2D (size = third variable)

```python
fig, ax = plt.subplots(figsize=(6, 4.5))
scatter = ax.scatter(x, y, s=sizes*2, c=sizes, cmap="coolwarm", alpha=0.7, edgecolors="white")
fig.colorbar(scatter, label="Params (M)")
```

## 16. t-SNE / Embedding Visualization

**When**: Visualize learned representations, clustering quality
**Function**: `plot_tsne(clusters, output)`

```python
clusters = {"Class A": (x_a, y_a), "Class B": (x_b, y_b), "Class C": (x_c, y_c)}
plot_tsne(clusters, output="fig_tsne.pdf")
```

## 17. Multi-Panel Composite

**When**: Combining 2-4 related plots (like kNN-MT's 3-panel figure)

```python
fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(12, 3.5))
# Plot on each ax independently
# Use (a), (b), (c) labels:
for ax, label in zip([ax1, ax2, ax3], ["(a)", "(b)", "(c)"]):
    ax.set_title(label, loc="left", fontsize=10)
fig.tight_layout()
```

---

## LaTeX Table Templates

### Main Comparison Table

```latex
\begin{table}[t]
\caption{Main results. Bold = best, underline = second best. ± = std over 3 seeds.}
\label{tab:main}
\centering
\begin{tabular}{lccc}
\toprule
Method & PPL $\downarrow$ & BLEU $\uparrow$ & Latency (ms) \\
\midrule
\multicolumn{4}{l}{\textit{Autoregressive}} \\
GPT-2 \citep{radford2019} & 22.4 & 31.2 & 45 \\
\midrule
\multicolumn{4}{l}{\textit{Non-autoregressive}} \\
D3PM \citep{austin2021} & 20.5{\scriptsize$\pm$0.3} & 28.7{\scriptsize$\pm$0.4} & 32 \\
\midrule
\textbf{Ours} & \textbf{18.3}{\scriptsize$\pm$0.2} & \textbf{32.1}{\scriptsize$\pm$0.3} & 35 \\
\bottomrule
\end{tabular}
\end{table}
```

### Ablation Table

```latex
\begin{table}[t]
\caption{Ablation study. Each row removes one component from the full method.}
\label{tab:ablation}
\centering
\begin{tabular}{lcc}
\toprule
Configuration & PPL $\downarrow$ & $\Delta$ \\
\midrule
Full method & \textbf{18.3} & — \\
\quad w/o factorization & 21.1 & $-$2.8 \\
\quad w/o residual path & 19.5 & $-$1.2 \\
\quad w/o schedule & 18.9 & $-$0.6 \\
\bottomrule
\end{tabular}
\end{table}
```

### Table Rules
- Horizontal rules only (`\toprule`, `\midrule`, `\bottomrule`) — no vertical lines
- Bold best result, underline second best
- Right-align numbers, left-align text
- Include ± for multi-seed results
- Group methods by category with `\multicolumn` + `\textit`
- Cite source for baseline numbers with `†` if from other papers
