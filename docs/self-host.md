# Self-Host LeadAce

LeadAce's backend is open source and runs on free tiers of Cloudflare and
Supabase. The Free plan (1 project, 30 prospects, 10 outreach lifetime) is
free in the cloud; running it yourself just means owning the accounts and
the deploy.

## Two paths

| Goal | Use |
|---|---|
| Hack on the codebase locally | [Local development](#local-development) |
| Run your own production for one team | [Self-deploy to your accounts](#self-deploy-to-your-accounts) |

Cloudflare Workers (`workerd`) does not run reliably inside Docker on macOS,
so neither path tries to put the backend in a container. Postgres and
Supabase Auth are containerised; the Workers run on the host.

## Local development

You need:

- Docker Desktop (or Podman)
- Node.js 20+
- Supabase CLI (`brew install supabase/tap/supabase`)

```bash
# 1. Auth + Postgres (Supabase local — uses Docker under the hood)
npx supabase start
# Note the JWT secret, anon key, and DB URL from the output.

# 2. Backend env vars
cd backend
cp .dev.vars.example .dev.vars
# Edit .dev.vars with the values from `supabase status`

# 3. Apply schema migrations
npm install
npm run db:migrate

# 4. Seed master documents (templates the plugin reads via MCP)
npx tsx scripts/seed-master-documents.ts

# 5. Start Workers (one per terminal)
npm run dev:api    # API   → http://localhost:8787
npm run dev:mcp    # MCP   → http://localhost:8788

# 6. Frontend
cd ../frontend
cp .env.example .env
# Set VITE_SUPABASE_URL/ANON_KEY from `supabase status`
npm install
npm run dev        # → http://localhost:5173

# 7. Plugin
export LEADACE_MCP_URL=http://localhost:8788/mcp
claude            # opens Claude Code with the plugin loaded
```

The `docker-compose.yml` at the repo root is an alternative for users who do
not want Supabase Auth and only need a bare Postgres (won't satisfy the
backend's auth middleware out of the box — you'd need to swap the JWT
verifier).

## Self-deploy to your accounts

Follow the production runbook end-to-end:

- [docs/deploy.md](./deploy.md) — Cloudflare + Supabase production
  setup (Workers, Pages, KV namespace, custom domains, Stripe, GitHub Actions).
- [CLAUDE.md](../CLAUDE.md) — repository conventions, plan tiers, RLS, and
  the schema-change workflow.

You will need:

- A Cloudflare account (free tier is enough for low traffic).
- A Supabase project (free tier is enough for evaluation).
- A Stripe account, **only** if you want to charge yourself or someone for the
  paid plans. The Free plan works without Stripe; the upgrade UI in Settings
  will return errors if a user tries to use it without a configured Stripe key.
- A domain (or Cloudflare's `*.workers.dev` if you skip custom domains).

For solo-tenant operation, the cheapest setup is: Cloudflare free, Supabase
free, no Stripe, no custom domain. You get the same code as the hosted
service, with your data living on your own Supabase project.

## Environment variables

### Backend (`backend/.dev.vars` for local; `wrangler secret` for production)

| Variable | Used by | Description |
|---|---|---|
| `DATABASE_URL` | API | Postgres connection (Supabase Transaction Pooler URL in production). |
| `SUPABASE_URL` | API + MCP | Supabase project URL — used to fetch JWKS for JWT verification. |
| `SUPABASE_ANON_KEY` | MCP | Supabase publishable/anon key (used by the MCP OAuth handler when forwarding logins). |
| `SUPABASE_JWT_SECRET` | API + MCP | Optional fallback when `SUPABASE_URL` is not set. |
| `WEB_API_URL` | MCP | URL of the API Worker (e.g. `https://api.leadace.ai`). |
| `STRIPE_SECRET_KEY` | API | Stripe secret key. Optional — checkout/portal endpoints return an error without it. |
| `STRIPE_WEBHOOK_SECRET` | API | Stripe webhook signing secret. |
| `ENVIRONMENT` | API + MCP | `development` or `production`. |
| `MCP_OAUTH_STORE` | MCP | Cloudflare KV binding for OAuth state. Auto-bound in `wrangler.mcp.jsonc`. |

### Frontend (`frontend/.env` for local; GitHub Variables for production)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Public URL of the API Worker. |
| `VITE_SUPABASE_URL` | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key. |
| `VITE_STRIPE_PRICE_STARTER_MONTHLY` ... | Six Stripe Price IDs for the upgrade buttons. Optional — buttons disable themselves when unset. |

### Plugin (`~/.zshrc` etc.)

| Variable | Description |
|---|---|
| `LEADACE_MCP_URL` | Optional. Overrides the MCP server URL. Defaults to `https://mcp.leadace.ai/mcp` (the hosted service). Set to `http://localhost:8788/mcp` for local dev, or to your self-hosted Worker URL in production. |

## Quotas and licensing when self-hosting

The backend enforces plan limits the same way regardless of who's running it.
A self-hosted instance with no Stripe configured leaves every tenant on the
Free plan, which is fine for personal/solo use. To unlock higher limits in a
self-host:

- Bypass the plan check (edit `backend/src/api/plan-limits.ts`), or
- Insert a `tenant_plans` row with `plan = 'pro'` (or higher) for your tenant
  via Drizzle Studio (`npm run db:studio`).

Note: the [LICENSE](../LICENSE) covers what you can and cannot do with the
code. Self-hosting for your own use is allowed; redistributing as a hosted
service to others is not.
