# LeadAce 大規模アップデート タスクリスト

アーキテクチャ設計: [large_update_infra_arch.md](./large_update_infra_arch.md)

## 現状整理（2026-04-18 セッション 5 終了時点）

### 本番稼働状況

| エンドポイント | 状態 |
|---|---|
| `https://leadace.ai` (apex) | ✓ Landing Page（Pages: `lead-ace-landing`）新デザイン稼働 |
| `https://www.leadace.ai` | ✓ apex へ 301 リダイレクト |
| `https://app.leadace.ai` | ✓ フロント SPA（新パレット + Geist、light/dark 両対応）|
| `https://api.leadace.ai` | ✓ Web API Worker |
| `https://mcp.leadace.ai` | ✓ MCP Worker（OAuth 2.1 + KV バック、新パレットのログインページ）|

- **CI/CD**: `main` push 毎に API / MCP Worker + Frontend Pages + Landing Pages を自動デプロイ
- **認証メール**: Resend 経由 `noreply@leadace.ai` から新パレット（card radius 6px / link `#C05248` / Geist フォールバック）で配信
- **Stripe**: ✅ live mode 稼働。`setup-stripe.ts` で live Products/Prices/Portal/Webhook 作成 → wrangler secret + GitHub Variables を live 値で上書き済み。test → live 移行時に残っていた test mode `stripe_customer_id` は prod DB の `tenant_plans` を UPDATE で全クリアして解消
- **Supabase 本番**（`chaxrcdtxngoyqvtoyem`）: migration + master_documents seed + RLS 稼働
- **プラグイン版**: 0.5.22（今日のデザイン刷新 + LP モーション追加で x 2）

### 2026-04-18 セッション 4 でやったこと

1. **5-4k デザイン刷新（色・タイポ・全体トーン）完了** — SurpassOne VSCode テーマをベースに「フラット・ミニマル・エンジニア感」で統一：
   - **カラートークン刷新**: `--color-page / surface / surface-2 / border / text / text-secondary / text-muted / accent / accent-strong` + semantic `success / warning / danger / info`。Light `#F4F2F0` 基調 / Dark `#1A1B24` 基調。旧 `warm / warm-dark / accent-light` 全廃
   - **タイポ**: Inter → **Geist** (Google Fonts) + JetBrains Mono（`tabular-nums` 有効）
   - **コンポーネント移行**: 全 Svelte routes/components。Badge 3種（status/sentiment/channel）を semantic token ベースに（Tailwind raw palette `blue-100 / green-500 / purple-100` 等を全廃）。shadow 全撤去、rounded-lg → rounded-md（4–6px）
   - **反映範囲**: frontend / landing (`index.html`) / backend (`mcp/oauth.ts` login page) / supabase 認証メール 4 テンプレ / ロゴ SVG 6 枚（`#D06A57` → `#E87462`）
   - **LP モーション再実装**（最初フラット化しすぎた反省で、Hero を中心に signature motion を復活）：
     - Hero 見出し kinetic reveal（clip-mask で下からスライドイン、1 回限り）
     - **Hero 右 animated terminal**（4 コマンド `/strategy` `/build-list` `/outbound` `/daily-cycle` を type→output→次でループ、9 行固定ウィンドウ）
     - Cursor-reactive constellation（近傍ノードが halo + リンク強化）
     - Typewriter rotator（`|` caret を period の後ろに配置）
     - Logo drop-shadow glow pulse、Nav backdrop-blur、Magnetic primary CTA（0.35/0.45 追従）、dual blob gradient（暖色 + 寒色）、SVG grain overlay、scroll stagger reveals
     - **注**: `prefers-reduced-motion` はデコラティブモーション限定で意図的に非尊重（LP motion IS the design）。本文・ボタン・ナビは motion なしでも操作可能
2. **Sidebar UI fix** — ThemeToggle + Terms/Privacy が `w-48` サイドバーから横にはみ出ていた件を、縦積み（ThemeToggle の上に Terms/Privacy）で解消

### 2026-04-18 セッション 5 でやったこと

1. **5-4f Stripe live 移行完了** — Stripe Dashboard 本人確認 → `setup-stripe.ts` を `sk_live_...` + `WEBHOOK_URL` で再実行 → live Products × 3 / Prices × 6 / Portal / Webhook 作成 → `gh variable set` で 6 つの Price ID を GitHub Variables に一括投入 → `wrangler secret put` で `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` を live 値に上書き → 空コミット push で CI 再デプロイ
2. **test → live 移行で判明した問題と恒久対応** — `tenant_plans.stripe_customer_id` に残っていた test mode の customer ID が live key で `No such customer` エラー。`UPDATE tenant_plans SET plan='free', stripe_customer_id=NULL, stripe_subscription_id=NULL, current_period_start=NULL, current_period_end=NULL` で全テナントをリセットして解消。test 期間中のサブスクは実質テストデータのみだったので全消しで OK

### 次セッション開始時にやること

1. **5-4n ブランド名を "LeadAce" に統一** — コードベース / LP / 認証メール / プラグイン README / Stripe 商品名 / 法的ドキュメント等で "Lead Ace" / "Leadace" / "lead-ace" が混在している。命名規約を決めて機械的に置換
2. **5-4o Cookie 利用確認バナー** — グローバル公開なので GDPR / ePrivacy / CCPA 観点で多分必須。LP (`leadace.ai`) と app (`app.leadace.ai`) どちらにも入れる必要あり（サブドメインごとに同意管理は別スコープが原則。ただし same-site cookies を親ドメインで共有する設計なら一元管理も可）
3. **5-4h エラー監視** — 任意（Sentry or Cloudflare Workers Logs + Slack 通知）
4. **5-4m Supabase Custom Auth Domain** — Pro プラン移行時の対応（Google 同意画面の `supabase.co` 表示を `leadace.ai` に差し替える。ユーザー数拡大後）
5. **フェーズ6: リリース・移行** — 新リポジトリのインストール手順整理、旧 `aitit-inc/claude-plugins` の archive 設定など（既存ユーザーはごく少数なのでデータ移行スクリプトは不要と判断してよい）

