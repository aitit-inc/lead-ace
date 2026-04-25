import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const prospectStatusEnum = pgEnum('prospect_status', [
  'new',
  'contacted',
  'responded',
  'converted',
  'rejected',
  'inactive',
])

export const channelEnum = pgEnum('channel', [
  'email',
  'form',
  'sns_twitter',
  'sns_linkedin',
])

export const outreachStatusEnum = pgEnum('outreach_status', ['sent', 'failed'])

export const sentimentEnum = pgEnum('sentiment', ['positive', 'neutral', 'negative'])

export const responseTypeEnum = pgEnum('response_type', [
  'reply',
  'auto_reply',
  'bounce',
  'meeting_request',
  'rejection',
])

export const formTypeEnum = pgEnum('form_type', [
  'google_forms',
  'native_html',
  'wordpress_cf7',
  'iframe_embed',
  'with_captcha',
])

export const planEnum = pgEnum('plan', ['free', 'starter', 'pro', 'scale', 'unlimited'])

export const tenantRoleEnum = pgEnum('tenant_role', ['owner', 'admin', 'member'])

// ---------------------------------------------------------------------------
// Types for JSONB columns
// ---------------------------------------------------------------------------

export type SnsAccounts = {
  x?: string
  linkedin?: string
  instagram?: string
  facebook?: string
}

export type EvaluationMetrics = {
  totalOutreach: number
  channelCounts: Array<{ channel: string; count: number }>
  responseCounts: { totalResponses: number; uniqueResponders: number }
  sentimentBreakdown: Array<{ sentiment: string; responseType: string; count: number }>
  priorityResponseRate: Array<{
    priority: number
    total: number
    responses: number
    rate: number
  }>
  statusCounts: Array<{ status: string; count: number }>
  channelResponseRate: Array<{
    channel: string
    total: number
    responses: number
    rate: number
  }>
}

// ---------------------------------------------------------------------------
// Tenant & Auth
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(), // nanoid
  name: text('name').notNull().default('My Workspace'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const tenantMembers = pgTable('tenant_members', {
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), // Supabase auth.users.id
  role: tenantRoleEnum('role').notNull().default('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.userId] }),
  // 1 user = 1 tenant (current product design). DB-enforced to prevent race conditions
  // in auth middleware auto-provisioning. Remove if/when teams (many users → 1 tenant) ship.
  unique('uq_tenant_members_user').on(table.userId),
  index('idx_tenant_members_user').on(table.userId),
])

export const tenantPlans = pgTable('tenant_plans', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  plan: planEnum('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable('projects', {
  id: text('id').primaryKey(), // auto-generated nanoid
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('uq_project_tenant_name').on(table.tenantId, table.name),
  index('idx_projects_tenant').on(table.tenantId),
])

// ---------------------------------------------------------------------------
// Organizations & Prospects
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(), // apex domain (e.g. "example.com")
  name: text('name').notNull(),
  websiteUrl: text('website_url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('uq_org_tenant_domain').on(table.tenantId, table.domain),
  index('idx_org_tenant').on(table.tenantId),
])

export const prospects = pgTable('prospects', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  organizationId: integer('organization_id')
    .notNull()
    .references(() => organizations.id),
  department: text('department'),
  overview: text('overview').notNull(),
  industry: text('industry'),
  websiteUrl: text('website_url').notNull(),
  email: text('email'),
  contactFormUrl: text('contact_form_url'),
  formType: formTypeEnum('form_type'),
  snsAccounts: jsonb('sns_accounts').$type<SnsAccounts>(),
  doNotContact: boolean('do_not_contact').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Unique constraints scoped to tenant
  uniqueIndex('idx_prospect_unique_email')
    .on(table.tenantId, table.email)
    .where(sql`${table.email} IS NOT NULL`),
  uniqueIndex('idx_prospect_unique_form')
    .on(table.tenantId, table.contactFormUrl)
    .where(sql`${table.contactFormUrl} IS NOT NULL`),
  index('idx_prospect_tenant').on(table.tenantId),
  index('idx_prospect_org').on(table.organizationId),
])

export const projectProspects = pgTable('project_prospects', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  prospectId: integer('prospect_id')
    .notNull()
    .references(() => prospects.id, { onDelete: 'cascade' }),
  matchReason: text('match_reason').notNull(),
  priority: smallint('priority').notNull().default(3),
  status: prospectStatusEnum('status').notNull().default('new'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('uq_project_prospect').on(table.projectId, table.prospectId),
  check('chk_priority', sql`${table.priority} BETWEEN 1 AND 5`),
  index('idx_pp_tenant').on(table.tenantId),
  index('idx_pp_project').on(table.projectId),
  index('idx_pp_prospect').on(table.prospectId),
  index('idx_pp_status').on(table.status),
])

// ---------------------------------------------------------------------------
// Outreach & Responses
// ---------------------------------------------------------------------------

export const outreachLogs = pgTable('outreach_logs', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  prospectId: integer('prospect_id')
    .notNull()
    .references(() => prospects.id, { onDelete: 'cascade' }),
  channel: channelEnum('channel').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  status: outreachStatusEnum('status').notNull().default('sent'),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  errorMessage: text('error_message'),
}, (table) => [
  index('idx_outreach_tenant').on(table.tenantId),
  index('idx_outreach_project').on(table.projectId),
  index('idx_outreach_prospect').on(table.prospectId),
  index('idx_outreach_dedup').on(table.projectId, table.prospectId, table.status),
  // For quota counting: tenant + status + sentAt
  index('idx_outreach_quota').on(table.tenantId, table.status, table.sentAt),
])

export const responses = pgTable('responses', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  outreachLogId: integer('outreach_log_id')
    .notNull()
    .references(() => outreachLogs.id, { onDelete: 'cascade' }),
  channel: channelEnum('channel').notNull(),
  content: text('content').notNull(),
  sentiment: sentimentEnum('sentiment').notNull(),
  responseType: responseTypeEnum('response_type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_responses_tenant').on(table.tenantId),
  index('idx_responses_outreach').on(table.outreachLogId),
])

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const projectDocuments = pgTable('project_documents', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(), // "business", "sales_strategy", "search_notes"
  content: text('content').notNull(), // full markdown content
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_doc_tenant').on(table.tenantId),
  index('idx_doc_latest').on(table.projectId, table.slug, table.createdAt),
])

// Global master documents (not tenant-scoped)
export const masterDocuments = pgTable('master_documents', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  slug: text('slug').notNull().unique(), // "tpl_business", "tpl_email_guidelines", etc.
  content: text('content').notNull(), // full markdown content
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export const evaluations = pgTable('evaluations', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  evaluationDate: timestamp('evaluation_date', { withTimezone: true }).defaultNow().notNull(),
  metrics: jsonb('metrics').$type<EvaluationMetrics>().notNull(),
  findings: text('findings').notNull(),
  improvements: text('improvements').notNull(), // LLM-generated text; not queried by key
}, (table) => [
  index('idx_evaluations_tenant').on(table.tenantId),
  index('idx_evaluations_project').on(table.projectId),
])
