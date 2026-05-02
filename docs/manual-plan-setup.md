# テストアカウントのプラン手動設定

開発時のテストアカウント（E2E ハーネス用、デバッグ用、staff 用）に対して、Stripe 課金を経由せずに DB を直接操作してプラン tier を設定する手順。本番ユーザーアカウントには絶対に使わない。

E2E ハーネスのテストアカウント運用については [`.claude/skills/prod-e2e/SKILL.md`](../.claude/skills/prod-e2e/SKILL.md) も参照。

## 大前提

- **prod DB 書き込みは 1 操作ごとにユーザー承認必須**（[CLAUDE.md](../CLAUDE.md) ルール）。`SELECT` も含めて毎回承認を取る。
- **接続方法**：Supabase Studio の SQL editor、または psql で `DATABASE_URL_SESSION_POOLER` (port 5432) 経由。詳細は [`docs/deploy.md`](./deploy.md) §2 参照。Transaction Pooler (port 6543) は DDL で詰まるため不可。
- **対象テナントを実行前に必ず特定**：誤って本番ユーザーのテナントを書き換えないよう Step 1 の SELECT で `email` と `tenant_name` を目視確認してから Step 2 に進む。

## 仕組み

`backend/src/db/schema.ts` の `tenant_plans` 表に「プラン tier」が記録される：

| カラム | 役割 | 手動設定時の値 |
|---|---|---|
| `tenant_id` | PK、`tenants.id` 参照 | 対象 tenant |
| `plan` | enum: `free` / `starter` / `pro` / `scale` / `unlimited` | 設定したい tier |
| `stripe_customer_id` | Stripe 顧客 ID | **NULL のまま**（手動 tier には Stripe 顧客がないため） |
| `stripe_subscription_id` | Stripe 購読 ID | **NULL のまま**（webhook の影響圏外で安全） |
| `current_period_start` | 月次 window の起点 | 月次 cap がある tier (starter / pro) は **必須**、ない tier (free / scale / unlimited) は NULL OK |
| `current_period_end` | 月次 window の終点 | UI 表示用、必須ではないが入れておく |

quota 判定ロジックは `backend/src/api/plan-limits.ts` の `getRemainingOutreachQuotaForPlan`：plan の `maxOutreachPerMonth` が non-null かつ `current_period_start` が non-null のときだけ月次 window が適用される。

各 tier の cap：

| tier | maxProjects | maxOutreachPerDay | maxOutreachLifetime | maxOutreachPerMonth | maxProspects |
|---|---|---|---|---|---|
| free | 1 | 5 | 50 | — | 500 |
| starter | 1 | — | — | 1,500 | — |
| pro | 5 | — | — | 10,000 | — |
| scale | — | — | — | — | — |
| unlimited | — | — | — | — | — |

`scale` と `unlimited` は cap 設定がすべて null（無制限）。違いは Stripe webhook の振る舞い（後述「落とし穴 4」）。

## Step 1: tenant 特定（READ）

email から対象テナントを特定し、現状を確認：

```sql
SELECT
  tm.tenant_id,
  t.name AS tenant_name,
  COALESCE(tp.plan, 'free') AS current_plan,
  tp.stripe_subscription_id,
  tp.current_period_start,
  tp.current_period_end,
  u.email,
  u.created_at AS user_created_at
FROM tenant_members tm
JOIN auth.users u ON u.id::text = tm.user_id
JOIN tenants t ON t.id = tm.tenant_id
LEFT JOIN tenant_plans tp ON tp.tenant_id = tm.tenant_id
WHERE u.email = '<test-account-email>';
```

期待：1 行のみ。複数行 / 別 plan / 既知の本番テナントが返ったら止まって調査。

## Step 2: tier 別 UPSERT（WRITE）

Step 1 で得た `tenant_id` を埋めて、設定したい tier の SQL を実行。

### `unlimited`（staff / コンプ用）

