import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, sql, gte, isNotNull, ilike } from 'drizzle-orm'
import {
  projects,
  outreachLogs,
  responses,
  projectProspects,
  prospects,
  organizations,
  sentimentEnum,
  responseTypeEnum,
  channelEnum,
  REJECTION_PRIMARY_REASONS,
  REJECTION_RECONTACT_WINDOWS,
  type RejectionFeedbackV1,
  type RejectionPrimaryReason,
  type RejectionRecontactWindow,
} from '../../db/schema'
import type { Env, Variables } from '../types'
import type { Db } from '../../db/connection'

// Typed sentinels so SQL literals stay in sync with the schema enums (a rename
// in REJECTION_PRIMARY_REASONS would otherwise leave these strings as silent
// 0-row filters with no compile error).
const FEATURE_GAP_REASON: RejectionPrimaryReason = 'feature_gap'
const NOT_RELEVANT_REASON: RejectionPrimaryReason = 'not_relevant'
const PMF_RELEVANT_REASONS: readonly RejectionPrimaryReason[] = ['feature_gap', 'already_have_solution', 'competitor_locked']
const REAPPROACH_WINDOWS: readonly RejectionRecontactWindow[] = ['3_months', '6_months', '12_months']
const DECISION_MAKER_LIMIT = 50

const REJECTION_SCOPES = ['pmf', 'tactical', 'all'] as const
type RejectionScope = typeof REJECTION_SCOPES[number]

function clampInt(raw: string | undefined, min: number, max: number): number | null {
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return null
  return Math.max(min, Math.min(n, max))
}

const rejectionFeedbackSchema = z.object({
  version: z.literal(1),
  primary_reason: z.enum(REJECTION_PRIMARY_REASONS),
  secondary_reasons: z.array(z.enum(REJECTION_PRIMARY_REASONS)).max(5).optional(),
  free_text: z.string().max(500).optional(),
  decision_maker_pointer: z.object({
    name: z.string().max(200).optional(),
    email: z.email().max(320).optional(),
    role: z.string().max(200).optional(),
  }).optional(),
  preferred_recontact_window: z.enum(REJECTION_RECONTACT_WINDOWS).optional(),
  consent: z.object({
    gdpr_erasure_request: z.boolean().optional(),
    ccpa_opt_out: z.boolean().optional(),
    marketing_opt_out: z.boolean().optional(),
  }).optional(),
  submitted_at: z.iso.datetime(),
  tenant_signature: z.string().optional(),
})

const recordResponseSchema = z.object({
  outreachLogId: z.number().int().positive(),
  channel: z.enum(channelEnum.enumValues),
  content: z.string().min(1),
  sentiment: z.enum(sentimentEnum.enumValues),
  responseType: z.enum(responseTypeEnum.enumValues),
  receivedAt: z.iso.datetime().optional(),
  // If true, mark the prospect as do_not_contact across all projects
  markDoNotContact: z.boolean().default(false),
  rejectionFeedback: rejectionFeedbackSchema.optional(),
})

// Returns true if the rejection feedback indicates a hard opt-out that must
// flip do_not_contact regardless of the markDoNotContact flag the caller passed.
function feedbackForcesDoNotContact(fb: RejectionFeedbackV1): boolean {
  return (
    fb.primary_reason === 'unsubscribe_request' ||
    fb.preferred_recontact_window === 'never' ||
    fb.consent?.gdpr_erasure_request === true ||
    fb.consent?.ccpa_opt_out === true ||
    fb.consent?.marketing_opt_out === true
  )
}

// Reapproach signal: a rejection that's conditional on time, not preference.
// The prospect should be re-eligible for outreach once the window passes,
// so we set prospects.next_outreach_after and put project_prospects into
// 'deferred' (a distinct status from 'new' so we don't conflate "never
// contacted" with "contacted, waiting").
const REAPPROACH_REASONS: readonly RejectionPrimaryReason[] = ['wrong_timing', 'budget']
const REAPPROACH_WINDOW_MONTHS: Record<RejectionRecontactWindow, number | null> = {
  never: null,
  '3_months': 3,
  '6_months': 6,
  '12_months': 12,
  unspecified: null,
}

