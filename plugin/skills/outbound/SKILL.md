---
name: outbound
description: "This skill should be used when the user asks to \"send emails\", \"do outreach\", \"contact prospects\", \"run outbound sales\", or wants to execute outbound sales. Automatically sends emails, fills in contact forms, and sends SNS DMs to prospects on the list. Count can be specified."
argument-hint: "<project-id> [count]"
allowed-tools:
  - Bash
  - Read
  # claude-in-chrome handles both contact-form submission and SNS DMs
  - mcp__claude_in_chrome__tabs_context_mcp
  - mcp__claude_in_chrome__tabs_create_mcp
  - mcp__claude_in_chrome__navigate
  - mcp__claude_in_chrome__read_page
  - mcp__claude_in_chrome__find
  - mcp__claude_in_chrome__get_page_text
  - mcp__claude_in_chrome__form_input
  - mcp__claude_in_chrome__computer
  - mcp__claude_in_chrome__javascript_tool
  - mcp__claude_in_chrome__read_network_requests
  - mcp__plugin_lead-ace_api__get_outbound_targets
  - mcp__plugin_lead-ace_api__send_email_and_record
  - mcp__plugin_lead-ace_api__record_outreach
  - mcp__plugin_lead-ace_api__update_prospect_status
  - mcp__plugin_lead-ace_api__get_document
  - mcp__plugin_lead-ace_api__get_master_document
  - mcp__plugin_lead-ace_api__get_project_settings
---

# Outbound - Outbound Sales Execution

A skill that sequentially reaches out to prospects on the sales list via email, contact forms, and SNS DMs.

For each prospect, sends a message via an available channel and records the result in the DB. After all processing, generates a summary report.

## Steps

### 1. Setup

- Project ID: `$0` (required)
- Approach count: `$1` (default: 30)