### 長期の未決事項

- 特定商取引法に基づく表示（5-4d の残）: 日本向け有料販売する場合は別途法務判断で追加
- 未来: `aitit-inc/business-autopilot` 配下の `projects/small-business/leadace/` はもう不要。任意タイミングで archive / remove して OK

---

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

#### フロントエンド ✅ 完了
- [x] Settings ページにプラン表示 + "Upgrade" ボタン（→ Checkout）+ "Manage subscription" ボタン（→ Customer Portal）
- [x] クォータ残量表示（サイドバー下部にコンパクト表示）
- [x] `plan` store 追加（`GET /me/plan` を取得）、`.env.example` に `VITE_STRIPE_PRICE_*` 追加

### 5-1c. RLS ポリシー追加 ✅ 完了

テナント分離の defense-in-depth。スキーマは対応済み（全テーブルに tenant_id あり）、ポリシー追加のみ。

- [x] `app_rls` ロール作成 + 全テーブルへの権限付与（`0001_rls_policies.sql`）
- [x] 全テナント依存テーブル（11テーブル）に RLS 有効化 + ポリシー追加: `USING (tenant_id = current_setting('app.tenant_id', true))`
- [x] `rlsMiddleware` 追加: リクエストをトランザクションで包み `SET LOCAL ROLE app_rls` + `set_config('app.tenant_id', ...)` を注入
- [x] 全ルートハンドラを `c.get('db')` 経由に変更（auth middleware が DB 接続を作成し context に格納 → RLS middleware がトランザクションで上書き）
- [x] auth middleware / stripe webhook は `postgres` ロール（RLS バイパス）のまま動作
- [x] `master_documents` テーブルは RLS なし（グローバルデータ）
- [x] テナント分離テスト: 2ユーザーで cross-tenant アクセス不可を確認

### 5-1d. スキーマレビュー改善 ✅ 完了

- [x] `organizations` から未使用カラム削除: country, address, industry, overview, normalizedName + idx_org_normalized_name
- [x] `prospect_status` enum から `unreachable` 削除（`inactive` に統一）
- [x] `projects` に `name` カラム追加（`UNIQUE(tenant_id, name)`）、ID は自動生成 nanoid に変更
- [x] prospect 登録に連絡先1つ以上を必須化（email / contactFormUrl / snsAccounts いずれか）
- [x] tenant 自動作成時に `tenant_plans` free 行も INSERT（JOIN 安全性）
- [x] MCP ツール: `setup_project` が `name` を受け取り `id` を返す形に変更
- [x] MCP ツール: `add_prospects` から削除カラム除去、`update_prospect_status` から `unreachable` 除去

### 5-1e. MCP name/id 解決 + プラグインスキル整合性 ✅ 完了

- [x] MCP に `resolveProjectId(projectRef)` ヘルパー追加（name または id のどちらでも受け付ける）
- [x] 13個の MCP ツール全て（delete_project, get_prospect_identifiers, add_prospects, get_outbound_targets, record_outreach, update_prospect_status, get_recent_outreach, get_eval_data, record_evaluation, get_evaluation_history, get_document, save_document, list_documents）に resolver 適用
- [x] プラグインスキル側は変更不要（`$0` が name として機能、パラメータ名 `projectId` は維持）
- [x] build-list / daily-cycle SKILL.md から削除済みフィールド（organizationNormalizedName, Country, Industry, Overview）参照を除去
- [x] outbound / daily-cycle / form-filling の `unreachable` 記述を `inactive` に統一

### 5-1 レビュー（本番デプロイ前に必須）

#### 静的確認（完了）

- [x] **organizations PK 変更の影響確認**: `GET /projects/:id/prospects/identifiers` が `organizationDomain` (text, `organizations.domain`) を返すこと確認。build-list / daily-cycle SKILL.md も `organizationDomain` を参照
- [x] **RLS ポリシー確認**: 11 テナント依存テーブル全てに `tenant_isolation` ポリシー、`master_documents` はポリシーなし（グローバル）
- [x] **ルートの DB 接続監査**: 全 9 ルートが `c.get('db')` 経由、`createDb()` 直叩きは auth middleware と stripe-webhook のみ
- [x] **クォータ強制点の監査**: project creation / add_prospects / get_outbound_targets / record_outreach の4箇所で plan-limits の関数を呼んでおり、Free lifetime / 有料 monthly を正しく区別
- [x] **ローカル起動確認**: `npm run dev:api` / `npm run dev:mcp` が起動、`/health` → `{ok:true}`、認証なしエンドポイント → 401

#### ランタイム動作確認

`backend/scripts/create-test-users.ts` で Supabase Auth に2ユーザー（tenant-a@test.local / tenant-b@test.local）を作成し、JWT を取得して curl で API / MCP を叩いて確認。

- [x] **テナント分離テスト**: A が作成したプロジェクトは B の `GET /api/projects` に出ず、直接 ID 指定でも 404。MCP の `list_projects` / `delete_project` でも同様
- [x] **クォータテスト**: Free ユーザーで prospect 30 件まで登録OK、31件目は 403。Outreach 10 件まで record_outreach 成功、11件目は 403。10 件到達後の `get_outbound_targets` は空配列 + "Outreach limit reached (10/10)" メッセージ
- [x] **全 MCP ツール動作確認**: MCP Server に `tools/list` で全18ツール登録確認。`list_projects` / `list_master_documents` / `get_outbound_targets` / `get_prospect_identifiers` / `save_document` / `get_document` を実際に呼び出して動作確認
- [ ] **Stripe 連携テスト**: Checkout → webhook → tenant_plans 更新 → プラン反映（Stripe テストモードで。5-3 デプロイ前に Stripe Dashboard セットアップが必要）

