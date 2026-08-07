# Prose Quality — Paragraph and Sentence Level Writing Standards

Load this reference during paper-compose Step 4 (section writing) and during paper-audit Step 4 (format review). It covers what the writing-guide.md does NOT: **sentence-level and paragraph-level quality control.**

## The 5-Pass Scientific Writing Audit

After each section is drafted, run these 5 sequential passes. Order matters — clean clutter first, then fix structure, then check consistency.

### Pass 1: Clutter Extraction

Strip every sentence to its cleanest form. Delete words that don't carry meaning.

**Common clutter → replacement:**

| Cluttered | Clean |
|-----------|-------|
| Due to the fact that | Because |
| In order to | To |
| A number of | Several |
| It is worth noting that | *(delete — state the point directly)* |
| It is important to note that | *(delete)* |
| At the present time | Now / Currently |
| On the basis of | Based on |
| In light of the fact that | Because |
| Have an effect on | Affect |
| Give rise to | Cause |
| Provides a description of | Describes |
| Made an investigation of | Investigated |
| In the event that | If |
| For the purpose of | To / For |
| In a manner similar to | Like |

**Redundancy removal:**
- "completely eliminate" → "eliminate"
- "future plans" → "plans"
- "unexpected surprise" → "surprise"
- "basic fundamentals" → "fundamentals"
- "first and foremost" → "first"
- "each and every" → "each"

**AI-ism detection and removal:**

These words are strong signals that the text was AI-generated. Reviewers notice them.

| AI word | Replace with |
|---------|-------------|
| delve / delves into | examine / explore / study |
| pivotal | important / key / critical |
| landscape | field / area / domain |
| tapestry | *(delete or restructure)* |
| underscore | highlight / show |
| noteworthy | notable / important |
| intriguingly | interestingly *(or delete)* |
| harness / leverage (verb) | use / exploit / apply |
| multifaceted | complex / diverse |
| paradigm shift | advance / change |
| shed light on | clarify / reveal |
| a testament to | evidence of / shows |
| the cornerstone of | fundamental to |
| navigating the complexities | addressing / handling |

### Pass 2: Active Voice and Verb Vitality

**Spot passive voice:** Look for to-be verb + past participle ("was observed", "were analyzed", "is demonstrated", "has been shown").

**Convert to active:** Find the actor, reconstruct as Subject–Verb–Object.

| Passive | Active |
|---------|--------|
| "It was observed that the model converges" | "We observe that the model converges" |
| "The results were analyzed" | "We analyzed the results" |
| "A significant improvement is demonstrated" | "Our method demonstrates / achieves a significant improvement" |

**Resurrect smothered verbs (nominalizations):**

| Smothered | Alive |
|-----------|-------|
| "We made an investigation" | "We investigated" |
| "Failure of the system occurs" | "The system fails" |
| "We performed an analysis" | "We analyzed" |
| "This leads to an improvement" | "This improves" |
| "We provide a comparison" | "We compare" |

**When passive IS acceptable:**
- Established facts: "Attention was introduced by Vaswani et al. (2017)"
- Methods where the actor is irrelevant: "The model was trained for 100 epochs"
- Emphasis on the object: "Three datasets were used" (when the datasets matter more than who used them)

### Pass 3: Sentence Architecture

**Flag long sentences:** Any sentence > 40 words should be split or restructured.

**Keep subject and verb close:**
- Bad: "The model, which was pre-trained on a large corpus of text data spanning multiple domains and languages, achieves state-of-the-art results."
- Good: "The model achieves state-of-the-art results. It was pre-trained on a large multi-domain, multilingual corpus."

**Information ordering — old before new:**
- Place familiar context (what the reader already knows) at the start
- Place new information (the point of this sentence) at the end
- The most important word in a sentence should be near the end

