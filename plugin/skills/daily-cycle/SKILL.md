---
name: daily-cycle
description: "This skill should be used when the user asks to \"run the daily cycle\", \"run today's sales\", \"do the daily sales tasks\", \"run daily-cycle\", or wants to run the daily sales automation cycle. Automatically runs check-results → evaluate → outbound + build-list (when needed) in sequence."
argument-hint: "<project-directory-name> [outbound-count=30]"
allowed-tools:
  - Bash
  - Read
  - Agent
---

# Daily Cycle - Daily Sales Cycle Execution

A skill that automatically runs a full day of sales activities. All phases are executed by sub-agents to keep the main context lightweight.

**Prerequisite:** Follow the conventions in `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` (data.db location and no-cd rule). Include references to these conventions in prompts to sub-agents as well.

**Important: Do not use `context: fork` in this skill.** Due to the one-level nesting limit for sub-agents, daily-cycle itself must run in the main context and launch each phase via the Agent tool.

**Context Lightweight Rules:**
- Sub-agents should **write detailed results to files in `$0/.tmp/`** and return **only a minimal summary (3 lines or fewer) needed for decisions** to the main context
- The wrap-up sub-agent reads the `.tmp/` files to generate the final report, send notifications, and commit

## Arguments

- Project directory name: `$0` (required)
- Outbound count: `$1` (default: 30)

## Steps

### 0. Preflight Check

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

If `status` is `error`, display the error message and **abort immediately**. Report any migrations in `migrations_applied` to the user.

### 1. Setup

First, get the exact current date, time, and day of week. Treat this result as authoritative for subsequent steps (takes priority over system date information).

```bash
date '+%Y-%m-%d %H:%M (%A)'
```

Verify that the `$0` directory exists and the project is registered in the DB.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db project-exists "$0"
```

Create a temporary directory (for storing sub-agent detailed results):

```bash
mkdir -p "$0/.tmp"
```

### 2. Review Previous Cycle

If `$0/DAILY_CYCLE_REPORT.md` exists, read it to understand:

- Date and time of previous run
- Outbound success rate and channel breakdown (if rate was low, use it to inform this run's batch strategy)
- Build-list results (if candidates were insufficient, decide to run build-list earlier this time)
- "Handover to next run" section (system errors, interruptions, items requiring attention)

Include notes from what was understood only **when there are relevant handover items** in the prompts passed to sub-agents in subsequent steps. Examples:
- Outbound success rate was low → Tell step 7 sub-agent "previous success rate was low (XX%). Many failures on channel Y"
- Build-list had few candidates → Tell step 8a sub-agent "previous run only found N candidates. Change direction per SEARCH_NOTES.md"
- There were system errors → Warn the relevant step's sub-agent

Skip if the file doesn't exist (first run).

### 3. Start Notification Email

Get the notification recipient email from the "Notification Settings" section of `$0/SALES_STRATEGY.md`, and the sender email from the "Sender Information" section. Skip if notification is "none" or not set.

Compose the email body concisely using only information already on hand — no additional DB queries:
- Execution date and time (result from step 1)
- Project name (`$0`)
- Outbound target count (`$1`)
- Results from previous cycle (1-2 lines extracted from DAILY_CYCLE_REPORT.md in step 2; omit for first run)

```bash
gog send --account "<sender>" --to "<recipient>" --subject "daily-cycle started: $0" --body "<body>"
```

If sending fails, continue the cycle (errors will be reported in the wrap-up report).

### 4. check-results (sub-agent)

Launch a sub-agent using the Agent tool to check for replies.

Include the following in the prompt:
- Project directory: `$0`
- Read `${CLAUDE_PLUGIN_ROOT}/skills/check-results/SKILL.md` and follow its procedure
- Write detailed results (response breakdown, summary of each reply, draft creation results, etc.) to `$0/.tmp/check-results-summary.md`
- Return to main with **only a 3-line summary**. Example: "3 responses (positive 2, neutral 1). 2 drafts created. 0 do-not-contacts."

After receiving the summary from the sub-agent, report it to the user.

### 5. evaluate (sub-agent, conditional)

Run every cycle.

Include the following in the prompt:
- Project directory: `$0`
- Read `${CLAUDE_PLUGIN_ROOT}/skills/evaluate/SKILL.md` and follow its procedure
- Write detailed results (KPI numbers, analysis results, improvements applied) to `$0/.tmp/evaluate-summary.md`
- Return to main with **only a 3-line summary**. Example: "Response rate 4.2%. Messaging improvement applied. 2 search keywords added."

After receiving the summary from the sub-agent, report it to the user.

### 6. Check List Remaining and Determine Execution Order

Check the number of uncontacted (status = 'new') prospects:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable-by-channel "$0"
```

