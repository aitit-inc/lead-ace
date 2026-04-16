# Lead Ace 大規模アップデート タスクリスト

アーキテクチャ設計: [large_update_infra_arch.md](./large_update_infra_arch.md)

## 背景・目的

現在の構成（ローカルSQLite + Pythonスクリプト直叩き）から、クラウド対応の本格的なバックエンドアーキテクチャへ移行する。

### 現状の問題
- DB がローカル SQLite のため、Cloud Scheduled Tasks（Claude Code ウェブ版）と併用するとDBが同期できない
- DB操作がPythonスクリプト直叩きで型安全性・保守性が低い
- マルチプロジェクト管理が単一ユーザーのローカル環境前提で設計されている

### 現在のスキル一覧と概要

| スキル | 概要 |
|---|---|
| `/setup` | プロジェクト初期化。DBセットアップ・グローバル登録・ライセンスチェック |
| `/strategy` | 対話的に事業情報を収集し BUSINESS.md / SALES_STRATEGY.md を生成・更新 |
| `/build-list` | Web探索で営業先候補を収集→連絡先を調査→DBに登録（4フェーズ）|
| `/outbound` | 未接触の営業先にメール・フォーム・SNS DMでアプローチ実行 |
| `/check-results` | Gmail・SNSの返信を監視し responses テーブルに記録、ステータス更新 |
| `/evaluate` | 反応率・チャネル効果・メッセージ分析に基づき SALES_STRATEGY.md を自動改善 |
| `/daily-cycle` | check-results → evaluate → outbound + build-list をサブエージェントで自動実行 |
| `/delete-project` | プロジェクト登録解除・DBレコード削除 |
| `/lead-ace-doctor` | 緊急DB修正。確認付き直接SQL実行 |

### 目指す構成

```
[Claude Code / Managed Agent]
         ↓ MCP Protocol
  [MCP Server (Cloudflare Workers)]  ← AI向けの薄いadapter層
         ↓ Internal HTTP
  [Web API Server (Cloudflare Workers)]  ← 業務ロジック・DBアクセスの唯一の窓口
         ↓                        ↑
     [Supabase (PostgreSQL)]   [Web Frontend (Cloudflare Pages)]
         ↓
  [Cloudflare Queues → Worker (非同期ジョブ)]
```

**重要な設計上の注意:** メール送信・フォーム入力・SNS DMなどの「実際の送信アクション」は引き続きユーザーのローカル環境（gog, playwright-cli, Claude-in-Chrome）で実行される。MCP Server が担うのはデータ操作（営業先取得・送信ログ記録・ステータス更新）のみ。

---

## 設計方針: 型安全・スキーマ厳密化

TypeScript 移行・PostgreSQL 移行を機に、**型で縛れるものは全て型で縛る**。曖昧な仕様は先に潰す。

### 基本原則

- TypeScript の `any` 禁止。型推論できない場合は設計を見直す
- 値の取りうる範囲が決まっているカラムは `TEXT` ではなく PostgreSQL `ENUM` 型にする
- JSON 文字列で保存していたカラムは `JSONB` + TypeScript 型定義に変える
- `NULL` を許容するカラムは本当に NULL が必要かを確認してから設計する
- 整数の取りうる範囲が決まっている場合は `CHECK` 制約を入れる
- トリガー等でDBレベルで整合性を守っていたルールは、API レイヤーの型・バリデーションで代替する（APIが唯一の入口なので DB トリガーより API で守る方がシンプル）

### 実装中の判断ルール

実装を進める中で以下に該当するものが出てきた場合は**必ずユーザーに確認・提案してから進める**:

- 「etc.」が付いた列挙（将来拡張の余地があるか？ or 今の値で閉じるか？）
- NULL 許容カラムで「なぜ NULL になりうるか」が不明なもの
- JSON 文字列で保存しているデータの型定義が不明確なもの
- ビジネスルール上「ありえないはずの組み合わせ」が型・制約で防がれていないもの
- 廃止・統合できそうな重複した概念や仕様

### 現スキーマで型に変換すべき主な箇所（要設計確認）

移行前に以下の方針を決めること。実装開始時に改めて確認する。

| カラム | 現状 | 候補値 | 確認事項 |
|---|---|---|---|
| `project_prospects.status` | `TEXT` | `new \| contacted \| responded \| converted \| rejected \| inactive \| unreachable` | 値はこれで全部か？ → ENUM 化 |
| `outreach_logs.channel` | `TEXT`（"etc."付き）| `email \| form \| sns_twitter \| sns_linkedin` | "etc."は将来拡張か？今の4値で閉じてENUM化するか？ |
| `outreach_logs.status` | `TEXT` | `sent \| failed` | 2値のみ確定 → ENUM 化 |
| `responses.sentiment` | `TEXT` | `positive \| neutral \| negative` | 3値のみ確定 → ENUM 化 |
| `responses.response_type` | `TEXT`（"etc."付き）| `reply \| auto_reply \| bounce \| meeting_request \| rejection` | "etc."は将来拡張か？今の値で閉じてENUM化するか？ |
| `prospects.form_type` | `TEXT` | `google_forms \| native_html \| wordpress_cf7 \| iframe_embed \| with_captcha` | 値はこれで全部か？ → ENUM 化 |
| `prospects.org_lookup_status` | `TEXT`（NULL=未検索）| `not_applicable \| unresolvable` | NULL を「未検索」の意味に使っているが、`pending` 等の明示値にした方が良いか？ |
| `project_prospects.priority` | `INTEGER 1-5` | 1〜5 | `CHECK (priority BETWEEN 1 AND 5)` 制約を追加。型は `smallint` で良いか？ |
| `evaluations.metrics` | `TEXT`（JSON文字列）| `{ total_sent: number, response_rate: number, ... }` | TypeScript 型定義が必要。フィールドを確定する |
| `evaluations.improvements` | `TEXT`（JSON配列）| 配列の要素型が不明 | 要素の型定義が必要。現行スキルの出力を見て決める |
| `prospects.sns_accounts` | `TEXT`（JSON文字列）| `{ twitter?: string, linkedin?: string }` | JSONB 化 + TypeScript 型定義。フィールドを確定する |

---

## 開発方針: 各技術のベストプラクティス確認

フェーズ2以降で新しいサービス・フレームワーク・ツールを導入する際は、**実装に入る前に「2026年時点のベストプラクティス」をざっと確認する**。

細部まで詰めすぎる必要はないが、「王道パターンを外す」「後から大きく直す羽目になる」を防ぐための最低限の確認を行う。