**Paragraph structure:**
- Each paragraph does ONE job
- First sentence = topic sentence (states the paragraph's point)
- Last sentence = either conclusion or transition to next paragraph
- Don't start consecutive sentences with "This" or "We"
- Check paragraph transitions — each paragraph's first sentence should connect to the previous paragraph's conclusion

### Pass 4: Keyword Consistency (The Banana Rule)

**Do NOT call a "banana" an "elongated yellow fruit" to avoid repetition.**

If the Method section says "obese group", the Results must NOT switch to "heavier group". Synonym variation for technical terms forces the reader to wonder whether a new category has been introduced.

**Audit procedure:**
1. Extract all key terms from the Method section (group names, variable names, technique names, abbreviations, metric names)
2. Verify the EXACT same terms appear in Results, Discussion, Tables, Figure captions
3. Flag every synonym substitution for a defined term

**Acronym discipline:**
- Define every acronym at first use: "Large Language Models (LLMs)"
- After definition, use ONLY the acronym — do not alternate
- Do not create acronyms used fewer than 3 times — just spell it out
- Verify consistency: `grep -rn "LLM\|large language model" paper/sections/` should show the definition once and the acronym everywhere else

### Pass 5: Numerical and Citation Integrity

- Does the number in the Abstract match the number in the Results table?
- Do percentages in text match raw numbers in tables? (compute manually)
- Are significant figures consistent? (don't write "92.14%" in text but "92.1%" in table)
- Do Figure axis values match Table values?
- Is every "significant improvement" backed by a statistical test?
- Is every baseline number attributed? (our reproduction vs cited from paper?)

---

## Reverse Outline Test

After all sections are drafted, run this coherence check:

1. **Extract topic sentences**: Pull the first sentence of every paragraph in the paper
2. **Read them in sequence**: They should form a coherent narrative on their own — problem → gap → method → evidence → conclusion
3. **Check claim coverage**: Every contribution from the introduction must appear as a topic sentence somewhere in the paper
4. **Check evidence mapping**: Every major experiment/figure must be introduced by a topic sentence that states what it demonstrates
5. **Fix gaps**: If a topic sentence doesn't advance the story, the paragraph needs rewriting

This test catches:
- Sections that don't connect to each other
- Claims made in the introduction but never evidenced
- Evidence presented but never linked to a claim
- Redundant paragraphs that repeat previous points

---

## Section-Specific Paragraph Plans

### Abstract (1 paragraph, 150-250 words)

| Sentence(s) | Purpose |
|-------------|---------|
| 1-2 | What problem, and why it matters |
| 3 | What gap exists in current approaches |
| 4-5 | What we do (mechanism, not details) |
| 6 | Key quantitative result (with number) |
| 7 | Broader implication: what this result MEANS — what assumption it challenges, what capability it unlocks, or what it enables for a specific community. Not a restatement of the result. |

### Introduction (~6-8 paragraphs)

| ¶ | Sentences | Purpose |
|---|-----------|---------|
| 1 | 3-4 | Context + specific problem (NOT "In recent years...") |
| 2 | 3-5 | What exists: 3-5 prior approaches, 1-2 sentences each |
| 3 | 2-3 | The gap: what's missing, why it matters |
| 4 | 2-3 | Our insight: the "aha" moment |
| 5 | 3-5 | Our approach: brief method overview |
| 6 | 3-4 | Contributions list (numbered, ≤ 3) |
| 7 | 1-2 | Main result preview (with number) |
| 8 | 2-3 | Broader impact: why this matters beyond the immediate contribution — name the community, the assumption challenged, or the capability unlocked |

### Related Work (~4-6 paragraphs)

| ¶ | Purpose |
|---|---------|
| Per category | 1 paragraph: summarize the line of work (3-5 key papers) → position our work relative to this category |
| Final ¶ | Synthesize: how our work differs from ALL categories (1-2 sentences per distinction) |

Each ¶ must end with positioning: "In contrast, our approach..." or "Unlike [category], we..."

### Method (~8-12 paragraphs)

| ¶ | Purpose |
|---|---------|
| 1 | Problem formulation / notation setup |
| 2 | High-level intuition (before any math) |
| 3-4 | Core mechanism with equations |
| 5 | Supporting component (if any) |
| 6-7 | Training procedure |
| 8 | Inference procedure |
| 9 | (optional) Theoretical analysis / guarantees |

### Experiments (~10-15 paragraphs)

| ¶ | Purpose |
|---|---------|
| 1-2 | Setup: datasets (with stats), baselines (with citations), metrics |
| 3 | Implementation details (or pointer to appendix) |
| 4-5 | Main results: key finding first, then detailed comparison |
| 6-7 | Ablation: per-component analysis |
| 8-9 | Analysis: visualizations, diagnostics, insights |
| 10 | (optional) Failure cases / negative results |

### Discussion (~3-4 paragraphs)

| ¶ | Purpose |
|---|---------|
| 1 | Main finding restated with broader context |
| 2 | Broader perspective: What assumption does this work challenge? What does it enable? What new questions does it open? Connect to insights from the claim phase. Write for a reader outside your exact sub-field. |
| 3 | Limitations (honest, specific, evidence-based) |
| 4 | Future work (concrete next steps, not "we plan to extend") |

---

## Agent Integration

The `editor` agent should apply these passes during paper-compose:

```
task(subagent_type="editor"):
  "Apply the 5-pass prose quality audit to this section:
   [paste section text]
   
   Run: (1) clutter extraction, (2) active voice check, (3) sentence architecture,
   (4) keyword consistency, (5) numerical integrity.
   
   For each issue: location, original text, suggested fix, pass number.
   Also run the reverse outline test on topic sentences."
```

The `auditor` agent should verify Pass 5 (numerical integrity) independently.
