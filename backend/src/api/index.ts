import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authMiddleware } from './middleware/auth'
import { projectsRouter } from './routes/projects'
import { prospectsRouter } from './routes/prospects'
import { outreachRouter } from './routes/outreach'
import { responsesRouter } from './routes/responses'
import { evaluationsRouter } from './routes/evaluations'
import { documentsRouter } from './routes/documents'
import { masterDocumentsRouter } from './routes/master-documents'
import type { Env, Variables } from './types'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use('*', cors())

app.get('/health', (c) => c.json({ ok: true }))

// All routes below require authentication
app.use('/api/*', authMiddleware)

app.route('/api/projects', projectsRouter)
app.route('/api', prospectsRouter)
app.route('/api', outreachRouter)
app.route('/api', responsesRouter)
app.route('/api', evaluationsRouter)
app.route('/api', documentsRouter)
app.route('/api', masterDocumentsRouter)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default {
  fetch: app.fetch,
}
