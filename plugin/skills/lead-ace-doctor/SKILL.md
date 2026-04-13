---
name: lead-ace-doctor
description: "緊急時のDB直接操作。専用スクリプトでは対応できないDB修正・調査が必要な場合に使用する。"
argument-hint: "<修正内容の説明>"
---

## 概要

このスキルは**緊急時・障害対応専用**の直接DB操作手段です。通常の運用では以下の専用スクリプトを使用してください:

| 操作 | 専用スクリプト |
|---|---|
| メール送信 + ログ記録 | `send_and_log.py` |
| 返信記録 + ステータス更新 | `record_response.py` |
| unreachable / inactive への変更 | `update_status.py` |
| 評価記録 + 優先度更新 | `record_evaluation.py` |
| 営業先の一括登録 | `add_prospects.py` |
| READ クエリ全般 | `sales_queries.py` |
| DB初期化 + プロジェクト登録 | `init_db.py` |

## DBスキーマ

SQL を書く前に以下を読み、現在のスキーマを把握すること:

- `${CLAUDE_PLUGIN_ROOT}/scripts/sales-db.sql` — 最新のフルスキーマ（テーブル定義・FK・インデックス・トリガー全て）

## 手順

### 0. プリフライト

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db --migrate-only
```

### 1. 状況確認

ユーザーの指示内容を確認し、実行すべき SQL を特定する。必要に応じて SELECT で現状を確認する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/query_db.py data.db "<SELECT文>" [パラメータ...]
```

### 2. 実行計画の提示

実行する SQL を**必ずユーザーに提示**し、AskUserQuestion で確認を取る。確認なしの実行は禁止。

提示する内容:
- 実行する SQL 文
- 影響を受けるレコード数（事前に SELECT COUNT で確認）
- 想定される影響

### 3. 実行

ユーザーの承認後に実行する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/query_db.py data.db "<SQL文>" [パラメータ...]
```

### 4. 結果確認

実行後、影響を受けたレコードを SELECT で確認し、結果をユーザーに報告する。

### 5. 再発防止の提案

同じ操作が今後も必要になりそうな場合、専用スクリプトの作成を提案する。
