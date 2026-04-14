---
name: check-results
description: "This skill should be used when the user asks to \"check replies\", \"check responses\", \"see results\", \"check if there are email replies\", or wants to check outbound outreach responses. Automatically checks email replies and SNS responses and records them in the DB."
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__claude_ai_Gmail__search_threads
  - mcp__claude_ai_Gmail__get_thread
  - mcp__claude_in_chrome__tabs_context_mcp
  - mcp__claude_in_chrome__tabs_create_mcp
  - mcp__claude_in_chrome__navigate
  - mcp__claude_in_chrome__read_page
  - mcp__claude_in_chrome__get_page_text
  - mcp__claude_ai_Gmail__create_draft
  - mcp__plugin_lead-ace_api__get_recent_outreach
  - mcp__plugin_lead-ace_api__record_response
  - mcp__plugin_lead-ace_api__update_prospect_status
---

# Check Results - Response Collection

A skill that automatically checks outbound sales responses and records them in the database.

## Steps

### 1. Setup

- Project directory name: `$0` (required)

Load `$0/SALES_STRATEGY.md` and understand the following from the "Response Definition" section:
- What counts as a "response"
- Scheduling service in use and its notification sender email address
- Other response signals

### 2. Retrieve Recent Outreach Information

Retrieve metadata for outreach sent within the last 4 business days:

Call `mcp__plugin_lead-ace_api__get_recent_outreach` with `projectId: "$0"`.

If the tool returns a "Project not found" error, instruct the user to run `/setup` first and **abort**.

### 3. Check Incoming Emails

Use Gmail MCP to perform the following searches:

**3a. Search for Direct Replies**

For each outreach-targeted prospect, search by the **domain** of the email address sent to (to handle replies from different people in the same organization):

1. Search `mcp__claude_ai_Gmail__search_threads` for `from:@<domain> newer_than:4d`
2. If found, confirm content with `mcp__claude_ai_Gmail__get_thread`
3. Determine whether the content is a response to the outreach

**3b. Search for Scheduling Notifications**

If a scheduling service is listed in SALES_STRATEGY.md, search for emails from its notification address:

1. Search `mcp__claude_ai_Gmail__search_threads` for `from:<notification address> newer_than:1d`
2. If found, read the content and match the name, email address, and organization name in the notification body against the outreach list

**3c. Search for Bounced Emails**

Detect sending failures (unknown recipient, non-existent domain, etc.):

1. Search `mcp__claude_ai_Gmail__search_threads` for `from:mailer-daemon OR from:postmaster newer_than:4d`
2. If found, confirm content with `mcp__claude_ai_Gmail__get_thread`
3. Match the bounced email address against the outreach list to identify the corresponding prospect

**3d. Matching**

Link received emails to outreach prospects. Match in the following priority order:
1. **Exact match on sent address**: Direct reply from the recipient
2. **Domain match**: Reply from a different person in the same organization (e.g., sent to `contact@co.jp` -> received from `tanaka@co.jp`)
3. **Organization name match**: The prospect's `name` appears in the email body or sender name (handles replies from group companies or legal secretariats)
4. **Scheduling notification**: The notification email body contains the prospect's name or email address

If match confidence is low, note "Needs confirmation" in the report and defer to the user's judgment.

### 4. Check SNS Responses

**Prerequisite check:** If the `recent-outreach` result from step 2 has **no SNS channel outreach** (`sns_twitter` / `sns_linkedin`), **skip this entire step**.

Check for DM replies from prospects contacted via SNS using claude-in-chrome. Supported platforms: **X (Twitter)** and **LinkedIn**.

**For X (Twitter):**
1. Open the X DM screen (https://x.com/messages)
2. Check for replies from outreach targets
3. If there are replies, retrieve the content

**For LinkedIn:**
1. Open the LinkedIn messaging screen (https://www.linkedin.com/messaging/)
2. Check for replies from outreach targets
3. If there are replies, retrieve the content

**If the browser extension is not connected:** Skip SNS checking, but count the number of prospects contacted via SNS that remain unconfirmed. In the results report (step 7), always report this as "**Unconfirmed SNS DMs: N**".

### 5. Update Database

For each response found, call `mcp__plugin_lead-ace_api__record_response` with:
- `outreachLogId`: the matching outreach log ID from step 2
- `channel`: the channel the response came through
- `content`: the response content
- `sentiment`: `positive` / `neutral` / `negative`
- `responseType`: `reply` / `auto_reply` / `bounce` / `meeting_request` / `rejection`
- `markDoNotContact`: set `true` for bounces or explicit opt-out requests
- `receivedAt`: ISO 8601 timestamp if known

The server automatically determines the prospect status update based on `responseType` and `sentiment`:
- Positive reply / meeting_request -> `responded`
- Rejection -> `rejected`
- Bounce -> `inactive` (also auto-marks do-not-contact)
- Auto-reply -> no status change (keeps `contacted`)

**Do-not-contact determination**: If the reply content contains opt-out intent such as "no further contact needed", "unsubscribe", "please don't contact me", set `markDoNotContact: true`. This applies across all projects.

If they simply declined this project's proposal (e.g., "we'll pass this time"), the server sets `rejected` via the responseType -- do not set `markDoNotContact`.

**Edge case override**: If the automatic status is incorrect (e.g., a negative-sentiment reply that's actually a "not now, try again later"), use `mcp__plugin_lead-ace_api__update_prospect_status` to set the correct status.

### 6. Create Reply Drafts

If step 5 recorded a positive response (`responded`) for any prospect, use Gmail MCP to automatically create a reply draft.

**Scope:** Only replies with positive or neutral sentiment and response_type of `reply` or `meeting_request`. Bounces, auto-replies, and rejections are excluded.

**Draft creation steps:**

1. Refer to the "Sender Information" and "Messaging" sections of `$0/SALES_STRATEGY.md`
2. Create an appropriate draft based on the reply content:
   - **Positive reply (interested)** -> Thank you + scheduling link or 3 time slot options
   - **Material request** -> Thank you + note that materials will be sent (the user will attach the actual materials after the draft)
   - **Question / inquiry** -> Draft answer to the question + next step suggestion
   - **Scheduling confirmation** -> Thank you for confirming + details for the day
3. Create the draft with `mcp__claude_ai_Gmail__create_draft`. Set subject in reply format (`Re: {original subject}`)
4. Include the number of drafts created in the results report

**Note:** Do not send automatically. Only create drafts; sending is done manually by the user after reviewing the content. If draft creation fails (Gmail MCP not connected, etc.), skip and report in the report.

### 7. Results Report

Report the following:
- Number of prospects checked
- Number of prospects with responses and breakdown (positive/neutral/negative)
- Response rate (responses / approaches)
- Response type breakdown (direct reply / scheduling confirmation, etc.)
- List any low-confidence matches as "Needs confirmation"
- **Unconfirmed SNS DMs: N** (when SNS checking was skipped; report even if 0)
- **Reply drafts created: N** (number created in step 6; report even if 0. If drafts exist, guide the user to check Gmail drafts)
- Summary of notable replies
- Guide the user to run `/evaluate` as the next step

Save the report to the project directory as `RESULTS_REPORT.md` (append mode).

**Append format:** Separate each run's results with `---` separator and date header:

```markdown
---
## YYYY-MM-DD HH:MM
(report content above)
```

**Rotation:** Before appending, check the file's line count. If it exceeds 500 lines, delete the older half before appending.
