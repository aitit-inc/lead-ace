---
name: setup
description: "This skill should be used when the user asks to \"セットアップして\", \"新しいプロジェクトを作成\", \"初期化して\", \"プロジェクトを始めたい\", or wants to set up a new sales project. SQLiteデータベースの初期化と営業プロジェクト用サブディレクトリを作成する。"
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Setup - プロジェクト初期セットアップ

営業プロジェクトの初期セットアップを行うスキル。SQLiteデータベースの初期化と、製品/サービスごとのサブディレクトリを作成する。

**前提:** `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` の規約に従うこと（data.dbの配置・cdしないルール）。

## 実行手順

### 1. 引数の確認

- プロジェクトディレクトリ名: `$0`（必須。例: `product-a-sales`）

`$0` が空の場合はエラーを返す。

### 2. 環境チェック

以下のコマンドを実行して、必要なツールの利用可否を確認する:

```bash
python3 --version 2>&1 && python3 -c "import sqlite3; print('sqlite3: ok')" 2>&1; echo "---"; git --version 2>&1 && git remote -v 2>&1; echo "---"; which gog 2>&1 && gog version 2>&1; echo "---"; playwright-cli --version 2>&1
```

結果に応じてユーザーに状況を伝える:

**python3 が使えない場合（致命的）:**
このプラグインの全機能が python3 に依存しているため、python3 をインストールするまで利用できない旨を伝え、セットアップを**中断**する。

**git が使えない / リモートリポジトリが未設定の場合:**
daily-cycle の自動コミット・プッシュが動作しないため、data.db やレポートの**データ消失リスク**がある旨を警告する。利用自体は可能。

**gog が使えない場合:**
メールの自動送信ができない。Gmail MCP が利用可能であればドラフト作成までは可能だが、送信は手動になる旨を警告する。

**Gmail MCP / playwright-cli / Claude in Chrome について:**
以下の依存関係をユーザーに伝える:
- **Gmail MCP** (`gmail_search_messages` 等): /check-results での返信確認と /check-results でのドラフト作成に必要。未設定の場合、返信確認が手動になる
- **playwright-cli**: /outbound でのフォーム送信に必要。`playwright-cli --version` で確認できる。未インストールの場合、メールアドレスがある営業先のみが対象になる
- **Claude in Chrome**: /outbound でのSNS DM送信、/check-results でのSNS返信確認に必要。未設定の場合、SNSチャネルが使えない
- **gog も Gmail MCP も両方使えない場合**: メール送信もドラフト作成もできないため、outbound 機能が実質使えない旨を明確に警告する

### 3. ライセンスチェック

プロジェクトの追加が可能かどうかを確認する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py check-can-add "$(pwd)/$0"
```

結果に応じた処理:

- **`PAID`** → そのまま続行
- **`FREE_OK`** → 「無料版（1プロジェクト）として登録します」と表示して続行
- **`FREE_LIMIT`** → 「無料版は1プロジェクトまでです。ライセンスキーを入力するか、既存プロジェクトを /delete-project で削除してください。」と表示。AskUserQuestionでキー入力を促す（スキップも可）
  - ユーザーがキーを入力した場合: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py save-key "<入力されたキー>"` を実行
  - 結果が `VALID` → 「ライセンスキーが有効です。有料版として登録します。」と表示して続行
  - 結果が `INVALID` → 「ライセンスキーが無効です。」と表示して**中断**
  - ユーザーがスキップした場合 → **中断**
- **`ALREADY_REGISTERED`** → 「このプロジェクトは登録済みです。そのまま続行します。」

### 4. データベース初期化

`data.db` がワークスペースルートに存在しない場合のみ、初期化スクリプトを実行する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/init_db.py
```

既にDBが存在する場合はスキップし、その旨を報告する。

### 5. サブディレクトリ作成

ワークスペースルート直下に指定名のディレクトリを作成する:

```bash
mkdir -p "$0"
```

既に存在する場合はスキップ。

### 5b. .gitignore の作成

ワークスペースルートに `.gitignore` が存在しない場合のみ作成する:

```bash
if [ ! -f .gitignore ]; then
  cat > .gitignore << 'EOF'
.env
.env.*
*.key
credentials*.json
client_secret*.json
.tmp/
.DS_Store
EOF
fi
```

既に存在する場合はスキップ（ユーザーの設定を上書きしない）。

### 6. プロジェクト登録

DBの `projects` テーブルにプロジェクトを登録する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/init_db.py data.db --register-project "$0"
```

### 7. グローバル登録

`~/.leadace/projects` にプロジェクトパスを登録する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py register "$(pwd)/$0"
```

### 8. 完了報告

以下を報告する:
- データベースの状態（新規作成 or 既存）
- 作成したディレクトリパス
- 次のステップとして `/strategy` の実行を案内する