function reapproachWindowMonths(fb: RejectionFeedbackV1): number | null {
  if (!REAPPROACH_REASONS.includes(fb.primary_reason)) return null
  if (!fb.preferred_recontact_window) return null
  return REAPPROACH_WINDOW_MONTHS[fb.preferred_recontact_window]
}

type DerivedProspectAction = 'created' | 'matched_existing'

type DerivedProspect = {
  id: number
  name: string
  action: DerivedProspectAction
}

// Materialise a decision_maker_pointer into an actual prospect row.
//
// Dedup ladder:
//   1. pointer.email → search by (tenant, email). DNC blocks any update.
//      - hit → fill missing contactName/department only; never overwrite
//      - miss → create a new prospect, inheriting org/overview/websiteUrl/industry
//        from the referring prospect, and link it to every project the
//        referring prospect is in (priority preserved per-link)
//   2. pointer.email absent + pointer.name → search by (tenant, organizationId,
//      contactName ILIKE name). Hit fills missing department. Miss is a no-op
//      because a contact-channel-less prospect would violate the schema refine.
//   3. neither → no-op.
//
// Self-references (pointer matches the referring prospect's own email or
// contactName) are skipped to avoid recursive defer/role-flip loops.
async function derivePointerProspect(
  db: Db,
  tenantId: string,
  referringProspectId: number,
  pointer: { name?: string; email?: string; role?: string },
  now: Date,
): Promise<DerivedProspect | null> {
  const pointerName = pointer.name?.trim() || null
  const pointerEmail = pointer.email?.trim() || null
  const pointerRole = pointer.role?.trim() || null

  if (!pointerName && !pointerEmail) return null

  const [referring] = await db
    .select({
      id: prospects.id,
      name: prospects.name,
      contactName: prospects.contactName,
      organizationId: prospects.organizationId,
      overview: prospects.overview,
      websiteUrl: prospects.websiteUrl,
      industry: prospects.industry,
      email: prospects.email,
    })
    .from(prospects)
    .where(eq(prospects.id, referringProspectId))
    .limit(1)

  if (!referring) return null

  if (pointerEmail && referring.email === pointerEmail) return null
  if (pointerName && referring.contactName && referring.contactName.toLowerCase() === pointerName.toLowerCase()) return null

  if (pointerEmail) {
    const [existing] = await db
      .select({
        id: prospects.id,
        name: prospects.name,
        contactName: prospects.contactName,
        department: prospects.department,
        doNotContact: prospects.doNotContact,
      })
      .from(prospects)
      .where(and(eq(prospects.tenantId, tenantId), eq(prospects.email, pointerEmail)))
      .limit(1)

    if (existing) {
      if (existing.doNotContact) return null
      const patch: { contactName?: string; department?: string; updatedAt?: Date } = {}
      if (!existing.contactName && pointerName) patch.contactName = pointerName
      if (!existing.department && pointerRole) patch.department = pointerRole
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = now
        await db.update(prospects).set(patch).where(eq(prospects.id, existing.id))
      }
      return { id: existing.id, name: existing.name, action: 'matched_existing' }
    }

    return await createDerivedProspect(db, tenantId, referring, {
      name: pointerName,
      email: pointerEmail,
      role: pointerRole,
    }, now)
  }

  // pointer.email absent — only update an existing same-org contactName match.
  // Cannot create: schema requires at least one contact channel and we have none.
  const [existing] = await db
    .select({
      id: prospects.id,
      name: prospects.name,
      department: prospects.department,
      doNotContact: prospects.doNotContact,
    })
    .from(prospects)
    .where(
      and(
        eq(prospects.tenantId, tenantId),
        eq(prospects.organizationId, referring.organizationId),
        ilike(prospects.contactName, pointerName!),
      ),
    )
    .limit(1)

  if (!existing) return null
  if (existing.doNotContact) return null
  if (!existing.department && pointerRole) {
    await db.update(prospects).set({ department: pointerRole, updatedAt: now }).where(eq(prospects.id, existing.id))
  }
  return { id: existing.id, name: existing.name, action: 'matched_existing' }
}

