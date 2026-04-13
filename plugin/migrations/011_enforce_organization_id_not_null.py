"""Enforce prospects.organization_id NOT NULL

Prospects without a domain-resolvable organization have no place in the system.
This migration:
  1. Cascades-deletes all prospects with NULL/empty organization_id, along with
     their project_prospects, outreach_logs, and responses records
  2. Recreates the prospects table with organization_id NOT NULL
"""

from __future__ import annotations

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")

    # ------------------------------------------------------------------
    # 1. Cascade-delete orphaned prospects (organization_id IS NULL or '')
    # ------------------------------------------------------------------
    orphan_rows = conn.execute(
        "SELECT id FROM prospects WHERE organization_id IS NULL OR organization_id = ''"
    ).fetchall()

    if orphan_rows:
        ids: list[int] = [int(row["id"]) for row in orphan_rows]
        placeholders = ",".join("?" * len(ids))

        # responses ← outreach_logs ← prospects
        conn.execute(
            f"DELETE FROM responses WHERE outreach_log_id IN "
            f"(SELECT id FROM outreach_logs WHERE prospect_id IN ({placeholders}))",
            ids,
        )
        conn.execute(
            f"DELETE FROM outreach_logs WHERE prospect_id IN ({placeholders})",
            ids,
        )
        conn.execute(
            f"DELETE FROM project_prospects WHERE prospect_id IN ({placeholders})",
            ids,
        )
        conn.execute(
            f"DELETE FROM prospects WHERE id IN ({placeholders})",
            ids,
        )

    # ------------------------------------------------------------------
    # 2. Recreate prospects with organization_id NOT NULL
    # ------------------------------------------------------------------
    conn.execute("DROP TABLE IF EXISTS prospects_new")

    conn.execute("""
        CREATE TABLE prospects_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact_name TEXT,
            organization_id TEXT NOT NULL REFERENCES organizations(domain),
            department TEXT,
            overview TEXT NOT NULL,
            industry TEXT,
            website_url TEXT NOT NULL,
            email TEXT,
            contact_form_url TEXT,
            form_type TEXT,
            sns_accounts TEXT,
            do_not_contact INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)

    conn.execute("""
        INSERT INTO prospects_new
        SELECT id, name, contact_name, organization_id, department, overview,
               industry, website_url, email, contact_form_url, form_type,
               sns_accounts, do_not_contact, notes, created_at, updated_at
        FROM prospects
    """)

    conn.execute("DROP INDEX IF EXISTS idx_prospect_unique_email")
    conn.execute("DROP INDEX IF EXISTS idx_prospect_unique_form")
    conn.execute("DROP INDEX IF EXISTS idx_prospect_org")
    conn.execute("DROP TABLE prospects")
    conn.execute("ALTER TABLE prospects_new RENAME TO prospects")

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_unique_email "
        "ON prospects(email) WHERE email IS NOT NULL"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_unique_form "
        "ON prospects(contact_form_url) WHERE contact_form_url IS NOT NULL"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prospect_org ON prospects(organization_id)")

    conn.execute("PRAGMA foreign_keys = ON")
