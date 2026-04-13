"""Rename prospects.corporate_number to prospects.organization_id

prospects.corporate_number was a FK to the organizations table, but the column name
did not reflect this. Renaming makes it clear it references organizations.corporate_number (PK).
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "corporate_number" in existing_cols and "organization_id" not in existing_cols:
        conn.execute(
            "ALTER TABLE prospects RENAME COLUMN corporate_number TO organization_id"
        )
    # Update index as well (drop old index and create a new one)
    conn.execute("DROP INDEX IF EXISTS idx_prospect_org")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_prospect_org ON prospects(organization_id)"
    )
