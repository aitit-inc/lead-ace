---
name: strategy
description: "This skill should be used when the user asks to \"formulate a strategy\", \"create a sales plan\", \"summarize business info\", \"generate SALES_STRATEGY.md\", \"review strategy\", \"update strategy\", or wants to create/update sales and marketing strategy. Interactively collects business information and auto-generates or updates BUSINESS.md and SALES_STRATEGY.md."
argument-hint: "<project-id>"
allowed-tools:
  - Bash
  - Read
  - WebSearch
  - AskUserQuestion
  - mcp__plugin_lead-ace_api__list_projects
  - mcp__plugin_lead-ace_api__get_evaluation_history
  - mcp__plugin_lead-ace_api__get_document
  - mcp__plugin_lead-ace_api__save_document
  - mcp__plugin_lead-ace_api__list_documents
  - mcp__plugin_lead-ace_api__get_master_document
---

# Strategy - Sales & Marketing Strategy Development

A skill that collects business and service information from the user and generates or updates strategy documents. For the first run, all information is collected interactively; for subsequent runs, gap analysis is performed on existing content to supplement only what is missing.

## Steps

### 1. Verify Project

- Project ID: `$0` (required)

Call `mcp__plugin_lead-ace_api__list_projects` and verify that `$0` exists. If not, guide the user to run `/setup $0`.

### 2. Load Environment Status

Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "env_status"` to get the environment snapshot saved by `/setup`.

If the document is missing, abort with: "No environment status recorded for this project. Please run `/setup $0` first — it verifies Gmail / playwright / Chrome availability and saves the status that this skill relies on."

Hold the parsed env status in memory; it is reused in step 4 (channel choices) and step 7 (the "Environment & Tool Status" section of SALES_STRATEGY.md). Do **not** re-ask the user about Gmail / playwright / Chrome here — that is `/setup`'s responsibility.

**Impact of results on channel selection (apply throughout the rest of the skill):**
- No Gmail SaaS connection -> Email sending not possible. Forms or SNS DMs only
- No Gmail MCP -> Reply checking in /check-results becomes manual
- No playwright-cli -> Form submission not possible. Email and SNS DMs only
- No Claude in Chrome -> SNS DMs not possible. Email and forms only
- No tools at all -> Outbound is effectively unusable -- make constraints clear when setting up channels in steps 3-6

### 3. Check Existing Documents & Determine Mode

Retrieve existing documents via MCP:

Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "business"`.
Call `mcp__plugin_lead-ace_api__get_document` with `projectId: "$0"` and `slug: "sales_strategy"`.

If either call returns a "Project not found" error, instruct the user to run `/setup $0` first and **abort**.

**Mode determination:**
- **Initial mode**: Neither document exists (both return "not found") -> Execute all steps in step 4 in sequence
- **Update mode**: Either document exists -> Perform the following gap analysis

#### Gap Analysis in Update Mode

Check the completeness of each section in the existing SALES_STRATEGY.md document:

| Section | Completeness Criteria |
|---|---|
| Elevator pitch | Contains specific content |
| Problems solved | Problem and solution are clearly stated |
| Target | Primary and secondary are specific by industry, scale, and role |
| Value proposition | Content is present |
| Track record / social proof | At least 1 specific achievement or number |
| Outreach mode | precision / volume is set |
| Sales channels | Channels and priority are specified |
| Sender information | Sender name, email address, and signature are all present |
| Messaging / email template | Template is defined |
| Response definition | Conditions that count as a response are specified |
| Notification settings | Content is present ("none" is also a valid setting) |
| KPI | Metrics are set |
| Search keywords | 10 or more |
| Environment & tool status | Status of each tool is recorded |

#### Check evaluate Improvement History

Retrieve improvement history:

Call `mcp__plugin_lead-ace_api__get_evaluation_history` with `projectId: "$0"`.

Based on results, classify each section into the following 3 categories:

| Category | Target Sections | How strategy handles it |
|---|---|---|
| **Not set** | Missing, empty, or incomplete sections | Subject to completion |
| **evaluate-managed** | Messaging, targeting, sales channels, KPI, search keywords (when evaluate has an improvement track record) | **Do not touch by default** |
| **Static settings** | Sender information, response definition, notification settings, track record, outreach mode, environment, etc. | Update only if user explicitly requests it |

If there is no evaluate improvement history (0 evaluations), treat all sections as "not set" or "static settings".

