# Lead Ace 本番デプロイ・ランブック

初回デプロイと CI/CD 有効化の手順。外部アカウント/プロジェクトを触るステップは **⚠️** マークあり。

## 前提

| 項目 | 値 |
|---|---|
| Cloudflare アカウント | `Leo.uno@surpassone.com's Account`（ID: `0633d5a3f3b6d8d4cb5b2c7fcf453494`） |
| Supabase プロジェクト | `lead-ace-prod`（Tokyo region） |
| カスタムドメイン | `api.leadace.ai` / `mcp.leadace.ai` / `app.leadace.ai`（apex `leadace.ai` は将来の LP 用に予約） |
| Stripe アカウント | SurpassOne（test/live 共通） |
| GitHub リポジトリ | `aitit-inc/lead-ace` |

設定ファイル（`backend/wrangler.*.jsonc` / `backend/scripts/setup-stripe.ts` / 本ドキュメント）はすべて `leadace.ai` ベース。`wrangler.*.jsonc` の `account_id` も Leo.uno@surpassone.com 側に固定済み。

## 進捗

- [x] §1 Supabase 本番プロジェクト作成・Auth URL 設定（Site/Redirect: `app.leadace.ai`）
- [x] §2 本番スキーママイグレーション + `master_documents` seed
- [x] §3 Stripe セットアップ（test mode で Products/Prices/Portal 作成完了。live は全体検証後に再実行）
- [x] §4-1 `leadace.ai` を Cloudflare Zone として追加・お名前.com の NS 切替完了（Active）
- [ ] §4-2 wrangler secrets 投入（API / MCP Worker）
- [ ] §4-3 Cloudflare API Token 発行（CI 用）
- [ ] §5 初回デプロイ（Workers + Pages 手動）
- [ ] §6 Stripe Webhook URL 登録
- [ ] §7 GitHub Actions 有効化
- [ ] §8 デプロイ後の検証

---

## 1. Supabase 本番プロジェクト作成 ⚠️ ✅ 完了

