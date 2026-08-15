# LaTeX Conventions — Dynamic Venue Adaptation

DO NOT hardcode venue template versions. Always fetch the latest from the official source.

## How to Get the Current Venue Template

```
# Search for the latest template
websearch("[venue name] [year] latex template author kit")
```

Common official sources:

| Venue | Where to find template |
|-------|----------------------|
| NeurIPS | neurips.cc → Author Instructions → Style Files |
| ICML | icml.cc → Author Instructions |
| ICLR | iclr.cc → Author Guide |
| ACL/EMNLP | acl-org/acl-style-files on GitHub |
| AAAI | aaai.org → Author Instructions |
| Nature | nature.com → Formatting Guide (post-acceptance) |
| Science | science.org → Author Guidelines |

## Venue-Specific LaTeX Rules (critical — violations cause desk reject)

### NeurIPS
- natbib loaded by default (opt-out: `\usepackage[nonatbib]{neurips_YYYY}`)
- Strongly recommend `booktabs` for tables
- Math: use AMS fonts (`amsfonts` / `amssymb`), do NOT use `\bbold`
- Figures: `graphicx`, widths as fraction of `\linewidth`

### ICML
- 8 pages main body; refs + appendix unlimited but PDF ≤ 10 MB
- Camera-ready: +1 page (9 pages main)

### ICLR
- natbib for citations (`\citet`, `\citep`)
- `graphicx` with `\linewidth` fractions
- Style: `iclr_YYYY_conference.sty` + `.bst`

### ACL / EMNLP
- Font: `\usepackage{times}` (or `txfonts` / `newtx`)
- Citations: natbib-based (`\citet`, `\citep`)
- Hyperlinks: DOIs/URLs via `hyperref`
- BST: `acl_natbib.bst`

### CVPR
- Cross-refs: use `\cref{...}` (from `cleveref`) for all references
- Figures: `graphicx` + `\includegraphics`
- References: numeric, 9pt Times

### AAAI ⚠️ (most restrictive)
- Required preamble: `aaai`, `times`, `helvet`, `courier`
- **BANNED**: `hyperref` (no embedded links/bookmarks)
- **BANNED**: `titlesec` (no spacing hacks)
- **BANNED**: `[T1]fontenc` (use CM-Super if needed)
- **BANNED**: `\input` (single .tex source file required, excluding .bib)
- Must compile with **pdfLaTeX** only
- No .ps/.eps figures — use .pdf/.png/.jpg only
- Font: Times/Nimbus (not Computer Modern for body)

**After downloading**: place `.sty` and `.bst` files in `paper/` and verify compilation:
```bash
.research/scripts/paper_check.sh paper/ --limit [page_limit]
```

## Citation Guard (引用守卫)

编译前运行 `latex_guard.py` 强制引用机制正确:

```bash
python .research/scripts/latex_guard.py paper/ --json
```

硬规则(任一违反 → FAIL):
- **禁用字面方括号数字**:文本中手打 `[1]`、`[3,12]` 是无效引用,必须用 `\cite{key}` 链接到 bibliography(`\bibliography{references.bib}` 或 `thebibliography` 的 `\bibitem{key}`)。手打 `[1]` 在 PDF 和 .docx 里都不会链接到文献表。
- **main tex 必须含 `\title{...}` 和 `\maketitle`**。
- **`\cite` 键必须已定义**:每个 `\cite{key}` 都要有对应的 `\bibitem{key}` 或 `.bib` 条目。

Warning(不 FAIL 但应修):
- `([15])` 数字外加括号的写法(与 `\citep` 重复包装)。

## Numeric Consistency (数字一致性)

正文数字必须与实验记录一致,写作完成后运行:

```bash
python .research/scripts/numeric_consistency_check.py paper/ --json
```

