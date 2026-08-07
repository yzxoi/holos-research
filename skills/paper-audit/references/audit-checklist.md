# Audit Checklist — Full Per-Item Verification Reference

This checklist is the canonical audit reference. Paper-audit skill walks through it dimension by dimension. Each item has a clear PASS/FAIL criterion.

---

## Dimension 1: Data Truthfulness

- [ ] Every number in the abstract matches a number in the results section
- [ ] Every number in a table cell traces to an experiment record's metrics field
- [ ] Every number in inline text traces to an experiment record
- [ ] Improvement percentages are arithmetically correct
- [ ] Standard deviations match the actual spread across seeds
- [ ] No experiment cited as evidence is in `failed` or `invalidated` status
- [ ] No experiment cited as evidence was preempted and resumed without acknowledgment
- [ ] "Best" results are actually the best across all seeds, not a selected seed
- [ ] Aggregated statistics (mean, median) are computed over the correct population

## Dimension 2: Citation Accuracy

- [ ] Every `\cite` entry exists in `references.bib`
- [ ] Every cited paper exists in reality (verify via scholar/web if not in wiki)
- [ ] Characterization of each cited paper matches what the paper actually says
- [ ] No results attributed to the wrong paper
- [ ] No characterization stronger than the cited paper's own claims
- [ ] Related work covers the 5 most relevant papers (check against wiki `relevance="core"`)
- [ ] Recent work (last 6 months) is not missing
- [ ] Self-citations are proportionate and not disguised during anonymous review

## Dimension 3: Claim-Evidence Consistency

- [ ] Every result claim in the paper maps to a `claim_XXX` object with status `supported` or `qualified`
- [ ] Every `qualified` claim has its caveats reflected in the paper text
- [ ] No claim in the paper exceeds its registered statement in scope or strength
- [ ] Abstract claims match results section claims (no scope inflation)
- [ ] Introduction contributions match the registered claim set exactly
- [ ] Conclusion does not add new claims not present in results
- [ ] Every comparison claim specifies: what, against what, on what, by how much
- [ ] Negative findings are acknowledged (not hidden)

## Dimension 4: Format and Completeness

- [ ] Paper compiles without errors
- [ ] No undefined `\ref` or `\cite` warnings
- [ ] No overfull hbox > 1pt
- [ ] Page count within venue limit
- [ ] Notation consistent: same symbol means same thing throughout
- [ ] All abbreviations defined on first use
- [ ] All equations numbered (or venue convention followed)
- [ ] All figures/tables numbered sequentially
- [ ] All figures/tables referenced in text
- [ ] All sections referenced correctly
- [ ] Supplementary uses separate numbering (Figure S1, Table S1)
- [ ] Anonymous requirements met (if conference review)
- [ ] Algorithm/pseudocode boxes are complete and parseable
- [ ] Acknowledgments section present or intentionally omitted

## Dimension 5: Visual Quality

- [ ] All figures render at correct resolution (300+ DPI raster, vector preferred)
- [ ] Font size readable at column width (≥ 8pt)
- [ ] Colorblind-safe palette used
- [ ] Color is not the sole distinguishing feature (shape/pattern as backup)
- [ ] Axes labeled with units
- [ ] Legends present and clear
- [ ] Captions are self-contained
- [ ] Tables use horizontal rules only (no vertical lines)
- [ ] Bold best result in comparison tables
- [ ] Consistent decimal places in tables
- [ ] Consistent style across all figures (font, color, layout)
- [ ] No misleading visualizations (truncated axes, cherry-picked ranges, 3D bar charts)

## Dimension 6: Reproducibility

- [ ] Code commit hash recorded for each experiment
- [ ] ALL hyperparameters documented (training, model, optimization)
- [ ] Dataset name, version, split, preprocessing described
- [ ] Evaluation protocol precisely described (metrics, decoding strategy, post-processing)
- [ ] Hardware specified (GPU type, count)
- [ ] Framework and version specified (PyTorch X.Y, CUDA X.Y)
- [ ] Random seeds documented
- [ ] Training duration / compute budget documented
- [ ] Data availability statement present
- [ ] Code availability statement or URL present

## Dimension 7: Simulated Review

- [ ] Simulated Soundness ≥ 3/4
- [ ] Simulated Contribution ≥ 3/4
- [ ] Simulated Presentation ≥ 3/4
- [ ] Overall simulated rating ≥ 6/10
- [ ] No "fatal flaw" identified (a single issue that would cause reject regardless of other strengths)
- [ ] All simulated "Weaknesses" have been addressed or have documented justification for deferral