1. [Supabase Dashboard](https://supabase.com/dashboard) → **New project**
2. Organization: （決定した Organization）、Name: `lead-ace-prod`、Region: Tokyo 推奨、Database password: **強いものを生成して保管**
3. プロジェクト作成後、以下を控える（後で secrets に設定）:
   - `Project URL` (例: `https://xxxx.supabase.co`)
   - `anon` / `publishable` key
   - `service_role` key（CI 等からの管理操作用、漏洩注意）
   - `Database URL`（Pooler / Transaction mode、`postgres.js` 用）
4. **Authentication → URL Configuration** で Site URL と Redirect URLs を設定:
   - Site URL: `https://app.leadace.ai`
   - Redirect URLs: `https://app.leadace.ai/*`（開発時は localhost も追加可）
5. **Authentication → Providers** で Email を有効化（必要に応じて確認メールを有効化）
6. **SQL Editor** で `app_rls` ロール作成 + RLS 有効化をまだしていない場合は、`backend/drizzle/0001_rls_policies.sql` の内容を貼り付けて実行するか、手順 3 の migration で自動適用されることを確認

---

## 2. 本番スキーママイグレーション ✅ 完了（継続運用手順として残す）

ローカルから本番 DB に対してマイグレーションを適用する。**必ず Session Pooler (port 5432) を使う**。Transaction Pooler (port 6543) は DDL / DO ブロック / `CREATE ROLE` 等で不具合が起きるため migrate 用途では不適。

Supabase Dashboard → **Connect** → **Session pooler** の URL をコピー。形式：

```
postgresql://postgres.<project_ref>:<password>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
```

適用：

```bash
cd backend
 DATABASE_URL="<Session Pooler URL>" npm run db:migrate
 DATABASE_URL="<Session Pooler URL>" npx tsx scripts/seed-master-documents.ts
```

アプリの `wrangler secret put DATABASE_URL ...` には **Transaction Pooler URL (port 6543)** を入れる（高並列に強い）。役割が違う：
- migrate → Session Pooler（DDL 安全）
- アプリ（wrangler secret）→ Transaction Pooler（高並列）

**注意:** `db:migrate` は CI で流さない方針。ローカル → 本番の順で手動適用、毎回 secret 一覧と設定値を二重チェック。

---

## 3. Stripe セットアップ ⚠️ ✅ test mode 完了（live は §5〜§8 検証後に再実行）

### 3-1. Products / Prices / Customer Portal をスクリプトで作成

`backend/scripts/setup-stripe.ts` が Products × 3、Prices × 6（metadata.plan 付き）、Customer Portal 設定を一括で冪等に作成する。

```bash
cd backend
# Test mode で先に検証（sk_test_... を使う）
 STRIPE_SECRET_KEY=sk_test_... \
 PORTAL_RETURN_URL=https://app.leadace.ai/settings \
 npx tsx scripts/setup-stripe.ts
```

実行後、末尾に 6 つの Price ID が `VITE_STRIPE_PRICE_*=price_...` 形式で出力されるので、これを手順 7 の GitHub Variables にコピペする。

スクリプトは既存リソースを `metadata.plan` / `metadata.interval` / `metadata.app=lead-ace` でマッチして再利用するので、何度流しても安全。価格や名称を変えたいときは Dashboard 側で直接編集するか、スクリプトの定義を書き換えて再実行。

**live 移行時:** 同じスクリプトに `sk_live_...` を渡して再実行すれば、live モードに同じ構成が作られる（test と live は完全に独立）。

### 3-2. API キー取得

- **Secret key** (`sk_live_...` or `sk_test_...`): `STRIPE_SECRET_KEY` として wrangler secret に設定（手順 4-2）
- **Webhook signing secret** (`whsec_...`): 手順 6 で webhook 登録後に発行

Webhook ハンドラは各 Price の `metadata.plan` を読んで `tenant_plans.plan` を更新する（`backend/src/api/routes/stripe-webhook.ts`）。setup-stripe.ts が metadata を自動設定するので手動付与は不要。

---

## 4. Cloudflare セットアップ ⚠️

### 4-1. ドメインを Cloudflare に登録 ✅ 完了

`leadace.ai`（お名前.com 取得）を Cloudflare Zone として追加し、NS を Cloudflare に切替済み（Active）。

参考手順（再実行時）:

1. [Cloudflare Dashboard → Websites → Add a site](https://dash.cloudflare.com/) → `leadace.ai` → Free プラン
2. 提示された NS 2 つをコピー
3. [お名前.com Navi](https://www.onamae.com/domain/navi/) → 該当ドメイン → ネームサーバー設定 → その他のネームサーバーを使う → Cloudflare の NS を入力
4. Cloudflare 側で **"Check nameservers"** → Active まで待機（通常30分以内）

`api` / `mcp` / `app` サブドメインは Workers/Pages のデプロイ時に自動で DNS レコードが作成される（`wrangler.*.jsonc` の `routes.zone_name` / Pages Custom domain 指定による）。apex `leadace.ai` はデプロイ完了までは Cloudflare デフォルト 404。

### 4-2. Secrets 設定

`wrangler login` 済み（`Leo.uno@surpassone.com's Account` を選択）。`account_id` は `wrangler.*.jsonc` で固定済みなので誤アカウントへのデプロイは防がれている。

**注意:** 初回 `wrangler secret put` を流すと自動で empty Worker が作成される（secret 設定先が必要なため）。名前の衝突を避けるため、`wrangler.api.jsonc` / `wrangler.mcp.jsonc` の `env.production.name` が `lead-ace-api` / `lead-ace-mcp` になっていることを確認。

API Worker の secrets（test mode 値でまず検証、後で live に入れ替え）:

```bash
cd backend

# Supabase の Transaction Pooler URL（`§2` で使ったものと同じ）
npx wrangler secret put DATABASE_URL --config wrangler.api.jsonc --env production
# Supabase Project URL（例: https://chaxrcdtxngoyqvtoyem.supabase.co）
npx wrangler secret put SUPABASE_URL --config wrangler.api.jsonc --env production
# Stripe secret key（test 段階では sk_test_...、live 切替時に sk_live_... へ上書き）
npx wrangler secret put STRIPE_SECRET_KEY --config wrangler.api.jsonc --env production
# Stripe webhook signing secret。§6 で発行するため、まず空文字/ダミーで入れておき、§6 の後に上書きする運用でもOK
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config wrangler.api.jsonc --env production
# SUPABASE_JWT_SECRET は不要（JWKS 検証経由）
```

MCP Worker の secrets:

```bash
npx wrangler secret put WEB_API_URL --config wrangler.mcp.jsonc --env production
# → 値: https://api.leadace.ai
npx wrangler secret put SUPABASE_URL --config wrangler.mcp.jsonc --env production
# Supabase Dashboard → Project Settings → API Keys の "Publishable key" (sb_publishable_...) を設定
npx wrangler secret put SUPABASE_ANON_KEY --config wrangler.mcp.jsonc --env production
```

Supabase のキー命名は最近変更された。レガシー `anon public` JWT（`eyJ...`）も使えるが、新プロジェクトでは `sb_publishable_...` 形式。変数名は後方互換で `SUPABASE_ANON_KEY` のまま。

MCP Worker の OAuth ストア (KV) は `wrangler.mcp.jsonc` で binding 済み（`MCP_OAUTH_STORE`、id: `78e184bebfde4e35a2261b2957067586`）。再作成が必要な場合：

```bash
npx wrangler kv namespace create MCP_OAUTH_STORE
# 出力された id を wrangler.mcp.jsonc の (top-level + env.production の) kv_namespaces に貼り替える
```

secret の一覧確認:

```bash
npx wrangler secret list --config wrangler.api.jsonc --env production
npx wrangler secret list --config wrangler.mcp.jsonc --env production
```

### 4-3. Cloudflare API Token（CI 用）

[Dashboard → My Profile → API Tokens → Create Token](https://dash.cloudflare.com/profile/api-tokens)

テンプレート **"Edit Cloudflare Workers"** を使用。以下の権限があれば十分：

- Account: Workers Scripts: Edit, Pages: Edit, Account Settings: Read
- Zone: Workers Routes: Edit, DNS: Edit（カスタムドメインを使うため）

作成後、トークンを控える（`CLOUDFLARE_API_TOKEN` として GitHub Secrets に設定）。`CLOUDFLARE_ACCOUNT_ID` は `0633d5a3f3b6d8d4cb5b2c7fcf453494`（前提表の値）。

---

## 5. 初回デプロイ（手動）

CI/CD を有効化する前に、1回ローカルから deploy して動作確認する。ドメイン回りの設定ミスを早めに検出するため。

### 5-1. Backend Workers

```bash
cd backend

# カスタムドメインがまだ準備できていない場合、wrangler.*.jsonc の "routes" ブロックを一旦削除してから先にデプロイし、workers.dev URL で動作確認する選択肢もあり。
npx wrangler deploy --config wrangler.api.jsonc --env production
npx wrangler deploy --config wrangler.mcp.jsonc --env production
```

デプロイ成功後の動作確認:

```bash
curl https://api.leadace.ai/health
# → {"ok":true}
curl -o /dev/null -w "%{http_code}\n" https://api.leadace.ai/api/projects
# → 401（未認証でOK）
curl -o /dev/null -w "%{http_code}\n" https://mcp.leadace.ai/mcp
# → 401（未認証でOK）
```

### 5-2. Frontend (Cloudflare Pages)

初回は Dashboard から Pages プロジェクトを作成するのが最も簡単:

1. [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages) → **Create a project** → **Direct upload** or **Connect to Git**
2. プロジェクト名: `lead-ace`
3. production branch: `main`
4. Build settings（Connect to Git の場合のみ。CI で回すなら不要）:
   - Framework preset: SvelteKit
   - Build command: `npm run build`
   - Build output directory: `.svelte-kit/cloudflare`
   - Root directory: `frontend`

または、ローカルから先にアップロードする場合：

```bash
cd frontend
VITE_API_URL=https://api.leadace.ai \
VITE_SUPABASE_URL=https://chaxrcdtxngoyqvtoyem.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon key> \
VITE_STRIPE_PRICE_STARTER_MONTHLY=price_... \
# ... 残りの VITE_STRIPE_PRICE_* も同様
npm run build
npx wrangler pages deploy .svelte-kit/cloudflare --project-name lead-ace --branch main
```

Dashboard から `app.leadace.ai` を Pages プロジェクトの **Custom domain** として追加。

---

## 6. Stripe Webhook URL 登録 ⚠️

API Worker が本番URLで起動した後、`setup-stripe.ts` に `WEBHOOK_URL` を渡して再実行する。既存の Products/Prices/Portal は metadata で再利用され、新規に Webhook endpoint だけ作成される。

```bash
cd backend
 STRIPE_SECRET_KEY=sk_test_... \
 WEBHOOK_URL=https://api.leadace.ai/api/stripe/webhook \
 npx tsx scripts/setup-stripe.ts
```

初回作成時、末尾に `STRIPE_WEBHOOK_SECRET=whsec_...` が出力される。**この値は作成時しか取得できない**ので即座に控え、wrangler secret に設定：

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config wrangler.api.jsonc --env production
# プロンプトに whsec_... を貼り付け
```

URL や対象イベントを後から変えたいだけなら同スクリプトを再実行（secret はそのまま維持される）。secret を紛失した場合は [Dashboard → Webhooks → 該当 endpoint → Reveal](https://dashboard.stripe.com/test/webhooks) で取得可能。

ローカルで Stripe CLI からテスト webhook を飛ばすなら：

```bash
stripe listen --forward-to https://api.leadace.ai/api/stripe/webhook
stripe trigger checkout.session.completed
```

---

## 7. GitHub Actions CI/CD 有効化

### 7-1. Secrets 設定（機密値）

[GitHub repo → Settings → Secrets and variables → Actions → Secrets tab](https://github.com/aitit-inc/lead-ace/settings/secrets/actions)

| Secret | 値 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 手順 4-3 で作成したトークン |
| `CLOUDFLARE_ACCOUNT_ID` | `0633d5a3f3b6d8d4cb5b2c7fcf453494` |

### 7-2. Variables 設定（公開値・ビルド時に埋め込む）

[同画面 → Variables tab](https://github.com/aitit-inc/lead-ace/settings/variables/actions)

| Variable | 値 |
|---|---|
| `VITE_API_URL` | `https://api.leadace.ai` |
| `VITE_SUPABASE_URL` | `https://chaxrcdtxngoyqvtoyem.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `VITE_STRIPE_PRICE_STARTER_MONTHLY` | Stripe Price ID |
| `VITE_STRIPE_PRICE_STARTER_YEARLY` | 〃 |
| `VITE_STRIPE_PRICE_PRO_MONTHLY` | 〃 |
| `VITE_STRIPE_PRICE_PRO_YEARLY` | 〃 |
| `VITE_STRIPE_PRICE_SCALE_MONTHLY` | 〃 |
| `VITE_STRIPE_PRICE_SCALE_YEARLY` | 〃 |

### 7-3. ワークフロー確認

`.github/workflows/` 下に既に以下を配置済み：

- `check.yml`: PR + push で backend typecheck + frontend check
- `deploy.yml`: main への push で API / MCP / Frontend を順にデプロイ

最初の push または手動 `workflow_dispatch` で動作確認。

---

## 8. デプロイ後の検証

5-1 レビューの「ランタイム動作確認」を本番環境で再実行する：

1. **テナント分離**: 2ユーザーでログイン → 互いのデータが見えないこと
2. **クォータ**: Free ユーザーで prospect 30件 + outreach 10件 → 枯渇メッセージ
3. **MCP tools**: Claude Code に `${LEADACE_MCP_URL}=https://mcp.leadace.ai/mcp` を設定 → `/setup my-test` が通ること
4. **Stripe checkout**: フロントエンドから Upgrade → Stripe Checkout → 戻り → `/api/me/plan` が `starter` に更新されること
5. **Customer Portal**: Manage subscription → ダウングレード → webhook で反映

---

## 緊急時の切り戻し

- Workers: Cloudflare Dashboard → Workers & Pages → 該当 Worker → Deployments → 過去版を "Rollback"
- Pages: 同様に Deployments → 該当ビルドを "Rollback to this deployment"
- DB: Supabase Dashboard → Database → Backups（日次スナップショット）

---

## 運用メモ

- **DB マイグレーションは CI で流さない**。必ずローカルから `DATABASE_URL` 指定で手動実行
- **secrets のローテーション**: Stripe / Supabase のキーは定期的に更新。更新時は `wrangler secret put` で上書き
- **ログ監視**: Workers の Observability を有効化済み。Cloudflare Dashboard → Workers → Logs で閲覧
- **コスト警戒**: Workers CPU 時間 / Pages ビルド回数 / Supabase 行数・帯域に月次で目を通す