### 5-2. セルフデプロイ対応

- [x] セルフホストガイド作成（`plugin/docs/self-host.md`）— ローカル開発フロー + 自前 Cloudflare/Supabase デプロイ案内
- [x] 環境変数一覧ドキュメント（self-host.md 内に backend/frontend/plugin それぞれ表化）
- [x] デプロイガイド整備（既存 `plugin/docs/deploy.md` で完結）
- [ ] `docker-compose.yml` で本当に「all-in-one」起動を提供（workerd が Docker 内で安定しない問題があるため、現状は Supabase CLI + host wrangler で対応。将来 workerd の Docker 安定化時に再検討）

### 5-3. Cloudflare 本番デプロイ

**ランブック:** [plugin/docs/deploy.md](./deploy.md) に全手順を記載。

#### コード側準備 ✅ 完了

- [x] `backend/wrangler.api.jsonc` / `wrangler.mcp.jsonc` に `env.production` 追加、`account_id` 固定（`Leo.uno@surpassone.com's Account`）
- [x] Custom Domain 対応（`routes` に `custom_domain: true` で DNS + SSL 自動化）
- [x] `frontend/wrangler.jsonc` 追加（`pages_build_output_dir` + `nodejs_compat`）
- [x] `.github/workflows/check.yml` / `deploy.yml` 作成
- [x] `plugin/docs/deploy.md` ランブック整備
- [x] `backend/scripts/setup-stripe.ts` で Products/Prices/Portal/Webhook を冪等に作成
- [x] `backend/scripts/create-test-users.ts` で Supabase Admin API 経由のテストユーザー作成

#### 外部リソース（手動作業で進行中）

- [x] Supabase 本番プロジェクト作成（project ref: `chaxrcdtxngoyqvtoyem`）+ migration 適用 + master_documents シード
- [x] Stripe test mode: Products × 3 / Prices × 6 / Customer Portal / Webhook endpoint
- [x] Cloudflare: `leadace.ai` を Zone 追加、お名前.com NS 切替、Active
- [x] wrangler secrets 投入（API + MCP worker 両方）
- [x] 初回デプロイ: Workers (API + MCP) + Pages (フロントエンド)
- [x] カスタムドメイン: `api.leadace.ai` / `mcp.leadace.ai` / `app.leadace.ai` 全て SSL 発行済み・疎通OK
- [x] prod DB の RLS セットアップ完了（`GRANT app_rls TO postgres` を SQL Editor で手動適用 → migration 修正済みで次回以降は自動）
- [ ] §8 本番動作検証（Stripe test mode での Checkout / webhook / Customer Portal）

#### CI/CD 有効化手順（再開時に実行）

