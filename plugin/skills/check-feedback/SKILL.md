---
name: check-feedback
description: "Inspect aggregated rejection feedback for a project: primary reason distribution, feature gap notes (PMF signal), recontact windows, decision-maker referrals. Triggers: \"check feedback\", \"why are prospects rejecting\", \"PMF signal\"."
argument-hint: "<project-id>"
allowed-tools:
  - mcp__plugin_lead-ace_api__get_rejection_feedback_summary
---

# Check Feedback - Aggregated Rejection Reasons

A read-only skill that surfaces structured rejection feedback already recorded by `/check-results`. Use this to answer "why are prospects rejecting us?" and to find PMF signals (especially `feature_gap` notes), reapproach candidates (preferred recontact windows), and decision-maker referrals.

## Steps

### 1. Verify Arguments

- Project ID: `$0` (required)

Return an error if `$0` is empty.

### 2. Fetch Two Windows in Parallel

Call `mcp__plugin_lead-ace_api__get_rejection_feedback_summary` twice in parallel:

1. `projectId: "$0"`, `windowDays: 30` -> recent
2. `projectId: "$0"` (no `windowDays`) -> all-time

If the tool returns "Project not found", instruct the user to run `/setup` first and abort.

### 3. Format Report

Render the aggregates with these sections, in this order. **Always lead with `feature_gap`** — that section drives product/strategy decisions. The other sections are operational reapproach plays.

#### a. Feature Gap Notes (PMF signal)

Pull from `featureGapNotes` (already ordered most-recent-first). For each entry:

```
- {receivedAt, ISO date} — {organizationName} / {prospectName}
  "{freeText}"
```

If empty in both windows, render: "No `feature_gap` rejections recorded yet."

#### b. Primary Reason Distribution

Render side-by-side: 30-day vs all-time. Use the `primaryReasonDistribution` array (already sorted by count desc).

```
Reason                   30 days        all-time
feature_gap              N (PP%)        N (PP%)
not_relevant             N (PP%)        N (PP%)
...
Total rejections         N              N
```

Skip rows where both windows are 0.

#### c. Reapproach Candidates by Recontact Window

Pull from `recontactWindows` (only `3_months` / `6_months` / `12_months` are returned — `never` and `unspecified` are excluded server-side). Group by `window` and within each group order by `receivedAt + window` to surface "ready to reapproach now" first.

For each window group:

```
After 3 months (ready: {N}, total: {M})
- {receivedAt} — {organizationName} / {prospectName} — reapproach after {receivedAt + 3 months}
```

"Ready" = `receivedAt + window` has already passed (i.e., `now >= receivedAt + windowDuration`). Compute this client-side from `receivedAt`. Surface up to 10 ready entries per window in the report; collapse the rest into a `+N more` line.

If a window has zero entries, omit the section entirely.

#### d. Decision-Maker Referrals

Pull from `decisionMakerPointers`. For each entry:

```
- {receivedAt} — {organizationName} / {prospectName} -> referred to:
  {pointer.name} ({pointer.role}) <{pointer.email}>
```

Omit fields that aren't set in the pointer. If the list is empty, render: "No decision-maker referrals captured."

### 4. Closing Note

End with one short, plain-English summary of what the data suggests. Two examples to anchor tone:

- Many `feature_gap` notes around the same capability: "Multiple recent rejections cite `<feature>` — strongest PMF signal is for that. Consider `/strategy` revision or product roadmap input."
- Many `wrong_timing` / `budget` with `3_months` windows: "Largest reapproach pool is the 3-month bucket — N prospects ready to recontact. Consider running `/build-list` filtered to those organizations or scheduling a follow-up cycle."

If neither pattern dominates, just state the dominant `primary_reason` and total volume in one sentence. Do not invent strategy actions when the data does not support them.

This is a read-only skill — no DB writes, no side effects.
