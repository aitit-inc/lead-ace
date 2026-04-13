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
- [ ] Supabase local でのマイグレーション動作確認（2-5 の docker compose 起動後に確認）

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

### 2-5. ローカル開発環境 (Docker Compose)

- [x] `docker-compose.yml` 作成（PostgreSQL + API Worker + MCP Worker）
- [x] `.dev.vars.example` / `.dev.vars.mcp.example` テンプレート作成
- [ ] ローカル環境での主要 API エンドポイント動作確認

### レビュー

**できていること（確認必須）:**
- [ ] `docker compose up` でローカル環境が全部起動する（Supabase local + Workers + MCP）
- [ ] `POST /projects` でプロジェクトが作成でき、ライセンス制限（1件まで）が動作する
- [ ] `POST /prospects/batch` で営業先が登録でき、法人番号・メール・ドメイン・名前による重複チェックが動作する
- [ ] `GET /projects/:id/prospects/reachable` で優先度順に未接触営業先が返る
- [ ] `POST /outreach` で送信ログが記録され、ステータスが `contacted` に更新される
- [ ] `POST /responses` で返信記録が保存され、do-not-contact フラグが全プロジェクト横断で反映される
- [ ] `GET /projects/:id/stats` で evaluate 用の9種類の統計データが返る
- [ ] MCP Server の全 Tool が動作し、Claude Code からツールとして呼べる

**まだできていなくて良いこと:**
- プラグイン側（Claude Code スキル）はまだ Python スクリプト版のまま
- Cloudflare 本番環境へのデプロイは未完了でも良い（ローカルで動けばOK）
- フロントエンドはない
- Cloudflare Queues を使った非同期ジョブ化は未実装でも良い

---

## フェーズ3: プラグイン側の更新

**目標:** 全スキルを「Python スクリプト直叩き」から「MCP Server ツール経由」に移行し、Pythonスクリプトを廃止する

### 重要な前提

メール送信（gog）・フォーム入力（playwright-cli）・SNS DM（Claude-in-Chrome）の「実際の送信アクション」はユーザーのローカルで実行される。MCP化するのはその前後のデータ操作（営業先取得・送信ログ記録・ステータス更新）のみ。

### 3-1. plugin.json に MCP サーバー設定を追加

- [ ] `plugin/.claude-plugin/plugin.json` に MCP サーバー設定を追加
  - ローカル開発時: `http://localhost:PORT`
  - 本番時: `https://mcp.leadace.surpassone.com`（予定URL）

### 3-2. 各スキルの書き直し

**setup スキル:**
- [ ] `license.py check-can-add` / `license.py register` / `init_db.py` / `preflight.py` → `setup_project` MCP tool に置き換え
- [ ] ライセンスキー保存フローも Web API 経由に

**strategy スキル:**
- [ ] `preflight.py`, `sales_queries.py list-projects`, `sales_queries.py evaluation-history` → 対応する MCP tool に置き換え
- [ ] LLM による BUSINESS.md / SALES_STRATEGY.md 生成部分は変更なし

**build-list スキル:**
- [ ] `sales_queries.py all-prospect-identifiers` → `get_prospect_identifiers` MCP tool
- [ ] `filter_duplicates.py`, `merge_prospects.py`, `add_prospects.py` → `add_prospects` MCP tool（重複チェックはサーバー側で実装済み）
- [ ] `fetch_url.py`, `check_corporate_number.py` はローカル実行のまま（Webアクセスはサーバーではなくローカルで行う）

**outbound スキル:**
- [ ] `sales_queries.py list-reachable` → `get_outbound_targets` MCP tool
- [ ] `send_and_log.py` → 送信処理はローカルのまま + `record_outreach` MCP tool で記録
- [ ] `update_status.py` → `update_prospect_status` MCP tool

**check-results スキル:**
- [ ] `sales_queries.py recent-outreach` → `get_recent_outreach` MCP tool
- [ ] `record_response.py` → `record_response` MCP tool
- [ ] Gmail検索（Gmail MCP）・SNS確認（Claude-in-Chrome）はローカル実行のまま

**evaluate スキル:**
- [ ] `sales_queries.py eval-*`（9コマンド）+ `sales_queries.py data-sufficiency` → `get_eval_data` MCP tool
- [ ] `record_evaluation.py` → `record_evaluation` MCP tool
- [ ] LLM によるパターン分析・SALES_STRATEGY.md 更新部分は変更なし

**daily-cycle スキル:**
- [ ] サブエージェント構成は維持しつつ、各スキルが MCP tool 経由になった状態での動作確認
- [ ] `.tmp/` 中間ファイル管理はそのまま

**delete-project スキル:**
- [ ] `license.py unregister`, `delete_project.py` → `delete_project` MCP tool

**lead-ace-doctor スキル:**
- [ ] `query_db.py`（直接SQL）はそのまま維持 or 管理用 API エンドポイントに移行（要検討）
- [ ] `preflight.py --migrate-only` は廃止（マイグレーションはサーバー管理）