### 確認の粒度

- 公式ドキュメントの「Getting Started」「Best Practices」「Migration Guide」程度を流し読み
- 有名な落とし穴（接続方式、認証フロー、デプロイ設定等）を把握する
- 不明点・迷い所があればユーザーに共有してから進む

### 導入時に確認すべき技術と主なチェックポイント

| 技術 | 導入フェーズ | 主なチェックポイント |
|---|---|---|
| **Cloudflare Workers + Wrangler** | 2-1 | Workers の制約（CPU時間・メモリ・サイズ上限）、`wrangler.toml` の書き方、ローカル dev サーバーの起動方法、環境変数の扱い（`wrangler secret` vs `vars`） |
| **Hono** | 2-1 | Cloudflare Workers との統合方法、ミドルウェアの書き方、型安全なルーティング（`app.route` + Zod バリデーション）、エラーハンドリング |
| **Drizzle ORM** | 2-2 | `drizzle-kit` によるマイグレーション運用、PostgreSQL ENUM の定義方法、Cloudflare Workers 環境での接続方法（`neon` / `postgres.js` / Supabase Pooler）、`drizzle-zod` による型生成 |
| **Supabase（DB・ローカル開発）** | 2-2 | `supabase` CLI でのローカル環境起動方法、RLS（Row Level Security）の設計方針、Pooler 接続（Transaction mode）の設定、Supabase local + docker compose の組み合わせ |
| **Supabase Auth** | 2-3 | Cloudflare Workers での JWT 検証方法（`jose` ライブラリ等）、`Authorization: Bearer` ヘッダーの扱い、ユーザー情報をどこまでDBに持つか |
| **MCP SDK（@modelcontextprotocol/sdk）** | 2-4 | Cloudflare Workers での Streamable HTTP トランスポートの実装方法、Tool 定義の Zod スキーマ記述、認証フロー（OAuth 2.1 / APIキー）の現時点の推奨方式 |

---

## フェーズ1: リポジトリ移行

**目標:** `aitit-inc/claude-plugins` → `aitit-inc/lead-ace` への移行と、将来のバックエンド追加を見越したディレクトリ構造の確立

**ローカル作業ディレクトリ:** `/Users/leo/work/so/lead-ace`（フェーズ1完了後、以降の全作業はここで行う）

### ディレクトリ構造

```
lead-ace/                           ← git repo root
├── .claude-plugin/
│   └── marketplace.json            ← source: "./plugin/" を指す
├── plugin/                         ← Claude Code プラグイン本体（現 plugins/lead-ace/ の中身）
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── skills/
│   ├── scripts/                    ← フェーズ3で廃止予定
│   ├── migrations/                 ← フェーズ3で廃止予定
│   ├── references/
│   └── docs/
├── backend/                        ← フェーズ2で新設
├── frontend/                       ← フェーズ4で新設
├── docker-compose.yml              ← フェーズ2で追加
├── CLAUDE.md
├── README.md
└── LICENSE
```

### タスク

- [ ] `aitit-inc/lead-ace` リポジトリを `/Users/leo/work/so/lead-ace` にローカルクローン
- [ ] `plugin/` ディレクトリを作成し、現 `plugins/lead-ace/` の中身をコピー
- [ ] ルートに `.claude-plugin/marketplace.json` を作成（`source: "./plugin/"` を指定）
- [ ] インストールコマンドを確認: `/plugin marketplace add aitit-inc/lead-ace` → `/plugin install lead-ace@lead-ace`
- [ ] CLAUDE.md を新リポジトリ向けに更新（マルチプラグイン前提の記述を削除、パス修正等）
- [ ] 旧 `aitit-inc/claude-plugins` の README に移行先を案内
- [ ] このドキュメント（`large_update_tasks.md`）と `large_update_infra_arch.md` を新リポジトリの `plugin/docs/` にコピー（以降の編集は新リポジトリ側で行う）

### レビュー

**できていること（確認必須）:**
- [ ] `git clone aitit-inc/lead-ace` → `/plugin marketplace add aitit-inc/lead-ace` → `/plugin install lead-ace@lead-ace` が通る
- [ ] `/setup`, `/strategy`, `/build-list`, `/outbound`, `/check-results`, `/evaluate`, `/daily-cycle`, `/delete-project`, `/lead-ace-doctor` の全9スキルが従来と同じ動作をする（Python スクリプト版のまま）
- [ ] `${CLAUDE_PLUGIN_ROOT}` が `plugin/` を指していてスクリプトパスが壊れていない
- [ ] `plugin/.claude-plugin/plugin.json` のバージョンが正しく、インストール後に表示される

**まだできていなくて良いこと:**
- バックエンド・MCP Server・フロントエンドは存在しない
- Supabase に接続していない
- Cloud Scheduled Tasks との統合は未対応

---

## フェーズ1.5: 全コンテンツの英語化 ✅ 完了

**目標:** 日本語ユーザー限定だったプラグインをグローバル版にする。plugin/docs/ 配下（開発用一時ドキュメント）を除く全ファイルを英語化。

### 対応内容

- `plugin/README.md`、`CLAUDE.md`（リポジトリルート）→ 英語化
- `plugin/.claude-plugin/plugin.json` → 英語化
- `plugin/references/workspace-conventions.md` → 英語化
- `plugin/skills/*/SKILL.md`（全9スキル）→ 英語化
- `plugin/skills/*/references/*.md`（全参照ファイル）→ 英語化
- `plugin/scripts/*.py`（コメント・docstring・メッセージ）→ 英語化
- `plugin/migrations/*.py`（コメント・docstring）→ 英語化
- `plugin/scripts/sales-db.sql`（コメント）→ 英語化
- `CLAUDE.md` の「言語: 日本語」→「Language: English」に変更

### グローバル化の追加修正（同セッションで対応）

- メール文字数基準を日本語ベース（文字数）→ 英語ベース（words）に変更
- 法的要件を特定電子メール法（日本）→ CAN-SPAM / GDPR / CASL / Spam Act のグローバル版に変更
- 日本固有のサービス名（Timerex, PR TIMES, INITIAL, STARTUP DB 等）を削除
- 代わりに `/strategy` スキルで「どのプラットフォームを使うか」をユーザーに確認し、SALES_STRATEGY.md の `## Prospect Discovery Sources` セクションに記載する設計に変更
- `enrich-contacts.md` が SALES_STRATEGY.md の Prospect Discovery Sources を参照するよう変更
- ターゲット例示の地名・業界名を汎用化