async function createDerivedProspect(
  db: Db,
  tenantId: string,
  referring: {
    id: number
    name: string
    organizationId: number
    overview: string
    websiteUrl: string
    industry: string | null
  },
  pointer: { name: string | null; email: string; role: string | null },
  now: Date,
): Promise<DerivedProspect> {
  const dateStr = now.toISOString().slice(0, 10)
  const newName = pointer.name ?? (pointer.role ? `${pointer.role} (${referring.name})` : pointer.email)
  const [created] = await db
    .insert(prospects)
    .values({
      tenantId,
      name: newName,
      contactName: pointer.name,
      organizationId: referring.organizationId,
      department: pointer.role,
      overview: referring.overview,
      industry: referring.industry,
      websiteUrl: referring.websiteUrl,
      email: pointer.email,
      notes: `Auto-created from decision-maker referral by ${referring.name} on ${dateStr}`,
      doNotContact: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: prospects.id, name: prospects.name })

  if (!created) throw new Error('Failed to insert derived prospect')

  const refLinks = await db
    .select({ projectId: projectProspects.projectId, priority: projectProspects.priority })
    .from(projectProspects)
    .where(and(eq(projectProspects.tenantId, tenantId), eq(projectProspects.prospectId, referring.id)))

  if (refLinks.length > 0) {
    await db.insert(projectProspects).values(
      refLinks.map((link) => ({
        tenantId,
        projectId: link.projectId,
        prospectId: created.id,
        matchReason: `Decision-maker referral from ${referring.name}`,
        priority: link.priority as 1 | 2 | 3 | 4 | 5,
        status: 'new' as const,
        createdAt: now,
        updatedAt: now,
      })),
    )
  }

  return { id: created.id, name: created.name, action: 'created' }
}

export const responsesRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /responses — record a response and update prospect status
responsesRouter.post('/responses', zValidator('json', recordResponseSchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (input.rejectionFeedback && input.responseType !== 'rejection') {
    return c.json({ error: 'rejectionFeedback may only be set when responseType is "rejection"' }, 400)
  }

  // Fetch the outreach log to verify project ownership and get prospect info
  const [log] = await db
    .select({
      id: outreachLogs.id,
      projectId: outreachLogs.projectId,
      prospectId: outreachLogs.prospectId,
    })
    .from(outreachLogs)
    .where(eq(outreachLogs.id, input.outreachLogId))
    .limit(1)

  if (!log) {
    return c.json({ error: 'Outreach log not found' }, 404)
  }

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, log.projectId), eq(projects.tenantId, tenantId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date()

  const [newResponse] = await db
    .insert(responses)
    .values({
      tenantId,
      outreachLogId: input.outreachLogId,
      channel: input.channel,
      content: input.content,
      sentiment: input.sentiment,
      responseType: input.responseType,
      receivedAt,
      rejectionFeedback: input.rejectionFeedback,
    })
    .returning({ id: responses.id })

  // Determine new status from responseType + sentiment
  let newStatus: typeof projectProspects.$inferSelect.status | null = null
  switch (input.responseType) {
    case 'bounce':
      newStatus = 'inactive'
      break
    case 'auto_reply':
      // No status change for auto-replies
      break
    case 'rejection':
      newStatus = 'rejected'
      break
    case 'meeting_request':
      newStatus = 'responded'
      break
    case 'reply':
      newStatus = input.sentiment === 'negative' ? 'rejected' : 'responded'
      break
  }

  const reapproachMonths = input.rejectionFeedback ? reapproachWindowMonths(input.rejectionFeedback) : null
  if (newStatus === 'rejected' && reapproachMonths !== null) {
    newStatus = 'deferred'
  }

  if (newStatus) {
    await db
      .update(projectProspects)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(
        and(
          eq(projectProspects.projectId, log.projectId),
          eq(projectProspects.prospectId, log.prospectId),
        ),
      )
  }

  if (reapproachMonths !== null) {
    const nextOutreachAfter = new Date(receivedAt)
    nextOutreachAfter.setUTCMonth(nextOutreachAfter.getUTCMonth() + reapproachMonths)
    await db
      .update(prospects)
      .set({ nextOutreachAfter, updatedAt: new Date() })
      .where(eq(prospects.id, log.prospectId))
  }

  // DNC ratchet: caller-requested OR bounce OR feedback signals a hard opt-out.
  const forceDnc = input.rejectionFeedback ? feedbackForcesDoNotContact(input.rejectionFeedback) : false
  if (input.markDoNotContact || input.responseType === 'bounce' || forceDnc) {
    await db
      .update(prospects)
      .set({ doNotContact: true, updatedAt: new Date() })
      .where(eq(prospects.id, log.prospectId))
  }

  // Decision-maker pointer → auto-prospect. Only when not a DNC-forcing reject
  // (a referral from someone who unsubscribed shouldn't seed a new contact),
  // and not when the rejection itself ratcheted DNC on the referring prospect.
  const derivedProspects: DerivedProspect[] = []
  const pointer = input.rejectionFeedback?.decision_maker_pointer
  if (pointer && !forceDnc) {
    const derived = await derivePointerProspect(db, tenantId, log.prospectId, pointer, new Date())
    if (derived) derivedProspects.push(derived)
  }

  return c.json({ id: newResponse?.id, derivedProspects }, 201)
})

