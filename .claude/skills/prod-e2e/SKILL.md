---
name: prod-e2e
description: "本番LeadAce環境でE2Eテストする時に使う。「本番E2E」「prod E2E」「本番テスト」のトリガー。Dockerハーネス+Workerログtail+プラン別テストアカウント+`+`エイリアス+クリーンアップSQLなど前提知識を集約。具体的シナリオは都度ユーザー指示。"
---

# 本番E2Eテストスキル

本番環境（`api.leadace.ai` / `mcp.leadace.ai` / 本番 Supabase / Stripe live）に対して、Docker コンテナ内で Claude Code を動かし、Worker ログを並行 tail しつつ、ユーザー指示のシナリオを E2E で確認する。

具体的なテストシナリオは毎回ユーザーが指示する。本スキルはそれを正しく回すために必要な**前提・実行手順・後始末**を集約する。

## 重要原則

- **本番環境を直接叩くため副作用は実物**（メール送信・DB 書き込み・Stripe 課金）。テストテナント以外には絶対に影響を出さない。
- **プラン別の専用テストアカウントを使う**：[`e2e/accounts.local.json`](../../../e2e/accounts.local.json)（gitignored）に `free` / `starter` / `pro` / `scale` / `unlimited` の各プランで別々にサインアップしたテスト用テナントが定義されている。本番ユーザーのテナントは触らない。
- **prod DB の読み書きは 1 操作ごとにユーザー承認**を取る（プロジェクト CLAUDE.md 準拠）。1 回の OK は他の操作の OK にならない。
- **送信先は `leouno12+NNN@gmail.com` 形式のサブアドレス**を使う。Gmail はすべて `leouno12@gmail.com` の受信箱に届く。`prospects.email` は `(tenant_id, email)` でユニークなので別 prospect として登録できる。

## テスト対象プランの選択

ユーザーが「Pro プランで E2E」のように指定するか、デフォルトで `free`。指定されたプランのキー（`free` / `starter` / `pro` / `scale` / `unlimited`）を使い：

1. **アカウント情報の取得**：`e2e/accounts.local.json` を読み、対象プランの `email`（送信元 = サインアップ Gmail）と `tenant_id`（DB 検証用）を確定する。`tenant_id` が空なら、Step 4 の確認 SELECT でユーザーに教えてもらい JSON を更新。
2. **`TIER` 環境変数を経由**してハーネスを起動する。`TIER=<plan>` を `run.sh` と `docker compose run` 両方に渡す。
3. **Docker volume はプラン別に分離**：`run.sh` が `COMPOSE_PROJECT_NAME=lead-ace-e2e-${TIER}` を設定するので、Claude Code ログイン状態と MCP OAuth 状態がプランごとに独立した volume に保存される。プラン切り替え時の再ログインは初回のみ。

## Pre-flight チェック

| 項目 | 確認方法 |
|---|---|
| Docker 起動中 | `docker info` がエラーなく返る |
| `ANTHROPIC_API_KEY` 設定済み | `[ -n "$ANTHROPIC_API_KEY" ] && echo OK \|\| echo MISSING` |
| ハーネス image build 済み | `docker images \| grep lead-ace-e2e-harness` |
| `e2e/accounts.local.json` 存在 | `[ -f e2e/accounts.local.json ] && echo OK` |
| 対象プランの `tenant_id` が JSON に書き込まれている | `jq -r ".${TIER}.tenant_id" e2e/accounts.local.json` が非空 |
| 対象プラン用 Claude Code ログイン済み | `docker volume ls \| grep lead-ace-e2e-${TIER}_claude-state` |
| 対象プラン用 MCP OAuth 済み | 過去に同 `TIER` で `/lead-ace` 実行・OAuth 完了 |

ハーネス自体の初回セットアップは [`e2e/README.md`](../../../e2e/README.md) 参照。

## 初回セットアップ（プラン別）

新しいプランで初めてテストする時のみ：

```bash
# Step 1: Claude Code をプラン別 volume にログイン
TIER=<plan> docker compose -f e2e/docker-compose.yml run --rm login
# 内部で `claude` 起動 → 対話ログイン → exit

# Step 2: MCP OAuth（LeadAce 接続）をそのプランのアカウントで完了
TIER=<plan> ./e2e/run.sh "/setup"
# OAuth URL が出る → ホストブラウザで該当プランの Google アカウントでログイン → 完了
```

## 実行手順

### 1. Worker ログ tail（並行起動）

別ターミナルで起動するか、Bash の `run_in_background` で並行起動：

```bash
cd backend && npx wrangler tail --config wrangler.api.jsonc --env production --format pretty
cd backend && npx wrangler tail --config wrangler.mcp.jsonc --env production --format pretty
```

ログ量が多い場合は `--search '<keyword>'` でフィルタ可。リクエスト ID で API ⇔ MCP のログを照合できる。