**Template update detection:** Compare section headings in the `tpl_sales_strategy` master document with the existing file. If a section exists in the template but not in the existing file, report it as "a section possibly added by an update".

#### Report to User and Confirm Policy

Report the current state to the user:
1. **Completed sections**: 1-line summary of each section
2. **evaluate-managed sections**: How many times evaluate has made improvements, summary of recent improvements. Note "These sections have accumulated data-driven improvements"
3. **Missing or incomplete sections**: Specifically state what's missing. Mention if sections may have been added by template updates
4. **BUSINESS.md overview**: Whether it exists, main content

Confirm policy with user:
- **"Fill in missing items"** (default recommendation): Only collect information for unset sections. Don't touch evaluate-managed sections
- **"Update specific sections"**: Only collect information for user-specified sections. If evaluate-managed sections are specified, warn "Accumulated improvements will be reset" and confirm
- **"Business pivot"**: For fundamental changes to business, product, or target. Reconstruct all sections including evaluate-managed ones (accumulated improvements will be reset)

**Reference other projects (initial mode only):** If projects other than `$0` exist (shown by list_projects), use `get_document` to read their `business` / `sales_strategy` documents. For second and subsequent project creation, existing project strategies can be referenced (target persona, channel selection, messaging structure, etc.). However, pay close attention to differences when the service or product differs -- don't copy carelessly. Inform the user of existing projects and confirm whether to reference them. (Not needed in update mode -- own project strategy is already established.)

### 4. Information Collection (Interactive, step by step)

Use AskUserQuestion to interactively collect the following information **one step at a time**.
Let the user know they can enter information casually in bullet points.

**Execution scope by mode:**
- **Initial mode**: Execute all steps below in sequence
- **Update mode (fill in missing items)**: Only execute steps corresponding to sections determined as unset in step 3. Skip completed and evaluate-managed steps
- **Update mode (update specific sections)**: Only execute steps corresponding to user-specified sections. Show existing values and confirm what changes
- **Update mode (business pivot)**: Execute all steps, but present existing values as defaults and ask "Any changes?" at each step. Retain if no changes

#### Basic Policy
- **Ask only 1-2 items per question**. Move to the next question after receiving an answer
- **Provide examples, choices, and recommendations for each question** to make it easy for the user to answer
- Build the next question based on the previous answer (context-aware follow-up)
- If user says "I don't know" or "up to you", reasonably infer based on industry best practices and general trends, propose it to the user, and adopt it after confirmation

#### Step 4-1: Business Overview
Question: Business/service/product overview (what the organization does, what to sell)
- Show examples: "Example: Provides SaaS attendance management system" "Example: Tax consulting service for small businesses"
- If vague: Follow up with "Specifically, what problem does it solve for what type of customer?"

#### Step 4-2: Target Customers
Question: Who do you want to sell to (industry, company size, role, characteristics)
- Use the business content from the previous step to give examples of typical target personas
  - Example: "For attendance management SaaS, HR managers or administrative staff at small companies with 50-300 employees are common targets"
- If "up to you": Infer the most rational target from the business content and propose

#### Step 4-3: Features, Differentiation, and Competition
Question: Service features, selling points, and differentiation from competitors
- Use information so far to give examples of likely competitors
  - Example: "In this field, X and Y are likely competitors -- what are your strengths?"
- May lightly research major competitors via WebSearch and use `fetch_url.py` to check page content from search results:
  ```bash
  python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "<URL>" --prompt "Extract this company's service content and features" --timeout 15
  ```
- If "up to you": Infer differentiation points from web research results and business content and propose

#### Step 4-4: Track Record / Social Proof
Question: Are there any specific track records, case studies, or numbers that can be included in emails?
- Show examples: "Number of companies using it", "Specific improvement numbers (cost reduction rate, time savings, sales increase, etc.)", "Customer testimonials", "Media coverage"
- Own usage track record also works (e.g., "Generated XX sales meetings per month using our own sales process")
- If "not yet available": Think together about estimated effects derivable from beta results or features, and include them. Even without any track record, prepare at least 1 trust foundation (e.g., "XX years of XX industry experience by founder", "Using XX technology", etc.)

#### Step 4-5: Pricing and Challenges
Question: Price range (or pricing structure) and current sales challenges or concerns
- Show typical pricing structure patterns as options
  - Example: "Monthly subscription / usage-based / initial fee + monthly / spot pricing are common -- which is closest to yours?"
- If "up to you": Research common price ranges in the industry and propose