// GET /projects/:id/responses — list responses for a project
responsesRouter.get('/projects/:id/responses', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const limit = clampInt(c.req.query('limit'), 1, 200) ?? 100
  const sentimentFilter = c.req.query('sentiment')
  const responseTypeFilter = c.req.query('responseType')

  const conditions = [eq(outreachLogs.projectId, projectId)]

  if (sentimentFilter && sentimentEnum.enumValues.includes(sentimentFilter as typeof sentimentEnum.enumValues[number])) {
    conditions.push(eq(responses.sentiment, sentimentFilter as typeof sentimentEnum.enumValues[number]))
  }

  if (responseTypeFilter && responseTypeEnum.enumValues.includes(responseTypeFilter as typeof responseTypeEnum.enumValues[number])) {
    conditions.push(eq(responses.responseType, responseTypeFilter as typeof responseTypeEnum.enumValues[number]))
  }

  const rows = await db
    .select({
      id: responses.id,
      channel: responses.channel,
      content: responses.content,
      sentiment: responses.sentiment,
      responseType: responses.responseType,
      receivedAt: responses.receivedAt,
      rejectionFeedback: responses.rejectionFeedback,
      prospectId: outreachLogs.prospectId,
      prospectName: prospects.name,
      outreachSubject: outreachLogs.subject,
    })
    .from(responses)
    .innerJoin(outreachLogs, eq(outreachLogs.id, responses.outreachLogId))
    .innerJoin(prospects, eq(prospects.id, outreachLogs.prospectId))
    .where(and(...conditions))
    .orderBy(desc(responses.receivedAt))
    .limit(limit)

  return c.json({ responses: rows })
})

