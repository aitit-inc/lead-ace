"""prospects テーブルに contact_name カラムを追加

担当者名が取得できた場合に記録する。メール宛名のパーソナライズに使用。
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "contact_name" not in existing_cols:
        conn.execute(
            "ALTER TABLE prospects ADD COLUMN contact_name TEXT"
        )
