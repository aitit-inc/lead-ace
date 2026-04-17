# landing/

Static landing page served at `https://leadace.ai` (apex).

- Served from Cloudflare Pages project `lead-ace-landing`.
- No build step — `public/` is uploaded as-is on deploy.
- CTAs link to `https://app.leadace.ai/login?signup=1`; footer legal links point to `https://app.leadace.ai/{terms,privacy}`.

## Deploy

CI deploys on every `main` push via `.github/workflows/deploy.yml` (`deploy-landing` job).

Manual deploy:

```bash
cd landing
npx wrangler pages deploy --branch main
```

## Initial Cloudflare setup (once)

1. Create Pages project `lead-ace-landing` in the Cloudflare dashboard, or let the first `wrangler pages deploy` create it implicitly.
2. Add custom domains in Pages → Custom domains: `leadace.ai` (apex) and optionally `www.leadace.ai` (set up a 301 redirect to apex via a Page Rule or CNAME).
3. Retire/redirect the legacy `leadace.surpassone.com` separately if desired.