#### Step 4-6: Prospect Discovery Sources
Question: What platforms and directories should be used to find prospect candidates? (Depends on your target market, industry, and region)
- Present examples organized by category:
  - Press release / news sites: PR Newswire, Business Wire, GlobeNewswire, TechCrunch, or country-specific equivalents
  - Company databases / directories: LinkedIn, Crunchbase, Apollo, ZoomInfo, industry association member lists
  - Startup / VC databases: Crunchbase, AngelList, PitchBook, Product Hunt (especially if targeting startups)
  - Trade show / event exhibitor lists (if applicable)
  - Country/region-specific directories (if applicable)
- If "up to you": Select reasonable defaults based on the user's target market (industry, country/region) and write selected sources into the "Prospect Discovery Sources" section of SALES_STRATEGY.md

#### Step 4-7: Sender Information
Question: Confirm the following in order (these are required for email sending)
- Organization's phone number (may be needed when filling in contact forms)
- Sender name (name displayed as email sender)
- Sender email address (account used to send sales emails)
- Signature information (organization name, full name, title, phone number, URL, etc.)
  - Show a common signature format example

These are required for outbound processing so "up to you" is not allowed. Must be obtained from the user.

#### Step 4-8: Scheduling and Response Definition
Question: Confirm the following
- Scheduling link (Calendly / Cal.com / HubSpot Meetings, etc. URL. "None" if not applicable)
  - "Do you use a scheduling tool? Calendly, Cal.com, HubSpot Meetings are popular options"
- Response definition: What counts as a "response"
  - Show options: "Common responses counted as 'responded': (1) Direct email reply (2) Scheduling completion notification (3) Reply via contact form. Is this OK? Add if there are others"
- Scheduling service name in use and notification sender email address
- If "up to you": Use (1)(2)(3) above as default for response definition

#### Step 4-9: Notification Settings
Question: Email address to receive daily-cycle completion notifications (or "none")
- "We can send you a daily report notification when the daily sales cycle completes. Please provide an email address if you'd like notifications"

### 5. Web Research (supplementary)

Supplement information obtained from the user with WebSearch for market and competitor information as needed. Use `fetch_url.py` to check page content from search results:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "<URL>" --prompt "<information to extract>" --timeout 15
```

### 6. Generate/Update BUSINESS.md

- **Initial mode**: Retrieve the template via `mcp__plugin_lead-ace_api__get_master_document` with `slug: "tpl_business"` and generate the document following its structure
- **Update mode**: Use the existing content from `get_document` and reflect only changed or added information. Keep sections without changes as-is

Save via `mcp__plugin_lead-ace_api__save_document` with `projectId: "$0"`, `slug: "business"`, and the full markdown content.

### 7. Generate/Update SALES_STRATEGY.md

- **Initial mode**: Retrieve the template via `mcp__plugin_lead-ace_api__get_master_document` with `slug: "tpl_sales_strategy"` and generate the document following its structure
- **Update mode**: Use the existing content from `get_document` and update only changed or added sections. Keep sections without changes as-is. Do not erase existing content unless the user explicitly instructs deletion. **Evaluate-managed sections (messaging, targeting, channels, KPI, search keywords) are only rewritten when the user explicitly instructs an update**

Also retrieve the following master documents via `mcp__plugin_lead-ace_api__get_master_document` to improve quality:

- **`tpl_targeting_guide`**: Target persona refinement, competitive analysis perspectives, USP articulation, channel selection criteria, KPI reverse calculation tree, search keyword design patterns
- **`tpl_email_templates`**: Email template selection based on target industry. Auto-select the optimal pattern based on user's industry information and customize to business info (USP, track record, pricing). Do not use templates as-is -- always add flesh based on user-specific information

**Reflect environment information:** Copy the environment status loaded in step 2 (from the `env_status` doc) into the "Environment & Tool Status" section verbatim — do not re-check or re-ask. If any tools are unavailable, also reflect in the "Sales Channels" section (e.g., if Gmail SaaS connection is unavailable, exclude email sending; if Chrome unavailable, exclude SNS).

Save via `mcp__plugin_lead-ace_api__save_document` with `projectId: "$0"`, `slug: "sales_strategy"`, and the full markdown content.

### 8. Completion Report

- **Initial mode**: Report an overview of the 2 generated documents and guide the user to run `/build-list` as the next step
- **Update mode**: Report a summary of what was updated. List updated and added sections in bullets