1. **Cloudflare API Token 発行**
   - [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   - テンプレート "Edit Cloudflare Workers" を使用
   - 必要権限（テンプレで自動付与）: Account → Workers Scripts: Edit / Pages: Edit / Account Settings: Read。Zone → Workers Routes: Edit / DNS: Edit
   - Account は `Leo.uno@surpassone.com's Account`（`0633d5a3f3b6d8d4cb5b2c7fcf453494`）に限定
   - 発行後の値を控える → 次で Secret に投入

2. **GitHub Secrets 登録** — [repo Settings → Secrets and variables → Actions → Secrets](https://github.com/aitit-inc/lead-ace/settings/secrets/actions)

   | Secret | 値 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 手順 1 で発行したトークン |
   | `CLOUDFLARE_ACCOUNT_ID` | `0633d5a3f3b6d8d4cb5b2c7fcf453494` |

3. **GitHub Variables 登録** — [同画面 → Variables tab](https://github.com/aitit-inc/lead-ace/settings/variables/actions)

   Stripe Price ID は `setup-stripe.ts` の直近出力から。Supabase 値は `chaxrcdtxngoyqvtoyem` プロジェクトの Dashboard から取得。

   | Variable | 値 |
   |---|---|
   | `VITE_API_URL` | `https://api.leadace.ai` |
   | `VITE_SUPABASE_URL` | `https://chaxrcdtxngoyqvtoyem.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | Supabase publishable key（`sb_publishable_...`） |
   | `VITE_STRIPE_PRICE_STARTER_MONTHLY` | Stripe test mode の Price ID |
   | `VITE_STRIPE_PRICE_STARTER_YEARLY` | 〃 |
   | `VITE_STRIPE_PRICE_PRO_MONTHLY` | 〃 |
   | `VITE_STRIPE_PRICE_PRO_YEARLY` | 〃 |
   | `VITE_STRIPE_PRICE_SCALE_MONTHLY` | 〃 |
   | `VITE_STRIPE_PRICE_SCALE_YEARLY` | 〃 |

4. **ローカルの 15 コミットを push**
   ```bash
   git push origin main
   ```
   これで `.github/workflows/deploy.yml` が default branch に乗り、以降 main への push で自動デプロイされる

5. **初回 CI デプロイの結果確認**
   - [Actions タブ](https://github.com/aitit-inc/lead-ace/actions) で `Deploy` が成功していること
   - API: `curl https://api.leadace.ai/health` → `{"ok":true}`
   - Pages: `app.leadace.ai` に "Create an account" トグル表示（5-4a の目印）
   - 失敗時は Actions ログ → wrangler / npm のエラー内容確認

6. **CI 成功後、§8 本番動作検証へ**

#### 本番デプロイで判明した問題と恒久対応

| 問題 | 対応 |
|---|---|
| `db:migrate` を Transaction Pooler (6543) 経由で流したため `CREATE ROLE app_rls` が silent fail | deploy.md §2 を Session Pooler (5432) に書き換え、CLAUDE.md にも注記 |
| `postgres` ユーザー（Supabase では非 superuser）が `SET ROLE app_rls` できず 500 | `0001_rls_policies.sql` に `GRANT app_rls TO current_user` を追加（将来の fresh 環境で自動適用） |
| Workers の `routes` 指定だと DNS レコードが自動作成されず疎通不可 | `custom_domain: true` に切替。wrangler が DNS + SSL を自動管理 |
| Pages で `node:async_hooks` の警告 | `frontend/wrangler.jsonc` に `compatibility_flags: ["nodejs_compat"]` 設定 |

---

## フェーズ5-4: MVP 公開前の仕上げ

**目標:** Stripe live 移行 + ユーザーフロー完成度を上げて、外部ユーザーに公開可能な状態にする。

### 5-4a. Auth UX の完成

現状ログインフォームのみ。Free トライアルのセルフオンボーディングに必須。

- [x] **Sign-up フォーム**（Email / Password）を `/login` にトグル形式で追加
- [x] Supabase 確認メールからのリダイレクト処理（`/auth/callback`）
- [x] **Password reset フロー**（`/forgot-password` → メールリンク → `/reset-password`）
- [x] Sign-up 後の初回 onboarding: プロジェクト作成を促す UI（空状態 → "Create your first project" + ProjectCreateDialog）

### 5-4b. MCP OAuth の本番対応

OAuth 2.1 フロー自体は実装済みだが、ストレージが in-memory で Cloudflare Workers の isolate 間で共有されない。

- [x] Cloudflare KV namespace 作成（`MCP_OAUTH_STORE`、id: `78e184bebfde4e35a2261b2957067586`）+ wrangler.mcp.jsonc に binding 追加
- [x] `backend/src/mcp/oauth.ts` の `authCodes` / `registeredClients` を Map → KV に移行（auth code: TTL 600s / 10 分。registered client: TTL 30 日。refresh token は Supabase に直接転送するため独自ストア不要）
- [ ] 本番で OAuth フロー疎通確認（Claude Code で `/plugin marketplace add` → 初回起動時にブラウザ認証 → MCP ツール呼び出し）— デプロイ後に検証

### 5-4c. MCP 接続ユーザードキュメント

- [x] plugin README.md に「Claude Code から MCP Server に接続する手順」を追加（LEADACE_MCP_URL 設定、OAuth 初回フロー、トラブルシューティング）
- [x] `.mcp.json` をハードコード localhost から `${LEADACE_MCP_URL}` に変更
- [x] 古い SQLite/data.db 参照や marketplace パスを刷新（root README.md / plugin/README.md）

### 5-4d. 法的ドキュメント

Stripe live 申請に必須。Customer Portal にも URL 登録必要。

- [x] Terms of Service ページ（`/terms`）— SaaS テンプレ + 法務確認箇所マーキング
- [x] Privacy Policy ページ（`/privacy`）— sub-processor 一覧 + ユーザー権利明記
- [x] Frontend のフッター（サイドバー）にリンク追加 + login ページから参照
- [ ] 特定商取引法に基づく表示（日本向け必要なら）— 法務判断
- [ ] Stripe Dashboard → Customer Portal → Business information にこれらの URL を設定 — 手動

### 5-4e. apex `leadace.ai` に既存 LP を移設

既存 LP 実体: `/Users/leo/work/so/business-autopilot/projects/small-business/leadace/site/`
（リポジトリ `aitit-inc/business-autopilot` 内 / 静的 HTML + CSS + 画像）
現状公開先: `https://leadace.surpassone.com`
ファイル構成: `index.html` / `legal.html` / `privacy.html` / `setup-guide.html` / `templates.html` / `tutorial.html` / `thanks.html` / `X_profile_banner.png`

#### リポジトリ戦略

採用: **B** — `lead-ace/landing/public/` に index.html を配置、別 Pages プロジェクト `lead-ace-landing` として配信。旧 `aitit-inc/business-autopilot/projects/small-business/leadace/site/` は今回の commit をもって役目を終える（必要なら後日 archive）。

#### 移設 / LP 側の修正 ✅ 完了（コード側）

- [x] `index.html` のみ `landing/public/index.html` にコピー。`legal.html`（旧商品モデル: ワークショップ 14.8 万円等）、`privacy.html`（app 側より情報量不足）、`setup-guide.html` / `tutorial.html` / `thanks.html` / `templates.html`（全て旧販売フロー・index からリンクされていない孤児）、`X_profile_banner.png`（未参照）は破棄
- [x] `index.html` の CTA 3 箇所（`Get started` / `Get Pro` / `Get Scale`）を `https://app.leadace.ai/login?signup=1` に差し替え
- [x] ヘッダー右上に **Login** リンク追加 → `https://app.leadace.ai/login`
- [x] `nav-cta` の `Get LeadAce` / hero の `from $29/mo` も `app.leadace.ai/login?signup=1` に統一
- [x] footer に **Terms** リンク追加 + **Privacy** を `/privacy.html` → `https://app.leadace.ai/privacy` に差し替え（app 側が authoritative。LP に privacy.html は残さない）
- [x] OG URL を `leadace.surpassone.com` → `leadace.ai` に変更
- 特定商取引法に基づく表記は別タスク（5-4d 残）として保留。現 LP の `legal.html` は旧商品ベースで内容が commit に値しないため破棄

#### Cloudflare Pages 設定 ✅ 完了

- [x] `landing/wrangler.jsonc` (`name: lead-ace-landing`, `pages_build_output_dir: public`) + `landing/README.md` 追加
- [x] `.github/workflows/deploy.yml` に `deploy-landing` ジョブ追加
- [x] `plugin/docs/deploy.md` §5-3 に Landing Page セクション追加
- [x] Cloudflare Pages で `lead-ace-landing` プロジェクト作成・コンテンツ投入
- [x] Custom domain `leadace.ai`（apex）を割り当て
- [x] `www.leadace.ai` → `leadace.ai` の 301
- [x] 旧 `leadace.surpassone.com` retire（Pages + DNS 削除、ほぼアクセスなかったため 301 不要と判断）

### 5-4f. Stripe live 移行チェックリスト ✅ 完了

test mode での動作確認完了後：

- [x] Stripe Dashboard → **Activate account**（会社情報・銀行口座・本人確認）
- [x] `setup-stripe.ts` を `sk_live_...` + `WEBHOOK_URL` で一発実行 → live Products/Prices/Portal/Webhook 作成
- [x] 出力された live Price ID 6 つを `gh variable set` で一括投入（`grep '^VITE_STRIPE_PRICE_' /tmp/stripe-live.log | while IFS='=' read -r k v; do gh variable set "$k" --body "$v" --repo aitit-inc/lead-ace; done`）
- [x] `wrangler secret put STRIPE_SECRET_KEY` を `sk_live_...` で上書き
- [x] `wrangler secret put STRIPE_WEBHOOK_SECRET` を live webhook secret で上書き
- [x] GitHub Variables の `VITE_STRIPE_PRICE_*` を live 版に上書き（上記 `gh variable set` で同時実施）
- [x] test → live 移行時の `tenant_plans.stripe_customer_id` クリア: `UPDATE tenant_plans SET plan='free', stripe_customer_id=NULL, stripe_subscription_id=NULL, current_period_start=NULL, current_period_end=NULL` を prod DB で実行（test mode 由来の customer ID で Portal が `No such customer` になる問題を解消）
- [ ] 実カードで Checkout → 直後に refund、webhook でプラン反映とロールバック確認
- [ ] test mode のリソースは参考保持 or 削除

**恒久対応メモ:** test → live 切替のたびに `tenant_plans` の Stripe ID をクリアする必要がある。今後プロダクション運用中に test ↔ live を往復することはないはずだが、もし再び切り替えるなら上記 UPDATE を手順に含める。

### 5-4g. 認証メールの送信ドメイン + 本文改善

現状: Supabase Auth のデフォルト送信元 `noreply@mail.supabase.io` で、かつ Supabase テンプレート英語のまま。
目標: 自前ドメイン + LeadAce のトーン・内容に合わせたメール文面。

採用方針（確定）:
- 送信サービス: **Resend**（無料 3,000 通/月、DKIM/SPF 自動発行、Supabase 統合例あり）
- 送信元: `noreply@leadace.ai`（返信不要）
- 言語: 英語のみ（app 本体に合わせる）

#### 送信ドメイン移行

- [x] メール送信サービス選定: Resend
- [x] 送信元アドレス確定: `noreply@leadace.ai`
- [x] Resend アカウント作成・`leadace.ai` ドメイン検証・DNS 投入
- [x] Resend API キー発行 + Supabase SMTP Settings 入力（Sender `noreply@leadace.ai`）
- [x] Sign up / Reset password の実メール受信確認（Confirm signup + Reset password 両方 OK）

手順は `plugin/docs/deploy.md §9` に詳細記載。

#### メール本文改善 ✅ コード側完了（Dashboard 反映のみ残り）

`supabase/templates/` にブランド付き HTML 4 種を作成済み。件名付きで以下を Supabase Dashboard → Authentication → Email Templates に貼り付けるのみ。

- [x] Confirm signup: `supabase/templates/confirm-signup.html` / Subject: `Confirm your LeadAce account`
- [x] Reset Password: `supabase/templates/reset-password.html` / Subject: `Reset your LeadAce password`
- [x] Magic Link: `supabase/templates/magic-link.html` / Subject: `Your LeadAce sign-in link`
- [x] Change Email: `supabase/templates/change-email.html`（参考・現状プロダクトではメアド変更 UI なし）
- [x] Confirm signup / Reset Password を本番 Dashboard に貼付・疎通確認。Magic Link / Change Email は機能未提供のため保留（使うタイミングで貼れば OK）
- Invite User はプロダクトで未使用なので skip

`supabase/config.toml` でもローカル dev 用に各 template を registered 済み（`supabase start` で自動反映）。フッターの連絡先は `contact@surpassone.com`（app 側 terms/privacy も同じ）。

### 5-4i. 最低限のレスポンシブ対応 ✅ コード完了

現状 `app.leadace.ai` は完全デスクトップ前提（サイドバー固定幅 `w-48` / flex row / table レイアウト多め）。タブレット以下で破綻。

- [x] サイドバーをモバイルでドロワー化（ハンバーガーボタン + オーバーレイ、`md` 未満で `fixed` + `transform`、ルート遷移で自動クローズ）
- [x] Prospects / Outreach / Responses の grid テーブルを mobile card 表示に（`hidden md:grid` + `flex md:hidden` の二系統レイアウト）
- [x] Evaluations の KPI 4 カラム → 2 カラム / 内訳グリッド幅を狭幅対応、Sentiment breakdown を折り返し可に
- [x] Documents の左右 2 カラムを mobile で縦スタック + ドキュメント一覧を横並び chip 表示に
- [x] Settings の Upgrade カード 3 列 → `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`、Danger zone の行を stack
- [x] Header を `md` 未満で `px-4` + ハンバーガー + email 非表示（email は `sm:inline` で画面幅 sm 以上で表示）
- [x] `/login` / `/forgot-password` / `/reset-password` は元から `max-w-sm` + center で mobile-first
- [x] `/terms` / `/privacy` は元から `max-w-2xl mx-auto` でリーダブル

観測範囲: 少なくとも 375px（iPhone SE 相当）で全ページ機能する。実機テストはブラウザ DevTools の device emulation 等で。

### 5-4j. ライト / ダークモード対応 ✅ コード完了

現状は暖色ベースのライトテーマ単一（`bg: #F6EEE6` / `text: #333` / `accent: #D06A57`）。システム prefers-color-scheme に追従 + 手動トグルを入れる。

- [x] Tailwind v4 の CSS variable ベーステーマに移行（`@theme` + `@custom-variant dark (&:where(.dark, .dark *))`）。`.dark` セレクタで全トークンを上書き
- [x] 固定色（`bg-white` / 主ボタンの `text-white`）を semantic token（`bg-page` / `text-page`）に置換。badge 系（status/sentiment/channel）には `dark:bg-*/15 dark:text-*-300` variant を追加
- [x] 新規トークン: `--color-page`（`#ffffff` ↔ `#141414`）。既存 `--color-warm/--color-surface/--color-border/--color-text` も dark で上書き。アクセントは `#D06A57` → `#E0887A` に軽く持ち上げてコントラスト確保
- [x] サイドバー footer にテーマトグル（`system / light / dark` の 3 択アイコン群）。`ThemeToggle.svelte`
- [x] localStorage `leadace.theme` に選択を保存、初期値は `system`。FOUC 防止のため `app.html` に早期適用 inline script
- [x] `color-scheme: dark` を `.dark` に付与（OS のフォーム/スクロールバー要素を dark で描画）
- [x] 検証: ライト/ダーク両方で `/login` 描画 OK（Chrome DevTools で確認、CSS var 切替確認済み）
- Landing (`landing/public/index.html`) は静的 HTML で別系統のため今回は対象外

### 5-4k. デザイン刷新（色 / タイポ / 全体トーン）✅ 完了

方針: SurpassOne VSCode テーマ（`~/src/vscode-surpassone-theme/`）をベースに、フラット・ミニマル・エンジニア感で app + LP + 認証メール + MCP OAuth login を統一。

- [x] カラートークン刷新 — `--color-page / surface / surface-2 / border / text / text-secondary / text-muted / accent / accent-strong` + semantic `success / warning / danger / info`（light `#F4F2F0` / dark `#1A1B24` 基調）
- [x] タイポ — Inter → Geist + JetBrains Mono（`tabular-nums`）
- [x] Badge 系 3 種を semantic token 化（Tailwind raw palette を全廃）
- [x] shadow 全撤去・rounded-lg → rounded-md
- [x] ロゴ SVG 6 枚を新 accent `#E87462` に統一（`brand/`, `frontend/`, `landing/`）
- [x] Supabase 認証メールテンプレ 4 種を新パレットに（card radius 6px / link `#C05248` / Geist フォールバック）
- [x] MCP OAuth login page（`backend/src/mcp/oauth.ts`）を新パレットに
- [x] Landing page 全面刷新 — Hero kinetic reveal + animated terminal（4 コマンドループ）+ cursor-reactive constellation + typewriter rotator + logo glow pulse + magnetic CTA + dual blob gradient + grain overlay + scroll stagger
- [x] Sidebar の ThemeToggle 横はみ出し修正（ThemeToggle を Terms/Privacy の上に積む形に変更）

**重要な学び:**
- `prefers-reduced-motion` をデコラティブ LP モーションに対して強く尊重すると、OS 設定によってはモーションが全部消える。LP の場合 motion 自体がデザインなので意図的に非尊重に。core content（テキスト・ボタン・ナビ）は motion なしでも操作可能にすることでアクセシビリティ許容範囲に収める
- 1 度「フラット・ミニマル」に寄せすぎて LP から動きを全部抜いてしまい、再度 Hero を中心に signature motion を足し直した。minimal != static。minimal は「一点突破の motion を際立たせるため他を static に保つ」の意

### 5-4l. Google Sign-in 追加

現状は Email + Password のみ。オンボーディング摩擦を減らすために Google を追加。

- [x] `/login` ページに "Continue with Google" ボタン追加（Supabase SDK `signInWithOAuth`）。最上部配置 + "or" divider + 既存 Email/Password の順
- [x] `/auth/callback` ルート既存ロジックが OAuth return にも対応（Supabase JS v2 は `detectSessionInUrl: true` + PKCE デフォルトで `?code=...` を自動交換）
- [x] 手動手順を `plugin/docs/deploy.md §10` に整備（Google Cloud OAuth consent + client 作成 / Supabase Provider 有効化 / 疎通確認）
- [x] Supabase Dashboard → Authentication → Providers → Google を有効化（手動完了）
- [x] Google Cloud Console で OAuth client 作成（手動完了。Authorized redirect URI: `https://chaxrcdtxngoyqvtoyem.supabase.co/auth/v1/callback`）
- [x] 本番疎通確認（`app.leadace.ai/login` で Continue with Google → `/prospects` までログインできることを確認）
- [ ] 既存 Email アカウントと同メアドで Google ログインが来た時の account linking 挙動を確認（Supabase デフォルトは分離。必要時に identity linking ポリシー見直し）

### 5-4n. ブランド名を "LeadAce" に統一

コード・UI・ドキュメント・Stripe 商品名などで "Lead Ace" / "Leadace" / "LeadAce" / "lead-ace" が混在している。正式名称を **LeadAce**（camelCase・スペースなし）に統一する。

**スコープ対象（表示名）:**
- フロントエンド UI 全般（`app.leadace.ai` のラベル・見出し・メタタグ）
- ランディングページ (`landing/public/index.html`) のコピー
- 認証メールテンプレ (`supabase/templates/*.html`) 件名・本文
- MCP OAuth ログインページ (`backend/src/mcp/oauth.ts`)
- プラグイン README.md / `plugin/.claude-plugin/plugin.json` の `description` 等
- 法的ドキュメント (`/terms`, `/privacy`) の会社名・サービス名記述
- Stripe Products の name / description（`setup-stripe.ts` の `PLANS` 定義 → live に再反映）
- Customer Portal の `BUSINESS_HEADLINE`
- Resend 送信元表示名（現 `Lead Ace` ならあれば）
- OG tags / title 系

**スコープ除外（識別子はそのまま）:**
- リポジトリ名 `aitit-inc/lead-ace`、ディレクトリ名 `plugin/` `backend/`、Worker 名 `lead-ace-api` / `lead-ace-mcp` / `lead-ace-landing`、KV namespace、Cloudflare account など。識別子を変えるとデプロイが割れる
- ドメイン `leadace.ai`（既に camelCase 相当、ハイフンなし）
- 環境変数名 `LEADACE_MCP_URL` 等（既に一語）
- プラグイン slug `lead-ace@lead-ace`（Claude Code の marketplace 仕様に従う）

**タスク:**
- [ ] リポジトリ全体で "Lead Ace" / "Leadace" の出現箇所を grep で洗い出し
- [ ] 上記スコープ対象の文字列を "LeadAce" に一括置換
- [ ] Stripe live Products の `name` / `description` / Portal headline を更新（`setup-stripe.ts` の `PLANS` 書き換え → 再実行で冪等更新）
- [ ] 変更後に LP / app / 認証メール / MCP OAuth 画面を目視確認
- [ ] CLAUDE.md / README の記述も統一

### 5-4o. Cookie 利用同意バナー

グローバル公開（US/EU/UK 等）なので GDPR / ePrivacy / UK PECR / CCPA 観点で同意バナーが実質必須。

**現状の cookie 利用状況（要洗い出し・調査項目）:**
- `app.leadace.ai`: Supabase Auth のセッション cookie（JWT 格納）、`leadace.theme` など localStorage 利用。Stripe Checkout/Portal リダイレクト後の戻り cookie
- `leadace.ai` (LP): 現在 analytics 未導入。将来 GA4 / Cloudflare Web Analytics 等を入れた場合に必要
- サードパーティ: Stripe（決済時のみ）、Supabase（auth）、Resend（メール送信のみなのでブラウザ側 cookie なし）

**サブドメインごとのスコープ問題:**
- Cookie 同意は「origin ごと」ではなく「cookie スコープごと」で扱うのが実務上シンプル。`Domain=leadace.ai` で parent domain 発行されれば LP と app で共有、`Domain=app.leadace.ai` なら app 専用
- Supabase Auth cookie がどちら発行かを要確認（多分 `app.leadace.ai` スコープ、LP 側は影響なし）
- 結論案: LP と app で **バナー表示自体は別実装**でも、同意状態は `leadace.ai` parent 発行の cookie で共有すれば UX 統一可能。ただし実装コストとのバランスで「各サブドメイン独立」でも法的要件は満たす

**タスク:**
- [ ] cookie / localStorage / sessionStorage / 外部スクリプト の利用インベントリを作成（Essential / Preferences / Analytics / Marketing に分類）
- [ ] 法的要件のスコープ確定（現状は主に Essential のみで Analytics/Marketing なし → 「Essential はバナー不要」とする解釈もあるが、グローバルで安全側に倒すなら "We use cookies" バナー + 詳細ポリシーを両サブドメインに入れる）
- [ ] バナー実装（LP 側は静的 HTML + 軽量 JS、app 側は Svelte コンポーネント）
- [ ] 同意状態の保存・再表示ロジック（`leadace.ai` parent cookie で LP/app 共有が理想）
- [ ] `/privacy` ページに cookie policy セクション追加（既存 Privacy Policy との整合性）
- [ ] Analytics を後から入れる場合、同意後に動的ロードする仕組み
- [ ] Stripe / Supabase / Google OAuth からのリダイレクト時の同意状態保持確認

**実装方針の参考:**
- 自前実装（依存なし・軽量・カスタマイズ容易）が推奨。`cookieconsent` / `osano` 等の OSS もあるが、LeadAce は cookie 利用が少ないので自前が見通し良い
- GDPR 厳密対応では "Reject all" を "Accept all" と同じ視認性にする必要あり（dark pattern 禁止）

### 5-4m. Supabase Custom Auth Domain（後日・Pro プラン移行時）

Google OAuth 同意画面で「`chaxrcdtxngoyqvtoyem.supabase.co` にログイン」と表示される件を解消するため、Supabase Auth を自前サブドメイン（`auth.leadace.ai` 等）に差し替える。2022 年以降の Google 同意画面は App name ではなく redirect URI のドメインを大きく表示する仕様で、consent screen 側の設定では変更できないため、Supabase Custom Domain しか対処法がない。

**前提:**
- Supabase **Pro プラン**（$25/mo）以上が必要
- **Custom Domain アドオン**（$10/mo）が追加で必要
- 現状（Free プラン）では実施不可 — ユーザー数が増えてブランド体験の重要性が ROI を上回った段階で移行

**移行時の手順:**

- [ ] Supabase 組織を Pro プランにアップグレード → プロジェクトに Custom Domain アドオンを有効化
- [ ] `auth.leadace.ai` を Supabase Dashboard → Project Settings → Custom Domain で申請
- [ ] Cloudflare DNS に CNAME `auth` → `<project-ref>.supabase.co` を追加（proxy OFF、TTL Auto）
- [ ] Supabase 側で DNS 検証・SSL 発行の完了を待つ（数分〜数時間）
- [ ] Google Cloud Console → OAuth Client → Authorized redirect URIs に `https://auth.leadace.ai/auth/v1/callback` を追加（既存の `supabase.co` 側は即削除せずフォールバックとして一定期間残す）
- [ ] フロント/バックエンドの環境変数 `VITE_SUPABASE_URL` / `SUPABASE_URL` を `https://auth.leadace.ai` に更新
  - Cloudflare Pages (`app.leadace.ai`) — GitHub Variables の `VITE_SUPABASE_URL` 書き換え + 再デプロイ
  - API / MCP Worker — `wrangler secret put SUPABASE_URL` で上書き + 再デプロイ
- [ ] Resend SMTP 設定と `supabase/templates/*.html` 内のリンク先（メール内の confirm/reset URL）が新ドメインで発行されることを確認
- [ ] 本番 Google ログインで「leadace.ai にログイン」表示になることを確認
- [ ] 一定期間後、旧 `supabase.co` redirect URI を Google OAuth Client から削除
- [ ] `plugin/docs/deploy.md` にこの手順を反映

**代替案（いずれも非推奨）:** 自前 Worker 経由で OAuth コードを中継する / Google の Brand Verification（数週間審査、ドメイン所有証明必要）— コスト・リスクに見合わない

### 5-4h. エラー監視・オブザーバビリティ

本番リリース後の問題早期発見。

- [ ] Sentry（or 同等）を Workers + Frontend に組み込む
- [ ] または Cloudflare Workers Logs に alert（例: 5xx が 1 分で 10 件以上で Slack 通知）
- [ ] Stripe webhook 失敗時のアラート（Stripe Dashboard の組み込み機能を有効化）

### レビュー

**できていること（確認必須）:**
- [ ] サインアップから Free トライアル利用開始まで、外部ユーザーが自力で完走できる
- [ ] Password reset が動作する
- [ ] MCP OAuth が本番で安定動作する（isolate 間で auth code を失わない）
- [ ] Claude Code プラグインから `/setup` → `/strategy` → `/build-list` が通る
- [ ] Stripe live mode で実カード Checkout が成功し、プラン反映する
- [ ] `leadace.ai` アクセス時に LP or app にリダイレクトされる
- [ ] 認証メール（確認・パスワードリセット）が実際に届く

**まだできていなくて良いこと:**
- Cloudflare Queues 経由の非同期ジョブ（build-list の完全非同期化）は後回しでも良い
- 高度な分析ダッシュボード / A/B テスト等

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
フェーズ5-1c（RLS ポリシー追加）✅ 完了
    ↓
フェーズ5-1d（スキーマレビュー改善）✅ 完了
    ↓
フェーズ5-1e（MCP name/id 解決 + スキル整合性）✅ 完了
    ↓
フェーズ5-1 フロントエンド（Settings プラン表示 + クォータ表示）✅ 完了
    ↓
フェーズ5-1 レビュー（テナント分離・クォータ・MCP 動作確認）✅ 完了
    ↓
フェーズ5-3（Cloudflare 本番デプロイ + CI/CD）✅ 完了
    - コード側準備 ✅
    - Supabase prod + Stripe test + Cloudflare zone + secrets + 初回デプロイ ✅
    - CI/CD 有効化（Cloudflare Token + GitHub Secrets/Variables + push）✅
    - §8 本番動作検証（Stripe test-mode Checkout / webhook / Portal）✅
    ↓
フェーズ5-4（MVP 公開前の仕上げ）
    - 5-4a Sign-up / Password reset / Email callback ✅
    - 5-4b MCP OAuth の KV 移行 ✅
    - 5-4c MCP 接続ユーザードキュメント ✅
    - 5-4d 法的ドキュメント（ToS / Privacy） ✅ コード完了（Stripe Portal 登録は手動）
    - 5-4e apex leadace.ai に既存 LP 移設 ✅
    - 5-4f Stripe test → live 移行 ✅ 完了（live mode 稼働、test customer クリア済み）
    - 5-4g 認証メールの送信ドメイン + 本文改善 ✅（Resend 経由 `noreply@leadace.ai` 稼働、Confirm/Reset テンプレ本番適用済み）
    - 5-4h エラー監視 ⏳ 任意
    - 5-4i 最低限のレスポンシブ対応 ✅ コード完了（ブラウザ実機確認で調整の可能性あり）
    - 5-4j ライト/ダークモード対応 ✅ コード完了（トークン化 + トグル、本番反映はデプロイ時）
    - 5-4k デザイン刷新（色・タイポ・LP モーション） ✅ 完了（SurpassOne パレット + Geist + LP 再モーション化）
    - 5-4l Google Sign-in 追加 ✅ 完了（コード + Google Cloud Console + Supabase Dashboard 全て、本番疎通 OK）
    - 5-4n ブランド名を "LeadAce" に統一 ⏳ 次セッション
    - 5-4o Cookie 利用同意バナー ⏳ 次セッション
    - 5-4m Supabase Custom Auth Domain ⏳ Pro プラン移行時の後日対応（Google 同意画面のブランド化）
    ↓
フェーズ5-2（セルフデプロイ対応・ドキュメント）✅ コード完了
    - self-host.md + env vars matrix ✅
    ↓
★ 現在地 ★ = Phase 5-4 残タスク
    - 次セッション: 5-4n ブランド統一 / 5-4o Cookie 同意バナー
    - 任意: 5-4h エラー監視（Sentry 等）
    - 後日: 5-4m Supabase Custom Auth Domain（Pro プラン移行時）
    ↓
フェーズ6（リリース・移行）→ フェーズ6 レビュー
```

**優先度の考え方:**
- 対外的に恥ずかしい（`leadace.ai` 404・スパム箱行きメール）は先に潰す → 5-4e / 5-4g
- 決済を live にしないと収益が立たない → 5-4f
- 外部流入の初回接触はモバイル率が高い → 5-4i を早めに
- Google Sign-in は摩擦削減効果が大きく実装コスト小 → 5-4l
- ダーク・デザイン刷新は大きな手戻りを避けて 5-4j 先、5-4k 後
- エラー監視は外部公開規模が見えてから → 5-4h

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
