---
name: delete-project
description: "This skill should be used when the user asks to \"プロジェクトを削除して\", \"プロジェクトを消して\", \"登録を解除して\", or wants to delete a registered project. ~/.leadace/projects から削除し、ローカルの data.db からも該当プロジェクトのレコードを削除する。"
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Delete Project - プロジェクト削除

登録済みプロジェクトを `~/.leadace/projects` から登録解除し、必要に応じてローカルの data.db からもデータを削除するスキル。

## 実行手順

### 1. 引数の確認

- プロジェクトディレクトリ名: `$0`（必須）

`$0` が空の場合はエラーを返す。

### 2. グローバル登録解除

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/license.py unregister "$(pwd)/$0"
```

- 結果が `UNREGISTERED` → 「プロジェクト '$0' を登録解除しました。」
- 結果が `NOT_FOUND` → 「プロジェクト '$0' は登録されていません。」と表示して終了

### 3. ローカルデータの削除確認

AskUserQuestion で「ローカルの data.db からもこのプロジェクトのデータを削除しますか？（ディレクトリは残ります）」と確認する。

### 4. ローカルデータの削除（ユーザーが承諾した場合のみ）

data.db の該当プロジェクトのレコードを1トランザクションで削除する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/delete_project.py data.db "$0"
```

※ prospects テーブルのレコードは他プロジェクトで再利用される可能性があるため削除しない。

### 5. 完了報告

- 登録解除の結果
- データ削除の有無
- ディレクトリは残っている旨を案内
