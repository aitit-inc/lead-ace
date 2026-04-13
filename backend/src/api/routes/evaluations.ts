import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, sql, desc } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import {
  projects,
  evaluations,
  projectProspects,
  prospects,
} from '../../db/schema'
import type { Env, Variables } from '../types'
import type { EvaluationMetrics } from '../../db/schema'

export const evaluationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// ---------------------------------------------------------------------------
// GET /projects/:id/stats
// ---------------------------------------------------------------------------

evaluationsRouter.get('/projects/:id/stats', async (c) => {
  const projectId = c.req.param('id')
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Helper to run a raw SQL query and return rows as a typed array
  type Row = Record<string, unknown>
  const rawQuery = async (query: ReturnType<typeof sql>): Promise<Row[]> => {
    const result = await db.execute(query)
    // drizzle-orm/postgres-js returns the RowList directly (array-like)
    return Array.from(result) as Row[]
  }

  const [
    totalOutreachRows,
    channelCountsRows,
    responseCountsRows,
    sentimentBreakdownRows,
    priorityResponseRateRows,
    statusCountsRows,
    channelResponseRateRows,
    respondedMessagesRows,
    noResponseSampleRows,
    lastSentRows,
  ] = await Promise.all([
    rawQuery(sql`SELECT COUNT(*)::int AS "totalOutreach" FROM outreach_logs WHERE project_id = ${projectId} AND status = 'sent'`),
    rawQuery(sql`SELECT channel, COUNT(*)::int AS count FROM outreach_logs WHERE project_id = ${projectId} GROUP BY channel`),
    rawQuery(sql`SELECT COUNT(r.id)::int AS "totalResponses", COUNT(DISTINCT ol.prospect_id)::int AS "uniqueResponders"
                 FROM responses r JOIN outreach_logs ol ON r.outreach_log_id = ol.id WHERE ol.project_id = ${projectId}`),
    rawQuery(sql`SELECT r.sentiment, r.response_type AS "responseType", COUNT(*)::int AS count
                 FROM responses r JOIN outreach_logs ol ON r.outreach_log_id = ol.id WHERE ol.project_id = ${projectId}
                 GROUP BY r.sentiment, r.response_type`),
    rawQuery(sql`SELECT pp.priority,
                   COUNT(DISTINCT ol.id)::int AS total,
                   COUNT(DISTINCT r.id)::int AS responses,
                   ROUND(COUNT(DISTINCT r.id)::numeric / NULLIF(COUNT(DISTINCT ol.id), 0) * 100, 1)::float AS rate
                 FROM project_prospects pp
                 LEFT JOIN outreach_logs ol ON ol.project_id = pp.project_id AND ol.prospect_id = pp.prospect_id AND ol.status = 'sent'
                 LEFT JOIN responses r ON r.outreach_log_id = ol.id
                 WHERE pp.project_id = ${projectId}
                 GROUP BY pp.priority ORDER BY pp.priority`),
    rawQuery(sql`SELECT status, COUNT(*)::int AS count FROM project_prospects WHERE project_id = ${projectId} GROUP BY status`),
    rawQuery(sql`SELECT ol.channel,
                   COUNT(ol.id)::int AS total,
                   COUNT(r.id)::int AS responses,
                   ROUND(COUNT(r.id)::numeric / NULLIF(COUNT(ol.id), 0) * 100, 1)::float AS rate
                 FROM outreach_logs ol LEFT JOIN responses r ON r.outreach_log_id = ol.id
                 WHERE ol.project_id = ${projectId} GROUP BY ol.channel`),
    rawQuery(sql`SELECT ol.id, ol.channel, ol.subject, ol.body, r.sentiment, r.response_type AS "responseType"
                 FROM responses r JOIN outreach_logs ol ON r.outreach_log_id = ol.id WHERE ol.project_id = ${projectId}`),
    rawQuery(sql`SELECT ol.id, ol.channel, ol.subject, ol.body
                 FROM outreach_logs ol WHERE ol.project_id = ${projectId} AND ol.status = 'sent'
                   AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.outreach_log_id = ol.id)
                 ORDER BY ol.sent_at DESC LIMIT 10`),
    rawQuery(sql`SELECT COUNT(*)::int AS "totalSent", MAX(sent_at) AS "lastSentAt"
                 FROM outreach_logs WHERE project_id = ${projectId} AND status = 'sent'`),
  ])

  const totalOutreach = (totalOutreachRows[0]?.['totalOutreach'] as number | undefined) ?? 0
  const lastSentRow = lastSentRows[0]
  const totalSent = (lastSentRow?.['totalSent'] as number | undefined) ?? 0
  const lastSentAt = (lastSentRow?.['lastSentAt'] as string | null | undefined) ?? null
  const daysSinceLastSend = lastSentAt
    ? Math.floor((Date.now() - new Date(lastSentAt).getTime()) / 86_400_000)
    : null

  const metrics: EvaluationMetrics = {
    totalOutreach,
    channelCounts: channelCountsRows as EvaluationMetrics['channelCounts'],
    responseCounts: (responseCountsRows[0] ?? { totalResponses: 0, uniqueResponders: 0 }) as EvaluationMetrics['responseCounts'],
    sentimentBreakdown: sentimentBreakdownRows as EvaluationMetrics['sentimentBreakdown'],
    priorityResponseRate: priorityResponseRateRows as EvaluationMetrics['priorityResponseRate'],
    statusCounts: statusCountsRows as EvaluationMetrics['statusCounts'],
    channelResponseRate: channelResponseRateRows as EvaluationMetrics['channelResponseRate'],
  }

  return c.json({
    metrics,
    respondedMessages: respondedMessagesRows,
    noResponseSample: noResponseSampleRows,
    dataSufficiency: {
      sufficient: totalSent >= 30 && (daysSinceLastSend === null || daysSinceLastSend >= 3),
      totalSent,
      daysSinceLastSend,
    },
  })
})

