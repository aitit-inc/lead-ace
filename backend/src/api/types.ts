import type { Db } from '../db/connection'

export type Env = {
  DATABASE_URL: string
  SUPABASE_JWT_SECRET: string
  SUPABASE_URL: string
  ENVIRONMENT: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GMAIL_TOKEN_ENCRYPTION_KEY: string
}

export type Variables = {
  userId: string
  tenantId: string
  db: Db
}