```sql
INSERT INTO tenant_plans (tenant_id, plan)
VALUES ('<tenant_id>', 'unlimited')
ON CONFLICT (tenant_id) DO UPDATE
  SET plan = 'unlimited', updated_at = NOW()
RETURNING tenant_id, plan, updated_at;
```

`current_period_start` 不要（cap が無いので window 計算自体走らない）。Stripe webhook 3 重 guard で保護される（後述「落とし穴 4」）。

### `scale`（無制限テスト用、Stripe 連動できる）

```sql
INSERT INTO tenant_plans (tenant_id, plan)
VALUES ('<tenant_id>', 'scale')
ON CONFLICT (tenant_id) DO UPDATE
  SET plan = 'scale', updated_at = NOW()
RETURNING tenant_id, plan, updated_at;
```

`unlimited` 同様 cap 無し、period 不要。ただし Stripe webhook guard が無いので `/me/checkout` を押されると上書きされる（落とし穴 3 参照）。

### `pro`（10,000/月）

```sql
INSERT INTO tenant_plans (
  tenant_id, plan, current_period_start, current_period_end
) VALUES (
  '<tenant_id>', 'pro', NOW(), NOW() + INTERVAL '1 month'
)
ON CONFLICT (tenant_id) DO UPDATE SET
  plan = 'pro',
  current_period_start = NOW(),
  current_period_end = NOW() + INTERVAL '1 month',
  updated_at = NOW()
RETURNING tenant_id, plan, current_period_start, current_period_end;
```

**`current_period_start` 必須**（落とし穴 1 参照）。

### `starter`（1,500/月）

```sql
INSERT INTO tenant_plans (
  tenant_id, plan, current_period_start, current_period_end
) VALUES (
  '<tenant_id>', 'starter', NOW(), NOW() + INTERVAL '1 month'
)
ON CONFLICT (tenant_id) DO UPDATE SET
  plan = 'starter',
  current_period_start = NOW(),
  current_period_end = NOW() + INTERVAL '1 month',
  updated_at = NOW()
RETURNING tenant_id, plan, current_period_start, current_period_end;
```

`pro` と同じ構造、cap 値だけ異なる。

### `free`（デフォルト / 戻す）

`tenant_plans` 行が無ければ `getTenantPlan()` が `'free'` を返すので、行を消すのが最もクリーン：

```sql
DELETE FROM tenant_plans WHERE tenant_id = '<tenant_id>'
RETURNING tenant_id;
```

行を残したまま戻したい場合：

```sql
UPDATE tenant_plans SET
  plan = 'free',
  current_period_start = NULL,
  current_period_end = NULL,
  stripe_customer_id = NULL,
  stripe_subscription_id = NULL,
  updated_at = NOW()
WHERE tenant_id = '<tenant_id>'
RETURNING tenant_id, plan;
```

## 月次 period のロールオーバー（starter / pro 専用）

Stripe webhook が無いので `current_period_start` は自動進行しない。30 日経つと「同じ月で 1500 件 / 10000 件貯まった」扱いで quota が枯渇する。

リセット SQL：

```sql
UPDATE tenant_plans SET
  current_period_start = NOW(),
  current_period_end = NOW() + INTERVAL '1 month',
  updated_at = NOW()
WHERE tenant_id = '<tenant_id>'
RETURNING tenant_id, current_period_start, current_period_end;
```

`outreach_logs` 自体は消さない方針（送信履歴として有用）。quota は `WHERE sent_at >= current_period_start` で計算されるので、`current_period_start` を進めれば古い行は自動的に「前期間扱い」となり集計から外れる。

月境界のテスト（「月初リセットされた」状態を作る）は逆に過去日付を入れる：

```sql
UPDATE tenant_plans SET
  current_period_start = NOW() - INTERVAL '35 days',
  current_period_end = NOW() - INTERVAL '5 days',
  updated_at = NOW()
WHERE tenant_id = '<tenant_id>';
```