// ---------------------------------------------------------------------------
// POST /evaluations
// ---------------------------------------------------------------------------

const priorityUpdateSchema = z.object({
  industry: z.string().min(1),
  priority: z.number().int().min(1).max(5),
})

const recordEvaluationSchema = z.object({
  projectId: z.string().min(1),
  metrics: z.record(z.string(), z.unknown()),
  findings: z.string().min(1),
  improvements: z.string().min(1),
  priorityUpdates: z.array(priorityUpdateSchema).optional(),
})

evaluationsRouter.post('/evaluations', zValidator('json', recordEvaluationSchema), async (c) => {
  const input = c.req.valid('json')
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const now = new Date()

  const [evaluation] = await db
    .insert(evaluations)
    .values({
      projectId: input.projectId,
      evaluationDate: now,
      metrics: input.metrics as EvaluationMetrics,
      findings: input.findings,
      improvements: input.improvements,
    })
    .returning({ id: evaluations.id })

  // Bulk update priorities by industry
  const priorityResults: Array<{ industry: string; rowsAffected: number }> = []
  if (input.priorityUpdates && input.priorityUpdates.length > 0) {
    for (const pu of input.priorityUpdates) {
      const updated = await db
        .update(projectProspects)
        .set({ priority: pu.priority as 1 | 2 | 3 | 4 | 5, updatedAt: now })
        .where(
          and(
            eq(projectProspects.projectId, input.projectId),
            eq(projectProspects.status, 'new'),
            sql`${projectProspects.prospectId} IN (SELECT id FROM prospects WHERE industry = ${pu.industry})`,
          ),
        )
        .returning({ id: projectProspects.id })

      priorityResults.push({ industry: pu.industry, rowsAffected: updated.length })
    }
  }

  return c.json({ evaluationId: evaluation?.id, priorityUpdates: priorityResults }, 201)
})

// ---------------------------------------------------------------------------
// GET /projects/:id/evaluations — evaluation history
// ---------------------------------------------------------------------------

evaluationsRouter.get('/projects/:id/evaluations', async (c) => {
  const projectId = c.req.param('id')
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const rows = await db
    .select({
      id: evaluations.id,
      evaluationDate: evaluations.evaluationDate,
      findings: evaluations.findings,
      improvements: evaluations.improvements,
    })
    .from(evaluations)
    .where(eq(evaluations.projectId, projectId))
    .orderBy(desc(evaluations.evaluationDate))

  return c.json({ evaluations: rows })
})
