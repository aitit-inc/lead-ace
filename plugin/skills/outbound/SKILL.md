---
name: outbound
description: "This skill should be used when the user asks to \"send emails\", \"do outreach\", \"contact prospects\", \"run outbound sales\", or wants to execute outbound sales. Automatically sends emails, fills in contact forms, and sends SNS DMs to prospects on the list. Count can be specified."
argument-hint: "<project-directory-name> [count]"
allowed-tools:
  - Bash
  - Read
  - Write
  # For SNS DMs (claude-in-chrome is used because login session is required)
  - mcp__claude_in_chrome__tabs_context_mcp
  - mcp__claude_in_chrome__tabs_create_mcp
  - mcp__claude_in_chrome__navigate
  - mcp__claude_in_chrome__read_page
  - mcp__claude_in_chrome__get_page_text
  - mcp__claude_in_chrome__form_input
  - mcp__claude_in_chrome__computer
  - mcp__plugin_lead-ace_api__get_outbound_targets
  - mcp__plugin_lead-ace_api__record_outreach
  - mcp__plugin_lead-ace_api__update_prospect_status
---

# Outbound - Outbound Sales Execution

A skill that sequentially reaches out to prospects on the sales list via email, contact forms, and SNS DMs.

For each prospect, sends a message via an available channel and records the result in the DB. After all processing, generates a summary report.

## Steps

### 1. Setup

- Project directory name: `$0` (required)
- Approach count: `$1` (default: 30)

Load `$0/BUSINESS.md` and `$0/SALES_STRATEGY.md` and pay particular attention to these sections:
- **Outreach mode**: `precision` (deep personalization) or `volume` (template-based semi-personalization). Default to `precision` if not set
- **Sales channels**: Channel priority and which channels not to use
- **Messaging**: Subject line patterns, body structure, and A/B test instructions if any -- follow them
- **Sender information**: Sender email address, signature
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

**If browser tools are unavailable:** If playwright-cli is not installed, form submission is not possible; if claude-in-chrome is not connected, SNS DM is not possible. Target only prospects with email addresses and skip those where the channel is unavailable. Report skipped count in results report as "Skipped due to browser not connected: N".

### 3. Email Sending

Write emails following the guidelines in `references/email-guidelines.md`. Get the sender email address and signature from the "Sender Information" section of SALES_STRATEGY.md.

**Subject line variation:** If SALES_STRATEGY.md defines multiple subject line patterns, use different patterns for each prospect. Never use the same subject for all outreach. Distribute evenly if A/B test instructions exist.

**Body personalization (vary depth by outreach mode):**

- **Precision mode**: Refer to each prospect's `overview` and `matchReason`, and write the entire body tailored to the recipient -- not just the opening. Reference specific numbers, achievements, and initiatives of the target company. Generic openers like "I visited your website" alone are insufficient
- **Volume mode**: Use the SALES_STRATEGY.md email template as a base, adjusting the opening (why you're reaching out) and the problem statement in 2 places based on `overview` / `matchReason`. The solution through CTA can follow the template structure as-is

**Send email via gog CLI, then record via MCP:**

1. Write the email body (including signature) to a temp file:
   ```bash
   cat > /tmp/email_body.txt << 'EMAILEOF'
   <body including signature>
   EMAILEOF
   ```

2. Send the email:
   ```bash
   gog send --account "<sender email address>" --to "<recipient>" --subject "<subject>" --body-file /tmp/email_body.txt
   ```

3. **Immediately after sending**, record the result via MCP:
   - On success: call `mcp__plugin_lead-ace_api__record_outreach` with `projectId: "$0"`, `prospectId`, `channel: "email"`, `subject`, `body`, `status: "sent"`
   - On failure: call `mcp__plugin_lead-ace_api__record_outreach` with `status: "failed"` and `errorMessage`

**Important:** Always record outreach immediately after each send attempt. Do not batch recordings. If `gog send` succeeds but the MCP recording fails, retry the MCP call once.

**Note:**
- The body passed to gog must be the complete content including the signature
- Gmail MCP (`gmail_create_draft`) can only create drafts -- it cannot send
- If specifying a sender alias, add `--from "<alias>"`

### 4. Contact Form Submission

Load `references/playwright-guide.md` and `references/form-filling.md` and follow their procedures.

Branch processing based on the `formType` field:

| formType | Processing |
|---|---|
| `google_forms` | Follow "Google Forms" section in `references/form-filling.md`, submit via `formResponse` POST (no browser needed) |
| `native_html` / `wordpress_cf7` / null | Use playwright-cli for browser operations. Follow basic flow in `references/form-filling.md` |
| `iframe_embed` | Skip. Record with `status: "failed"`, `errorMessage: "iframe-embedded form -- skipped"` |
| `with_captcha` | Skip. Follow "reCAPTCHA / hCaptcha etc." section in `references/form-filling.md` |

If `formType` is null (not yet determined), check form structure with playwright-cli before deciding. **However, if null, skip immediately on first attempt failure** (to prevent wasted tool calls in case it's iframe_embed or with_captcha).

**Body validation before sending:** Before recording, verify that the body entered in the form is not empty. If empty, record as `status: "failed"`, `errorMessage: "body empty"`.

**After submission:** Call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "sent"`, and the body text used.

### 5. SNS DM

Use claude-in-chrome to send DMs on SNS (login session required). Supported platforms: **X (Twitter)** and **LinkedIn**.

**Message:** Keep it short and concise for SNS. Refer to the "SNS Messages" section of SALES_STRATEGY.md.

**Common steps:**
1. Get account information from the prospect's `snsAccounts` field
2. Navigate to the SNS profile page in the browser
3. Send a message using the DM or messaging feature

**For X (Twitter):**
- Click the DM (message) icon from the profile page
- If recipient's DM settings are closed, sending is not possible -> set to `unreachable`
- channel: `sns_twitter`

**For LinkedIn:**
- Click the "Message" button from the profile page
- DMs can only be sent to connected users. If not connected, sending is not possible -> set to `unreachable`
- Do not use InMail (paid feature)
- channel: `sns_linkedin`

After sending, call `mcp__plugin_lead-ace_api__record_outreach` with the appropriate channel, subject (empty string for SNS), and body.

### 6. Handle Unreachable Prospects

For prospects where approach failed due to a **structural reason** making future approaches impossible, call `mcp__plugin_lead-ace_api__update_prospect_status` with `status: "unreachable"`.

**Cases where `unreachable` should be set:**
- Email address was invalid and bounced (permanent error)
- SNS DMs are not open
- Form was not suitable for B2B inquiries
- No available contact method at all

**Cases where `unreachable` should NOT be set (keep as `new`):**
- Temporary network error or timeout
- System-side issues such as gog send authentication errors

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
- Number of failures and reasons
- Guide the user to run `/check-results` as the next step