The channel breakdown (email / form_only / sns_only) is used for the batch strategy decision in step 7.

**Email depletion check:** If channel breakdown shows **email = 0 and form_only < 5**, outbound effectiveness will be very low. In this case, skip outbound and **run step 8 (build-list) first** to replenish email holders. After replenishment, re-run step 6; if email > 0, proceed to outbound. If email = 0 even after build-list, run outbound for the number of form_only prospects (report the email depletion state to the user).

**Execution order determination:** If remaining prospects are less than **1/3 of the specified outbound count**, run step 8 (build-list) first to replenish the list, then return to step 7 outbound.

- email = 0 and form_only < 5 → step 8 (build-list) → re-run step 6 → step 7 (outbound)
- Remaining ≥ 1/3 of specified count → step 7 (outbound) → step 8 (build-list, if needed)
- Remaining < 1/3 of specified count → step 8 (build-list) → re-run step 6 → step 7 (outbound)
- Remaining = 0 and build-list not yet run → step 8 (build-list) → re-run step 6 → step 7 (outbound)

### 7. outbound (sub-agents × batch split)

**Determine actual outbound count:** Use `min(specified count, remaining count from step 6)` as the actual outbound count. If remaining is 0 (including after step 8), skip outbound and proceed to step 9.

**Form submission limit:** Cap form submissions at **5 per cycle**. Form submissions consume 10-20 tool calls each via browser operations and are the primary cause of context exhaustion. If `form_only` from the step 6 channel breakdown exceeds 5, carry the excess over to the next cycle. No limit for prospects with email.

Split the outbound count into **batches of 10** and launch each as a **separate sub-agent in series**.

Example: 30 prospects → 3 sub-agent launches (10 each)

Include the following in each sub-agent's prompt:

```
You are an outbound sales agent. Please reach out to each company on the prospect list via email, form, or SNS DM.

## Preparation (read in this order)

1. First read `$0/SALES_STRATEGY.md` and `$0/BUSINESS.md` to understand:
   - Outreach mode (precision / volume). Default to precision if not set
   - Channel priorities and which channels not to use
   - Subject line pattern variations (if A/B test instructions exist, follow them)
   - Email body structure and template (especially important in volume mode)
   - Sender information (sender email address, signature)
   - SNS messaging policy

2. Next, read `${CLAUDE_PLUGIN_ROOT}/skills/outbound/SKILL.md` and follow its procedure

3. Also read these based on the channel:
   - For email: `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/email-guidelines.md`
   - For forms: `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/form-filling.md` and `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/playwright-guide.md`

## Required Rules for Sales Policy

- **Subject lines:** If SALES_STRATEGY.md has multiple subject patterns, distribute them evenly within the batch. Do not use the same subject every time
- **Email opening:** Reference specific characteristics, industry, or initiatives of the target company. Generic greetings like "I visited your website" alone are not acceptable
- **Full body:** Weave prospect-specific information from overview and match_reason throughout multiple parts of the email — write in context tailored to the recipient, not template replacement
[Append previous batch subject pattern usage here if available]

## Task

- Project directory: $0
- Batch number: N
- Count: 10 (final batch may be fewer)
- Write detailed results to `$0/.tmp/outbound-batch-N.md`
- Return to main with **only: success count, failure count, unreachable count, main failure reasons (if any), list of subject patterns used**
  Example: "Success 8, Failure 1 (form submission error), Unreachable 1. Subject patterns: A×4, B×3, C×3"
```

