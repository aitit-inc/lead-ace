---
name: evaluate
description: "This skill should be used when the user asks to \"analyze results\", \"improve strategy\", \"run PDCA\", \"evaluate effectiveness\", \"check response rates\", or wants to evaluate sales performance and improve strategy. Automatically analyzes and improves strategy, targeting, and messaging based on response rate data."
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - Write
  - WebSearch
---

# Evaluate - PDCA Evaluation & Improvement

A skill that analyzes sales activity result data and automatically evaluates and improves every aspect — strategy, tactics, targeting, and messaging.

**Prerequisite:** Follow the conventions in `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` (data.db location and no-cd rule).

## Steps

### 0. Preflight Check

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

If `status` is `error`, display the error message and **abort immediately**. Report any migrations in `migrations_applied` to the user.

### 1. Data Collection

- Project directory name: `$0` (required)

Run `sales_queries.py` `eval-*` commands in sequence, keeping each result for analysis:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-total-outreach "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-channel-counts "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-response-counts "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-sentiment-breakdown "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-priority-response-rate "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-status-counts "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-channel-response-rate "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-responded-messages "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-no-response-sample "$0"
```

### 2. Load Existing Strategy

Load the following:
- `$0/BUSINESS.md`
- `$0/SALES_STRATEGY.md`
- `$0/RESULTS_REPORT.md` (if it exists)
- Past `evaluations` table records (all records)

If past evaluations exist, organize each record's `evaluation_date`, `findings`, and `improvements` chronologically to understand what has been tried, what was effective, and what was not. Use this information when deciding on improvement actions in step 4.

### 3. Multi-angle Analysis

Refer to `${CLAUDE_PLUGIN_ROOT}/skills/evaluate/references/analysis-frameworks.md` and analyze from the following perspectives:

**Response Rate Analysis:**
- Overall response rate
- Response rate by channel (email vs form vs SNS)
- Response rate by priority
- Trends by time of day and day of week (analyze from send timestamps. However, since sending timing is determined by the daily-cycle execution schedule, do not write sending time constraints in SALES_STRATEGY.md. Report analysis results as "recommended execution timing" in the report only)

**Message Analysis:**
- Read all email bodies (outreach_logs.body) that received responses and extract common traits
- Sample a few emails that received no response and compare
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

Before applying improvement actions, check whether there is sufficient data:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db data-sufficiency "$0"
```

If any of the following apply, **do not apply changes to SALES_STRATEGY.md or recalculate priorities**. Only run report generation (steps 5 and 6) and report "Insufficient data — continue monitoring":
- Total approaches (status='sent') fewer than 30
- Less than 3 business days since last send

Even with insufficient data, still record to the evaluations table (step 5) and generate the report (step 6) — they are useful for understanding current status.

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

**Update search keywords:**
- Add keywords related to high-response segments
- Remove ineffective keywords

**Reflect response patterns in SEARCH_NOTES.md:**
If `$0/SEARCH_NOTES.md` exists, overwrite the `## Hints from evaluate` section (add it at the end if not present). build-list will preserve this section during the next run and adjust its search policy.

Content to add:
- Industries / segments with response rates above overall average → "XX industry has X% response rate (vs overall average Y%). Explore more of this industry"
- Characteristics similar to companies that responded (scale, business content, pain points) → "Companies like XX respond well. Search for similar companies and competitors"
- Segments with poor responses → "XX industry has low response rate (X%). Lower priority"

Skip if SEARCH_NOTES.md does not exist (build-list hasn't been run yet).

**Recalculate priorities:**
- Update prospect priorities based on response patterns (bulk execution in step 5)

### 5. Save Evaluation Record

Use `record_evaluation.py` to atomically execute the evaluation record and priority update:

```bash
echo "<findings_text>" > /tmp/eval_findings.txt
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/record_evaluation.py data.db \
  --project "$0" \
  --metrics '<metrics_json>' \
  --findings-file /tmp/eval_findings.txt \
  --improvements '<improvements_json>' \
  --priority-updates '[{"industry": "<industry>", "priority": <1-5>}, ...]'
```

`--priority-updates` is optional (omit if no priority changes due to insufficient data).

> **Note:** Direct SQL execution to the DB is prohibited. Evaluation records must be recorded via `record_evaluation.py`.

### 6. Results Report

Report the following:
- Key KPIs (response rate, positive rate, etc.)
- Changes from previous evaluation (if any)
- Important findings from the analysis
- List of improvements applied
- Next actions to take (`/build-list` for additional exploration, `/outbound` for re-approach, etc.)

Save the report to the project directory as `EVALUATION_REPORT.md` (overwrite; history is saved in DB).
