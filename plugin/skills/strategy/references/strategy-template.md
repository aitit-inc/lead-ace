# SALES_STRATEGY.md Template

Generate `<project-dir>/SALES_STRATEGY.md` with the following structure:

```markdown
# Sales & Marketing Strategy

## Elevator Pitch
(A one-liner that can be delivered in 30 seconds)

## Problems Solved
(The challenges your target faces and how you solve them)

## Target
### Primary Target
(Industry/domain, size, role, characteristics)
### Secondary Target

## Value Proposition
(Why customers should choose you)

## Track Record / Social Proof
(Specific track records, numbers, and case studies that can be referenced in emails. Prepare at least one.)

Examples:
- Adoption: "Deployed at XX companies", "Currently piloting at X companies in beta"
- Outcome numbers: "Generate XX leads per month", "Reduced sales workload by XX hours/week", "Reduced cost by XX%"
- Customer testimonials: "○○ was improved" (with permission)
- Own track record: "Used in our own sales process, resulting in XX meetings booked"
- Awards/media: "Winner of ○○ Award", "Featured in ○○"

※ Even at an early stage with no case studies yet, include estimated effects based on self-usage track records or feature capabilities

## Outreach Mode

Set one of the following. Choose based on the project's goals and target.

- **precision** — High-value, targeted approach. Deep personalization referencing specific news, job postings, funding rounds, and initiatives for each prospect. No expense spared per contact; maximize response rate. Best for high-value targets
- **volume** — Efficiency-focused. Semi-personalized based on company name, industry, and business overview. Use the email template in SALES_STRATEGY.md as a base, adjusting the opening and problem framing per prospect. Best for broad market testing and awareness building

Default: `precision`

## Sales Channels
(Channels to use and their priority. Explicitly state any channels not in use.)

Default priority: Email → Form → SNS DM
Examples:
- Email only
- Email → Form (no SNS)
- Email → Form → SNS DM (default)
- SNS DM → Email → Form (SNS-first approach)

## Sender Information
- Sender name: (Name displayed as email sender)
- Sender email address: (Used for gog send --account)
- Signature: (Signature block appended to emails. Organization name, full name, title, phone number, URL, etc.)
- Scheduling link: (Timerex or similar URL. Used in CTAs if available.)

## Messaging
### First Outreach (Email/Form)
(Template-like structure: subject line patterns, opening hook, problem framing, solution presentation, CTA)
### Email Template
The following is a reference template for first outreach emails. Customize for each prospect.

```
Subject: {specific subject line that addresses the recipient's challenge}

{Recipient's organization name}

{Opening: 1-2 lines on why you're reaching out}

{Problem framing: 2-3 lines on the specific challenge the recipient likely faces}

{Solution: 2-3 lines on how your service solves it}

{Track record / proof: 1-2 lines with numbers or case studies if available}

{CTA: Include scheduling link here if available}

{Signature}
```
### SNS Messages
(Short and concise. Self-introduction → value proposition → action)
- SNS used: (X / LinkedIn / Both)
- **Prerequisite:** If using SNS DMs, log into each SNS account in Chrome beforehand

## Response Definition
- What counts as a response: (Direct email reply, scheduling completion notification, reply via contact form, etc.)
- Scheduling service in use: (Service name and notification sender email. Example: Timerex — notifications@timerex.net)
- Other response signals: (Notifications from specific services, etc. List if applicable.)

## Notification Settings
- daily-cycle completion notification recipient: (Email address to receive completion reports. "None" if not needed.)

## KPI
(Metrics to track: number of sends, open rate, response rate, meeting conversion rate, etc.)

## Search Keywords
(Keyword list for finding prospects. Industry names, service categories, related terms, etc.)

## Environment & Tool Status
- python3: ✅ or ❌
- git (remote): ✅ or ❌ (❌ means risk of data loss)
- gog CLI: ✅ or ❌ (❌ means email auto-sending not available)
- Gmail MCP: ✅ or ❌ (❌ means reply checking and draft creation not available)
- playwright-cli: ✅ or ❌ (❌ means form submission not available)
- Claude in Chrome: ✅ or ❌ (❌ means SNS DMs not available)
- Available channels: (Auto-determined from tool status above. Example: "Email (draft only), Form")
```

**Generation guidelines:**
- Keep the elevator pitch specific and concise. Avoid jargon; make it easy to understand
- Make targets as specific as possible (not "small businesses" but "SaaS companies with 50-200 employees"; not "schools" but "private middle-high schools in the Greater Tokyo area")
- Structure messaging to lead with recipient benefits
- List at least 10 search keywords
