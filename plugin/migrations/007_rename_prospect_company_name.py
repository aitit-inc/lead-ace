"""Rename prospects.company_name to prospects.name

Clarifies the distinction: organizations.name = official entity name,
prospects.name = prospect name (school name, department, etc.).
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "company_name" in existing_cols and "name" not in existing_cols:
        conn.execute("ALTER TABLE prospects RENAME COLUMN company_name TO name")
