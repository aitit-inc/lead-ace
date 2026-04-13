"""Add org_lookup_status column to the prospects table

Records the corporate number lookup state. Used as a filter in lookup_corporate_numbers.py
to target only prospects that have not been searched yet.

Values:
  NULL: not yet searched (default)
  'not_applicable': no corporate number exists (sole proprietor, unincorporated, etc.)
  'unresolvable': searched but could not be identified
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "org_lookup_status" not in existing_cols:
        conn.execute("ALTER TABLE prospects ADD COLUMN org_lookup_status TEXT")
