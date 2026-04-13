"""prospects テーブルに form_type カラムを追加

form_type カラムが存在しない古いDBからのアップグレード用。
sales-db.sql には最初から含まれているため、新規DBでは no-op。
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(prospects)")
    columns = {str(row[1]) for row in cursor.fetchall()}

    if "form_type" not in columns:
        conn.execute("ALTER TABLE prospects ADD COLUMN form_type TEXT")