// GET /projects/:id/rejection-feedback/summary — aggregate rejection_feedback
//
// Optional query params:
//   windowDays: number — restrict to rejections received within the last N days (omit for all-time)
//   freeTextLimit: number — cap on the feature_gap free_text rows (default 20)
//   recontactLimit: number — cap on rows per recontact-window bucket (default 20)
//   notRelevantLimit: number — cap on the not_relevant rows with industry context (default 50)
//   scope: 'pmf' | 'tactical' | 'all' (default 'all')
//     - 'pmf'      → only feature_gap / already_have_solution / competitor_locked;
//                    skips recontact + decision_maker + not_relevant queries; total + percentages
//                    are computed within the PMF subset
//     - 'tactical' → only non-PMF reasons; skips feature_gap free_text query
//     - 'all'      → no scope filter; full payload (legacy default)
responsesRouter.get('/projects/:id/rejection-feedback/summary', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const scopeParam = c.req.query('scope') ?? 'all'
  if (!(REJECTION_SCOPES as readonly string[]).includes(scopeParam)) {
    return c.json({ error: `Invalid scope: ${scopeParam} (allowed: ${REJECTION_SCOPES.join(', ')})` }, 400)
  }
  const scope = scopeParam as RejectionScope

  const windowDays = clampInt(c.req.query('windowDays'), 1, 3650)
  const freeTextLimit = clampInt(c.req.query('freeTextLimit'), 1, 100) ?? 20
  const recontactLimit = clampInt(c.req.query('recontactLimit'), 1, 100) ?? 20
  const notRelevantLimit = clampInt(c.req.query('notRelevantLimit'), 1, 200) ?? 50

  const since = windowDays
    ? new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    : null

  const pmfReasonList = sql.join(
    PMF_RELEVANT_REASONS.map((r) => sql`${r}`),
    sql`, `,
  )

  const baseConditions = [
    eq(responses.tenantId, tenantId),
    eq(outreachLogs.projectId, projectId),
    eq(responses.responseType, 'rejection'),
    isNotNull(responses.rejectionFeedback),
  ]
  if (since) baseConditions.push(gte(responses.receivedAt, since))
  if (scope === 'pmf') {
    baseConditions.push(sql`${responses.rejectionFeedback}->>'primary_reason' IN (${pmfReasonList})`)
  } else if (scope === 'tactical') {
    baseConditions.push(sql`${responses.rejectionFeedback}->>'primary_reason' NOT IN (${pmfReasonList})`)
  }

  const reapproachWindowList = sql.join(
    REAPPROACH_WINDOWS.map((w) => sql`${w}`),
    sql`, `,
  )

  // Up to 5 independent reads — pipelined over the RLS transaction connection.
  // Queries irrelevant to the requested scope are skipped (Promise.all resolves
  // null directly) so we don't pay for rows the caller will discard.
  const [reasonRows, featureGapRows, recontactRows, decisionMakerRows, notRelevantRows] = await Promise.all([
    // primary_reason distribution — always run; baseConditions already constrains by scope
    db
      .select({
        reason: sql<string>`${responses.rejectionFeedback}->>'primary_reason'`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(responses)
      .innerJoin(outreachLogs, eq(outreachLogs.id, responses.outreachLogId))
      .where(and(...baseConditions))
      .groupBy(sql`${responses.rejectionFeedback}->>'primary_reason'`),

    // feature_gap free_text — only when PMF or all (the row set is empty under tactical anyway)
    scope === 'tactical'
      ? null
      : db
          .select({
            receivedAt: responses.receivedAt,
            freeText: sql<string | null>`${responses.rejectionFeedback}->>'free_text'`,
            prospectId: outreachLogs.prospectId,
            prospectName: prospects.name,
            organizationName: organizations.name,
          })
          .from(responses)
          .innerJoin(outreachLogs, eq(outreachLogs.id, responses.outreachLogId))
          .innerJoin(prospects, eq(prospects.id, outreachLogs.prospectId))
          .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
          .where(and(
            ...baseConditions,
            sql`${responses.rejectionFeedback}->>'primary_reason' = ${FEATURE_GAP_REASON}`,
          ))
          .orderBy(desc(responses.receivedAt))
          .limit(freeTextLimit),

    // recontact windows — only when tactical or all (PMF reasons rarely set this and it's not PMF-relevant)
    scope === 'pmf'
      ? null
      : db
          .select({
            window: sql<string>`${responses.rejectionFeedback}->>'preferred_recontact_window'`,
            receivedAt: responses.receivedAt,
            prospectId: outreachLogs.prospectId,
            prospectName: prospects.name,
            organizationName: organizations.name,
          })
          .from(responses)
          .innerJoin(outreachLogs, eq(outreachLogs.id, responses.outreachLogId))
          .innerJoin(prospects, eq(prospects.id, outreachLogs.prospectId))
          .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
          .where(and(
            ...baseConditions,
            sql`${responses.rejectionFeedback}->>'preferred_recontact_window' IN (${reapproachWindowList})`,
          ))
          .orderBy(desc(responses.receivedAt))
          .limit(recontactLimit * REAPPROACH_WINDOWS.length),

    // decision_maker_pointer — only when tactical or all
    scope === 'pmf'
      ? null
      : db
          .select({
            receivedAt: responses.receivedAt,
            prospectId: outreachLogs.prospectId,
            prospectName: prospects.name,
            organizationName: organizations.name,
            pointer: sql<{ name?: string; email?: string; role?: string } | null>`${responses.rejectionFeedback}->'decision_maker_pointer'`,
          })
          .from(responses)
          .innerJoin(outreachLogs, eq(outreachLogs.id, responses.outreachLogId))
          .innerJoin(prospects, eq(prospects.id, outreachLogs.prospectId))
          .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
          .where(and(
            ...baseConditions,
            sql`${responses.rejectionFeedback}->'decision_maker_pointer' IS NOT NULL`,
          ))
          .orderBy(desc(responses.receivedAt))
          .limit(DECISION_MAKER_LIMIT),

    // not_relevant rows with prospect industry — only when tactical or all.
    // Lets /evaluate aggregate by industry / org to drive SEARCH_NOTES targeting.
    scope === 'pmf'
      ? null
      : db
          .select({
            receivedAt: responses.receivedAt,
            freeText: sql<string | null>`${responses.rejectionFeedback}->>'free_text'`,
            prospectId: outreachLogs.prospectId,
            prospectName: prospects.name,
            organizationName: organizations.name,
            industry: prospects.industry,
          })
          .from(responses)
          .innerJoin(outreachLogs, eq(outreachLogs.id, responses.outreachLogId))
          .innerJoin(prospects, eq(prospects.id, outreachLogs.prospectId))
          .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
          .where(and(
            ...baseConditions,
            sql`${responses.rejectionFeedback}->>'primary_reason' = ${NOT_RELEVANT_REASON}`,
          ))
          .orderBy(desc(responses.receivedAt))
          .limit(notRelevantLimit),
  ])

  const total = reasonRows.reduce((sum, r) => sum + r.count, 0)

  return c.json({
    windowDays,
    scope,
    total,
    primaryReasonDistribution: reasonRows
      .map((r) => ({
        reason: r.reason,
        count: r.count,
        percentage: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count),
    featureGapNotes: (featureGapRows ?? []).map((r) => ({
      receivedAt: r.receivedAt,
      freeText: r.freeText,
      prospectId: r.prospectId,
      prospectName: r.prospectName,
      organizationName: r.organizationName,
    })),
    recontactWindows: (recontactRows ?? []).map((r) => ({
      window: r.window,
      receivedAt: r.receivedAt,
      prospectId: r.prospectId,
      prospectName: r.prospectName,
      organizationName: r.organizationName,
    })),
    decisionMakerPointers: (decisionMakerRows ?? []).map((r) => ({
      receivedAt: r.receivedAt,
      prospectId: r.prospectId,
      prospectName: r.prospectName,
      organizationName: r.organizationName,
      pointer: r.pointer,
    })),
    notRelevantNotes: (notRelevantRows ?? []).map((r) => ({
      receivedAt: r.receivedAt,
      freeText: r.freeText,
      prospectId: r.prospectId,
      prospectName: r.prospectName,
      organizationName: r.organizationName,
      industry: r.industry,
    })),
  })
})
