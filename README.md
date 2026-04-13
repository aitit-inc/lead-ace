# lead-ace

Autonomous lead generation plugin for Claude Code.
Builds prospect lists, runs outbound outreach, and iterates on strategy — all hands-free.

## 利用者向け

### 前提条件

- Claude Code
- SQLite3
- Gmail MCP（メール送信・確認用）
- claude-in-chrome MCP（フォーム入力・SNS操作用）

### インストール

Claude Code 内で以下を実行:

```
/plugin marketplace add aitit-inc/lead-ace
/plugin install lead-ace@lead-ace
```

更新する場合:

```
/plugin marketplace update
/plugin update lead-ace@lead-ace
```

### 使い方

以下のスラッシュコマンドをパイプライン的に順番に実行する。

| コマンド | 概要 |
|---|---|
| `/setup <dir>` | プロジェクト初期化（DB・ディレクトリ作成） |
| `/strategy <dir>` | 営業・マーケ戦略を策定 |
| `/build-list <dir>` | Web探索で営業先リストを作成 |
| `/outbound <dir>` | メール・フォーム・SNS DMでアプローチ |
| `/check-results <dir>` | 反応を確認・記録 |
| `/evaluate <dir>` | データ分析に基づいてPDCA改善 |
| `/daily-cycle <dir> [件数]` | 日次サイクル自動実行（check-results → outbound + build-list） |
| `/delete-project <dir>` | プロジェクトの登録解除・データ削除 |

`<dir>` は製品/サービスごとのサブディレクトリ名（例: `product-a-sales`）。
データベース（`data.db`）はプロジェクトルートで共有、ナレッジファイル類はサブディレクトリに分離される。

### 基本的な流れ

```
/setup my-product
/strategy my-product        # 対話で事業情報を入力 → BUSINESS.md, SALES_STRATEGY.md 生成
/build-list my-product      # Web探索で営業先を収集
/outbound my-product        # 自動でアウトバウンド営業
/check-results my-product   # 反応を確認
/evaluate my-product        # 結果を分析して戦略を自動改善
```

初回セットアップ後は `/daily-cycle` で日々の営業活動を自動実行できる:

```
/daily-cycle my-product      # 毎日実行: 返信確認 → 30件アプローチ → リスト補充
/daily-cycle my-product 50   # 件数を指定
/evaluate my-product         # 週1程度で戦略改善
```

---

## ライセンス

このプラグインは SurpassOne Inc. の独自ライセンスの下で提供されています。

- **無料版:** 1プロジェクトまで利用可能
- **有料版:** 複数プロジェクト無制限。ライセンスキーは https://leadace.surpassone.com で購入できます

`/setup` 実行時にライセンスキーの入力を求められます。無料版の場合はそのままスキップしてください。

---

## 開発者向け

### プラグイン構成

```
plugin/                          # Claude Code プラグイン本体
├── .claude-plugin/plugin.json   # マニフェスト
├── skills/                      # スラッシュコマンド（各ディレクトリに SKILL.md）
├── scripts/                     # 共有スクリプト（DB初期化・クエリ実行等）
├── migrations/                  # DB マイグレーション
└── docs/                        # 設計ドキュメント
backend/                         # Web API Server + MCP Server（Cloudflare Workers）
frontend/                        # Web フロントエンド（Cloudflare Pages）
```

- 各スキルの仕様は `plugin/skills/<name>/SKILL.md` を参照
- 詳細なテンプレートやガイドラインは `plugin/skills/<name>/references/` に分離
- スクリプト内では `${CLAUDE_PLUGIN_ROOT}` でプラグインルートを参照

### DBスキーマ

`plugin/scripts/sales-db.sql` に定義。主要テーブル: `projects`, `prospects`, `outreach_logs`, `responses`, `evaluations`。

### ローカルでの開発・テスト

```bash
# このリポジトリのディレクトリで Claude Code を起動すればスキルが自動ロードされる
claude

# または別プロジェクトからプラグインとして指定
claude --plugin-dir /path/to/this/repo
```
