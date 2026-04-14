---
name: build-list
description: "This skill should be used when the user asks to \"build a prospect list\", \"find prospects\", \"gather leads\", \"explore targets\", or wants to build a prospect list. Collects prospect candidates via web search based on BUSINESS.md and SALES_STRATEGY.md and registers them in the DB."
argument-hint: "<project-directory-name> [target-count=30]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Agent
  - WebSearch
  - mcp__plugin_lead-ace_api__get_prospect_identifiers
  - mcp__plugin_lead-ace_api__add_prospects
  - mcp__plugin_lead-ace_api__get_outbound_targets
---

# Build List - Prospect List Building

A skill that collects prospect candidates via web search based on the information in BUSINESS.md and SALES_STRATEGY.md, retrieves contact information, and registers them in the database.

**2-Phase Structure:**
- **Phase 1 (Candidate Collection):** Find prospect candidates broadly via web search (name, official URL, overview)
- **Phase 2 (Contact Retrieval):** Use sub-agents to explore each candidate's official site and retrieve email addresses and contact form URLs

## Phase 1: Candidate Collection

### 1. Setup

- Project directory name: `$0` (required)
- Target count: `$1` (default: 30. Approximate is fine -- "around N" is sufficient)

Load the following:
- `$0/BUSINESS.md`
- `$0/SALES_STRATEGY.md`

If either does not exist, guide the user to run `/strategy`.

### 2. Review Existing List and Search Notes

Before starting exploration, check these two things:

**2a. Retrieve registered prospects (for deduplication):**

Call `mcp__plugin_lead-ace_api__get_prospect_identifiers` with `projectId: "$0"`.

If the tool returns a "Project not found" error, instruct the user to run `/setup` first and **abort**.

Keep this result (list of name + websiteUrl + email + organizationId). During Phase 1 candidate collection, **do not include** any prospects already in this list. Match by exact name or website URL domain.

**2b. Search notes:**

If `$0/SEARCH_NOTES.md` exists, read it. It contains knowledge from previous explorations:
- Useful information source sites (not yet fully explored)
- Keywords and angles used in previous searches
- Directions to try next time

Use this to continue exploration from where the last session left off.

### 3. Search Strategy

Based on the "Search Keywords" and "Target" sections of SALES_STRATEGY.md, formulate multiple search queries.

Types of search queries (choose appropriate ones based on target type):
- Search by target industry + region
- Member lists of industry associations, federations
- Prospect collection from industry media and news sites
- Exhibitor lists from trade shows and events
- Client case studies from competitors
- Target exploration on job sites
- Directories or public databases of schools and corporations

### 4. Web Search Execution

Combine WebSearch and `fetch_url.py` (Jina Reader + Claude Haiku) to broadly collect prospect candidates.

