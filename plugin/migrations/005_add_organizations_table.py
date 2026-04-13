"""Add organizations table, and add department column and UNIQUE constraints to prospects

organizations: entity-level master table (corporate_number is the PK)
prospects.department: department or branch name within an entity (nullable)
prospects.corporate_number: remove old schema UNIQUE constraint (as a FK, multiple prospects can share the same corporate number)
email/contact_form_url: global UNIQUE constraints to prevent duplicate outreach
"""

import re
import sqlite3
import sys
import unicodedata


def _normalize_name(name: str) -> str:
    return unicodedata.normalize("NFKC", name).lower().strip()


def _extract_domain(url: str) -> str:
    domain = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    domain = re.sub(r"^www\.", "", domain, flags=re.IGNORECASE)
    return domain.split("/")[0].lower()


def up(conn: sqlite3.Connection) -> None:
    # 1. Create organizations table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS organizations (
            corporate_number TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            domain TEXT,
            website_url TEXT NOT NULL,
            industry TEXT,
            overview TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_org_domain ON organizations(domain)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_org_normalized_name ON organizations(normalized_name)"
    )

    # 2. Migrate existing prospects data into organizations
    # If 007/008 already applied: name/organization_id columns; otherwise: company_name/corporate_number
    cols = {col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()}
    name_col = "name" if "name" in cols else "company_name"
    org_col = "organization_id" if "organization_id" in cols else "corporate_number"
    cursor = conn.execute(
        f"SELECT {org_col}, {name_col}, website_url, industry, overview,"
        f" created_at, updated_at"
        f" FROM prospects WHERE {org_col} IS NOT NULL"
    )
    for row in cursor.fetchall():
        corp_num: str = row[0]
        name: str = row[1]
        url: str = row[2] or ""
        conn.execute(
            "INSERT OR IGNORE INTO organizations"
            " (corporate_number, name, normalized_name, domain,"
            "  website_url, industry, overview, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                corp_num,
                name,
                _normalize_name(name),
                _extract_domain(url) if url else None,
                url,
                row[3],  # industry
                row[4],  # overview
                row[5],  # created_at
                row[6],  # updated_at
            ),
        )

    # 3. Remove the UNIQUE constraint on prospects.corporate_number
    # In the old schema it was corporate_number TEXT UNIQUE, but as a FK to organizations,
    # multiple prospects need to be able to share the same corporate number.
    # SQLite does not support altering column constraints, so we recreate the table.
    autoindex_names = {
        idx[1] for idx in conn.execute("PRAGMA index_list(prospects)").fetchall()
        if idx[1] and idx[1].startswith("sqlite_autoindex_prospects")
    }
    has_unique_on_corp_num = False
    for idx_name in autoindex_names:
        cols = conn.execute(f"PRAGMA index_info('{idx_name}')").fetchall()
        col_names = {col[2] for col in cols}
        # autoindex for corporate_number or organization_id (after rename)
        if col_names & {"corporate_number", "organization_id"}:
            has_unique_on_corp_num = True
            break

    if has_unique_on_corp_num:
        # Get current column names (name/organization_id if 007/008 already applied; otherwise company_name/corporate_number)
        col_info = conn.execute("PRAGMA table_info(prospects)").fetchall()
        current_cols = [col[1] for col in col_info]

        cols_csv = ", ".join(current_cols)
        # Dynamically build column definitions for the new table
        col_defs: list[str] = []
        for col in col_info:
            col_name: str = col[1]
            col_type: str = col[2]
            not_null: int = col[3]
            default_val: str | None = col[4]
            is_pk: int = col[5]

            parts = [col_name, col_type]
            if is_pk:
                parts.append("PRIMARY KEY AUTOINCREMENT")
            elif not_null:
                if default_val is not None:
                    # DEFAULT expressions containing functions must be wrapped in ()
                    parts.append(f"NOT NULL DEFAULT ({default_val})")
                else:
                    parts.append("NOT NULL")
            elif default_val is not None:
                parts.append(f"DEFAULT ({default_val})")
            # Do not add UNIQUE (this is the whole point of the fix)
            col_defs.append(" ".join(parts))

        conn.execute("ALTER TABLE prospects RENAME TO _prospects_old")
        conn.execute(f"CREATE TABLE prospects ({', '.join(col_defs)})")
        conn.execute(f"INSERT INTO prospects ({cols_csv}) SELECT {cols_csv} FROM _prospects_old")
        conn.execute("DROP TABLE _prospects_old")

    # 4. Add department column to prospects
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "department" not in existing_cols:
        conn.execute("ALTER TABLE prospects ADD COLUMN department TEXT")

    # 5. Add UNIQUE constraints on email / contact_form_url
    existing_indexes = {
        idx[1] for idx in conn.execute("PRAGMA index_list(prospects)").fetchall()
    }

    if "idx_prospect_unique_email" not in existing_indexes:
        # Log any existing duplicate emails (assuming the constraint creation will succeed)
        dupes = conn.execute(
            "SELECT email, COUNT(*) as cnt FROM prospects"
            " WHERE email IS NOT NULL GROUP BY email HAVING cnt > 1"
        ).fetchall()
        if dupes:
            for d in dupes:
                print(
                    f"WARNING: Duplicate email detected: {d[0]} ({d[1]} records) — merge manually",
                    file=sys.stderr,
                )
        else:
            conn.execute(
                "CREATE UNIQUE INDEX idx_prospect_unique_email"
                " ON prospects(email) WHERE email IS NOT NULL"
            )

    if "idx_prospect_unique_form" not in existing_indexes:
        dupes = conn.execute(
            "SELECT contact_form_url, COUNT(*) as cnt FROM prospects"
            " WHERE contact_form_url IS NOT NULL GROUP BY contact_form_url HAVING cnt > 1"
        ).fetchall()
        if dupes:
            for d in dupes:
                print(
                    f"WARNING: Duplicate contact form URL detected: {d[0]} ({d[1]} records) — merge manually",
                    file=sys.stderr,
                )
        else:
            conn.execute(
                "CREATE UNIQUE INDEX idx_prospect_unique_form"
                " ON prospects(contact_form_url) WHERE contact_form_url IS NOT NULL"
            )
