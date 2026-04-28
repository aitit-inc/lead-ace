import { eq, and } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { projects } from '../db/schema'

export async function verifyProject(db: Db, projectId: string, tenantId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1)
  return project
}
