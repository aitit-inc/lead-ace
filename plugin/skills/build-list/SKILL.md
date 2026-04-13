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
---

# Build List - Prospect List Building

A skill that collects prospect candidates via web search based on the information in BUSINESS.md and SALES_STRATEGY.md, retrieves contact information, and registers them in the database.

**Prerequisite:** Follow the conventions in `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` (data.db location and no-cd rule).

**2-Phase Structure:**
- **Phase 1 (Candidate Collection):** Find prospect candidates broadly via web search (name, official URL, overview)
- **Phase 2 (Contact Retrieval):** Use sub-agents to explore each candidate's official site and retrieve email addresses and contact form URLs

## Phase 0: Prerequisites Check

### 0. Preflight Check

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

If `status` is `error`, display the error message and **abort immediately**. Report any migrations in `migrations_applied` to the user.

## Phase 1: Candidate Collection

### 1. Setup

- Project directory name: `$0` (required)
- Target count: `$1` (default: 30. Approximate is fine — "around N" is sufficient)

Load the following:
- `$0/BUSINESS.md`
- `$0/SALES_STRATEGY.md`

If either does not exist, guide the user to run `/strategy`.

### 2. Review Existing List and Search Notes

Before starting exploration, check these two things:

**2a. Retrieve registered prospects (for deduplication):**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db all-prospect-identifiers "$0"
```

Keep this result (list of name + website_url). During Phase 1 candidate collection, **do not include** any prospects already in this list. Match by exact name or website_url domain.

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
- Corporate number (13 digits) — obtained via the corporate number search described below
- Business overview (what the organization does; 1-2 sentences summarized from the official site)
- Official site URL

**If available:**
- Industry or field
- Department or branch name (school name for school corporations, target department for large companies)
- Email addresses or SNS accounts found incidentally during search (no need to look for these intentionally)

Skip any prospect for which the official site URL and business overview cannot be obtained.

**Corporate number search (required for each candidate):**

After collecting candidates, retrieve corporate numbers for those that don't have one yet:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/check_corporate_number.py "{company name}"
```

JSON is output to stdout. Retrieve `number` (corporate number) and `name` (official legal name) from the `results` array.
- 1 result → use `number` as `corporate_number`, `name` as `organization_name`
- Multiple results → identify the correct candidate by cross-referencing address and official site information. If uncertain, verify with WebSearch + fetch_url.py
- 0 results → retry by removing legal entity type from the name or using the kana reading (`--kana`)

Do not include candidates for which a corporate number cannot be found (they cannot be registered since organizations table uses corporate number as PK).

**Note:** `organization_name` is the official legal name confirmed at NTA (e.g., "学校法人片柳学園" / "Katayagi Gakuen School Corporation"), which may differ from the prospect name (`name`, e.g., "日本工学院専門学校" / "Nihon Kogakuin College").

**Search tips:**
- A single query finds limited prospects, so vary the angles broadly
- Use portal sites and listing pages to find many candidates at once
- Stop searching once the target count (`$1`, default 30) is reached. Deduplication rejections don't count (count only newly registered ones)
- No need to deep-dive individual official sites in this phase — focus on securing a quantity of candidates

**Deep-diving when duplicates are frequent:**

As the list grows, well-known prospects appearing at the top of search results will already be registered, increasing duplicates. In that case, **rather than changing the target or strategy**, explore more deeply within the same target:

- Look beyond the top results to page 2, 3, and beyond
- Add regional qualifiers to keywords (e.g., "SaaS companies" → "SaaS companies Fukuoka", "SaaS companies Nagoya")
- Use synonyms and related terms (e.g., "cram school" → "prep school", "individual tutoring", "prep academy")
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

**Factor in email retrieval ease:** If the following signals are found during exploration, raise priority by 1 level for equal match quality (more email holders → higher outbound success rate):
- Has press releases on press release distribution sites (high rate of PR contact email inclusion)
- Listed in startup DB or industry directory (more public information available)
- Email explicitly shown on official site (e.g., info@) discovered during exploration

## Phase 2: Contact Retrieval

### 6. Contact Retrieval via Sub-agents

Split Phase 1 candidates into **batches of 5** and launch a sub-agent for each batch to retrieve contact information.

Include the following in each sub-agent's prompt:
- List of assigned candidates (name, organization_name, corporate_number, website_url, overview, industry, department, match_reason, priority)
- Read `${CLAUDE_PLUGIN_ROOT}/skills/build-list/references/enrich-contacts.md` and follow its procedure
- Explore each candidate's official site to retrieve email addresses and contact form URLs
- Use `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url <URL> --prompt <instructions>` for page retrieval (do not use WebFetch)
- After completion, return the results as a JSON array

