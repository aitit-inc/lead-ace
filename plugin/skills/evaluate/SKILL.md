---
name: evaluate
description: "This skill should be used when the user asks to \"analyze results\", \"improve strategy\", \"run PDCA\", \"evaluate effectiveness\", \"check response rates\", or wants to evaluate sales performance and improve strategy. Automatically analyzes and improves strategy, targeting, and messaging based on response rate data."
argument-hint: "<project-id>"
allowed-tools:
  - Bash
  - Read
  - WebSearch
  - mcp__plugin_lead-ace_api__get_eval_data
  - mcp__plugin_lead-ace_api__get_evaluation_history
  - mcp__plugin_lead-ace_api__record_evaluation
  - mcp__plugin_lead-ace_api__get_document
  - mcp__plugin_lead-ace_api__save_document
  - mcp__plugin_lead-ace_api__get_master_document
---

# Evaluate - PDCA Evaluation & Improvement

A skill that analyzes sales activity result data and automatically evaluates and improves every aspect -- strategy, tactics, targeting, and messaging.

## Steps

### 1. Data Collection

- Project ID: `$0` (required)

Call `mcp__plugin_lead-ace_api__get_eval_data` with `projectId: "$0"`.

If the tool returns a "Project not found" error, instruct the user to run `/setup` first and **abort**.

The response includes:
- `metrics`: totalOutreach, channelCounts, responseCounts, sentimentBreakdown, priorityResponseRate, statusCounts, channelResponseRate
- `respondedMessages`: all outreach bodies that received responses (with sentiment and responseType)
- `noResponseSample`: sample of outreach bodies that received no response
- `dataSufficiency`: `{ sufficient, totalSent, daysSinceLastSend }`

### 2. Load Existing Strategy

Load documents via MCP:

Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "business"`.
Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "sales_strategy"`.

Call `mcp__plugin_lead-ace_api__get_evaluation_history` with `projectId: "$0"` to retrieve past evaluation records.

If past evaluations exist, organize each record's `evaluationDate`, `findings`, and `improvements` chronologically to understand what has been tried, what was effective, and what was not. Use this information when deciding on improvement actions in step 4.

### 3. Multi-angle Analysis

Retrieve analysis frameworks via `mcp__plugin_lead-ace_api__get_master_document` with `slug: "tpl_analysis_frameworks"` and analyze from the following perspectives:

**Response Rate Analysis:**
- Overall response rate
- Response rate by channel (email vs form vs SNS)
- Response rate by priority
- Trends by time of day and day of week (analyze from send timestamps. However, since sending timing is determined by the daily-cycle execution schedule, do not write sending time constraints in SALES_STRATEGY.md. Report analysis results as "recommended execution timing" in the report only)

**Message Analysis:**
- Read all outreach bodies that received responses (from `respondedMessages`) and extract common traits
- Compare with non-response samples (from `noResponseSample`)
- Effectiveness of subject lines
- Effectiveness of body length and structure

**Target Analysis:**
- Industries and sizes with good responses
- Segments with poor responses
- Unexpected response patterns

**Channel Analysis:**
- Most effective channel
- Cost-effectiveness by channel

### 4. Determine and Apply Improvement Actions

**Data volume check (required):**

Use the `dataSufficiency` field from step 1. If `sufficient` is `false`, **do not apply changes to SALES_STRATEGY.md or recalculate priorities**. Only run report generation (steps 5 and 6) and report "Insufficient data -- continue monitoring":
- Total approaches (status='sent') fewer than 30
- Less than 3 business days since last send

Even with insufficient data, still record to the evaluations table (step 5) and generate the report (step 6) -- they are useful for understanding current status.

---

When data is sufficient, decide on specific improvements based on analysis results and **apply them automatically**.

**Strategy change stability (required):**
Evaluate runs daily, but avoid changing strategy too frequently. Until sufficient data has accumulated after the last strategy change, maintain the current strategy and prioritize data collection.

What counts as "sufficient data" depends on context. For high-volume projects, a few response fluctuations are noise, but for precision approaches, even a single response can be an important signal. Judge based on the target scale and send frequency in SALES_STRATEGY.md.

Judgment principles:
- Change based on **patterns observed repeatedly, not one-off fluctuations**
- If the **effect of the last strategy change cannot yet be measured**, do not layer additional changes
- When in doubt, don't change. Accumulating data is more valuable than changing direction on weak evidence

**Cross-reference with improvement history (required):**
Before deciding on improvement actions, review the past evaluations history organized in step 2 and follow these rules:
- Do not re-adopt measures that were tried before and had no effect
- Continue and deepen the direction of measures that were effective before
- If proposing the same improvement as before, state why different results are expected this time

**Update SALES_STRATEGY.md:**
- Narrow or broaden targeting
- Improve messaging (subject line, body structure, tone)
- Revise channel priority
- Update KPI goals

Save the updated document via `mcp__plugin_lead-ace_api__save_document` with `projectId: "$0"`, `slug: "sales_strategy"`, and the full markdown content.

**Update search keywords:**
- Add keywords related to high-response segments
- Remove ineffective keywords

**Reflect response patterns in SEARCH_NOTES.md:**
Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "search_notes"`. If found, update the `## Hints from evaluate` section (add it at the end if not present) and save via `save_document`. build-list will preserve this section during the next run and adjust its search policy.

Content to add:
- Industries / segments with response rates above overall average -> "XX industry has X% response rate (vs overall average Y%). Explore more of this industry"
- Characteristics similar to companies that responded (scale, business content, pain points) -> "Companies like XX respond well. Search for similar companies and competitors"
- Segments with poor responses -> "XX industry has low response rate (X%). Lower priority"

Skip if the document is not found (build-list hasn't been run yet).

**Recalculate priorities:**
- Update prospect priorities based on response patterns (bulk execution in step 5)

### 5. Save Evaluation Record

Call `mcp__plugin_lead-ace_api__record_evaluation` with:
- `projectId`: "$0"
- `metrics`: the metrics object from step 1 (excluding respondedMessages and noResponseSample)
- `findings`: analysis findings text from step 3
- `improvements`: summary of improvement actions applied (or "Insufficient data -- no changes applied")
- `priorityUpdates` (optional): array of `{ industry, priority }` for bulk priority updates. Omit if no priority changes due to insufficient data.

### 6. Results Report

Report the following directly to the user (no file output needed -- evaluation data is stored in the DB):
- Key KPIs (response rate, positive rate, etc.)
- Changes from previous evaluation (if any)
- Important findings from the analysis
- List of improvements applied
- Next actions to take (`/build-list` for additional exploration, `/outbound` for re-approach, etc.)