### 2. ハーネスコンテナでシナリオ実行

```bash
TIER=<plan> ./e2e/run.sh "<prompt>"
```

例：

```bash
TIER=free ./e2e/run.sh "/lead-ace https://example.com"
TIER=pro ./e2e/run.sh "/daily-cycle <project-id>"
```

出力 JSON は stdout に流れる。保存したい場合は `> e2e/output/run-${TIER}-$(date +%s).json`。

### 3. メール到達確認

`leouno12@gmail.com` の受信箱を確認（`+NNN` サブアドレスは全てここに届く）。Gmail の `mcp__claude_ai_Gmail__search_threads` が使える状況なら、件名でスレッド取得して本文検証可能。

### 4. DB 状態確認（要ユーザー承認）

prod DB の SELECT も承認対象。Supabase Studio (`https://supabase.com/dashboard/project/chaxrcdtxngoyqvtoyem`) または `psql` 経由：

`tenant_id` は `e2e/accounts.local.json` の対象プランから取得。

```sql
-- 直近の outreach
SELECT id, project_id, prospect_id, status, sent_at, error_message
  FROM outreach_logs WHERE tenant_id = '<tenant_id from accounts.local.json>'
  ORDER BY sent_at DESC LIMIT 10;

-- prospect ステータス分布
SELECT status, COUNT(*) FROM project_prospects
  WHERE project_id = '<project-id>' GROUP BY status;

-- テストテナントの確認（実行前に必ず）
SELECT id, name, created_at FROM tenants WHERE id = '<tenant_id from accounts.local.json>';
```

prod 接続情報は [`docs/deploy.md`](../../../docs/deploy.md) §2 参照（Session Pooler / port 5432）。

### 5. クリーンアップ（再テスト用、要ユーザー承認）

quota は `outreach_logs` の `status='sent'` 行数で決まるため、**row 削除でデイリー / ライフタイム両方が回復**する。

特定 prospect だけ再テスト可能にする：

```sql
DELETE FROM outreach_logs
  WHERE tenant_id = '<tenant_id from accounts.local.json>'
    AND project_id = '<project-id>'
    AND prospect_id = '<prospect-id>';
UPDATE project_prospects SET status = 'new'
  WHERE project_id = '<project-id>' AND prospect_id = '<prospect-id>';
```

テストテナントを丸ごとリセット：

```sql
DELETE FROM outreach_logs WHERE tenant_id = '<tenant_id from accounts.local.json>';
UPDATE project_prospects pp SET status = 'new'
  FROM projects p
  WHERE pp.project_id = p.id
    AND p.tenant_id = '<tenant_id from accounts.local.json>'
    AND pp.status != 'new';
```

**実行前に必ず Step 4 の `tenants` SELECT で `tenant_id` がテストテナントであることを確認**してから流すこと（誤って本番テナントを触らないため）。

## トラブルシューティング

- **MCP OAuth 失効 (401/412)**：Test mode の Google OAuth は 7 日無使用で refresh token が切れる。対象 TIER のログイン flow をやり直す（"初回セットアップ" の Step 1+2）。
- **quota 枯渇**：Free=5/day+50 lifetime / Starter=1500/mo / Pro=10000/mo / Scale+unlimited=実質無制限。Step 5 のクリーンアップで回復。プラン別の挙動を見たい場合は `TIER` を切り替える。
- **`tenant_id` を JSON に書き忘れた**：初回サインアップ後にユーザーから ID をもらい、`accounts.local.json` の該当プランの `tenant_id` フィールドを更新。
- **Gmail のスパム学習**：同種メール連投で受信箱がスパム判定し始めたら、Gmail のフィルタで「迷惑メールにしない」ルールを `from:noreply@leadace.ai` 等に対して設定。
- **コンテナで `fetch_url.py` が遅い / SPA を取れない**：本番でも同じ挙動。ハーネス固有の問題ではない。

## やってはいけないこと

- 本番テナント（自分のメインテナント含む）に対するテスト送信
- 認証なしで prod DB に書き込み
- `outreach_logs` に直接 `INSERT`（テスト用ログを偽造する目的でも禁止——quota の正当性が壊れる）
- ハーネスのテストシナリオに `--dangerously-skip-permissions` 等を追加して安全弁を外すこと
- `accounts.local.json` を git に commit すること（`*.local.json` で gitignore 済みだが、明示的に確認）

## 関連リソース

- ハーネス機構の詳細：[`e2e/README.md`](../../../e2e/README.md)
- アカウントスキーマ：[`e2e/accounts.local.json.example`](../../../e2e/accounts.local.json.example)
- 本番デプロイ手順・DB 接続情報：[`docs/deploy.md`](../../../docs/deploy.md)
- プラグインのスキル一覧と仕様：`plugin/skills/`
- 全体タスク管理：[`docs/tasks.local.md`](../../../docs/tasks.local.md)