**Carry over previous batch results:** From the 2nd batch onward, append the subject pattern usage from the previous batch to the "Previous batch subject pattern usage" part of the prompt to prevent overuse of the same pattern. Example: "Previous batch used pattern A 4 times, B 3 times. Use more of B and C this time"

**Reason for series execution:** Each batch references the same status in the same DB, so parallel execution risks duplicate outreach to the same prospect.

**Sub-agent refusal fallback:** If a sub-agent refuses browser operations (form submissions, etc.) and can't proceed, re-run that batch in the main context. When re-running in main, process only form targets and check DB status to avoid duplicating email-sent prospects.

Report progress after each batch summary (e.g., "outbound: 10/30 completed").

**Success rate check between batches:** After each batch completes, check the success rate (successes / processed). If rate is below 30%, stop remaining batches and autonomously decide and execute the following:
- Failure reason is insufficient contacts (many unreachable) → prioritize step 8 build-list and replenish prospects with contact info
- Failure reason is a system issue (gog send auth error, etc.) → abort all outbound and report the issue in the completion report
- Failure reason is form incompatibility, etc. → continue remaining batches with only email-available prospects

**Retry when target not met:** After all outbound batches complete, tally each batch's results. If total successes < specified count:

1. Re-check reachable remaining:
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
   ```
2. If remaining > 0, run the shortfall (specified count - total successes) as an additional batch (same prompt format)
3. Retry **one round only**
4. If reachable is 0, skip retry and proceed to step 8

### 8. build-list (only when needed, 3-step structure)

Run in any of the following cases:
- Step 6 determined to run build-list before outbound
- Remaining list (step 6 result − consumed in step 7) is less than 3× the outbound count
- Batch success rate check in step 7 determined that contact replenishment is needed

Set the target count the same as the outbound count (`$1`, default 30). Aim to meet the target in terms of **reachable count**, not registration count (collect more candidates to account for those without contact info).

Since the build-list skill internally launches sub-agents, it cannot be called directly from daily-cycle (nesting constraint). Instead, run each phase of build-list as individual sub-agents:

**8a. Candidate collection (sub-agent)**

May be **launched in parallel** with the last outbound batch in step 7 (candidate collection only adds new entries so there's no duplicate risk).

Include the following in the prompt:
- Project directory: `$0`
- Target count
- Read Phase 1 (steps 1-5) of `${CLAUDE_PLUGIN_ROOT}/skills/build-list/SKILL.md` and follow its procedure
- **Contact retrieval (email, form, etc.) is not needed**. Collect candidate name, corporate number, official legal name, official URL, overview, industry, match reason, and priority
- After completion, return the candidate list as a JSON array (each object: name, organization_name, corporate_number, website_url, overview, industry, match_reason, priority (numeric 1-5 per build-list SKILL.md definition))
- Also update the search notes (`$0/SEARCH_NOTES.md`)

**8b. Duplicate filter (main context)**

From the candidates returned by 8a, exclude already-registered prospects in the DB. Save 8a's output to a JSON file and pass it to `filter_duplicates.py`:

```bash
cat <<'EOF' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/filter_duplicates.py data.db "$0"
<8a output JSON array>
EOF
```

The script automatically excludes duplicates by exact name match and website_url domain match, outputting only new candidates as a JSON array (exclusion summary is output to stderr). Pass the output JSON array to 8c.

If there are 0 new candidates, skip 8c and 8d and report in the completion report.

**8c. Contact retrieval (sub-agents × batches)**

Split the filtered new candidates from 8b into **batches of 10** and launch a sub-agent for each.

Include the following in each sub-agent's prompt:
- List of assigned candidates (pass the relevant portion from 8a output)
- Read `${CLAUDE_PLUGIN_ROOT}/skills/build-list/references/enrich-contacts.md` and follow its procedure
- Explore each candidate's official site to retrieve email addresses, contact form URLs, and SNS accounts
- After completion, return results as a JSON array

**8c2. Re-search for candidates without contacts (sub-agent, only when applicable)**

If 8c results show candidates with both email / contact_form_url as null, launch a sub-agent to try supplementing from non-official sources.

Include the following in the prompt:
- List of target candidates (name, website_url). Up to 10
- For each candidate, search WebSearch for `"{company name}" email address`, `"{company name}" contact`, etc., to find contacts from industry directories or press release sites
- Return found contacts (email, contact_form_url, sns_accounts) as a JSON array
- Candidates not found do not need to be included in results

Merge sub-agent results into the 8c result JSON.

**8d. DB registration (main context)**

Merge filtered candidates from 8b (Phase 1 info) and contact retrieval results from 8c, then register with `add_prospects.py`.

First save 8b output (candidate JSON) and 8c output (contact JSON) to files:
- 8b output → `/tmp/candidates.json`
- Combine all 8c sub-agent outputs into a single JSON array → `/tmp/contacts.json`

Merge by name + domain using `merge_prospects.py` and pipe directly to `add_prospects.py`:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/merge_prospects.py /tmp/candidates.json /tmp/contacts.json \
  | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/add_prospects.py data.db "$0"
```

