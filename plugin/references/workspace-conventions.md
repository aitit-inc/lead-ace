# ワークスペース共通規約

全スキル・サブエージェント共通のルール。

## data.db の配置

`data.db` は **ワークスペースルート（cdの初期位置）に1つだけ存在する共有DB** である。プロジェクトサブディレクトリ内には存在しない。

```
workspace-root/          ← ここが cwd の初期位置
├── data.db              ← 共有DB（ここにしかない）
├── project-a/
│   ├── BUSINESS.md
│   └── SALES_STRATEGY.md
└── project-b/
    └── ...
```

## 日時のタイムゾーン

SQLite で日時を扱う際は、常に **`datetime('now', 'localtime')`** を使用すること。`datetime('now')` は UTC になるため使用禁止。

```sql
-- ○ 正しい
DEFAULT (datetime('now', 'localtime'))
updated_at = datetime('now', 'localtime')
datetime('now', 'localtime', '-6 days')

-- × 使用禁止
DEFAULT (datetime('now'))
updated_at = datetime('now')
```

## コマンド実行時のルール

- **cdしない。** 全ての bash コマンドはワークスペースルートで実行すること
- `data.db` は常に相対パスでそのまま参照できる（cwdがワークスペースルートなので）
- プロジェクトディレクトリ内のファイルは `$0/BUSINESS.md` のように `$0` プレフィックスで参照する