---

## フェーズ1.7: 法人番号システムのグローバル化 ✅ 完了

**目標:** 日本の国税庁法人番号に依存した組織識別の仕組みを、グローバル対応の汎用識別子に置き換える

### 背景・問題

現在の build-list スキルおよびスクリプト群は、日本固有の**法人番号（13桁）**に強く依存している：

- `check_corporate_number.py`: 国税庁（NTA）APIを叩いて法人番号を取得
- `organizations` テーブル: 法人番号を Primary Key として使用
- 「法人番号が取得できない候補は登録不可」というルール（`add_prospects.py`）
- `build-list/SKILL.md` に法人番号検索のフロー・対処法が詳細記述されている

日本以外の企業・組織には法人番号が存在しないため、このままではグローバルユーザーが利用できない。

### 設計方針（要検討・合意が必要）

以下の方針を決定してから実装に入ること：

#### 組織識別子の設計

| 案 | 内容 | メリット | デメリット |
|---|---|---|---|
| A | 法人番号を廃止し、公式URLをPKに変更 | シンプル・グローバル対応 | URLが変わると別組織扱いになる |
| B | 法人番号をオプション化し、代替として公式URL + 組織名のペアを使用 | 後方互換・柔軟 | 重複チェックが複雑になる |
| C | 国別IDフィールド（`country_code` + `business_id`）を導入 | 将来性・型安全 | 設計コストが高い |

**推奨:** 案Bをベースに検討（法人番号がある場合は使い、ない場合はURL+名前で代替）

#### 影響範囲

- `plugin/scripts/sales-db.sql`: `organizations` テーブルのスキーマ変更
- `plugin/scripts/add_prospects.py`: 法人番号必須バリデーションの廃止
- `plugin/scripts/check_corporate_number.py`: グローバル化または廃止
- `plugin/scripts/check_duplicate.py`: 重複チェックロジックの修正
- `plugin/migrations/`: 新マイグレーション追加
- `plugin/skills/build-list/SKILL.md`: 法人番号検索フローの削除・置換
- `plugin/skills/build-list/references/enrich-contacts.md`: 同上

#### スクリプト移行時の注意

フェーズ2（バックエンド構築）と同時期に対応する場合は、Drizzleスキーマ側で先に設計を確定させること（二度変更しないように）。

### タスク

- [x] 組織識別子の設計方針をユーザーと合意（apex domain をPKに採用）
- [x] `organizations` テーブルのスキーマ変更（`domain TEXT PK`、`country` 追加、`corporate_number` 廃止）
- [x] `prospects.organization_id` を NOT NULL に厳格化（NULLレコードはカスケード削除）
- [x] `add_prospects.py` の法人番号必須バリデーション廃止・ドメインベース重複チェック実装
- [x] `check_corporate_number.py` 廃止（`lookup_corporate_numbers.py`, `link_organization.py`, `mark_org_lookup_status.py` も削除）
- [x] `build-list` スキルから法人番号前提のフローを削除・汎用フローに置換
- [x] マイグレーション追加（010: organizations/prospects 再構築、011: organization_id NOT NULL 強制）
- [x] `enrich-contacts.md` を更新（corporate_number フィールド削除、organization_name オプション化）
- [x] `data-migration-v050` スキル削除（v0.6.0 予定を前倒し）

---

## フェーズ2: バックエンド構築（Cloudflare Workers + Supabase）

**目標:** Web API Server と MCP Server を TypeScript で実装し、Supabase PostgreSQL を使うバックエンド基盤を作る

### 技術スタック

各ツール・ライブラリは**バージョン固定せず最新版をインストール**する。インストール後に実際のバージョンを確認すること。

