import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { verifySupabaseJwt } from '../auth/verify-jwt'
import { OUTBOUND_MODES } from '../db/schema'
import {
  handleMetadata,
  handleResourceMetadata,
  handleRegister,
  handleAuthorizeGet,
  handleAuthorizeSessionInfo,
  handleAuthorizeFinalize,
  handleToken,
  fingerprint,
} from './oauth'

type Env = {
  WEB_API_URL: string
  SUPABASE_JWT_SECRET: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  ENVIRONMENT: string
  FRONTEND_URL: string
  MCP_OAUTH_STORE: KVNamespace
}

// ---------------------------------------------------------------------------
// Version metadata
// ---------------------------------------------------------------------------
//
// SERVER_VERSION is informational — the deployed backend's own version.
// MIN_PLUGIN_VERSION is the gate: any plugin older than this MUST be told to
// run `/plugin update lead-ace@lead-ace` because backend behavior assumes the
// new plugin contract. Bump this **only when** introducing a backend change
// that the old plugin cannot tolerate (removed tool, renamed required arg,
// changed response shape). See .claude/rules/release.md.
const SERVER_VERSION = '1.0.0'
const MIN_PLUGIN_VERSION = '0.5.38'

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function extractUserId(request: Request, jwtSecret: string, supabaseUrl?: string): Promise<string | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  return verifySupabaseJwt(token, jwtSecret, supabaseUrl)
}

// ---------------------------------------------------------------------------
// API call helper
// ---------------------------------------------------------------------------

async function callApi(
  method: string,
  path: string,
  body: unknown,
  apiUrl: string,
  authHeader: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${apiUrl}/api${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })

  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

// Resolve a project reference (either name or internal id) to the canonical id.
// User-facing skills accept the project name; the backend uses auto-generated ids.
async function resolveProjectId(
  projectRef: string,
  apiUrl: string,
  authHeader: string,
): Promise<{ id: string | null; error?: string }> {
  const { ok, data } = await callApi('GET', '/projects', null, apiUrl, authHeader)
  if (!ok) {
    const err = data as { error?: string }
    return { id: null, error: err.error ?? 'Failed to list projects' }
  }
  const { projects } = data as { projects: Array<{ id: string; name: string }> }
  const match = projects.find((p) => p.id === projectRef || p.name === projectRef)
  if (!match) {
    return { id: null, error: `Project "${projectRef}" not found` }
  }
  return { id: match.id }
}

const formatTarget = (id?: string) => id ? `project ${id}` : 'tenant assets'

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
}

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders)) {
    newHeaders.set(k, v)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}

// ---------------------------------------------------------------------------
// MCP server factory (one instance per request for stateless Workers)
// ---------------------------------------------------------------------------