Sub-agent allowed-tools: `Bash`, `WebSearch`, `Read`

Each object in the JSON array returned by the sub-agent includes the Phase 1 information (name, organization_name, corporate_number, overview, website_url, industry, department, match_reason, priority) plus the retrieved contacts (email, contact_form_url, sns_accounts).

### 6b. Re-search for Candidates Without Contact Info (only when applicable)

If Phase 2 results show candidates with both email / contact_form_url as null, try to supplement contact info from **sources other than the official site**.

For each such candidate, search WebSearch for:
- `"{company name}" email address`
- `"{company name}" contact`

Information may be found from industry directories, press release distribution sites, event speaker information, etc. If found, update the candidate's JSON.

**Limit:** Re-search up to a **maximum of 10 candidates** without contact info. Register the rest without contact info (they will be skipped during outbound).

## Phase 3: Registration

### 7. Database Registration

Merge Phase 1 candidate information and Phase 2 contact information using `merge_prospects.py`, then register in the DB with `add_prospects.py`.

First, save the Phase 1 candidate list (without contact info) and all Phase 2 batch results (with contact info) to separate JSON files:
- Phase 1 candidates → `/tmp/candidates.json`
- Combine all Phase 2 batch results into a single JSON array → `/tmp/contacts.json`

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/merge_prospects.py /tmp/candidates.json /tmp/contacts.json \
  | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/add_prospects.py data.db "$0"
```

Merge is matched by name + website_url domain. Candidates without contact info are also registered (with email=null, etc.). Unmatched count from merging is output to stderr.

**If the sub-agent output is already in a format passable directly to add_prospects.py** (complete JSON including all Phase 1 fields + contacts), you can skip the merge script and pass it directly:

```bash
cat <<'EOF' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/add_prospects.py data.db "$0"
[
  {
    "name": "Prospect name (school name, company name, etc.)",
    "organization_name": "Official legal name (result from check_corporate_number.py)",
    "corporate_number": "1234567890123",
    "department": null,
    "overview": "Business overview (1-2 sentences)",
    "website_url": "https://example.com",
    "industry": "Industry",
    "email": "info@example.com",
    "contact_form_url": null,
    "sns_accounts": {"x": "@account"},
    "match_reason": "Reason why appropriate as a target (including challenges and needs)",
    "priority": 3
  }
]
EOF
```

**Difference between organizations and prospects:**
- `organizations` = **Legal entity** unit (corporate number is PK). The official legal name confirmed via `check_corporate_number.py` is auto-registered
- `prospects` = **Prospect** unit. Put the actual prospect name in `name`. `department` is the department within the prospect (if any)

Small company: org.name = pros.name (1:1, department is null)
School corporation: org.name = "学校法人片柳学園", pros.name = "日本工学院専門学校" (1:many possible)
Department within large company: org.name = "ABC Corp.", pros.name = "ABC Corp.", department = "Sales Planning Dept."

```json
{
  "name": "Nihon Kogakuin College",
  "organization_name": "Katayagi Gakuen School Corporation",
  "corporate_number": "9010805001803",
  "department": null,
  ...
}
```

**Field details:**
- Required: `name` (prospect name), `organization_name` (official legal name), `corporate_number`, `overview`, `website_url`, `match_reason`
- Optional: `department`, `industry`, `email`, `contact_form_url`, `sns_accounts`
- `priority`: defaults to 3 if omitted

**Script behavior:**
- Automatically checks for duplicates on each entry (in order: corporate number → email → form URL → SNS → name → domain)
- `corporate_number` is required. Organizations table is auto-upserted
- `email` / `contact_form_url` have global UNIQUE constraints to prevent double-sending
- `EXACT_MATCH`: Uses existing prospect_id and only adds the project_prospects link
- `POSSIBLE_MATCH` (domain match, etc.): Registers as new but reports as `possible_matches` in output
- No match: Registers as new
- Processes all entries in a single transaction. Validation errors on individual entries continue processing, but DB exceptions roll back all entries

**If only linking an existing prospect to another project:**

Specify `existing_prospect_id` to skip new prospect registration and only add the link:
```json
{"existing_prospect_id": 42, "match_reason": "Reason", "priority": 2}
```

### 8. Results Report

After DB registration, check reachable count:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
```

Report the following:
- Number of newly registered prospects / target count
- **Reachable breakdown** (among newly registered: N with email, N with form, N SNS-only, N without contacts)
- Breakdown by priority
- Number rejected as duplicates (if many, briefly describe how the search angle was changed)
- Total project reachable remaining (result of count-reachable)
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