| 役割 | 技術 |
|---|---|
| ランタイム | Cloudflare Workers (TypeScript) |
| Web フレームワーク | [Hono](https://hono.dev/) |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) |
| DB | Supabase PostgreSQL |
| Auth | Supabase Auth（JWT検証） |
| 非同期ジョブ | Cloudflare Queues |

### 2-1. backend/ プロジェクトのセットアップ ✅ 完了

- [x] **Cloudflare Workers + Wrangler のベストプラクティス確認**（Workers RPC が標準化、`nodejs_compat` フラグ必須）
- [x] **Hono のベストプラクティス確認**（`c.env` 使用、`process.env` 禁止）
- [x] `backend/` に Hono + TypeScript + Drizzle ORM の初期セットアップ（`wrangler.api.jsonc` / `wrangler.mcp.jsonc` 作成）
- [x] 実際に入ったバージョン: Hono 最新、Drizzle ORM 最新、Wrangler 最新、MCP SDK 1.29.0、Zod 4.3.6

### 2-2. Drizzle スキーマ定義 ✅ 完了

- [x] **Drizzle ORM + Supabase のベストプラクティス確認**（`postgres.js` + Transaction Pooler、`prepare: false` 必須）
- [x] **「設計方針: 型安全・スキーマ厳密化」セクションの確認事項をユーザーと合意**（ENUM 化 / org_lookup_status 削除 / JSONB 定義等）
- [x] `backend/src/db/schema.ts` にDrizzleスキーマ定義（6 ENUM + 7 テーブル）
- [x] `drizzle-kit generate` でマイグレーションファイル生成（`drizzle/0000_empty_white_tiger.sql`）
- [x] ローカル PostgreSQL でのマイグレーション動作確認（`docker compose up` + `db:migrate` で適用確認済み）

### 2-3. Web API Server の実装 (Hono) ✅ 完了

- [x] **Supabase Auth（JWT検証）のベストプラクティス確認**（`jose` でローカル検証、高セキュリティなら `getUser()` 必要）
- [x] 各エンドポイントの実装（全11エンドポイント + `/health` + 評価履歴）
- [x] Supabase Auth JWT 検証ミドルウェア（`jose` 使用）
- [x] プロジェクト数制限ロジック（無料: 1プロジェクト）
- [ ] 冪等性キー対応（`Idempotency-Key` ヘッダー）— 後回し可
- [ ] 監査ログ — 後回し可

### 2-4. MCP Server の実装 (Cloudflare Workers) ✅ 完了

- [x] **MCP SDK のベストプラクティス確認**（`WebStandardStreamableHTTPServerTransport` を使用、旧 SSE 方式は非推奨）
- [x] `@modelcontextprotocol/sdk` v1.29.0 を使った MCP Server 実装
- [x] Streamable HTTP トランスポート対応（`WebStandardStreamableHTTPServerTransport`）
- [x] 全 11 Tool の実装（Web API を呼ぶだけ）
- [x] 認証（Supabase Auth JWT 検証）

### 2-5. ローカル開発環境 (Docker Compose) ✅ 完了

- [x] `docker-compose.yml` 作成（PostgreSQL のみ。Workers dev はホストで実行 — `workerd` はネイティブバイナリのため Docker 内では動作しない）
- [x] `.dev.vars.example` / `.dev.vars.mcp.example` テンプレート作成
- [x] ローカル環境での全 API エンドポイント動作確認（全13エンドポイント OK）

### レビュー

**できていること（確認済み）:**
- [x] `docker compose up -d` で PostgreSQL 起動 → `npm run dev:api` / `npm run dev:mcp` で Workers 起動
- [x] `POST /projects` でプロジェクトが作成でき、ライセンス制限（1件まで）が動作する
- [x] `POST /prospects/batch` で営業先が登録でき、メール・フォームURL・ドメインによる重複チェックが動作する
- [x] `GET /projects/:id/prospects/reachable` で優先度順に未接触営業先が返る
- [x] `POST /outreach` で送信ログが記録され、ステータスが `contacted` に更新される
- [x] `POST /responses` で返信記録が保存され、do-not-contact フラグが反映される
- [x] `GET /projects/:id/stats` で evaluate 用の統計データ + dataSufficiency が返る
- [ ] MCP Server の全 Tool が動作し、Claude Code からツールとして呼べる（フェーズ3でスキル書き直し時に確認予定）

**まだできていなくて良いこと:**
- プラグイン側（Claude Code スキル）はまだ Python スクリプト版のまま
- Cloudflare 本番環境へのデプロイは未完了でも良い（ローカルで動けばOK）
- フロントエンドはない
- Cloudflare Queues を使った非同期ジョブ化は未実装でも良い

---

## フェーズ3: プラグイン側の更新 ✅ 完了

**目標:** 全スキルを「Python スクリプト直叩き」から「MCP Server ツール経由」に移行し、Pythonスクリプトを廃止する

### 重要な前提

メール送信（gog）・フォーム入力（playwright-cli）・SNS DM（Claude-in-Chrome）の「実際の送信アクション」はユーザーのローカルで実行される。MCP化するのはその前後のデータ操作（営業先取得・送信ログ記録・ステータス更新）のみ。

### 3-0. バックエンド追加（前提条件） ✅ 完了

- [x] `GET /api/projects` エンドポイント + `list_projects` MCP tool 追加
- [x] `GET /projects/:id/prospects/reachable` に `total` + `byChannel` メタデータ追加（MCP tool も更新）
- [x] `get_evaluation_history` MCP tool 追加（既存 API エンドポイントへのプロキシ）
- [x] `record_response` のステータス自動判定ロジック修正（responseType + sentiment ベース）
- [x] bounce 時の doNotContact 自動設定

### 3-1. MCP サーバー設定を追加 ✅ 完了

- [x] `plugin/.mcp.json` を作成（HTTP type、`${LEADACE_MCP_URL}` + `${LEADACE_AUTH_TOKEN}` 環境変数）

### 3-2. 各スキルの書き直し ✅ 完了

- [x] **delete-project**: `license.py` + `delete_project.py` → `delete_project` MCP tool
- [x] **setup**: `license.py` + `init_db.py` + `preflight.py` → `setup_project` MCP tool。ローカルライセンス管理廃止
- [x] **strategy**: `preflight.py` + `sales_queries.py` → `list_projects` + `get_evaluation_history` MCP tools
- [x] **check-results**: `preflight.py` + `sales_queries.py` + `record_response.py` → `get_recent_outreach` + `record_response` MCP tools
- [x] **evaluate**: `preflight.py` + 9個の eval クエリ + `record_evaluation.py` → `get_eval_data` + `get_evaluation_history` + `record_evaluation` MCP tools
- [x] **build-list**: `preflight.py` + `filter_duplicates.py` + `merge_prospects.py` + `add_prospects.py` → `get_prospect_identifiers` + `add_prospects` MCP tools。LLM がマージ・重複フィルタを直接担当
- [x] **outbound**: `preflight.py` + `send_and_log.py` + `update_status.py` → `get_outbound_targets` + `record_outreach` + `update_prospect_status` MCP tools。送信は `gog` ローカル実行のまま
- [x] **daily-cycle**: 全サブエージェントプロンプトを MCP tool 経由に更新。`data.db` の git commit を削除

### 3-3. 廃止ファイルの整理 ✅ 完了

- [x] `plugin/scripts/` 以下の Python スクリプト全廃止（`fetch_url.py` のみ残存）
- [x] `plugin/migrations/` 廃止
- [x] `plugin/skills/lead-ace-doctor/` 廃止（Drizzle Studio で代替）
- [x] `plugin/skills/evaluate/references/evaluation-queries.sql` 廃止
- [x] CLAUDE.md 更新（DB Migrations セクション削除、Separation of Responsibilities 更新、Pre-Release Checklist 更新）
- [x] `workspace-conventions.md` 更新（data.db・SQLite 参照を削除、MCP tool エラーハンドリング追加）

### レビュー

**できていること（確認必須）:**
- [ ] `/setup` でプロジェクトが作成でき、無料プラン1件制限が動作する
- [ ] `/strategy` で BUSINESS.md / SALES_STRATEGY.md が生成・更新できる
- [ ] `/build-list` で Web 探索 → 営業先登録が動作し、重複がサーバー側で排除される
- [ ] `/outbound` で営業先をMCP経由で取得し、送信後にMCPツールでログ記録できる
- [ ] `/check-results` で Gmail / SNS の返信がMCPツール経由でDBに記録される
- [ ] `/evaluate` でMCPツールから統計データを取得し、SALES_STRATEGY.md が更新される
- [ ] `/daily-cycle` が全フェーズを通して動作する（check-results → evaluate → outbound + build-list）
- [ ] `/delete-project` でプロジェクトが削除される
- [ ] Python スクリプト（`plugin/scripts/`）が `fetch_url.py` 以外全て廃止されている
- [ ] `docker compose up` → プラグインの全スキルが一通り使える

**まだできていなくて良いこと:**
- Cloudflare 本番へのデプロイは未完了でも良い
- フロントエンドはまだない
- Cloudflare Queues を使った非同期ジョブ化は未実装でも良い

---

## フェーズ4: フロントエンド（管理画面）✅ 完了

**目標:** 結果確認・高リスク操作の承認のための最小限UI

### 技術スタック

- Cloudflare Pages + SvelteKit (Svelte 5, runes mode)
- Tailwind CSS v4
- Supabase Auth（`@supabase/supabase-js` クライアントサイドJWT）
- SPA mode (`ssr: false`)

### 4-0. バックエンド追加（前提条件） ✅ 完了

- [x] `GET /api/projects/:id/prospects` — 全営業先一覧（status, priority フィルタ対応）
- [x] `GET /api/projects/:id/responses` — 返信一覧（sentiment, responseType フィルタ対応）
- [x] `PATCH /api/prospects/:id/do-not-contact` — doNotContact フラグ切り替え

### 4-1. プロジェクトセットアップ ✅ 完了

- [x] SvelteKit + Cloudflare Pages adapter + Tailwind CSS v4
- [x] Supabase Auth クライアント + auth store
- [x] API クライアント（Bearer token 自動付与）
- [x] ログインページ
- [x] ルートレイアウト（認証ゲート）

### 4-2. レイアウト・プロジェクト切り替え ✅ 完了

- [x] サイドバーナビゲーション（Prospects, Outreach, Responses, Evaluations, Settings）
- [x] ProjectSwitcher（ドロップダウン、localStorage 永続化）

### 4-3. ページ実装 ✅ 完了

- [x] プロジェクト一覧・切り替え
- [x] 営業先リスト（ステータス・優先度フィルタ、組織名表示、展開詳細）
- [x] アウトバウンドログ（送信日時・チャネル・件名・本文、展開表示）
- [x] 返信一覧（センチメント・タイプ別フィルタ、展開表示）
- [x] 評価・戦略サマリー（KPIダッシュボード + 評価履歴）
- [x] Settings（プロジェクト削除 with 確認ダイアログ）

### デザイン

- フラットUI、枠線最小、AI感なし
- カラー: グレースケール中心 + `#D06A57`（アクセント）, `#333333`（テキスト）, `#F6EEE6`（ウォーム背景）
- フォント: Inter（本文）+ JetBrains Mono（数値・コード）
- 全て英語

### レビュー

**できていること（確認必須）:**
- [ ] ログイン・ログアウトができる
- [ ] プロジェクトを切り替えると営業先リスト・ログが変わる
- [ ] 営業先リストのステータス（new / contacted / responded / rejected 等）が確認できる
- [ ] アウトバウンドログで送信日時・チャネル・本文が確認できる
- [ ] 返信一覧でセンチメント（positive/neutral/negative）が確認できる

**まだできていなくて良いこと:**
- 高度な分析ダッシュボードは未完成でも良い
- 全ての承認フローは最小限でも良い

---

## フェーズ4.5: ナレッジ・ドキュメントのDB集約

**目標:** ローカルファイル（BUSINESS.md, SALES_STRATEGY.md 等）をすべてDBに移行し、データ管理を完全にDB集約する。ローカルにプロジェクトディレクトリを作る必要をなくし、git 依存も廃止する。

### 背景・問題

現状、データが2箇所に分散している：
- **DB（MCP経由）:** prospects, outreach_logs, responses, evaluations
- **ローカルファイル:** BUSINESS.md, SALES_STRATEGY.md, SEARCH_NOTES.md, RESULTS_REPORT.md, EVALUATION_REPORT.md, DAILY_CYCLE_REPORT.md

この分散は以下の問題を生む：
- Cloud Scheduled Tasks（ウェブ版）ではローカルファイルにアクセスできない
- 複数マシンから同じプロジェクトで作業するとファイルが同期されない
- git でのバージョン管理が本質的でない作業を増やしている

### 設計方針

#### テーブル設計: `project_documents`

```sql
project_documents:
  id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  slug          TEXT NOT NULL  -- "business", "sales_strategy", "search_notes", etc.
  content       TEXT NOT NULL  -- markdown 全文
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

  INDEX idx_doc_latest ON (project_id, slug, created_at DESC)
```

**設計判断の根拠:**

1. **構造化しない**: BUSINESS.md や SALES_STRATEGY.md の中身は LLM にコンテキストとして丸ごと投げるだけ。セクション単位でDBカラムに分けても意味がない。構造はスキルのテンプレートが定義し、LLM が解釈する。
2. **イミュータブル追記**: 更新のたびに新行を追加。最新版は `ORDER BY created_at DESC LIMIT 1`。変更履歴はそのまま残る。
3. **古いバージョンの処理は後回し**: 初期はそのまま蓄積。データが増えてきたら古いバージョンを archive テーブルに移す or 削除するポリシーを後で決めればよい。
4. **一時ファイル（.tmp/）はDB不要**: 旧設計ではサブエージェントの詳細結果を .tmp/ に書いて wrap-up で読んでいたが、今は全詳細データが MCP 経由で DB に入っている（record_outreach, record_response 等）。サブエージェントは短い完了サマリーだけ返し、wrap-up は DB クエリで詳細を取得する。一時ストレージ（ファイル、DB、Durable Objects）は不要。

#### ドキュメント種別（slug）

| slug | 旧ファイル名 | 作成 | 更新 | 備考 |
|---|---|---|---|---|
| `business` | BUSINESS.md | /strategy | /strategy | 事業情報。めったに変わらない |
| `sales_strategy` | SALES_STRATEGY.md | /strategy | /strategy, /evaluate, /daily-cycle | 最も頻繁に更新。evaluate-managed sections あり |
| `search_notes` | SEARCH_NOTES.md | /build-list | /build-list, /evaluate | 検索戦略メモ |

**廃止するドキュメント（二次情報）:**
- `RESULTS_REPORT.md` — `responses` + `outreach_logs` のクエリで再生成可能。削除
- `EVALUATION_REPORT.md` — `evaluations` テーブルに findings + improvements が既にある。削除
- `DAILY_CYCLE_REPORT.md` — 実行結果は DB にある。引き継ぎ判断（「次回 build-list 優先」等）は DB の状態（残 reachable 数等）から再判断すればよく、スキルにロジックが書いてある。削除

### 4.5-1. バックエンド（DB + API + MCP）

#### DB スキーマ

- [ ] `project_documents` テーブルを `backend/src/db/schema.ts` に追加
- [ ] マイグレーション生成・適用

#### API エンドポイント

- [ ] `GET /api/projects/:id/documents` — slug 一覧（各 slug の最終更新日時）
- [ ] `GET /api/projects/:id/documents/:slug` — 最新版の content を返す（なければ 404）
- [ ] `GET /api/projects/:id/documents/:slug/history?limit=10` — バージョン履歴（content 含む）
- [ ] `PUT /api/projects/:id/documents/:slug` — 新バージョンを追記。body: `{ content: string }`

#### MCP ツール

- [ ] `get_document(projectId, slug)` — 最新版を取得
- [ ] `save_document(projectId, slug, content)` — 新バージョンを保存
- [ ] `list_documents(projectId)` — ドキュメント一覧

### 4.5-2. スキル書き換え

全スキルからローカルファイル操作を MCP ドキュメント操作に置き換える。

- [ ] **setup**: ローカルディレクトリ作成を廃止。`.gitignore` 作成を廃止。依存チェックから `git` を外す
- [ ] **strategy**: BUSINESS.md / SALES_STRATEGY.md の Read/Write を `get_document` / `save_document` に置換
- [ ] **build-list**: SEARCH_NOTES.md の Read/Write を MCP に置換。BUSINESS.md / SALES_STRATEGY.md の Read を MCP に置換
- [ ] **outbound**: BUSINESS.md / SALES_STRATEGY.md の Read を MCP に置換
- [ ] **check-results**: RESULTS_REPORT.md 生成を廃止。SALES_STRATEGY.md の Read を MCP に置換
- [ ] **evaluate**: EVALUATION_REPORT.md 生成を廃止。SALES_STRATEGY.md / SEARCH_NOTES.md の Read/Write を MCP に置換
- [ ] **daily-cycle**: `.tmp/` ディレクトリを廃止（サブエージェントは短い完了サマリーのみ返し、詳細は各自が `record_outreach` / `record_response` 等で既に DB に記録済み）。DAILY_CYCLE_REPORT.md 生成を廃止。SALES_STRATEGY.md の KPI Actuals 更新を MCP に置換。**git add / commit / push を廃止**。通知メール用レポートは DB クエリから生成。引き継ぎ判断は次回実行時に DB の状態（残 reachable 数等）から再判断する
- [ ] **delete-project**: 変更不要（cascade delete で documents も消える）

### 4.5-3. フロントエンド更新

- [ ] Documents ページ追加（business / sales_strategy / search_notes の最新版表示 + 変更履歴）
- [ ] サイドバーに Documents リンク追加

### 4.5-4. 整理

- [ ] `plugin/references/workspace-conventions.md` 更新（ローカルディレクトリ構造の記述を削除、MCP ドキュメント操作の説明に置換）
- [ ] CLAUDE.md 更新（git 関連の記述を削除、ドキュメント管理の説明を追加）

### レビュー

**できていること（確認必須）:**
- [ ] `/strategy` で BUSINESS.md / SALES_STRATEGY.md が DB に保存され、再取得できる
- [ ] `/build-list` が DB から SALES_STRATEGY.md / SEARCH_NOTES.md を読み、SEARCH_NOTES.md を DB に保存できる
- [ ] `/outbound` が DB から戦略ドキュメントを読んで送信できる
- [ ] `/check-results` が DB からデータを取得し、ローカルファイルを一切使わない
- [ ] `/evaluate` が DB のドキュメントを読み書きし、SALES_STRATEGY.md を更新できる
- [ ] `/daily-cycle` が全フェーズを通して動作し、ローカルファイル・git を一切使わない
- [ ] ドキュメント（business, sales_strategy, search_notes）の変更履歴が DB に残り、過去バージョンを参照できる
- [ ] プロジェクト削除で関連ドキュメントも cascade 削除される
- [ ] フロントエンドでドキュメント一覧・内容が閲覧できる

**まだできていなくて良いこと:**
- 古いバージョンの自動アーカイブ・削除ポリシーは未実装でも良い
- ドキュメント間の diff 表示は未実装でも良い

---

## フェーズ4.7: プラグイン側ナレッジ・ロジックのクラウド移行

**目標:** プラグインを「システムを動作させるための必要最小限」にする。ドメイン知識（テンプレート、ガイドライン、分析フレームワーク等）をDBマスターデータに移行し、MCP経由で取得する構成にする。

### 背景・問題

現状、プラグインの `references/` 配下にドメイン知識（テンプレート、メールガイドライン、ターゲティングガイド等、計約1,000行）が存在する。これらはプラグインのバージョンに固定されており：

- クラウド側で改善・更新しても、ユーザーがプラグインを更新しないと反映されない
- evaluate スキルが戦略を改善しても、テンプレートや基準自体は静的なまま
- プラグイン内のファイルが増えると Claude のコンテキストを圧迫する

### 設計方針

#### プラグインに残すもの（ローカル実行が必要 or システム制御に直結）

| ファイル | 理由 |
|---|---|
| `skills/*/SKILL.md` | スキルの手順定義。Claude Code のスキルローダーが読む |
| `scripts/fetch_url.py` | ローカル実行が必要（Jina Reader + SPA 対応）|
| `references/workspace-conventions.md` | システム規約（プラグインの動作ルール自体）|
| `outbound/references/playwright-guide.md` | ローカルブラウザ操作手順（playwright-cli 依存）|
| `outbound/references/form-filling.md` | ローカルブラウザ操作手順（同上）|

#### DBマスターデータに移行するもの（ドメイン知識）

| 現在のファイル | slug（案） | 説明 |
|---|---|---|
| `strategy/references/business-template.md` | `tpl_business` | BUSINESS.md テンプレート |
| `strategy/references/strategy-template.md` | `tpl_sales_strategy` | SALES_STRATEGY.md テンプレート |
| `strategy/references/targeting-guide.md` | `tpl_targeting_guide` | ターゲティング精緻化ガイド |
| `strategy/references/industry-email-templates.md` | `tpl_email_templates` | 業界別メールテンプレート集 |
| `outbound/references/email-guidelines.md` | `tpl_email_guidelines` | メール作成ガイドライン |
| `build-list/references/enrich-contacts.md` | `tpl_enrich_contacts` | 連絡先調査手順 |
| `evaluate/references/analysis-frameworks.md` | `tpl_analysis_frameworks` | 評価分析フレームワーク |

#### テーブル設計: `master_documents`

```sql
master_documents:
  id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  slug          TEXT NOT NULL UNIQUE  -- "tpl_business", "tpl_email_guidelines", etc.
  content       TEXT NOT NULL         -- markdown 全文
  version       INT NOT NULL DEFAULT 1
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

プロジェクト非依存のグローバルマスターデータ。認証不要（全ユーザー共通）or 読み取り専用。

### 4.7-0. 責務分離・境界の定義

実装前に、現状のスキル・リファレンスを全て精査し、以下を確定する：

- [x] 全 reference ファイルの内容を確認し、上記分類が正しいか検証
- [x] SKILL.md 内にインラインで埋め込まれているドメイン知識（テンプレート断片、判断基準等）を洗い出す
- [x] 移行対象の最終リストを確定し、ユーザーと合意
- [x] `master_documents` vs `project_documents` の使い分けルールを文書化

### 4.7-1. バックエンド（DB + API + MCP）

- [x] `master_documents` テーブルを `backend/src/db/schema.ts` に追加
- [x] マイグレーション生成・適用
- [x] `GET /api/master-documents/:slug` — マスタードキュメント取得
- [x] `GET /api/master-documents` — マスタードキュメント一覧
- [x] `get_master_document(slug)` MCP ツール追加
- [x] `list_master_documents` MCP ツール追加
- [x] 初期データ投入（seed）: 現在の reference ファイルの内容を DB に登録（`backend/scripts/seed-master-documents.ts`）

### 4.7-2. スキル書き換え

- [x] 各スキルの `Read references/...` を `get_master_document` MCP ツール呼び出しに置換
- [x] SKILL.md 内のインラインドメイン知識があれば、マスタードキュメントに抽出（抽出不要と確認済み）
- [x] プラグインから移行済みの reference ファイルを削除（7ファイル削除、空ディレクトリも削除）

### 4.7-3. 整理・レビュー

- [x] プラグインに残るファイル一覧を確認（SKILL.md + ローカル操作系 reference + scripts + workspace-conventions のみ）
- [x] CLAUDE.md 更新（マスタードキュメントの説明追加）
- [x] workspace-conventions.md 更新（マスタードキュメント参照方法）
- [ ] 全スキルの動作確認

### レビュー

**できていること（確認必須）:**
- [ ] `/strategy` がマスタードキュメントからテンプレートを取得し、正しく BUSINESS.md / SALES_STRATEGY.md を生成できる
- [ ] `/build-list` がマスタードキュメントから enrich-contacts 手順を取得し、連絡先調査できる
- [ ] `/outbound` がマスタードキュメントからメールガイドラインを取得し、メール作成できる
- [ ] `/evaluate` がマスタードキュメントから分析フレームワークを取得し、評価・改善できる
- [ ] プラグイン側に移行済みの reference ファイルが残っていない
- [ ] マスタードキュメントの内容を更新すると、次回のスキル実行から反映される

**まだできていなくて良いこと:**
- マスタードキュメントの管理UI（フロントエンド）は未実装でも良い
- マスタードキュメントのバージョン管理（変更履歴）は最小限で良い

---

## フェーズ5: サブスクリプション・デプロイ

**目標:** Stripe 連携によるプラン管理と、Cloudflare + Supabase 本番環境へのデプロイ

### プラン設計（確定済み）

| | Free (trial) | Starter $29/mo | Pro $79/mo | Scale $199/mo |
|---|---|---|---|---|
| プロジェクト数 | 1 | 1 | 5 | Unlimited |
| Outreach actions | 10 (lifetime) | 1,500/mo | 10,000/mo | Unlimited |
| Prospect 登録 | 30 (lifetime) | — | — | — |
| 年額 | — | $290 (17%割引) | $790 | $1,990 |

- Free 制限は lifetime（使い切り）。有料は月間リセット
- Outreach action = `record_outreach` with `status: "sent"`
- Self-host: GitHub で無料公開。1プロジェクト、クラウド機能なし（ユーザーが自分で docker-compose で全スタック起動）

### 決済設計（確定済み）

- **Stripe Checkout**: 新規サブスク加入（フロントエンドからリダイレクト、`client_reference_id` に Supabase userId を付与）
- **Stripe Customer Portal**: アップグレード・ダウングレード・キャンセル（フロントエンドから外部リンク）
- **Stripe Webhook**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` を受信して DB 更新
- アプリ内に決済 UI は作らない

### クォータ制御（確定済み）

- `get_outbound_targets`: `min(requested, remainingQuota, availableTargets)` を返す。呼び出しのたびに残り枠を再計算（今月の sent 数をカウント）。枠 0 → ターゲット 0 件 + アップグレードメッセージ
- `record_outreach`: 二重安全ガード（枠超過時は拒否）
- `add_prospects`: Free プランのみ 30 件 lifetime 上限チェック
- プロジェクト作成: プラン別のプロジェクト数上限チェック（現行の `FREE_PLAN_PROJECT_LIMIT = 1` を拡張）

### 5-1a. テナント分離 ✅ 完了

マルチテナント対応のスキーマリファクタリング。全データテーブルに `tenant_id` を追加し、テナント単位でデータを隔離。

- [x] `tenants` + `tenant_members` テーブル追加
- [x] `tenant_plans` テーブル追加（旧 `user_plans` を tenantId ベースに変更）
- [x] 全データテーブルに `tenant_id` カラム追加
- [x] `organizations` PK を `domain (text)` → `id (auto-int)` に変更、`UNIQUE(tenant_id, domain)`
- [x] ユニーク制約（email, form URL）をテナントスコープに変更
- [x] Auth ミドルウェアで userId → tenantId 自動解決（初回アクセス時にテナント自動生成）
- [x] 全 API ルートを tenantId フィルタリングに更新
- [x] クォータ計算を tenantId ベースに更新（JOIN 不要で高速）
- [x] マイグレーションをクリーンに再生成

### 5-1b. サブスクリプション管理 ✅ バックエンド完了

#### DB + API + MCP（完了）
- [x] `tenant_plans` テーブル（plan enum, Stripe ID, billing period）
- [x] `POST /api/stripe/webhook` — Stripe イベント処理（署名検証 + DB 更新）
- [x] `GET /api/me/plan` — 現在のプラン + クォータ情報取得
- [x] `POST /api/me/checkout` — Stripe Checkout Session 作成
- [x] `POST /api/me/portal` — Stripe Customer Portal Session 作成
- [x] プロジェクト作成のプラン別制限（tenant_plans 参照）
- [x] `get_outbound_targets` にクォータチェック + `remainingQuota` フィールド追加
- [x] `record_outreach` にクォータガード追加
- [x] `add_prospects` に Free プラン 30 件上限チェック追加

#### フロントエンド（未着手）
- [ ] Settings ページにプラン表示 + "Upgrade" ボタン（→ Checkout）+ "Manage subscription" ボタン（→ Customer Portal）
- [ ] クォータ残量表示（ダッシュボードまたはサイドバー）

### 5-1c. RLS ポリシー追加

テナント分離の defense-in-depth。スキーマは対応済み（全テーブルに tenant_id あり）、ポリシー追加のみ。

- [ ] API ミドルウェアでリクエストをトランザクションで包み、`SET LOCAL app.tenant_id = X` を注入
- [ ] 全テナント依存テーブルに RLS ポリシー追加: `USING (tenant_id = current_setting('app.tenant_id', true))`
- [ ] RLS が有効な状態で全 API エンドポイントの動作確認

### 5-1 レビュー（本番デプロイ前に必須）

- [ ] **テナント分離テスト**: 2つのテストユーザーで、一方のデータが他方に見えないことを確認（全エンドポイント）
- [ ] **クォータテスト**: Free トライアルフロー完走（/strategy → /build-list 30件 → /outbound 10件 → 枠切れメッセージ）
- [ ] **organizations PK 変更の影響確認**: MCP `get_prospect_identifiers` のレスポンスが `organizationDomain` (text) を返していること（build-list スキルが参照する）
- [ ] **全 MCP ツール動作確認**: ローカル MCP Server 起動 → Claude Code から各ツールを呼び出し
- [ ] **Stripe 連携テスト**: Checkout → webhook → tenant_plans 更新 → プラン反映（Stripe テストモードで）

### 5-2. セルフデプロイ対応

- [ ] `docker-compose.yml` でローカル全スタック（Supabase local + Workers + MCP）を起動できるようにする
- [ ] デプロイガイド（Cloudflare + Supabase の手順書）
- [ ] 環境変数一覧ドキュメント

### 5-3. Cloudflare 本番デプロイ

- [ ] Stripe アカウントセットアップ（Products × 3、Prices × 6 (月額+年額)、Customer Portal 設定、Webhook Endpoint 登録）
- [ ] `wrangler deploy` で Web API / MCP Server を Cloudflare にデプロイ
- [ ] Cloudflare Pages でフロントエンドをデプロイ
- [ ] Supabase 本番プロジェクトのセットアップ（Auth, RLS 設定）
- [ ] カスタムドメイン設定（`api.leadace.surpassone.com`, `mcp.leadace.surpassone.com`）
- [ ] Stripe Webhook URL を本番 API に設定

### レビュー

**できていること（確認必須）:**
- [ ] 本番 URL で Web API / MCP Server が動作する
- [ ] Claude Code から本番 MCP Server に接続してスキルが動作する
- [ ] Free ユーザーが /strategy → /build-list(30件) → /outbound(10件sent) のトライアルフローを完走できる
- [ ] Free ユーザーが outreach 10 件超過時に `get_outbound_targets` がアップグレードメッセージを返す
- [ ] Stripe Checkout → webhook → DB 更新 → プラン反映が動作する
- [ ] Starter/Pro/Scale で正しいプロジェクト数・outreach 上限が適用される
- [ ] Stripe Customer Portal からアップグレード・ダウングレード・キャンセルが動作する
- [ ] `docker compose up` でセルフホスト版が起動する

**まだできていなくて良いこと:**
- Cloudflare Queues 経由の非同期ジョブ（build-list の完全非同期化）は後回しでも良い

---

## フェーズ6: リリース・移行

**目標:** 既存ユーザーの移行対応と、旧リポジトリのアーカイブ

### タスク

- [ ] 既存ユーザー向けデータ移行スクリプト（SQLite → Supabase PostgreSQL）
- [ ] インストール手順の更新（新マーケットプレイス URL: `aitit-inc/lead-ace`）
- [ ] `plugin/.claude-plugin/plugin.json` バージョンアップ
- [ ] 旧 `aitit-inc/claude-plugins` リポジトリのアーカイブ設定

### レビュー

**できていること（確認必須）:**
- [ ] 既存の SQLite データを移行スクリプトで Supabase に移行でき、全データが正しく移行される
- [ ] 旧インストールコマンド（`aitit-inc/claude-plugins`）でインストールしたユーザーへの移行案内が表示される
- [ ] 新インストールコマンド（`aitit-inc/lead-ace`）で最新版がインストールできる
- [ ] CHANGELOG または README に移行手順が記載されている

---

## 推奨実装順序

```
フェーズ1〜4.7 ✅ 完了
    ↓
フェーズ5-1a（テナント分離）✅ 完了
    ↓
フェーズ5-1b（サブスクリプション管理バックエンド）✅ 完了
    ↓
★ 現在地 ★
    ↓
フェーズ5-1c（RLS ポリシー追加）
    ↓
フェーズ5-1 フロントエンド（Settings プラン表示 + クォータ表示）
    ↓
フェーズ5-1 レビュー（テナント分離・クォータ・MCP 動作確認）
    ↓
フェーズ5-3（Stripe セットアップ + Cloudflare 本番デプロイ）
    ↓
フェーズ5 レビュー（本番環境での全体動作確認）
    ↓
フェーズ5-2（セルフデプロイ対応・ドキュメント）
    ↓
フェーズ6（リリース・移行）→ フェーズ6 レビュー
```

---

## 未決事項・判断待ち

| 事項 | 状況 |
|---|---|
| Cloud Scheduled Tasks（Claude Code Web版）との統合タイミング | フェーズ3以降 |
| build-list の Cloudflare Queues 非同期化 | フェーズ5以降（Web探索は重い処理なので将来的には非同期化したい）|

### 解決済み

| 事項 | 決定 |
|---|---|
| 有料ライセンスの価格・プラン設計 | Starter $29/mo, Pro $79/mo, Scale $199/mo（フェーズ5で確定）|
| セルフデプロイユーザーへのライセンス管理方法 | API サーバー側制御のみ。セルフホストは無料（1プロジェクト、クラウド機能なし）|
| MCP Server の認証方式 | Supabase Auth JWT（フェーズ2-4で実装済み）|
| フロントエンドのフレームワーク | SvelteKit（フェーズ4で実装済み）|
| `lead-ace-doctor` の移行方針 | 廃止（Drizzle Studio で代替、フェーズ3で実施済み）|
| マルチテナンシー方式 | テナント分離（shared tables + tenant_id）。アプリレベル隔離 + RLS defense-in-depth。将来のチーム利用拡張に対応 |
| 決済方式 | Stripe Checkout + Customer Portal。アプリ内に決済UIは作らない |
