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

Skip rows where both windows are 0. Compute the total from these three reasons only — do **not** include tactical reasons (`not_relevant` / `wrong_timing` / `budget` / `not_decision_maker` / `unsubscribe_request` / `other`) in the total or the table.

```
Reason                   30 days        all-time
feature_gap              N (PP%)        N (PP%)
already_have_solution    N (PP%)        N (PP%)
competitor_locked        N (PP%)        N (PP%)
PMF-relevant total       N              N
```

If all three are 0 in both windows, render: "No PMF-relevant rejections recorded yet."

### 4. Closing Note

End with one short, plain-English summary of what the PMF data suggests. Three examples to anchor tone:

- Many `feature_gap` notes around the same capability: "Multiple recent rejections cite `<feature>` — strongest PMF signal is for that. Consider `/strategy` revision or product roadmap input."
- Many `already_have_solution` mentioning the same vendor: "Repeated rejections cite `<vendor>` as incumbent — competitive pressure from a specific player. Consider differentiation messaging in `/strategy`."
- Mixed but no dominant pattern: "Rejection volume is N over 30 days, no single PMF signal dominates. Continue monitoring."

If signal is too thin (PMF-relevant total < 3), say so and recommend continued data collection. Do not invent product/strategy actions when the data does not support them.

This is a read-only skill — no DB writes, no side effects, no tactical recommendations.