## 落とし穴

### 1. monthly tier (starter / pro) で `current_period_start` を NULL のままにすると事実上無制限になる

`plan-limits.ts` の logic：

```ts
const monthlySince = limits.maxOutreachPerMonth !== null && tp.currentPeriodStart
  ? tp.currentPeriodStart : null
// ...
if (!dailySince && !monthlySince && !includeLifetime) {
  return { plan, remaining: null, ... }  // null = 無制限扱い
}
```

starter / pro は `maxOutreachPerMonth` が non-null だが `current_period_start` が NULL だと monthly window が落ち、3 つの window 全て不在 → unlimited 扱い。**Step 2 の SQL で必ず `current_period_start` を入れる**。

### 2. Stripe webhook 連動が無いので period が自動進行しない

落とし穴 1 を回避できても、放置すれば 30 日後には quota 枯渇。30 日ごとに「月次 period のロールオーバー」SQL を実行する運用、または「枯渇したらリセット」運用。

### 3. `/me/portal`（"Manage subscription"）は 404、`/me/checkout`（"Subscribe"）は動いてしまう

`backend/src/api/routes/billing.ts:135` で `stripe_customer_id` NULL だと `'No active subscription found'` 404 を返す。テストアカウントなのでクリックしなければ問題なし。

逆に `/me/checkout` は普通に動く。誤って "Subscribe to Pro" 等を押すと本物の Stripe Checkout に飛び、完了すると webhook が `tenant_plans` を上書きする：
- `unlimited` 以外（free / starter / pro / scale）は guard 無し → 上書きされて Stripe 連動の本物の plan になる
- 一度 Stripe 連動すると `stripe_subscription_id` が付き、webhook の管理下に入る

**テストアカウント運用中は Subscribe ボタンを押さない**。万一押した場合は test mode の Stripe で終わらせるか、即 cancel + DB を手動で戻す。

### 4. `unlimited` は Stripe webhook の 3 重 guard で保護されている、他の手動 tier はされていない

`backend/src/api/routes/stripe-webhook.ts` の以下 3 イベントで `plan = 'unlimited'` のテナントは refuse される：
- `checkout.session.completed`
- `subscription.updated`
- `subscription.deleted`

つまり staff / コンプ用に `unlimited` をセットしておけば、誤って `/me/checkout` を踏んでも DB は守られる（webhook が上書きを拒否し CRITICAL ログを残す）。

`scale` / `pro` / `starter` を手動で立てたテストアカウントには同等の guard が**ない**。`/me/checkout` 経由で Stripe 課金が走ると上書きされる。気をつけるか、`unlimited` で代用するか。

## トラブルシューティング

- **`/me/plan` の `outreach.remaining` が `null` を返す**：starter / pro なのに `current_period_start` が NULL（落とし穴 1）。Step 2 の SQL を再実行。
- **Pro 設定したのに月次 cap が消費されない**：同上。
- **Pro 設定したのに「Outreach limit reached」が出る**：30 日経過して period が古い（落とし穴 2）。「月次 period のロールオーバー」SQL を実行。
- **prod DB 接続が遅い**：Transaction Pooler (port 6543) を使ってないか確認。Session Pooler (port 5432) でないと DDL や複雑クエリで詰まる。

## 関連リソース

- [`backend/src/api/plan-limits.ts`](../backend/src/api/plan-limits.ts) — plan tier 定義と quota ロジック
- [`backend/src/api/routes/stripe-webhook.ts`](../backend/src/api/routes/stripe-webhook.ts) — webhook guards
- [`backend/src/db/schema.ts`](../backend/src/db/schema.ts) — `tenant_plans` schema
- [`docs/deploy.md`](./deploy.md) §2 — prod DB 接続情報
- [`.claude/skills/prod-e2e/SKILL.md`](../.claude/skills/prod-e2e/SKILL.md) — E2E ハーネスでの利用ワークフロー
