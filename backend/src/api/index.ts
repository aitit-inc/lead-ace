import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authMiddleware } from './middleware/auth'
import { rlsMiddleware } from './middleware/rls'
import { projectsRouter } from './routes/projects'
import { projectSettingsRouter } from './routes/project-settings'
import { prospectsRouter } from './routes/prospects'
import { outreachRouter } from './routes/outreach'
import { responsesRouter } from './routes/responses'
import { evaluationsRouter } from './routes/evaluations'
import { documentsRouter } from './routes/documents'
import { masterDocumentsRouter } from './routes/master-documents'
import { billingRouter } from './routes/billing'
import { authRouter } from './routes/auth'
import { stripeWebhookRouter } from './routes/stripe-webhook'
import { unsubscribeRouter } from './routes/unsubscribe'
import type { Env, Variables } from './types'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use('*', cors())

app.get('/health', (c) => c.json({ ok: true }))

// Stripe webhook — no auth middleware (uses Stripe signature verification)
app.route('/api', stripeWebhookRouter)

// Unsubscribe endpoints — no auth middleware. The HMAC token in the URL is
// the auth and authorizes flipping prospects.do_not_contact for one prospect.
app.route('/api', unsubscribeRouter)

// All routes below require authentication + tenant-scoped RLS
app.use('/api/*', authMiddleware)
app.use('/api/*', rlsMiddleware)

app.route('/api/projects', projectsRouter)
app.route('/api', projectSettingsRouter)
app.route('/api', prospectsRouter)
app.route('/api', outreachRouter)
app.route('/api', responsesRouter)
app.route('/api', evaluationsRouter)
app.route('/api', documentsRouter)
app.route('/api', masterDocumentsRouter)
app.route('/api', billingRouter)
app.route('/api', authRouter)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default {
  fetch: app.fetch,
}