Load documents and project settings via MCP:

Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "business"`.
Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "sales_strategy"`.
Call `mcp__plugin_lead-ace_api__get_project_settings` with `projectId: "$0"`. Note the `outboundMode` value — it controls how step 3 sends emails:
- `send` (default) → send immediately via the user's connected Gmail
- `draft` → store the composed email as a LeadAce draft (the user reviews and sends it from https://app.leadace.ai/drafts)

Pay particular attention to these sections in the sales_strategy document:
- **Outreach mode**: `precision` (deep personalization) or `volume` (template-based semi-personalization). Default to `precision` if not set
- **Sales channels**: Channel priority and which channels not to use
- **Messaging**: Subject line patterns, body structure, and A/B test instructions if any -- follow them
- **Sender information**: Signature block (organization phone, name, title, etc.). Sender display name and email come from project settings (loaded above), **not** from this document — the backend send path uses them automatically
- **Email template**: If a template is defined, use it as a base (especially important in volume mode)
- **SNS messages**: SNS DM messaging policy

**Important:** If SALES_STRATEGY.md has specific instructions on subject line variations, A/B tests, etc., always follow them. Never ignore instructions and revert to default behavior.
**Note:** Sending timing (day of week, time of day) is not controlled by this skill.

Retrieve the uncontacted prospect list:

Call `mcp__plugin_lead-ace_api__get_outbound_targets` with `projectId: "$0"` and `limit: $1` (default 30).

If the tool returns a "Project not found" error, instruct the user to run `/setup` first and **abort**.

### 2. Approach Each Prospect

Follow the channels and priorities listed in the "Sales Channels" section of SALES_STRATEGY.md. Skip any channel explicitly listed as not in use.

Default priority when "Sales Channels" section has no particular restrictions:

1. **Email** -- if email address is available
2. **Contact form** -- if form URL is available
3. **SNS DM** -- if SNS account is available (X/Twitter only; sending may not be possible depending on recipient's DM settings)

No need to approach a single prospect via all available channels. One channel is sufficient.

**Attempt limit per prospect:** Limit sending attempts to **a maximum of 2** per prospect (main channel + 1 fallback). If both fail for any reason, immediately skip and move to the next prospect. Do not waste context and tool calls lingering on a single prospect.

**SNS DM caution:** SNS DMs have a lower reach rate (depends on recipient's DM settings). Follow the priority order in the "Sales Channels" section of SALES_STRATEGY.md if specified. Skip if SNS is disabled.

**If claude-in-chrome is not connected:** Both contact-form submission and SNS DMs require it. Target only prospects with email addresses and skip those where the channel is unavailable. Report skipped count in results report as "Skipped due to browser not connected: N".

### 3. Email Sending

Retrieve email guidelines via `mcp__plugin_lead-ace_api__get_master_document` with `slug: "tpl_email_guidelines"` and follow them. Get the signature block from the "Sender Information" section of SALES_STRATEGY.md (append it to the body). Sender display name and `From:` address are applied automatically by `send_email_and_record` from project settings — do not pass them as arguments.

**Subject line variation:** If SALES_STRATEGY.md defines multiple subject line patterns, use different patterns for each prospect. Never use the same subject for all outreach. Distribute evenly if A/B test instructions exist.

**Body personalization (vary depth by outreach mode):**

- **Precision mode**: Refer to each prospect's `overview` and `matchReason`, and write the entire body tailored to the recipient -- not just the opening. Reference specific numbers, achievements, and initiatives of the target company. Generic openers like "I visited your website" alone are insufficient
- **Volume mode**: Use the SALES_STRATEGY.md email template as a base, adjusting the opening (why you're reaching out) and the problem statement in 2 places based on `overview` / `matchReason`. The solution through CTA can follow the template structure as-is

**Branch on `outboundMode` from step 1:**

#### `send` mode (default) — send immediately

Call `mcp__plugin_lead-ace_api__send_email_and_record` with:
- `projectId: "$0"`
- `prospectId`: the prospect's id
- `to`: array with the recipient address
- `subject`: subject line
- `body`: complete body including signature

The MCP tool sends the email through the user's connected Gmail (gmail.send scope) and records the outreach log atomically. On success it returns `{ outreachId, messageId, threadId }`. On failure (`error: "Send failed"`, status 502) the outreach is still logged with `status: "failed"`, so do not retry record_outreach manually.

If the tool returns `error: "Gmail not connected"` or `"Gmail token revoked"` (status 412), abort all email sending for this run and surface the message — the user must reconnect Gmail in the web app's Settings.

#### `draft` mode — store a draft in LeadAce (no auto-send)

Do **not** call any Gmail MCP. The draft is stored as an outreach log row that the user reviews and sends from the LeadAce web app (Drafts page). Sending happens through the SaaS backend's gmail.send, so the quota / stats / reply tracking stay accurate.

Call `mcp__plugin_lead-ace_api__record_outreach` with:
- `projectId: "$0"`
- `prospectId`: the prospect's id
- `channel: "email"`
- `subject`: subject line
- `body`: complete body including signature
- `status: "pending_review"`

`pending_review` does not count against the outreach quota — only actual sends do. The recipient is implicit (the prospect's primary email) and resolved at send time. cc / bcc are not yet supported in draft mode.

**Notes (both modes):**
- The body must be the complete content including the signature
- The `From:` address and display name are pulled from project settings (`senderEmailAlias` / `senderDisplayName`) by the backend. If `senderEmailAlias` is set to a Send-As alias not yet verified in the user's Gmail account, sending fails with a Gmail error — surface it in the report and tell the user to verify the alias at https://mail.google.com → Settings → Accounts → "Send mail as"

### 4. Contact Form Submission

Read `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/claude-in-chrome-guide.md` and `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/form-filling.md` and follow their procedures.

Branch processing based on the `formType` field:

| formType | Processing |
|---|---|
| `google_forms` | Follow "Google Forms" section in `references/form-filling.md`. Extract entry IDs via `javascript_tool`, then submit via `formResponse` POST with curl |
| `native_html` / `wordpress_cf7` / null | Use claude-in-chrome MCP tools (`navigate`, `read_page` / `find`, `form_input`, `computer`, `read_network_requests`). Follow basic flow in `references/form-filling.md` |
| `iframe_embed` | Skip. Record with `status: "failed"`, `errorMessage: "iframe-embedded form -- skipped"` |
| `with_captcha` | Skip. Follow "reCAPTCHA / hCaptcha etc." section in `references/form-filling.md` |

If `formType` is null (not yet determined), inspect the page with `read_page` / `find` first. **However, if null, skip immediately on first attempt failure** (to prevent wasted tool calls in case it's iframe_embed or with_captcha).

**Body validation before sending:** Before recording, verify that the body entered in the form is not empty. If empty, record as `status: "failed"`, `errorMessage: "body empty"`.

**After submission:** Call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "sent"`, and the body text used.

### 5. SNS DM

Use claude-in-chrome to send DMs on SNS (login session required). Supported platforms: **X (Twitter)** and **LinkedIn**. See `references/claude-in-chrome-guide.md` for tool reference.

**Message:** Keep it short and concise for SNS. Refer to the "SNS Messages" section of SALES_STRATEGY.md.

**Common steps:**
1. Get account information from the prospect's `snsAccounts` field
2. Navigate to the SNS profile page in the browser
3. Send a message using the DM or messaging feature

**For X (Twitter):**
- Click the DM (message) icon from the profile page
- If recipient's DM settings are closed, sending is not possible -> set to `inactive`
- channel: `sns_twitter`

**For LinkedIn:**
- Click the "Message" button from the profile page
- DMs can only be sent to connected users. If not connected, sending is not possible -> set to `inactive`
- Do not use InMail (paid feature)
- channel: `sns_linkedin`

After sending, call `mcp__plugin_lead-ace_api__record_outreach` with the appropriate channel, subject (empty string for SNS), and body.

### 6. Handle Inactive Prospects

For prospects where approach failed due to a **structural reason** making future approaches impossible, call `mcp__plugin_lead-ace_api__update_prospect_status` with `status: "inactive"`.

**Cases where `inactive` should be set:**
- Email address was invalid and bounced (permanent error)
- SNS DMs are not open
- Form was not suitable for B2B inquiries
- No available contact method at all

**Cases where `inactive` should NOT be set (keep as `new`):**
- Temporary network error or timeout
- System-side issues such as Gmail token revocation or quota exhaustion

### 7. Additional Outreach When Target Not Met

After all prospects are processed, if successes (sent) fall short of the target count:

1. Shortfall = target count - successes
2. Retrieve additional prospects: call `mcp__plugin_lead-ace_api__get_outbound_targets` with `limit: <shortfall>`
3. Repeat steps 2-6 for retrieved prospects
4. Retry **one round only**. Also end retry if total reachable is 0
5. Include final target achievement in the report (e.g., "Target 5, achieved 3 (ended due to depleted list)")

### 8. Results Report

Report the following:
- Number of prospects approached
- Attempts and successes per channel, success rate (Email: X successes/Y attempts (XX%), Form: X successes/Y attempts (XX%), SNS: X successes/Y attempts (XX%))
- In `draft` mode, also report drafts created (Drafts: N) and remind the user to review and send them at https://app.leadace.ai/drafts
- Number of failures and reasons
- Guide the user to run `/check-results` as the next step (or, in draft mode, after the user sends the reviewed drafts)
