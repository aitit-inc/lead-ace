"""prospects テーブルに org_lookup_status カラムを追加

法人番号の検索状態を記録する。lookup_corporate_numbers.py が未検索の prospects だけを
対象にするためのフィルタに使用。

値:
  NULL: 未検索（デフォルト）
  'not_applicable': 法人番号が存在しない（個人事業主、法人格なし等）
  'unresolvable': 検索したが特定できなかった
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "org_lookup_status" not in existing_cols:
        conn.execute("ALTER TABLE prospects ADD COLUMN org_lookup_status TEXT")
