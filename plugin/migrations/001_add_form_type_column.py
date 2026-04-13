"""Add form_type column to the prospects table

For upgrading from older DBs that do not have the form_type column.
Since sales-db.sql already includes it, this is a no-op on new DBs.
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(prospects)")
    columns = {str(row[1]) for row in cursor.fetchall()}

    if "form_type" not in columns:
        conn.execute("ALTER TABLE prospects ADD COLUMN form_type TEXT")
