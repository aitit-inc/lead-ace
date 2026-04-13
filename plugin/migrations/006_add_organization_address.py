"""organizations テーブルに address カラムを追加

国税庁法人番号公表サイトの所在地情報を保持する。法人番号の照合にも使用。
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(organizations)").fetchall()
    }
    if "address" not in existing_cols:
        conn.execute("ALTER TABLE organizations ADD COLUMN address TEXT")
