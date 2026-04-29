import { eq, and } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { projects, projectProspects, prospects, organizations } from '../db/schema'

export async function verifyProject(db: Db, projectId: string, tenantId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1)
  return project
}

export async function findExistingProjectLink(
  db: Db,
  args: { projectId: string; tenantId: string; domain: string },
): Promise<{ ppId: number; prospectId: number } | null> {
  const [row] = await db
    .select({ ppId: projectProspects.id, prospectId: prospects.id })
    .from(projectProspects)
    .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
    .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
    .where(
      and(
        eq(projectProspects.projectId, args.projectId),
        eq(organizations.tenantId, args.tenantId),
        eq(organizations.domain, args.domain),
      ),
    )
    .limit(1)
  return row ?? null
}
