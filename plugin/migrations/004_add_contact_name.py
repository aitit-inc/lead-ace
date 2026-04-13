"""Add contact_name column to the prospects table

Records the contact person's name when available. Used for personalizing email salutations.
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
