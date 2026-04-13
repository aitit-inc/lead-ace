"""Add address column to the organizations table

Stores the address from the NTA Corporate Number Publication Site. Also used for corporate number verification.
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(organizations)").fetchall()
    }
    if "address" not in existing_cols:
        conn.execute("ALTER TABLE organizations ADD COLUMN address TEXT")
