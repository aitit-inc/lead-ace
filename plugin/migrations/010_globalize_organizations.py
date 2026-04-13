"""Globalize organizations: replace corporate_number PK with domain PK

- organizations: rename corporate_number PK → domain PK (apex domain extracted from website_url)
  - Add optional country field (ISO 3166-1 alpha-2)
  - Keep address, industry, overview
- prospects: update organization_id FK reference (corporate_number → domain)
  - Remove org_lookup_status column (was only used for corporate number lookup tracking)
- Remove idx_org_domain index (domain is now the PK, auto-indexed)
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata


def _extract_domain(url: str) -> str:
    domain = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    domain = re.sub(r"^www\.", "", domain, flags=re.IGNORECASE)
    return domain.split("/")[0].lower()


def _normalize_name(name: str) -> str:
    return unicodedata.normalize("NFKC", name).lower().strip()


def up(conn: sqlite3.Connection) -> None:
    # Disable FK enforcement during the table recreation
    conn.execute("PRAGMA foreign_keys = OFF")

    # ------------------------------------------------------------------
    # 1. Create new organizations table with domain as PK
    # ------------------------------------------------------------------
    conn.execute("""
        CREATE TABLE organizations_new (
            domain TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            website_url TEXT NOT NULL,
            country TEXT,
            address TEXT,
            industry TEXT,
            overview TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)

    # Migrate rows: derive domain from website_url; build a map for prospects migration
    orgs = conn.execute(
        "SELECT corporate_number, name, normalized_name, website_url, "
        "address, industry, overview, created_at, updated_at FROM organizations"
    ).fetchall()

    org_map: dict[str, str] = {}  # corporate_number → domain
    for org in orgs:
        domain = _extract_domain(str(org["website_url"]))
        if domain:
            org_map[str(org["corporate_number"])] = domain
            conn.execute(
                "INSERT OR IGNORE INTO organizations_new "
                "(domain, name, normalized_name, website_url, address, industry, overview, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    domain,
                    org["name"],
                    org["normalized_name"],
                    org["website_url"],
                    org["address"],
                    org["industry"],
                    org["overview"],
                    org["created_at"],
                    org["updated_at"],
                ),
            )

    # ------------------------------------------------------------------
    # 2. Recreate prospects: translate organization_id and drop org_lookup_status
    # ------------------------------------------------------------------
    conn.execute("""
        CREATE TABLE prospects_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact_name TEXT,
            organization_id TEXT REFERENCES organizations_new(domain),
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

    prospects = conn.execute(
        "SELECT id, name, contact_name, organization_id, department, overview, "
        "industry, website_url, email, contact_form_url, form_type, sns_accounts, "
        "do_not_contact, notes, created_at, updated_at FROM prospects"
    ).fetchall()

    for p in prospects:
        old_org_id = p["organization_id"]
        new_org_id: str | None = None
        if old_org_id is not None:
            new_org_id = org_map.get(str(old_org_id))
            # If not found in map (data inconsistency), leave as NULL
        conn.execute(
            "INSERT INTO prospects_new "
            "(id, name, contact_name, organization_id, department, overview, "
            "industry, website_url, email, contact_form_url, form_type, sns_accounts, "
            "do_not_contact, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                p["id"], p["name"], p["contact_name"], new_org_id, p["department"],
                p["overview"], p["industry"], p["website_url"], p["email"],
                p["contact_form_url"], p["form_type"], p["sns_accounts"],
                p["do_not_contact"], p["notes"], p["created_at"], p["updated_at"],
            ),
        )

    # ------------------------------------------------------------------
    # 3. Swap tables
    # ------------------------------------------------------------------
    conn.execute("DROP INDEX IF EXISTS idx_org_domain")
    conn.execute("DROP INDEX IF EXISTS idx_org_normalized_name")
    conn.execute("DROP INDEX IF EXISTS idx_prospect_unique_email")
    conn.execute("DROP INDEX IF EXISTS idx_prospect_unique_form")
    conn.execute("DROP INDEX IF EXISTS idx_prospect_org")
    conn.execute("DROP TABLE organizations")
    conn.execute("DROP TABLE prospects")
    conn.execute("ALTER TABLE organizations_new RENAME TO organizations")
    conn.execute("ALTER TABLE prospects_new RENAME TO prospects")

    # Recreate indexes (domain is PK so no explicit idx_org_domain needed)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_org_normalized_name ON organizations(normalized_name)"
    )
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