**Use `fetch_url.py` for page retrieval (do not use WebFetch):**
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "https://example.com" --prompt "Extract company list" --timeout 15
```
Has timeout control so it won't freeze on unresponsive sites. Also handles SPA sites.

This phase focuses on **discovering candidates**. Contact information (email, form, etc.) is collected in Phase 2, so only gather the following here:

**Required (skip the candidate if missing):**
- Name (company name, school name, organization name, etc.)
- Business overview (what the organization does; 1-2 sentences summarized from the official site)
- Official site URL

**If available:**
- Industry or field
- Department or branch name (school name for school corporations, target department for large companies)
- Country (ISO 3166-1 alpha-2, e.g., "US", "JP", "GB")
- Email addresses or SNS accounts found incidentally during search (no need to look for these intentionally)
- Organization name: the legal entity name if it differs from the prospect name (e.g., a school corporation that operates multiple schools)

Skip any prospect for which the official site URL and business overview cannot be obtained.

**Search tips:**
- A single query finds limited prospects, so vary the angles broadly
- Use portal sites and listing pages to find many candidates at once
- Stop searching once the target count (`$1`, default 30) is reached. Deduplication rejections don't count (count only newly registered ones)
- No need to deep-dive individual official sites in this phase -- focus on securing a quantity of candidates

**Deep-diving when duplicates are frequent:**

As the list grows, well-known prospects appearing at the top of search results will already be registered, increasing duplicates. In that case, **rather than changing the target or strategy**, explore more deeply within the same target:

- Look beyond the top results to page 2, 3, and beyond
- Add regional qualifiers to keywords (e.g., "SaaS companies" -> "SaaS companies Portland", "SaaS companies Austin")
- Use synonyms and related terms (e.g., "consulting firm" -> "advisory firm", "management consultancy")
- Find industry-specific portal sites and directories and follow the prospects listed there
- Pick up prospects missed in listing pages
- Search for "competitors" or "similar services" of already-registered prospects to find new ones organically

When duplicates are rejected, treat it as a signal that "this direction has been exhausted" and **change the angle of exploration** (change how you search, not what you're targeting).

### 5. Priority and Match Reason Assessment

For each prospect, assign a match reason (why they're appropriate as a target, including their challenges and needs) and priority (1-5) based on SALES_STRATEGY.md criteria:
- 1: Top priority (perfectly matches target, needs are clear)
- 2: High priority (broadly matches target)
- 3: Standard (within target range)
- 4: Marginal (only partially meets criteria)
- 5: Under consideration (indirect possibility)

**Factor in email retrieval ease:** If the following signals are found during exploration, raise priority by 1 level for equal match quality (more email holders -> higher outbound success rate):
- Has press releases on press release distribution sites (high rate of PR contact email inclusion)
- Listed in startup DB or industry directory (more public information available)
- Email explicitly shown on official site (e.g., info@) discovered during exploration

## Phase 2: Contact Retrieval

### 6. Contact Retrieval via Sub-agents

Split Phase 1 candidates into **batches of 5** and launch a sub-agent for each batch to retrieve contact information.

Include the following in each sub-agent's prompt:
- List of assigned candidates (name, organization_name, website_url, overview, industry, department, country, match_reason, priority)
- Read `${CLAUDE_PLUGIN_ROOT}/skills/build-list/references/enrich-contacts.md` and follow its procedure
- Explore each candidate's official site to retrieve email addresses and contact form URLs
- Use `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url <URL> --prompt <instructions>` for page retrieval (do not use WebFetch)
- After completion, return the results as a JSON array

Sub-agent allowed-tools: `Bash`, `WebSearch`, `Read`

Each object in the JSON array returned by the sub-agent includes the Phase 1 information (name, organization_name, overview, website_url, industry, department, country, match_reason, priority) plus the retrieved contacts (email, contact_form_url, form_type, sns_accounts, contact_name).

### 6b. Re-search for Candidates Without Contact Info (only when applicable)

If Phase 2 results show candidates with both email / contact_form_url as null, try to supplement contact info from **sources other than the official site**.

For each such candidate, search WebSearch for:
- `"{company name}" email address`
- `"{company name}" contact`

Information may be found from industry directories, press release distribution sites, event speaker information, etc. If found, update the candidate's data.

**Limit:** Re-search up to a **maximum of 10 candidates** without contact info. Register the rest without contact info (they will be skipped during outbound).

## Phase 3: Registration

### 7. Database Registration

Call `mcp__plugin_lead-ace_api__add_prospects` with:
- `projectId`: "$0"
- `prospects`: array of prospect objects

**Field mapping for the MCP tool:**

For each prospect, construct the object as follows:
- `organizationDomain`: **Extract the apex domain from website_url** (e.g., `https://www.example.com/about` -> `example.com`). Strip `www.` prefix and path. This is the organization's primary key.
- `organizationName`: the legal entity name (or `name` if not separately available)
- `organizationNormalizedName`: **lowercase and trimmed** version of organizationName (e.g., "ABC Corp." -> "abc corp.")
- `organizationWebsiteUrl`: the organization's official website URL
- `organizationCountry`: ISO 3166-1 alpha-2 (optional)
- `organizationIndustry`: industry (optional)
- `organizationOverview`: business overview (optional)
- `name`: prospect name (company name, school name, department, etc.)
- `contactName`: contact person name (optional)
- `department`: department within the organization (optional)
- `overview`: business overview (1-2 sentences)
- `industry`: industry (optional)
- `websiteUrl`: the specific page URL for this prospect
- `email`: email address (optional)
- `contactFormUrl`: contact form URL (optional)
- `formType`: one of `google_forms`, `native_html`, `wordpress_cf7`, `iframe_embed`, `with_captcha` (optional)
- `snsAccounts`: `{ x?, linkedin?, instagram?, facebook? }` (optional)
- `matchReason`: why this prospect is a good target
- `priority`: 1-5 (default 3)

The server automatically deduplicates by email, contact form URL, and organization domain within the project.

**Difference between organizations and prospects:**
- `organizations` = **Legal entity** unit (apex domain is PK)
- `prospects` = **Prospect** unit (specific target within an organization)

Small company: organizationName = name (1:1, department is null)
School corporation operating multiple schools: organizationName = "Katayagi Gakuen School Corporation", name = "Nihon Kogakuin College" (1:many possible)
Department within large company: name = "ABC Corp.", department = "Sales Planning Dept."

### 8. Results Report

After DB registration, check reachable count:

Call `mcp__plugin_lead-ace_api__get_outbound_targets` with `projectId: "$0"` and `limit: 1` to get the `total` and `byChannel` summary.

Report the following:
- Number of newly registered prospects / target count
- **Reachable breakdown** (among newly registered: N with email, N with form, N SNS-only, N without contacts)
- Breakdown by priority
- Number rejected as duplicates (if many, briefly describe how the search angle was changed)
- Total project reachable remaining (from `total` field)
- Guide the user to run `/outbound` as the next step

### 9. Update Search Notes

Overwrite `$0/SEARCH_NOTES.md`. Record information useful for the next exploration in the following structure:

```markdown
# Search Notes
Last updated: YYYY-MM-DD

## Useful Sources
- (Portal sites or listing page URLs that haven't been fully explored yet)

## Keywords and Angles Used in Previous Search
- (Main search keywords and approaches used this time)

## Directions to Try Next Time
- (Search methods not attempted this time, regions or angles not yet explored)

## Notes
- (Areas with many duplicates, areas where prospects were found unexpectedly, insights for next time)
```

Overwrite, but if a `## Hints from evaluate` section already exists, preserve its content and carry it over to the end of the new SEARCH_NOTES.md (to preserve response pattern info added by evaluate).
