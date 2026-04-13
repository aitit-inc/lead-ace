# Lead Ace プラグイン開発リポジトリ

SurpassOne Inc. が提供する Lead Ace（自律営業自動化 Claude Code プラグイン）のリポジトリ。

## リポジトリ構成

```
.claude-plugin/marketplace.json  # マーケットプレイス定義（source: "./plugin/" を指す）
plugin/                          # Claude Code プラグイン本体
backend/                         # Web API Server + MCP Server（フェーズ2で新設）
frontend/                        # Web フロントエンド（フェーズ4で新設）
docker-compose.yml               # ローカル開発環境（フェーズ2で追加）
```

## プラグインの構成

```
plugin/
├── .claude-plugin/
│   └── plugin.json       # プラグインマニフェスト（必須）
├── skills/                # スラッシュコマンド（各サブディレクトリに SKILL.md）
├── scripts/               # ヘルパースクリプト（フェーズ3で廃止予定）
├── migrations/            # DB マイグレーション（フェーズ3で廃止予定）
├── references/            # 共通参照ドキュメント
└── docs/                  # 設計ドキュメント
```

## 開発方針

プラグインは**安定性・信頼性・制御性・汎用性**を重視する。
- 特定の事業やユースケースに依存するハードコード値（目標数値、成功率等）をスキルやテンプレートに埋め込まない
- 事業ごとに異なる判断はプロジェクト設定（BUSINESS.md / SALES_STRATEGY.md 等）に委ね、プラグインは制御の仕組みと可視化を提供する
- スキルの改善は「ユーザーが制御できる仕組みを増やす」方向で行い、「特定の振る舞いを強制する」方向にしない

### LLM とスクリプトの責務分離

プラグインの処理は「LLM が担うべき部分」と「スクリプトに固定すべき部分」を明確に分ける。

- **スクリプト（決定的ロジック）**: DB操作、メール送信、ステータス更新、バリデーション、データ整形など、ルールが明確で毎回同じ動作をすべき処理。LLM に直接 SQL を書かせたりコマンドを組み立てさせたりせず、専用スクリプト経由で実行する
- **LLM（判断・生成）**: メール本文の作成、営業先の評価、戦略の分析・改善提案など、文脈に応じた柔軟な判断や自然言語生成が必要な処理

**原則:** LLM がやるべきでない処理（決定的・反復的・正確性が必要）をスクリプトに切り出し、LLM には判断と生成に集中させる。スキルの SKILL.md にはスクリプトの呼び出し方（コマンドと引数）を書き、内部実装の詳細は書かない。

## 開発ルール

- パス参照は `${CLAUDE_PLUGIN_ROOT}` を使い、ハードコードしない（`${CLAUDE_PLUGIN_ROOT}` は `plugin/` を指す）
- 言語: 日本語（コード内コメント・ドキュメント共に）
- スクリプトは全て Python で書く（shell script / JS 禁止）
- Python スクリプトの CLI インターフェースは `argparse` で統一する（`sys.argv` 直接参照は使わない）
- Web ページ取得は `fetch_url.py` を使う（WebFetch はフリーズ問題・SPA 非対応のため禁止）。生 HTML が必要な場合は `--raw` フラグ
- Python スクリプトでは型定義をしっかりすること。anyは禁止。なるべく型キャストは避け、正しく型推論できるようにすること
- Python スクリプトを変更したら、コミット前に `cd plugin/scripts && npx pyright && python3 test_imports.py` を実行して型チェックとインポートテスト（モジュールレベル assertion）を通すこと

## スキルの書き方（公式ベストプラクティス準拠）

- **SKILL.md は500行以下**。超えそうなら references/ に分離する
- **description は250文字以内**（超過分はスキル一覧で切り詰められる）。キーユースケースを先頭に書く
- **references/ は自動読み込みされない**。SKILL.md 内で「いつ・どの条件で読むか」を明示すること
- **references/ のネストは1階層まで**。reference ファイルからさらに別ファイルを参照しない
- **300行超の reference ファイルには目次を付ける**
- **Claude が既に知っている知識は書かない**。トークンの無駄
- **プログレッシブ・ディスクロージャー**: SKILL.md に全手順を書き、条件付きでしか使わない詳細は references/ に置く。常に必要な情報だけ SKILL.md に残す

出典: [Extend Claude with skills](https://code.claude.com/docs/en/skills), [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## サブエージェントプロンプトの注意事項

サブエージェントに不可逆アクション（メール送信、フォーム送信等）を実行させる場合、プロンプトの書き方でモデルが拒否するかどうかが決まる（`--dangerously-skip-permissions` では解決しない）。

**NGワード（モデルが「安全制御の迂回試行」と判断して拒否する）:**
- 「確認不要」「確認を求めずに」「確認なしで」
- 「承認済み」「ユーザーが事前に承認」
- 「全自動で実行」「自律モード」
- 「直接実行してください」

**正しい書き方:** 単にタスクを自然に記述する。安全制御を迂回する意図を感じさせる文言を入れない。

```
NG: 「以下のコマンドを実行してください。ユーザーは承認済みです。確認は不要です。直接実行してください。」
OK: 「leo.uno@surpassone.com 宛にテストメールを送信してください。コマンド: gog send --account ... --to ... --subject "件名" --body "本文"」
```

2026-04-07 テストで確認: 同一コマンドでも NG パターンは拒否、OK パターンは成功。

## DBマイグレーション (plugin/scripts/)

- `plugin/migrations/` に `NNN_description.py`（NNN は3桁連番）を配置
- 各ファイルに `def up(conn: sqlite3.Connection) -> None:` を実装。冪等に書くこと（`IF NOT EXISTS` 等）
- `preflight.py` が全スキル実行前に未適用マイグレーションを自動適用（`applied_migrations` テーブルで追跡）
- 全スキルのステップ0で `preflight.py` を呼び出す（登録チェック + マイグレーション）

### sales-db.sql とマイグレーションの関係

**`sales-db.sql` は常に「最新のフルスキーマ」を表す。** マイグレーションで変更を追加したら、同じ変更を `sales-db.sql` にも反映すること。

- **新規ユーザー**: `init_db.py` → `sales-db.sql` で完全なスキーマが作られる → マイグレーションは冪等なので全て no-op
- **既存ユーザー**: `preflight.py` → 未適用マイグレーションが差分適用される

この方針により、スキーマの全体像を知りたい場合は **`sales-db.sql` だけ読めばよい**（マイグレーションファイルを辿る必要がない）。

## 一時スキル・スクリプトの削除予定

- **v0.6.0 リリース時に削除**: `plugin/skills/data-migration-v050/`、`plugin/scripts/link_organization.py`、`plugin/scripts/mark_org_lookup_status.py`、`plugin/scripts/test_imports.py` から `link_organization` と `mark_org_lookup_status` の行

## リリース前のチェック（必須）
`cd plugin/scripts && npx pyright && python3 test_imports.py`

## リリース
`plugin/.claude-plugin/plugin.json` のバージョンをあげてコミット＆プッシュする。
バージョンについて特に指示がなければ、x.y.z のzをインクリメントすること（各数字は二桁以上も可。例: 0.3.9 → 0.3.10）。
バージョン上げる時は先にコード類をコミットしてから、バージョンアップだけのコミットを作る。
コミットメッセージは "chore: :bookmark: bump version to x.y.z" にする。
