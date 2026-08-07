# Exhibit Guide — Figure & Table Decision Router

This is the **main entry point** for all exhibit (figure/table/diagram) creation decisions. It routes to the correct reference file based on what you need to produce.

## Decision Tree: What Type of Exhibit?

```
What are you visualizing?
├── Quantitative data (numbers, metrics, results)
│   ├── Method comparison → bar chart, grouped bar, horizontal bar
│   ├── Training progress → line plot, convergence plot (log scale)
│   ├── Correlation / scaling → scatter, bubble, Pareto frontier
│   ├── Distribution → violin, box plot
│   ├── Ablation contribution → waterfall chart
│   ├── Matrix / cross-comparison → heatmap
│   ├── Classification performance → PR curve + Iso-F1, ROC
│   ├── Composition over time → stacked area
│   ├── Multi-metric overview → radar / spider chart
│   └── Embedding space → t-SNE / UMAP scatter
│   → Load: references/data-figures.md
│
├── Structure / architecture / flow
│   ├── Model architecture diagram
│   ├── Pipeline / workflow
│   ├── State machine / decision flow
│   └── System topology
│   → Load: references/diagram-guide.md
│
├── LaTeX table
│   ├── Main comparison table
│   ├── Ablation table
│   ├── Hyperparameter table
│   └── Prior work feature comparison
│   → Load: references/data-figures.md (table templates section)
│
└── Multi-panel figure (combining multiple types)
    → Compose individual panels using the appropriate reference, then combine with plt.subplots
```

## Theme Selection

Every paper should use ONE theme consistently across all data figures. Select at project start.

| Theme | Best For | Character |
|-------|---------|-----------|
| `clean-modern` | General ML conferences, preprints | Minimal, airy, soft blue-orange palette |
| `nature-elegant` | Nature/Science, formal journals | Serif, classic, no grid, understated |
| `neurips-vivid` | NeurIPS/ICML spotlight, posters | Vibrant, high contrast, bold lines |
| `warm-minimal` | ICLR, modern workshops | Warm tones, off-white bg, contemporary |
| `monochrome-pro` | Print-heavy venues, supplements | Grayscale + accent, always readable |

### How to apply

```python
# In any figure generation script:
from plot import use_theme, get_colors
use_theme("neurips-vivid")   # call once at start
colors = get_colors(4)        # get the theme's color cycle
```

CLI: `python .research/scripts/plot.py bar --theme neurips-vivid --data '...' --output fig.pdf`

Themes are `.mplstyle` files in `.research/scripts/themes/`. To customize: copy and edit.

## Agent Integration

| Agent | Role in exhibit creation |
|-------|------------------------|
| **master** | Write the Python/LaTeX generation script |
| **editor** | Review visual quality, caption, readability, consistency |
| **auditor** | Verify data-exhibit consistency (numbers match experiment records) |
| **critic** | Review whether the exhibit effectively supports its bound claims |

### Tool workflow

```
research_exhibit(action="create", title="...", kind="figure|table|...", label="fig:main")
research_exhibit(action="bind_sources", id="exh_001", experiments=[...], claims=[...], script="...")
  → master writes the generation script
  → run the script to produce the figure
research_exhibit(action="render", id="exh_001", output_path="paper/figures/main.pdf")
  → editor reviews visual quality
research_exhibit(action="verify", id="exh_001")
  → auditor confirms data-exhibit match
research_exhibit(action="approve", id="exh_001")
```

## Quality Checklist (before approve)

- [ ] Data traces to experiment records (auditor verified)
- [ ] Theme consistent with all other figures in this paper
- [ ] Font readable at print column width (≥ 8pt labels)
- [ ] **No title inside figure** — caption in LaTeX `\caption{}` only
- [ ] Color accessible (grayscale readable, colorblind safe)
- [ ] Axis labels include units where applicable
- [ ] Legend does not overlap data
- [ ] Vector format (PDF) for LaTeX; PNG only as raster fallback
- [ ] Caption is self-contained (reader understands without main text)
- [ ] Claim binding is correct in `research_exhibit`
- [ ] Supplementary exhibits use S-prefixed numbering

## Supported Figure Types (17)

| # | Type | plot.py function | Reference |
|---|------|-----------------|-----------|
| 1 | Line plot / training curves | `plot_curves()` | data-figures.md |
| 2 | Bar chart | `plot_bar()` | data-figures.md |
| 3 | Grouped bar | matplotlib direct | data-figures.md |
| 4 | Horizontal bar | `plot_hbar()` | data-figures.md |
| 5 | Scatter plot | `plot_scatter()` | data-figures.md |
| 6 | Convergence (log-scale) | `plot_curves(log_y=True)` | data-figures.md |
| 7 | PR curve + Iso-F1 | `plot_pr_curve()` | data-figures.md |
| 8 | Pareto frontier | `plot_scatter(groups=...)` | data-figures.md |
| 9 | Heatmap / confusion matrix | `plot_heatmap()` | data-figures.md |
| 10 | Violin plot | `plot_violin()` | data-figures.md |
| 11 | Box plot | matplotlib direct | data-figures.md |
| 12 | Radar / spider chart | `plot_radar()` | data-figures.md |
| 13 | Ablation waterfall | `plot_waterfall()` | data-figures.md |
| 14 | Stacked area | matplotlib direct | data-figures.md |
| 15 | Bubble chart | `plot_scatter()` + size | data-figures.md |
| 16 | t-SNE / embedding | `plot_tsne()` | data-figures.md |
| 17 | Multi-panel composite | `plt.subplots()` | data-figures.md |
| — | Architecture diagram | draw.io / Mermaid / TikZ | diagram-guide.md |
| — | LaTeX table | manual LaTeX | data-figures.md |
