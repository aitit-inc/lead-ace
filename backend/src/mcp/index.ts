import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { verifySupabaseJwt } from '../auth/verify-jwt'
import {
  handleMetadata,
  handleResourceMetadata,
  handleRegister,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleToken,
} from './oauth'

type Env = {
  WEB_API_URL: string
  SUPABASE_JWT_SECRET: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  ENVIRONMENT: string
}

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
  const server = new McpServer({ name: 'lead-ace', version: '1.0.0' })

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
    'Create a new Lead Ace project. Returns an error if the free plan limit (1 project) is reached.',
    { projectId: z.string().describe('Project ID (alphanumeric, _ or -)') },
    async ({ projectId }) => {
      const { ok, data } = await callApi('POST', '/projects', { id: projectId }, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string; detail?: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}${err.detail ? ` — ${err.detail}` : ''}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: `Project "${projectId}" created successfully.` }] }
    },
  )

  // --- delete_project ---
  server.tool(
    'delete_project',
    'Delete a project and all its data (prospects, outreach logs, responses, evaluations).',
    { projectId: z.string().describe('Project ID to delete') },
    async ({ projectId }) => {
      const { ok, data } = await callApi('DELETE', `/projects/${projectId}`, null, apiUrl, authHeader)
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
    { projectId: z.string().describe('Project ID') },
    async ({ projectId }) => {
      const { ok, data } = await callApi('GET', `/projects/${projectId}/prospects/identifiers`, null, apiUrl, authHeader)
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
    'Batch register prospects into a project. Automatically deduplicates by email, contact form URL, and organization domain.',
    {
      projectId: z.string().describe('Project ID'),
      prospects: z.array(z.object({
        organizationDomain: z.string().describe('Apex domain of the organization (e.g. example.com)'),
        organizationName: z.string(),
        organizationNormalizedName: z.string().describe('Lowercase, trimmed name for dedup'),
        organizationWebsiteUrl: z.string().url(),
        organizationCountry: z.string().length(2).optional().describe('ISO 3166-1 alpha-2'),
        organizationIndustry: z.string().optional(),
        organizationOverview: z.string().optional(),
        name: z.string().describe('Prospect name (company, school, department, etc.)'),
        contactName: z.string().optional(),
        department: z.string().optional(),
        overview: z.string(),
        industry: z.string().optional(),
        websiteUrl: z.string().url(),
        email: z.string().email().optional(),
        contactFormUrl: z.string().url().optional(),
        formType: z.enum(['google_forms', 'native_html', 'wordpress_cf7', 'iframe_embed', 'with_captcha']).optional(),
        snsAccounts: z.object({
          x: z.string().optional(),
          linkedin: z.string().optional(),
          instagram: z.string().optional(),
          facebook: z.string().optional(),
        }).optional(),
        notes: z.string().optional(),
        matchReason: z.string().describe('Why this prospect is a good target'),
        priority: z.number().int().min(1).max(5).default(3),
      })).describe('Array of prospects to register (max 100)'),
    },
    async ({ projectId, prospects }) => {
      const { ok, data } = await callApi('POST', '/prospects/batch', { projectId, prospects }, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { inserted: number; skipped: number; insertedIds: number[]; skippedDetails: unknown[] }
      return {
        content: [{
          type: 'text' as const,
          text: `Registered: ${result.inserted}, Skipped: ${result.skipped}\nSkipped details: ${JSON.stringify(result.skippedDetails)}`,
        }],
      }
    },
  )

  // --- get_outbound_targets ---
  server.tool(
    'get_outbound_targets',
    'Get uncontacted prospects ordered by priority for outbound outreach.',
    {
      projectId: z.string(),
      limit: z.number().int().min(1).max(200).default(50).describe('Max number of prospects to return'),
    },
    async ({ projectId, limit }) => {
      const { ok, data } = await callApi('GET', `/projects/${projectId}/prospects/reachable?limit=${limit}`, null, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { prospects: unknown[]; total: number; byChannel: { email: number; formOnly: number; snsOnly: number } }
      return {
        content: [{
          type: 'text' as const,
          text: `Total reachable: ${result.total} (email: ${result.byChannel.email}, formOnly: ${result.byChannel.formOnly}, snsOnly: ${result.byChannel.snsOnly})\nReturned: ${result.prospects.length}\n${JSON.stringify(result.prospects, null, 2)}`,
        }],
      }
    },
  )

  // --- record_outreach ---
  server.tool(
    'record_outreach',
    'Record an outreach log entry after sending an email, form submission, or SNS DM. Updates prospect status to "contacted".',
    {
      projectId: z.string(),
      prospectId: z.number().int(),
      channel: z.enum(['email', 'form', 'sns_twitter', 'sns_linkedin']),
      subject: z.string().optional(),
      body: z.string(),
      status: z.enum(['sent', 'failed']).default('sent'),
      sentAt: z.string().datetime().optional().describe('ISO 8601 timestamp; defaults to now'),
      errorMessage: z.string().optional(),
    },
    async (input) => {
      const { ok, data } = await callApi('POST', '/outreach', input, apiUrl, authHeader)
      if (!ok) {
        const err = data as { error: string }
        return { content: [{ type: 'text' as const, text: `Error: ${err.error}` }], isError: true }
      }
      const result = data as { id: number }
      return { content: [{ type: 'text' as const, text: `Outreach logged (id: ${result.id}).` }] }
    },
  )

  // --- update_prospect_status ---
  server.tool(
    'update_prospect_status',
    'Update the status of a prospect in a project (e.g. mark as unreachable, inactive).',
    {
      projectId: z.string(),
      prospectId: z.number().int(),
      status: z.enum(['new', 'contacted', 'responded', 'converted', 'rejected', 'inactive', 'unreachable']),
    },
    async ({ projectId, prospectId, status }) => {
      const { ok, data } = await callApi(
        'PATCH',
        `/prospects/${prospectId}/status`,
        { projectId, status },
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

  // --- get_recent_outreach ---
  server.tool(
    'get_recent_outreach',
    'Get recent outreach logs for a project. Used by check-results to match Gmail/SNS replies to sent messages.',
    {
      projectId: z.string(),
      limit: z.number().int().min(1).max(200).default(100),
    },
    async ({ projectId, limit }) => {
      const { ok, data } = await callApi('GET', `/projects/${projectId}/outreach/recent?limit=${limit}`, null, apiUrl, authHeader)
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
    { projectId: z.string() },
    async ({ projectId }) => {
      const { ok, data } = await callApi('GET', `/projects/${projectId}/stats`, null, apiUrl, authHeader)
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
      projectId: z.string(),
      metrics: z.record(z.string(), z.unknown()).describe('Summary metrics (from get_eval_data, excluding respondedMessages/noResponseSample)'),
      findings: z.string().describe('Analysis findings text'),
      improvements: z.string().describe('Improvement actions applied (free text or JSON)'),
      priorityUpdates: z.array(z.object({
        industry: z.string(),
        priority: z.number().int().min(1).max(5),
      })).optional().describe('Bulk priority updates by industry'),
    },
    async (input) => {
      const { ok, data } = await callApi('POST', '/evaluations', input, apiUrl, authHeader)
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
    { projectId: z.string().describe('Project ID') },
    async ({ projectId }) => {
      const { ok, data } = await callApi('GET', `/projects/${projectId}/evaluations`, null, apiUrl, authHeader)
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
      projectId: z.string().describe('Project ID'),
      slug: z.string().describe('Document slug: "business", "sales_strategy", or "search_notes"'),
    },
    async ({ projectId, slug }) => {
      const { ok, status, data } = await callApi('GET', `/projects/${projectId}/documents/${slug}`, null, apiUrl, authHeader)
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
      projectId: z.string().describe('Project ID'),
      slug: z.string().describe('Document slug: "business", "sales_strategy", or "search_notes"'),
      content: z.string().describe('Full markdown content of the document'),
    },
    async ({ projectId, slug, content }) => {
      const { ok, data } = await callApi('PUT', `/projects/${projectId}/documents/${slug}`, { content }, apiUrl, authHeader)
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
      projectId: z.string().describe('Project ID'),
    },
    async ({ projectId }) => {
      const { ok, data } = await callApi('GET', `/projects/${projectId}/documents`, null, apiUrl, authHeader)
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
    return withCors(await handleRegister(request))
  }

  if (path === '/authorize') {
    if (request.method === 'GET') {
      return handleAuthorizeGet(request, baseUrl)
    }
    if (request.method === 'POST') {
      return withCors(await handleAuthorizePost(request, env.SUPABASE_URL, env.SUPABASE_ANON_KEY))
    }
  }

  if (path === '/token' && request.method === 'POST') {
    return withCors(await handleToken(request, env.SUPABASE_URL, env.SUPABASE_ANON_KEY))
  }

  // --- MCP endpoints (auth required) ---

  const userId = await extractUserId(request, env.SUPABASE_JWT_SECRET, env.SUPABASE_URL)
  if (!userId) {
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