Merge summary (unmatched count, etc.) is output to stderr.

**8e. Reachable recheck and summary output**

After build-list completes, re-check reachable count:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
```

Write build-list summary (added count, reachable count, unmatched count, etc.) to `$0/.tmp/build-list-summary.md`.

If step 6 determined to run build-list first, proceed to step 7 (outbound) from here.

### 9. wrap-up (sub-agent)

**After all phases complete, execute report generation, notification, and commit in a single sub-agent.** This ensures final processing runs reliably without being affected by main context accumulation.

Include the following in the prompt:
- Project directory: `$0`
- Execution date and time: the datetime obtained in step 1
- Whether evaluate was skipped (if applicable)
- Whether outbound was skipped (if applicable)
- Whether build-list was skipped (if applicable)
- Read all files in `$0/.tmp/` and execute the following 3 tasks in order

**9a. Generate DAILY_CYCLE_REPORT.md**

Read all summary files in `$0/.tmp/` and overwrite `$0/DAILY_CYCLE_REPORT.md` in the following format:

```markdown
# Daily Cycle Report

- Execution date and time: YYYY-MM-DD HH:MM
- Project: $0

## check-results
(Response count, breakdown, draft creation count)

## evaluate
(KPI, improvements applied, or reason skipped)

## outbound
- Approaches: X (success: Y / failure: Z)
- Success rate: XX%
- Channel success rate: Email X/Y(XX%) / Form X/Y(XX%) / SNS X/Y(XX%)
- Unreachable: X

## build-list
(Added count, or reason skipped)

## Remaining List
X (reachable)

## Handover to Next Run
(Issues, notes, strategy adjustment suggestions. "None" if nothing to note)
```

**9a2. Update KPI Actual Results in SALES_STRATEGY.md**

If `$0/SALES_STRATEGY.md` has a "KPI Actuals" section, update the following basic numbers with the latest values:
- Total sent (contacted)
- Total responses and response rate
- Execution date and time

This prevents KPI actuals from becoming stale even in cycles where evaluate is skipped. Leave messaging improvements, targeting changes, and other strategic analysis to the evaluate skill — **only update numbers here**.

**9b. Completion Notification Email**

Get the notification recipient email from the "Notification Settings" section of `$0/SALES_STRATEGY.md`, and the sender email from the "Sender Information" section. Skip if notification is "none" or not set.

```bash
gog send --account "<sender email>" --to "<recipient email>" --subject "daily-cycle completed: $0" --body-file "$0/DAILY_CYCLE_REPORT.md"
```

**9c. Delete Temporary Files**

```bash
rm -rf "$0/.tmp"
```

**9d. Commit and Push Work Results**

Commit and push files changed during the work. **Always execute this regardless of other steps' success or failure.**

```bash
git add data.db "$0/" && git commit -m "work: :e-mail: $0" && git push
```

Sub-agent's return to main: Briefly report the save status of the report, notification email send status, and commit status.