### 3-3. 廃止ファイルの整理

- [ ] `plugin/scripts/` 以下の Python スクリプト全廃止（段階的に。動作確認後に削除）
- [ ] `plugin/migrations/` 廃止（Drizzle マイグレーションに移管）
- [ ] `plugin/scripts/sales-db.sql` 廃止（Drizzle スキーマが唯一の真実）
- [ ] `plugin/scripts/pyrightconfig.json`, `test_imports.py` 廃止

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
- [ ] Python スクリプト（`plugin/scripts/`）が全て廃止されている
- [ ] `docker compose up` → プラグインの全スキルが一通り使える

**まだできていなくて良いこと:**
- Cloudflare 本番へのデプロイは未完了でも良い
- フロントエンドはまだない
- Cloudflare Queues を使った非同期ジョブ化は未実装でも良い

---

## フェーズ4: フロントエンド（管理画面）

**目標:** 結果確認・高リスク操作の承認のための最小限UI

### 技術スタック

- Cloudflare Pages
- SvelteKit または React（検討中）
- Supabase Auth（ログイン）

### タスク

- [ ] プロジェクト一覧・切り替え
- [ ] 営業先リスト（ステータス・優先度・チャネルでフィルタ）
- [ ] アウトバウンドログ（送信日時・チャネル・件名・本文）
- [ ] 返信一覧（センチメント・タイプ別）
- [ ] 評価・戦略サマリー（KPI推移、改善履歴）
- [ ] 高リスク操作の承認UI（一括削除・do-not-contact 設定等）

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

## フェーズ5: ライセンス・マネタイズ・デプロイ

**目標:** プロジェクト数制限を本番で機能させ、Cloudflare + Supabase 本番環境にデプロイ

### 5-1. ライセンス管理

- [ ] ライセンスキーの発行・検証ロジック（Supabase テーブルで管理）
- [ ] 無料: 1プロジェクト制限（Web API Server 側で制御）
- [ ] 有料: プロジェクト数無制限
- [ ] ソース改変による制限回避への対策方針を決める（ライセンスサーバーによる認証か）

### 5-2. セルフデプロイ対応

- [ ] `docker-compose.yml` でローカル全スタック（Supabase local + Workers + MCP）を起動できるようにする
- [ ] デプロイガイド（Cloudflare + Supabase の手順書）
- [ ] 環境変数一覧ドキュメント

### 5-3. Cloudflare 本番デプロイ

- [ ] `wrangler deploy` で Web API / MCP Server を Cloudflare にデプロイ
- [ ] Cloudflare Pages でフロントエンドをデプロイ
- [ ] Supabase 本番プロジェクトのセットアップ（Auth, RLS設定）
- [ ] カスタムドメイン設定（`api.leadace.surpassone.com`, `mcp.leadace.surpassone.com`）

### レビュー

**できていること（確認必須）:**
- [ ] 本番 URL（Cloudflare Workers）で Web API が動作する
- [ ] 本番 URL（Cloudflare Workers）で MCP Server が動作する
- [ ] Claude Code から本番 MCP Server に接続してスキルが動作する
- [ ] 無料プランで2プロジェクト作成しようとするとエラーになる
- [ ] 有料ライセンスキーで2プロジェクト以上作成できる
- [ ] `docker compose up` でローカル全スタックが起動し、ローカル MCP に繋いだスキルが全て動作する

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
フェーズ1（リポジトリ移行）
    ↓
フェーズ2-1〜2-2（backend セットアップ + スキーマ定義）
    ↓
フェーズ2-3（Web API Server の全エンドポイント）
    ↓
フェーズ2-4（MCP Server の全 Tool）
    ↓
フェーズ2-5（Docker Compose ローカル環境）→ フェーズ2 レビュー
    ↓
フェーズ3（プラグイン全スキルの MCP 移行・Python廃止）→ フェーズ3 レビュー
    ↓
フェーズ5-1（ライセンス管理）← 有料化前に必須
    ↓
フェーズ5-3（Cloudflare 本番デプロイ）→ フェーズ5 レビュー
    ↓
フェーズ4（フロントエンド）→ フェーズ4 レビュー
    ↓
フェーズ6（リリース・移行）→ フェーズ6 レビュー
```

---

## 未決事項・判断待ち

| 事項 | 状況 |
|---|---|
| 有料ライセンスの価格・プラン設計 | 未決 |
| セルフデプロイユーザーへのライセンス管理方法 | 未決（ライセンスサーバー認証 vs ソース改変禁止のみ） |
| MCP Server の認証方式 | APIキー vs Supabase Auth JWT |
| フロントエンドのフレームワーク | SvelteKit vs React |
| `lead-ace-doctor` の移行方針 | Python `query_db.py` 維持 vs 管理用 API エンドポイント化 |
| Cloud Scheduled Tasks（Claude Code Web版）との統合タイミング | フェーズ3以降 |
| build-list の Cloudflare Queues 非同期化 | フェーズ5以降（Web探索は重い処理なので将来的には非同期化したい）|