function createMcpServer(apiUrl: string, authHeader: string): McpServer {
  const server = new McpServer({ name: 'lead-ace', version: SERVER_VERSION })

  // --- get_server_version ---
  server.tool(
    'get_server_version',
    'Return the LeadAce backend MCP server version and the minimum compatible plugin version. Skills should call this first and abort with a "/plugin update" message if their plugin.json version is below minPluginVersion.',
    {},
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ serverVersion: SERVER_VERSION, minPluginVersion: MIN_PLUGIN_VERSION }),
        }],
      }
    },
  )

  // --- list_projects ---
  server.tool(
    'list_projects',
    'List all projects for the current user.',
    {},
    async () => {
      const { ok, data } = await callApi('GET', '/projects', null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const { projects } = data as { projects: unknown[] }
      return {
        content: [{
          type: 'text' as const,
          text: projects.length === 0
            ? 'No projects found.'
            : `${projects.length} project(s).\n${JSON.stringify(projects, null, 2)}`,
        }],
      }
    },
  )

  // --- setup_project ---
  server.tool(
    'setup_project',
    'Create a new LeadAce project. Returns the auto-generated project ID. Returns an error if the plan limit is reached.',
    { name: z.string().describe('Project name (unique per tenant)') },
    async ({ name }) => {
      const { ok, data } = await callApi('POST', '/projects', { name }, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string; detail?: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}${err.detail ? ` — ${err.detail}` : ''}` }], isError: true }
      }
      const result = data as { id: string; name: string }
      return { content: [{ type: 'text' as const, text: `Project "${name}" created (id: ${result.id}).` }] }
    },
  )

  // --- delete_project ---
  server.tool(
    'delete_project',
    'Delete a project and all its data (prospects, outreach logs, responses, evaluations).',
    { projectId: z.string().describe('Project name or ID') },
    async ({ projectId }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('DELETE', `/projects/${resolved.id}`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: `Project "${projectId}" deleted.` }] }
    },
  )

  // --- get_prospect_identifiers ---
  server.tool(
    'get_prospect_identifiers',
    'Get names, URLs, emails, and organization domains of all registered prospects in a project. Used to avoid duplicate registrations during build-list.',
    { projectId: z.string().describe('Project name or ID') },
    async ({ projectId }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('GET', `/projects/${resolved.id}/prospects/identifiers`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const { identifiers } = data as { identifiers: unknown[] }
      return {
        content: [{
          type: 'text' as const,
          text: `${identifiers.length} prospects registered.\n${JSON.stringify(identifiers, null, 2)}`,
        }],
      }
    },
  )

  // --- add_prospects ---
  server.tool(
    'add_prospects',
    'Batch register prospects. Automatically deduplicates by email, contact form URL, and (when projectId is given) organization domain within the project. projectId is optional: omit it to save prospects as tenant-only assets (no project link). When projectId is provided, every prospect must include matchReason. Set doNotContact=true on rows the source data marks as unsubscribed/opted-out so /build-list will not re-contact them later (DNC is a one-way ratchet on overwrite — false never clears an existing flag). Pair tenant-only imports with /match-prospects to link the right ones into a project later.',
    {
      projectId: z.string().optional().describe('Project name or ID. Omit to save prospects as tenant-only assets without linking to any project.'),
      prospects: z.array(z.object({
        organizationDomain: z.string().describe('Apex domain of the organization (e.g. example.com)'),
        organizationName: z.string(),
        organizationWebsiteUrl: z.url(),
        name: z.string().describe('Prospect name (company, school, department, etc.)'),
        contactName: z.string().optional(),
        department: z.string().optional(),
        overview: z.string(),
        industry: z.string().optional(),
        websiteUrl: z.url(),
        email: z.email().optional().describe('At least one contact channel required'),
        contactFormUrl: z.url().optional(),
        formType: z.enum(['google_forms', 'native_html', 'wordpress_cf7', 'iframe_embed', 'with_captcha']).optional(),
        snsAccounts: z.object({
          x: z.string().optional(),
          linkedin: z.string().optional(),
          instagram: z.string().optional(),
          facebook: z.string().optional(),
        }).optional(),
        notes: z.string().optional(),
        doNotContact: z.boolean().optional().describe('Mark this prospect as do-not-contact (unsubscribed / opted-out). Defaults to false. On overwrite, true sets the flag but false never clears an existing one.'),
        matchReason: z.string().optional().describe('Why this prospect is a good target. Required when projectId is set; ignored otherwise.'),
        priority: z.number().int().min(1).max(5).default(3),
      })).describe('Array of prospects to register (max 100)'),
    },
    async ({ projectId, prospects }) => {
      let resolvedId: string | undefined
      if (projectId) {
        const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
        if (!resolved.id) {
          return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
        }
        resolvedId = resolved.id
      }
      const { ok, data } = await callApi('POST', '/prospects/batch', { projectId: resolvedId, prospects }, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { inserted: number; skipped: number; insertedIds: number[]; skippedDetails: unknown[] }
      return {
        content: [{
          type: 'text' as const,
          text: `Registered (${formatTarget(resolvedId)}): ${result.inserted}, Skipped: ${result.skipped}\nSkipped details: ${JSON.stringify(result.skippedDetails)}`,
        }],
      }
    },
  )

  // --- import_prospects_from_csv ---
  server.tool(
    'import_prospects_from_csv',
    'Import prospects from a canonical CSV string. Required headers: organizationDomain, organizationName, organizationWebsiteUrl, name, overview, websiteUrl. matchReason is required only when projectId is provided. Optional headers: contactName, department, industry, email, contactFormUrl, formType, snsAccounts.x, snsAccounts.linkedin, snsAccounts.instagram, snsAccounts.facebook, notes, priority, doNotContact. At least one of email / contactFormUrl / snsAccounts.* per row. doNotContact accepts 1/true/yes/on (DNC) or 0/false/no/off (not DNC); empty cells are treated as not provided. Set it on rows the source marks as unsubscribed/opted-out so /build-list will not re-discover and contact them. On overwrite, doNotContact=true sets the flag on existing prospects; false (or column absent) never clears an existing flag (one-way ratchet). projectId is optional: omit it to save prospects as tenant-only assets (no project_prospects link is created — pair with /match-prospects to link them into a project later). dedupPolicy "skip" leaves existing prospects alone; "overwrite" updates prospect fields and (if projectId is given) re-links to that project. Existing prospects already flagged do_not_contact are always skipped (their record is preserved). Max 1000 data rows.',
    {
      projectId: z.string().optional().describe('Project name or ID. Omit to save prospects as tenant-only assets without linking to any project.'),
      csvText: z.string().describe('Full CSV text including header row'),
      dedupPolicy: z.enum(['skip', 'overwrite']).default('skip'),
    },
    async ({ projectId, csvText, dedupPolicy }) => {
      let resolvedId: string | undefined
      if (projectId) {
        const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
        if (!resolved.id) {
          return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
        }
        resolvedId = resolved.id
      }
      const { ok, data } = await callApi(
        'POST',
        '/prospects/import',
        { projectId: resolvedId, csvText, dedupPolicy },
        apiUrl,
        authHeader,
      )
      if (!ok) {
        const err = data as { error: string; detail?: string }
        const msg = err.detail ? `${err.error}: ${err.detail}` : err.error
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
      }
      const result = data as {
        inserted: number
        overwritten: number
        skipped: number
        errors: number
        skippedDetails: unknown[]
        errorDetails: unknown[]
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Imported (${formatTarget(resolvedId)}): ${result.inserted} new, ${result.overwritten} overwritten, ${result.skipped} skipped, ${result.errors} errors.\nSkipped: ${JSON.stringify(result.skippedDetails)}\nErrors: ${JSON.stringify(result.errorDetails)}`,
        }],
      }
    },
  )

  // --- get_outbound_targets ---
  server.tool(
    'get_outbound_targets',
    'Get uncontacted prospects ordered by priority for outbound outreach.',
    {
      projectId: z.string().describe('Project name or ID'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max number of prospects to return'),
    },
    async ({ projectId, limit }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('GET', `/projects/${resolved.id}/prospects/reachable?limit=${limit}`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      type QuotaWindow = { used: number; limit: number; remaining: number }
      const result = data as {
        prospects: unknown[]
        total: number
        byChannel: { email: number; formOnly: number; snsOnly: number }
        quota?: {
          remaining: number | null
          limit: number | null
          used: number
          plan: string
          bindingConstraint: 'daily' | 'lifetime' | 'monthly' | null
          daily?: QuotaWindow
          lifetime?: QuotaWindow
          monthly?: QuotaWindow
        }
        message?: string
      }

      const formatWindow = (label: string, w: QuotaWindow) =>
        `${label} ${w.remaining}/${w.limit} remaining (used ${w.used})`
      const quotaLine = (() => {
        if (!result.quota) return ''
        const q = result.quota
        if (q.remaining === null) return `\nOutreach quota: unlimited (plan: ${q.plan})`
        const parts: string[] = []
        if (q.daily) parts.push(formatWindow('daily', q.daily))
        if (q.lifetime) parts.push(formatWindow('lifetime', q.lifetime))
        if (q.monthly) parts.push(formatWindow('monthly', q.monthly))
        const summary = parts.length > 0 ? parts.join(', ') : `${q.remaining}/${q.limit} remaining (used ${q.used})`
        return `\nOutreach quota: ${summary} (plan: ${q.plan})`
      })()
      const msgLine = result.message ? `\n⚠️ ${result.message}` : ''

      return {
        content: [{
          type: 'text' as const,
          text: `Total reachable: ${result.total} (email: ${result.byChannel.email}, formOnly: ${result.byChannel.formOnly}, snsOnly: ${result.byChannel.snsOnly})${quotaLine}${msgLine}\nReturned: ${result.prospects.length}\n${JSON.stringify(result.prospects, null, 2)}`,
        }],
      }
    },
  )

  // --- record_outreach ---
  server.tool(
    'record_outreach',
    'Record an outreach log entry after sending an email, form submission, or SNS DM. In draft mode use status "pending_review" to store the composed email for later review in the LeadAce web app. Marks the prospect "contacted" except on failure.',
    {
      projectId: z.string().describe('Project name or ID'),
      prospectId: z.number().int(),
      channel: z.enum(['email', 'form', 'sns_twitter', 'sns_linkedin']),
      subject: z.string().optional(),
      body: z.string(),
      status: z.enum(['sent', 'failed', 'pending_review']).default('sent')
        .describe('"sent" = delivered. "failed" = send error. "pending_review" = draft created (outbound_mode = draft).'),
      sentAt: z.string().datetime().optional().describe('ISO 8601 timestamp; defaults to now'),
      errorMessage: z.string().optional(),
    },
    async (input) => {
      const resolved = await resolveProjectId(input.projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('POST', '/outreach', { ...input, projectId: resolved.id }, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { id: number }
      return { content: [{ type: 'text' as const, text: `Outreach logged (id: ${result.id}).` }] }
    },
  )

  // --- get_gmail_status ---
  server.tool(
    'get_gmail_status',
    'Check whether the current user has connected their Google account (gmail.send scope) via the LeadAce web app. Returns the connected Gmail address or an indication that Gmail is not connected.',
    {},
    async () => {
      const { ok, data } = await callApi('GET', '/auth/google-credentials/status', null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { connected: boolean; email?: string; grantedAt?: string; updatedAt?: string }
      const text = result.connected
        ? `Gmail connected as ${result.email} (granted: ${result.grantedAt}, last refreshed: ${result.updatedAt}).`
        : 'Gmail not connected. Have the user sign in at https://app.leadace.ai (Settings → Connect Google).'
      return { content: [{ type: 'text' as const, text }] }
    },
  )

  // --- send_email ---
  server.tool(
    'send_email',
    'Send an email via the user\'s connected Gmail account WITHOUT recording an outreach log. Use for internal notifications (e.g. daily-cycle start/wrap-up emails). For prospect outreach use send_email_and_record instead.',
    {
      to: z.array(z.email()).min(1),
      subject: z.string().min(1),
      body: z.string().min(1),
      cc: z.array(z.email()).optional(),
      bcc: z.array(z.email()).optional(),
      inReplyTo: z.string().optional(),
    },
    async (input) => {
      const { ok, data } = await callApi('POST', '/auth/send-email', input, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string; detail?: string }
        const msg = err.detail ? `${err.error}: ${err.detail}` : err.error
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
      }
      const result = data as { messageId: string; threadId: string }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Email sent (Gmail messageId: ${result.messageId}, threadId: ${result.threadId}).`,
          },
        ],
      }
    },
  )

  // --- send_email_and_record ---
  server.tool(
    'send_email_and_record',
    'Send an email via the user\'s connected Gmail account and record the outreach log atomically. Replaces the old gog send + record_outreach flow.',
    {
      projectId: z.string().describe('Project name or ID'),
      prospectId: z.number().int(),
      to: z.array(z.email()).min(1),
      subject: z.string().min(1),
      body: z.string().min(1),
      cc: z.array(z.email()).optional(),
      bcc: z.array(z.email()).optional(),
      inReplyTo: z.string().optional().describe('Gmail Message-Id header for threading'),
    },
    async (input) => {
      const resolved = await resolveProjectId(input.projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi(
        'POST',
        '/outreach/send-and-record',
        { ...input, projectId: resolved.id },
        apiUrl,
        authHeader,
      )
      if (!ok) {
        const err = data as { error: string; detail?: string }
        const msg = err.detail ? `${err.error}: ${err.detail}` : err.error
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
      }
      const result = data as { outreachId: number; messageId: string; threadId: string }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Email sent (Gmail messageId: ${result.messageId}, threadId: ${result.threadId}). Outreach logged (id: ${result.outreachId}).`,
          },
        ],
      }
    },
  )

  // --- update_prospect_status ---
  server.tool(
    'update_prospect_status',
    'Update the status of a prospect in a project (e.g. mark as inactive, rejected).',
    {
      projectId: z.string().describe('Project name or ID'),
      prospectId: z.number().int(),
      status: z.enum(['new', 'contacted', 'responded', 'converted', 'rejected', 'inactive']),
    },
    async ({ projectId, prospectId, status }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi(
        'PATCH',
        `/prospects/${prospectId}/status`,
        { projectId: resolved.id, status },
        apiUrl,
        authHeader,
      )
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: `Status updated to "${status}".` }] }
    },
  )

  // --- set_prospect_do_not_contact ---
  server.tool(
    'set_prospect_do_not_contact',
    'Toggle the do_not_contact flag on a tenant prospect. Use after /import-prospects when the source had no DNC column but you know certain rows are unsubscribed/opted-out, or for ad-hoc DNC management outside the response-recording flow. DNC prospects are excluded from /build-list re-discovery and from outbound targeting.',
    {
      prospectId: z.number().int(),
      doNotContact: z.boolean().describe('true to mark do-not-contact; false to clear the flag.'),
    },
    async ({ prospectId, doNotContact }) => {
      const { ok, data } = await callApi(
        'PATCH',
        `/prospects/${prospectId}/do-not-contact`,
        { doNotContact },
        apiUrl,
        authHeader,
      )
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: `Prospect ${prospectId}: do_not_contact = ${doNotContact}.` }] }
    },
  )

  // --- get_recent_outreach ---
  server.tool(
    'get_recent_outreach',
    'Get recent outreach logs for a project. Used by check-results to match Gmail/SNS replies to sent messages.',
    {
      projectId: z.string().describe('Project name or ID'),
      limit: z.number().int().min(1).max(200).default(100),
    },
    async ({ projectId, limit }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('GET', `/projects/${resolved.id}/outreach/recent?limit=${limit}`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const { logs } = data as { logs: unknown[] }
      return {
        content: [{
          type: 'text' as const,
          text: `${logs.length} recent outreach logs.\n${JSON.stringify(logs, null, 2)}`,
        }],
      }
    },
  )

  // --- record_response ---
  server.tool(
    'record_response',
    'Record a response (email reply, SNS DM, etc.) to an outreach. Updates prospect status and optionally marks do-not-contact.',
    {
      outreachLogId: z.number().int().describe('ID of the outreach log this response is for'),
      channel: z.enum(['email', 'form', 'sns_twitter', 'sns_linkedin']),
      content: z.string().describe('Response content'),
      sentiment: z.enum(['positive', 'neutral', 'negative']),
      responseType: z.enum(['reply', 'auto_reply', 'bounce', 'meeting_request', 'rejection']),
      receivedAt: z.string().datetime().optional(),
      markDoNotContact: z.boolean().default(false).describe('Set true for bounces or unsubscribes'),
    },
    async (input) => {
      const { ok, data } = await callApi('POST', '/responses', input, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { id: number }
      return { content: [{ type: 'text' as const, text: `Response recorded (id: ${result.id}).` }] }
    },
  )

  // --- get_eval_data ---
  server.tool(
    'get_eval_data',
    'Get evaluation statistics for a project: response rates, channel performance, sentiment breakdown, etc. Also returns responded message bodies and data sufficiency check.',
    { projectId: z.string().describe('Project name or ID') },
    async ({ projectId }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('GET', `/projects/${resolved.id}/stats`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
      }
    },
  )

  // --- record_evaluation ---
  server.tool(
    'record_evaluation',
    'Record an evaluation result and optionally bulk-update prospect priorities by industry.',
    {
      projectId: z.string().describe('Project name or ID'),
      metrics: z.record(z.string(), z.unknown()).describe('Summary metrics (from get_eval_data, excluding respondedMessages/noResponseSample)'),
      findings: z.string().describe('Analysis findings text'),
      improvements: z.string().describe('Improvement actions applied (free text or JSON)'),
      priorityUpdates: z.array(z.object({
        industry: z.string(),
        priority: z.number().int().min(1).max(5),
      })).optional().describe('Bulk priority updates by industry'),
    },
    async (input) => {
      const resolved = await resolveProjectId(input.projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('POST', '/evaluations', { ...input, projectId: resolved.id }, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { evaluationId: number; priorityUpdates: unknown[] }
      return {
        content: [{
          type: 'text' as const,
          text: `Evaluation recorded (id: ${result.evaluationId}). Priority updates: ${JSON.stringify(result.priorityUpdates)}`,
        }],
      }
    },
  )

  // --- get_evaluation_history ---
  server.tool(
    'get_evaluation_history',
    'Get past evaluation records for a project (findings, improvements, dates).',
    { projectId: z.string().describe('Project name or ID') },
    async ({ projectId }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('GET', `/projects/${resolved.id}/evaluations`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const { evaluations } = data as { evaluations: unknown[] }
      return {
        content: [{
          type: 'text' as const,
          text: evaluations.length === 0
            ? 'No evaluations recorded yet.'
            : `${evaluations.length} evaluation(s).\n${JSON.stringify(evaluations, null, 2)}`,
        }],
      }
    },
  )

  // --- get_document ---
  server.tool(
    'get_document',
    'Get the latest version of a project document (business, sales_strategy, search_notes).',
    {
      projectId: z.string().describe('Project name or ID'),
      slug: z.string().describe('Document slug: "business", "sales_strategy", or "search_notes"'),
    },
    async ({ projectId, slug }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, status, data } = await callApi('GET', `/projects/${resolved.id}/documents/${slug}`, null, apiUrl, authHeader)
      if (!ok) {
        if (status === 404) {
          return { content: [{ type: 'text' as const, text: `Document "${slug}" not found for project "${projectId}".` }] }
        }
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const doc = data as { id: number; slug: string; content: string; createdAt: string }
      return {
        content: [{ type: 'text' as const, text: doc.content }],
      }
    },
  )

  // --- save_document ---
  server.tool(
    'save_document',
    'Save a new version of a project document. Appends a new version (immutable); previous versions are preserved.',
    {
      projectId: z.string().describe('Project name or ID'),
      slug: z.string().describe('Document slug: "business", "sales_strategy", or "search_notes"'),
      content: z.string().describe('Full markdown content of the document'),
    },
    async ({ projectId, slug, content }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('PUT', `/projects/${resolved.id}/documents/${slug}`, { content }, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { id: number; slug: string; createdAt: string }
      return { content: [{ type: 'text' as const, text: `Document "${slug}" saved (version id: ${result.id}).` }] }
    },
  )

  // --- list_documents ---
  server.tool(
    'list_documents',
    'List all documents for a project with their last updated timestamps.',
    {
      projectId: z.string().describe('Project name or ID'),
    },
    async ({ projectId }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('GET', `/projects/${resolved.id}/documents`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const { documents } = data as { documents: Array<{ slug: string; updatedAt: string }> }
      if (documents.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No documents found.' }] }
      }
      return {
        content: [{
          type: 'text' as const,
          text: `${documents.length} document(s).\n${JSON.stringify(documents, null, 2)}`,
        }],
      }
    },
  )

  // --- get_master_document ---
  server.tool(
    'get_master_document',
    'Get a master document (shared templates, guidelines, frameworks) by slug.',
    {
      slug: z.string().describe('Master document slug (e.g. "tpl_business", "tpl_email_guidelines")'),
    },
    async ({ slug }) => {
      const { ok, status, data } = await callApi('GET', `/master-documents/${slug}`, null, apiUrl, authHeader)
      if (!ok) {
        if (status === 404) {
          return { content: [{ type: 'text' as const, text: `Master document "${slug}" not found.` }] }
        }
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const doc = data as { id: number; slug: string; content: string; version: number; updatedAt: string }
      return {
        content: [{ type: 'text' as const, text: doc.content }],
      }
    },
  )

  // --- list_master_documents ---
  server.tool(
    'list_master_documents',
    'List all available master documents (templates, guidelines, frameworks).',
    {},
    async () => {
      const { ok, data } = await callApi('GET', '/master-documents', null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const { documents } = data as { documents: Array<{ slug: string; version: number; updatedAt: string }> }
      if (documents.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No master documents found.' }] }
      }
      return {
        content: [{
          type: 'text' as const,
          text: `${documents.length} master document(s).\n${JSON.stringify(documents, null, 2)}`,
        }],
      }
    },
  )

  // --- list_tenant_prospects ---
  server.tool(
    'list_tenant_prospects',
    'List existing prospects across the entire tenant (every project the user owns). Use this in /match-prospects to find prospects gathered for past projects that may fit the current project. Excludes do-not-contact prospects. excludeProjectId omits prospects already linked to that project. q is a substring match on name / overview / industry / organization name. Returns up to 1000 rows.',
    {
      excludeProjectId: z.string().optional()
        .describe('Project name or ID — omit prospects already linked to this project'),
      q: z.string().optional().describe('Substring search on name / overview / industry / org name'),
      industry: z.string().optional().describe('Exact-match industry filter'),
      limit: z.number().int().min(1).max(1000).default(200),
    },
    async ({ excludeProjectId, q, industry, limit }) => {
      const params = new URLSearchParams()
      if (excludeProjectId) {
        const resolved = await resolveProjectId(excludeProjectId, apiUrl, authHeader)
        if (!resolved.id) {
          return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
        }
        params.set('excludeProjectId', resolved.id)
      }
      if (q) params.set('q', q)
      if (industry) params.set('industry', industry)
      params.set('limit', String(limit))

      const { ok, data } = await callApi('GET', `/tenant/prospects?${params.toString()}`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { prospects: unknown[]; total: number }
      return {
        content: [{
          type: 'text' as const,
          text: `${result.total} tenant prospect(s).\n${JSON.stringify(result.prospects, null, 2)}`,
        }],
      }
    },
  )

  // --- link_existing_prospects_to_project ---
  server.tool(
    'link_existing_prospects_to_project',
    'Link existing tenant prospects to a project by creating project_prospects junction rows. Does NOT create new prospects or organizations — pair with list_tenant_prospects to discover candidates first. Skips prospects flagged do_not_contact and reports prospects already linked. Use this in /match-prospects after the LLM picks targets and the user approves.',
    {
      projectId: z.string().describe('Project name or ID'),
      links: z.array(z.object({
        prospectId: z.number().int(),
        matchReason: z.string().min(1).describe('Why this prospect fits the current project'),
        priority: z.number().int().min(1).max(5).default(3),
      })).min(1).max(200),
    },
    async ({ projectId, links }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi(
        'POST',
        `/projects/${resolved.id}/prospects/link`,
        { links },
        apiUrl,
        authHeader,
      )
      if (!ok) {
        const err = data as { error: string; detail?: string }
        const msg = err.detail ? `${err.error}: ${err.detail}` : err.error
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
      }
      const result = data as {
        linked: number
        alreadyLinked: number
        skipped: number
        skippedDetails: unknown[]
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Linked: ${result.linked} new, ${result.alreadyLinked} already linked, ${result.skipped} skipped.\nSkipped: ${JSON.stringify(result.skippedDetails)}`,
        }],
      }
    },
  )

  // --- get_project_settings ---
  server.tool(
    'get_project_settings',
    'Get user-editable project settings (outboundMode, senderEmailAlias, senderDisplayName, unsubscribeEnabled). Returns defaults if no row exists yet. Skills should call this before strategy/outbound/daily-cycle to honor user-controlled behavior.',
    { projectId: z.string().describe('Project name or ID') },
    async ({ projectId }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('GET', `/projects/${resolved.id}/settings`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    },
  )

  // --- update_project_settings ---
  server.tool(
    'update_project_settings',
    'Update user-editable project settings. Any omitted field keeps its current value. Pass null to clear senderEmailAlias / senderDisplayName.',
    {
      projectId: z.string().describe('Project name or ID'),
      outboundMode: z.enum(OUTBOUND_MODES).optional()
        .describe('"send" = send immediately. "draft" = store as LeadAce drafts for review (user sends from app.leadace.ai/drafts).'),
      senderEmailAlias: z.email().nullable().optional()
        .describe('Gmail Send-As alias to use as From: address. null = primary Gmail.'),
      senderDisplayName: z.string().min(1).max(200).nullable().optional(),
      unsubscribeEnabled: z.boolean().optional()
        .describe('When true, outbound emails include an unsubscribe link + List-Unsubscribe header.'),
    },
    async ({ projectId, ...patch }) => {
      const resolved = await resolveProjectId(projectId, apiUrl, authHeader)
      if (!resolved.id) {
        return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }], isError: true }
      }
      const { ok, data } = await callApi('PUT', `/projects/${resolved.id}/settings`, patch, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    },
  )

  return server
}

// ---------------------------------------------------------------------------
// Cloudflare Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env)
    } catch (e) {
      console.error('Unhandled error:', e)
      return withCors(Response.json(
        { error: 'Internal server error', detail: e instanceof Error ? e.message : undefined },
        { status: 500 },
      ))
    }
  },
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const baseUrl = url.origin

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // --- OAuth endpoints (no auth required) ---

  if (path === '/.well-known/oauth-authorization-server') {
    return withCors(handleMetadata(baseUrl))
  }

  if (path === '/.well-known/oauth-protected-resource') {
    return withCors(handleResourceMetadata(baseUrl))
  }

  if (path === '/register' && request.method === 'POST') {
    return withCors(await handleRegister(request, env.MCP_OAUTH_STORE))
  }

  if (path === '/authorize' && request.method === 'GET') {
    return await handleAuthorizeGet(request, env.MCP_OAUTH_STORE, env.FRONTEND_URL)
  }

  if (path === '/authorize/session' && request.method === 'GET') {
    return withCors(await handleAuthorizeSessionInfo(request, env.MCP_OAUTH_STORE))
  }

  if (path === '/authorize/finalize' && request.method === 'POST') {
    return withCors(
      await handleAuthorizeFinalize(request, env.MCP_OAUTH_STORE, env.SUPABASE_JWT_SECRET, env.SUPABASE_URL),
    )
  }

  if (path === '/token' && request.method === 'POST') {
    return withCors(await handleToken(request, env.MCP_OAUTH_STORE, env.SUPABASE_JWT_SECRET))
  }

  // --- MCP endpoints (auth required) ---

  const authHeaderRaw = request.headers.get('Authorization')
  const userId = await extractUserId(request, env.SUPABASE_JWT_SECRET, env.SUPABASE_URL)
  if (!userId) {
    const hasBearer = authHeaderRaw?.startsWith('Bearer ') ?? false
    let accessFp: string | null = null
    let exp: number | null = null
    let nowGap: number | null = null
    if (hasBearer) {
      const token = authHeaderRaw!.slice(7)
      accessFp = await fingerprint(token)
      // Best-effort decode of exp claim without verification (verification already failed above).
      try {
        const parts = token.split('.')
        if (parts.length === 3 && parts[1]) {
          const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
          const claims = JSON.parse(payloadJson) as { exp?: number }
          if (typeof claims.exp === 'number') {
            exp = claims.exp
            nowGap = Math.floor(Date.now() / 1000) - claims.exp
          }
        }
      } catch {
        // ignore
      }
    }
    console.log('[mcp.auth] 401', { path, method: request.method, hasBearer, accessFp, exp, nowGap })
    return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      },
    }))
  }

  // Reject GET/DELETE on MCP path — stateless mode does not support SSE streams,
  // and Workers cannot keep long-lived connections. Only POST is needed.
  if (request.method !== 'POST') {
    return withCors(Response.json(
      { error: 'Method not allowed. Use POST for MCP requests.' },
      { status: 405 },
    ))
  }

  const authHeader = request.headers.get('Authorization') ?? ''
  const server = createMcpServer(env.WEB_API_URL, authHeader)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // Return JSON instead of SSE streams (Workers compat)
  })

  await server.connect(transport)
  return withCors(await transport.handleRequest(request))
}