- 默认 advisory:报告实验 metrics 在正文中缺失的数字(warning)和相近但不等的数字对(potential_mismatch)。
- `--strict` 时 potential_mismatch 导致 exit 1(审计阶段用)。
- 数字不一致是 paper-audit 阶段 auditor 复核的重点;在 compose 阶段提前发现可省一轮返工。

## Compilation Workflow

### Standard build
```bash
cd paper && latexmk -pdf -interaction=nonstopmode main.tex
```

### BibTeX workflow (if latexmk unavailable)
```bash
pdflatex main && bibtex main && pdflatex main && pdflatex main
```

### Structured check (recommended)
```bash
.research/scripts/paper_check.sh paper/ --json --limit 9
```
Returns JSON with: compiled, pages, errors, warnings, overfull boxes, undefined refs/cites, page limit check.

## Cross-References

```latex
Figure~\ref{fig:main}       % ~ prevents line break
Table~\ref{tab:results}
Equation~\eqref{eq:loss}
Section~\ref{sec:method}
Appendix~\ref{app:extended}
```

## Math Notation Consistency

| Concept | Convention | LaTeX |
|---------|-----------|-------|
| Vectors | Bold lowercase | `\mathbf{x}` or `\bm{x}` |
| Matrices | Bold uppercase | `\mathbf{W}` |
| Sets | Calligraphic | `\mathcal{D}` |
| Functions | Roman | `\mathrm{softmax}` |
| Probabilities | Lowercase p | `p(\cdot)` |
| Losses | Script L | `\mathcal{L}` |
| Expectations | Blackboard E | `\mathbb{E}` |

Pick ONE convention and use it everywhere. Create a `\newcommand` block in preamble:
```latex
\newcommand{\vx}{\mathbf{x}}
\newcommand{\mW}{\mathbf{W}}
\newcommand{\loss}{\mathcal{L}}
```

## Bibliography

```latex
\citet{key}    % "Smith et al. (2025) showed..."
\citep{key}    % "...has been shown (Smith et al., 2025)"
```

- Every BibTeX entry should come from `research_wiki` (auto-resolved from arXiv/CrossRef)
- Run `research_wiki(action="verify_bib")` before submission to catch hallucinated/wrong entries
- Sort: alphabetical or first-appearance (venue-dependent)

## Figure/Table Inclusion

```latex
% Figure
\begin{figure}[t]
    \centering
    \includegraphics[width=0.48\textwidth]{figures/fig_main.pdf}
    \caption{[Self-contained caption starting with the finding, not "This figure shows..."]}
    \label{fig:main}
\end{figure}

% Table
\begin{table}[t]
    \caption{[Caption ABOVE table.]}
    \label{tab:main}
    \centering
    \begin{tabular}{lcc}
    \toprule ... \bottomrule
    \end{tabular}
\end{table}
```

Rules:
- Figures: caption BELOW (`\caption` after `\includegraphics`)
- Tables: caption ABOVE (`\caption` before `\begin{tabular}`)
- Check venue requirements — some differ

## Supplementary Material

```latex
% In supplementary.tex (separate file if required by venue)
\appendix
\section{Extended Results}
\label{app:extended}

% Use S-prefixed numbering for standalone supplementary:
\renewcommand{\thefigure}{S\arabic{figure}}
\renewcommand{\thetable}{S\arabic{table}}
\setcounter{figure}{0}
\setcounter{table}{0}
```

## Pre-Submission Checklist

Use `paper_check.sh` for automated checks, plus manual verification:

- [ ] Compiles without errors (`paper_check.sh --json`)
- [ ] Page count within limit
- [ ] No undefined references or citations
- [ ] No overfull hboxes > 1pt
- [ ] Anonymous (conference review): no author names, no acknowledgments, no self-identifying refs
- [ ] All figures/tables referenced in text
- [ ] All figures in vector format (PDF/SVG, not rasterized)
- [ ] Bibliography formatted per venue style
- [ ] Supplementary compiles separately (if required)
- [ ] All source files included for arXiv (.tex + .bib + figures + .sty)
