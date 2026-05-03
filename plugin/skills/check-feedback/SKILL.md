---
name: check-feedback
description: "Surface PMF signals from rejection feedback: feature_gap notes and competitor presence (already_have_solution / competitor_locked). Read-only product reflection, not sales tactics. Triggers: \"check feedback\", \"PMF signals\"."
argument-hint: "<project-id>"
allowed-tools:
  - mcp__plugin_lead-ace_api__get_rejection_feedback_summary
---

# Check Feedback - PMF Signals from Rejection Feedback

A read-only skill that surfaces **product/pricing/business-model** signals from rejection feedback recorded by `/check-results`. Use this for PMF reflection — questions like "is there a missing feature people keep asking for?" or "are we losing to a specific competitor?".

This skill is **not** for sales tactics. Tactical signals from rejections (when to recontact, who to redirect to, which industries to deprioritize) are consumed automatically by `/evaluate` in the daily cycle. Do not use `/check-feedback` to drive operational decisions.

## Steps

### 1. Verify Arguments

- Project ID: `$0` (required)

Return an error if `$0` is empty.

### 2. Fetch Two Windows in Parallel

Call `mcp__plugin_lead-ace_api__get_rejection_feedback_summary` twice in parallel:

1. `projectId: "$0"`, `windowDays: 30` -> recent
2. `projectId: "$0"` (no `windowDays`) -> all-time

If the tool returns "Project not found", instruct the user to run `/setup` first and abort.

The response includes both PMF fields (`primaryReasonDistribution`, `featureGapNotes`) and tactical fields (`recontactWindows`, `decisionMakerPointers`). **Ignore the tactical fields** — they are present for future `/evaluate` consumption and are not part of this skill's output.

### 3. Format Report

Render in this order. **Always lead with `featureGapNotes`** — that section drives product/roadmap decisions.

#### a. Feature Gap Notes (PMF signal)

Pull from `featureGapNotes` (already ordered most-recent-first). For each entry:

```
- {receivedAt, ISO date} — {organizationName} / {prospectName}
  "{freeText}"
```

If empty in both windows, render: "No `feature_gap` rejections recorded yet."

#### b. PMF-Relevant Reason Distribution

Render side-by-side: 30-day vs all-time. From `primaryReasonDistribution`, **show only the three PMF-relevant reasons**:

- `feature_gap` — concrete missing capability (highest PMF signal)
- `already_have_solution` — incumbent vendor presence (competitive pressure)
- `competitor_locked` — multi-year contract / renewal-only window (competitive pressure)

Skip rows where both windows are 0. **Recompute the total and percentages locally from these three reasons only** — the API-supplied `percentage` field is computed against the all-rejections denominator (all 9 enum values) and is misleading for this PMF-only view. Any reason not listed above (`not_relevant` / `wrong_timing` / `budget` / `not_decision_maker` / `unsubscribe_request` / `other`, plus any unknown future enum values) is treated as tactical and excluded.

```
Reason                   30 days        all-time
feature_gap              N (PP%)        N (PP%)
already_have_solution    N (PP%)        N (PP%)
competitor_locked        N (PP%)        N (PP%)
PMF-relevant total       N              N
```

If all three are 0 in both windows, render: "No PMF-relevant rejections recorded yet."

### 4. Closing Note

End with one short, plain-English summary. Decide which line to write in this order — first match wins:

1. **Thin signal** — if PMF-relevant total (recomputed in step 3.b) is < 3, say so and recommend continued data collection. Stop.
2. **Capability clustering in `featureGapNotes`** — scan `featureGapNotes[].freeText` for repeated capability/feature terms across entries. If ≥2 notes name the same capability, use the dominant-feature example.
3. **Competitor-pressure share** — if `already_have_solution` + `competitor_locked` together exceed half of the PMF-relevant total, use the competitor example. (Free-text is not returned for these reasons, so do not name a specific vendor.)
4. **Otherwise** — use the mixed example.

Example tones:

- Dominant feature_gap capability: "Multiple recent rejections cite `<feature>` — strongest PMF signal is for that. Consider `/strategy` revision or product roadmap input."
- High competitor pressure: "A large share of rejections cite an incumbent solution or contract lock-in — competitive pressure is the dominant PMF signal. Consider differentiation messaging in `/strategy`."
- Mixed: "Rejection volume is N over 30 days, no single PMF signal dominates. Continue monitoring."

Do not invent product/strategy actions when the data does not support them.

This is a read-only skill — no DB writes, no side effects.
