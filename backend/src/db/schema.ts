import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
  'unreachable',
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
// Tables
// ---------------------------------------------------------------------------

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(), // Supabase auth.users.id (UUID stored as text)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_projects_user').on(table.userId),
])

export const organizations = pgTable('organizations', {
  domain: text('domain').primaryKey(), // apex domain (e.g. "example.com")
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(), // NFKC + lowercase + trim
  websiteUrl: text('website_url').notNull(),
  country: text('country'), // ISO 3166-1 alpha-2
  address: text('address'),
  industry: text('industry'),
  overview: text('overview'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_org_normalized_name').on(table.normalizedName),
])

export const prospects = pgTable('prospects', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.domain),
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
  // Partial unique indexes: only enforce uniqueness when value is not null
  uniqueIndex('idx_prospect_unique_email')
    .on(table.email)
    .where(sql`${table.email} IS NOT NULL`),
  uniqueIndex('idx_prospect_unique_form')
    .on(table.contactFormUrl)
    .where(sql`${table.contactFormUrl} IS NOT NULL`),
  index('idx_prospect_org').on(table.organizationId),
])

export const projectProspects = pgTable('project_prospects', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
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
  index('idx_project_prospects_project').on(table.projectId),
  index('idx_project_prospects_prospect').on(table.prospectId),
  index('idx_project_prospects_status').on(table.status),
])

export const outreachLogs = pgTable('outreach_logs', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
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
  index('idx_outreach_project').on(table.projectId),
  index('idx_outreach_prospect').on(table.prospectId),
  index('idx_outreach_dedup').on(table.projectId, table.prospectId, table.status),
])

export const responses = pgTable('responses', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  outreachLogId: integer('outreach_log_id')
    .notNull()
    .references(() => outreachLogs.id, { onDelete: 'cascade' }),
  channel: channelEnum('channel').notNull(),
  content: text('content').notNull(),
  sentiment: sentimentEnum('sentiment').notNull(),
  responseType: responseTypeEnum('response_type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_responses_outreach').on(table.outreachLogId),
])

export const projectDocuments = pgTable('project_documents', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(), // "business", "sales_strategy", "search_notes"
  content: text('content').notNull(), // full markdown content
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_doc_latest').on(table.projectId, table.slug, table.createdAt),
])

export const planEnum = pgEnum('plan', ['free', 'starter', 'pro', 'scale'])

export const userPlans = pgTable('user_plans', {
  userId: text('user_id').primaryKey(), // Supabase auth.users.id
  plan: planEnum('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const masterDocuments = pgTable('master_documents', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  slug: text('slug').notNull().unique(), // "tpl_business", "tpl_email_guidelines", etc.
  content: text('content').notNull(), // full markdown content
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const evaluations = pgTable('evaluations', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  evaluationDate: timestamp('evaluation_date', { withTimezone: true }).defaultNow().notNull(),
  metrics: jsonb('metrics').$type<EvaluationMetrics>().notNull(),
  findings: text('findings').notNull(),
  improvements: text('improvements').notNull(), // LLM-generated text; not queried by key
}, (table) => [
  index('idx_evaluations_project').on(table.projectId),
])
