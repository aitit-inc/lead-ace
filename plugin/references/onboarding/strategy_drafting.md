# Strategy Drafting (BUSINESS.md + SALES_STRATEGY.md)

Shared procedure for collecting business information and generating / updating the project's strategy documents (`business`, `sales_strategy`). Used by `/strategy` (Mode A: interactive Q&A) and `/lead-ace` onboarding chain (Mode B: URL-driven inference).

## Table of Contents
- [Modes](#modes)
- [Step 1. Verify Project](#step-1-verify-project)
- [Step 2. Load Environment Status](#step-2-load-environment-status)
- [Step 3. Check Existing Documents & Determine Sub-mode](#step-3-check-existing-documents--determine-sub-mode)
- [Step 4. Information Collection (mode-specific)](#step-4-information-collection-mode-specific)
- [Step 5. Web Research (supplementary)](#step-5-web-research-supplementary)
- [Step 6. Generate / Update BUSINESS.md](#step-6-generate--update-businessmd)
- [Step 7. Generate / Update SALES_STRATEGY.md](#step-7-generate--update-sales_strategymd)
- [Step 8. Hand-off to caller](#step-8-hand-off-to-caller)

## Modes

| Mode | Caller | Input style | Behavior |
|---|---|---|---|
| **A — Interactive Q&A** | `/strategy` | User-driven, AskUserQuestion-heavy, 4-1..4-10 step-by-step | Full-detail collection. Supports both initial and update sub-modes (Step 3). |
| **B — URL-driven inference** | `/lead-ace` onboarding chain | URL fetched once, content parsed by LLM, fills sections from inference, asks only for critical gaps | Initial sub-mode only. Faster, lighter; user reviews summary at the end and can re-run `/strategy` for refinement. |

The caller declares mode at invocation. This document references `MODE = A | B` throughout.

---

## Step 1. Verify Project

Project ID: `$0` (required, set by the caller).

Call `mcp__plugin_lead-ace_api__list_projects`. If `$0` does not exist:
- Mode A → instruct user to run `/setup $0` first. Abort.
- Mode B → the onboarding chain just created the project in env_check Step 3; this branch is unreachable. If reached, abort with internal error and ask the user to re-run.

## Step 2. Load Environment Status

Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "env_status"`.

If missing:
- Mode A → abort with: "No environment status recorded for this project. Please run `/setup $0` first."
- Mode B → unreachable (env_check just saved it). If reached, abort.

Hold the parsed env status as `ENV`. It feeds Step 4 (channel choices) and Step 7 (Environment & Tool Status section). **Do not re-ask the user** about Gmail / Chrome here.

**Channel impact** (apply throughout the rest):
- No Gmail SaaS → no email sending; forms / SNS only.
- No Gmail MCP → reply checking in `/check-results` becomes manual.
- No Claude in Chrome → no form submission, no SNS DMs; email only.
- No tools at all → Outbound is effectively unusable; make the limitation prominent.

## Step 3. Check Existing Documents & Determine Sub-mode

Call in parallel:
- `mcp__plugin_lead-ace_api__get_document` with `slug: "business"`
- `mcp__plugin_lead-ace_api__get_document` with `slug: "sales_strategy"`
- `mcp__plugin_lead-ace_api__get_project_settings`

If any document call returns "Project not found", abort and instruct the user to run `/setup $0`.

Hold project settings (`outboundMode`, `senderEmailAlias`, `senderDisplayName`, `unsubscribeEnabled`) as `SETTINGS`.

**Migration check (Mode A, update sub-mode only):** If the existing SALES_STRATEGY.md has a "Sender Information" section containing a sender email or display name (older versions), and `SETTINGS.senderEmailAlias` / `SETTINGS.senderDisplayName` are empty, propose migrating the values into project settings via `update_project_settings` and stripping them from the document.

**Sub-mode determination:**
- Both documents missing → **initial** sub-mode. Both modes use this when the project is new.
- Either document exists → **update** sub-mode. Mode A only (Mode B never enters update sub-mode; if Mode B sees existing docs, hand back to caller and let `/lead-ace` route the user to `/strategy`).

### Gap Analysis (Mode A, update sub-mode)

Check completeness of each section in existing `SALES_STRATEGY.md`:

| Section | Completeness Criteria |
|---|---|
| Elevator pitch | Specific content present |
| Problems solved | Problem and solution clearly stated |
| Target | Primary and secondary specific by industry, scale, role |
| Value proposition | Content present |
| Track record / social proof | At least 1 specific achievement or number |
| Outreach mode | precision / volume is set |
| Outbound mode | send / draft is set in project settings |
| Sales channels | Channels and priority specified |
| Sender information | Display name + email in project settings; phone + signature in document |
| Messaging / email template | Template defined |
| Response definition | Conditions counting as response specified |
| Notification settings | Content present ("none" is a valid value) |
| KPI | Metrics set |
| Search keywords | 10 or more |
| Environment & tool status | Each tool's status recorded |

Call `mcp__plugin_lead-ace_api__get_evaluation_history` with `projectId: "$0"`. Classify sections:

| Category | Sections | Behavior |
|---|---|---|
| Not set | Missing / empty / incomplete | Subject to completion |
| evaluate-managed | Messaging, targeting, channels, KPI, search keywords (when eval history exists) | **Do not touch by default** |
| Static settings | Sender info, response def, notification, track record, outreach mode, environment | Update only if user explicitly requests |

If 0 evaluations: treat as "not set" or "static settings".

**Template update detection:** Compare section headings in `tpl_sales_strategy` master document with the existing file. Sections present in template but missing in file → report as "possibly added by an update".

#### Report and Confirm Policy (Mode A only)

Report to user:
1. Completed sections (1-line summary each)
2. Evaluate-managed sections (improvement count + recent summary)
3. Missing / incomplete sections
4. BUSINESS.md state (exists / main content)

Confirm policy via `AskUserQuestion`:
- **Fill in missing items** (default): Only collect missing, don't touch evaluate-managed.
- **Update specific sections**: Collect only user-specified. Warn if evaluate-managed is included.
- **Business pivot**: Reconstruct all sections including evaluate-managed (eval improvements reset).

#### Reference other projects (Mode A, initial sub-mode)

If projects other than `$0` exist (from `list_projects`), use `get_document` to read their `business` / `sales_strategy`. For 2nd-and-later project creation, prior strategies can inform target persona / channel / messaging structure. Pay attention to differences when service / product differs — don't copy carelessly. Inform user and confirm whether to reference.

(Not needed in update sub-mode or in Mode B.)

---

## Step 4. Information Collection (mode-specific)

### Mode A — Interactive Q&A

Use `AskUserQuestion` to collect the following **one item at a time**. Tell the user they may answer in casual bullets.

Execution scope by sub-mode:
- Initial → all 4-1..4-10 in sequence.
- Update (fill missing) → only steps for sections judged "not set" in Step 3. Skip completed and evaluate-managed.
- Update (specific sections) → only user-specified. Show existing values, confirm changes.
- Update (pivot) → all steps, present existing values as defaults, ask "Any changes?".

Basic policy:
- 1-2 items per question. Move on after answer.
- Provide examples / choices / recommendations.
- Build context-aware follow-ups.
- "I don't know" / "up to you" → infer from industry best practices, propose, adopt after confirmation.

#### 4-1. Business Overview
Business / service / product overview (what the org does, what to sell).
- Examples: "Provides SaaS attendance management" / "Tax consulting for small businesses".
- If vague: "Specifically, what problem does it solve for what type of customer?"

#### 4-2. Target Customers
Who to sell to (industry, size, role, characteristics).
- Use 4-1 content to suggest typical personas.
- "Up to you" → infer most rational target and propose.

#### 4-3. Features, Differentiation, Competition
Features, selling points, differentiation from competitors.
- Suggest likely competitors based on prior context.
- May lightly research via `WebSearch` and `fetch_url.py`:
  ```bash
  python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "<URL>" --prompt "Extract this company's service content and features" --timeout 15
  ```
- "Up to you" → infer differentiation and propose.

#### 4-4. Track Record / Social Proof
Specific records, case studies, numbers usable in emails.
- Examples: number of users, improvement metrics (cost reduction, time savings, sales lift), testimonials, media coverage.
- Own usage track record OK ("Generated XX meetings/mo via this process").
- "None yet" → estimate effects from beta / features. At minimum, 1 trust foundation (founder's industry experience, technology base).

#### 4-5. Pricing and Challenges
Price range or pricing structure + current sales challenges.
- Pattern options: monthly subscription / usage-based / initial fee + monthly / spot.
- "Up to you" → research industry common ranges, propose.

#### 4-6. Prospect Discovery Sources
Platforms / directories for finding prospect candidates (depends on target market, industry, region).
- Examples: PR sites (PR Newswire, Business Wire, GlobeNewswire, TechCrunch), company DBs (LinkedIn, Crunchbase, Apollo, ZoomInfo, industry assoc.), startup/VC DBs (Crunchbase, AngelList, PitchBook, Product Hunt), trade-show / event lists, country/region directories.
- "Up to you" → reasonable defaults by target market, write into "Prospect Discovery Sources" section of SALES_STRATEGY.md.

#### 4-7. Sender Information
Collect 4 items in order (all required for outbound):
1. Organization phone number (may be needed for contact forms).
2. Sender display name (e.g., "Taro Yamada — Acme Inc.").
3. Sender email (Gmail address or verified Send-As alias of the connected Google account).
4. Signature block (org name, full name, title, phone, URL).

"Up to you" not allowed — must come from the user.

After collection, **save display name + email to project settings**:
```
mcp__plugin_lead-ace_api__update_project_settings
  projectId: "$0"
  senderDisplayName: <display>
  senderEmailAlias: <email>
```
Phone + signature stay in SALES_STRATEGY.md (Sender Information section).

If the email is a Send-As alias **not yet verified** in Gmail (Settings → Accounts → "Send mail as"), Gmail will reject the send. Tell the user to verify before `/outbound`. Primary Gmail addresses don't need verification.

#### 4-8. Outbound Mode
- `send` (default): emails sent immediately during `/outbound`.
- `draft`: `/outbound` stores as LeadAce draft; user reviews at https://app.leadace.ai/drafts. Recommended while calibrating or for high-stakes outreach.

Save:
```
mcp__plugin_lead-ace_api__update_project_settings
  projectId: "$0"
  outboundMode: "send" | "draft"
```
"Up to you" → default `send`.

#### 4-9. Scheduling and Response Definition
- Scheduling link(s) (Calendly / Cal.com / HubSpot Meetings — URL; "None" if N/A; multiple OK).
- Response definition: what counts as a "response". Options: (1) Direct email reply, (2) Scheduling completion notification, (3) Reply via contact form. Confirm or extend.
- Scheduling service name(s). **Auto-resolve notification domain**: call `mcp__plugin_lead-ace_api__get_master_document` with `slug: "ref_scheduling_services"`, look up each named service, record the domain in SALES_STRATEGY.md without asking (e.g., `Calendly — calendly.com`). Only ask if not in the reference list.
- "Up to you" → defaults: (1)(2)(3).

#### 4-10. Notification Settings
Email address for daily-cycle completion notifications (or "none").
- "We can send a daily-cycle completion notification. Provide an address if desired."

### Mode B — URL-driven Inference

The caller has provided `$URL` (the user's homepage). Fetch and infer.

#### 4B-1. Fetch the URL
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "$URL" --prompt "Extract: business overview, target customers, key features and differentiation, pricing if shown, track record / social proof if shown, contact info if shown, scheduling links if shown" --timeout 30
```
If the fetch fails or returns near-empty content (SPA without server-rendered text), fall back: ask the user for a 2-3 sentence elevator pitch via `AskUserQuestion`, then proceed.

Hold the result as `URL_CONTENT`.

#### 4B-2. Infer sections from URL_CONTENT
For each of the following, draft a 1-3 sentence value from `URL_CONTENT`. Do **not** ask the user for these — show inferences in Step 4B-4 for confirmation.

- Business overview (4-1 equivalent)
- Target customers (4-2 equivalent) — if not stated on the site, infer from the product nature
- Features / differentiation (4-3 equivalent)
- Track record / social proof (4-4 equivalent) — if absent, leave a placeholder note "Add 1 trust foundation later"
- Pricing (4-5 equivalent) — if absent, mark as "TBD"
- Scheduling links (part of 4-9) — only if visibly linked

#### 4B-3. Ask for the items that cannot be inferred
Use `AskUserQuestion` for these only (1-2 questions max):

1. **Sender information** (4-7 equivalent): Ask in a single multi-question flow for sender display name, sender email, phone, signature. These cannot come from a website.
2. **Notification email** (4-10 equivalent): "Email address for daily-cycle completion notifications, or 'none'."

Do not ask for prospect discovery sources, outbound mode, or response definition in Mode B — apply defaults:
- Prospect discovery sources: pick 2-3 from `tpl_targeting_guide` matching the inferred target market.
- Outbound mode: default `draft` (recommended for new users to review the first batch before sending).
- Response definition: defaults (1)(2)(3) from 4-9.

#### 4B-4. Show inference summary and confirm
Print a compact summary (10-20 lines) of all inferred + collected items. Ask one final confirmation: "Look good? (Y to save, edit to adjust)". If user says "edit X", reopen `AskUserQuestion` for that item.

Save sender display + email + outbound mode (`draft`) to project settings:
```
mcp__plugin_lead-ace_api__update_project_settings
  projectId: "$0"
  senderDisplayName: <display>
  senderEmailAlias: <email>
  outboundMode: "draft"
```

---

## Step 5. Web Research (supplementary)

Both modes may supplement with `WebSearch` + `fetch_url.py` for market and competitor information when useful:
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "<URL>" --prompt "<info to extract>" --timeout 15
```
Mode B uses this sparingly to avoid stretching the chain; Mode A may use it more freely.

If the caller's `allowed-tools` does not include `WebSearch`, skip this step.

## Step 6. Generate / Update BUSINESS.md

- **Initial** (both modes): Retrieve template via `mcp__plugin_lead-ace_api__get_master_document` with `slug: "tpl_business"`. Generate document following its structure, filled from collected/inferred data.
- **Update** (Mode A only): Use existing content from Step 3 `get_document`. Reflect changes / additions only. Keep unchanged sections.

Save:
```
mcp__plugin_lead-ace_api__save_document
  projectId: "$0"
  slug: "business"
  content: <full markdown>
```

## Step 7. Generate / Update SALES_STRATEGY.md

- **Initial** (both modes): Retrieve template `tpl_sales_strategy`. Generate following structure.
- **Update** (Mode A): Use existing from Step 3. Update only changed sections. **Evaluate-managed sections (messaging, targeting, channels, KPI, search keywords) are only rewritten when user explicitly instructs an update.**

**Sender Information section**: Write only the organization's phone number and the signature block. Sender display name and email live in project settings (set in 4-7 / 4B-3) and are read from there by `/outbound`, `/daily-cycle`, `/check-results` — do not duplicate. If the template prompts for them, replace those lines with: `Sender display name and email: managed in Project Settings (Web UI → Settings page)`.

**Outbound mode**: Do not write `send`/`draft` into the document — it lives in project settings. A one-line note near "Sales channels" is fine: `Outbound mode: managed in Project Settings`.

Also retrieve via `get_master_document` to improve quality:
- **`tpl_targeting_guide`**: Target persona refinement, competitive analysis, USP articulation, channel selection criteria, KPI reverse calculation, search keyword design patterns.
- **`tpl_email_templates`**: Email template selection by target industry. Auto-select the best pattern, customize to business-specific info (USP, track record, pricing). Do **not** use templates as-is.

**Reflect environment information**: Copy the env status loaded in Step 2 into the "Environment & Tool Status" section verbatim. If tools are unavailable, also reflect in "Sales Channels" (e.g., no Gmail SaaS → exclude email; no Chrome → exclude SNS).

Save:
```
mcp__plugin_lead-ace_api__save_document
  projectId: "$0"
  slug: "sales_strategy"
  content: <full markdown>
```

## Step 8. Hand-off to caller

Return:
- A 5-10 line summary the caller can include in its completion report (sub-mode, sections completed, sections deferred, any sender-info migrations, the chosen outbound mode).
- For Mode B: an explicit hint that the user can re-run `/strategy <project>` later for refinement (e.g., to update messaging or fill in deferred fields).

The caller composes its own user-facing completion message; this procedure does not print one.
