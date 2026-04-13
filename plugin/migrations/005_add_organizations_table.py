"""organizations テーブルの追加、prospects に department カラムと UNIQUE 制約を追加

organizations: 法人単位のマスタ（corporate_number が PK）
prospects.department: 法人内の部署・拠点名（nullable）
prospects.corporate_number: 旧スキーマの UNIQUE 制約を除去（FKなので複数 prospect が同一法人番号を共有可能）
email/contact_form_url: グローバル UNIQUE 制約で二重送信を防止
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
    # 1. organizations テーブル作成
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

    # 2. 既存 prospects から organizations にデータ移行
    # 007/008 適用済みなら name/organization_id、未適用なら company_name/corporate_number
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

    # 3. prospects.corporate_number の UNIQUE 制約を除去
    # 旧スキーマでは corporate_number TEXT UNIQUE だったが、organizations への FK なので
    # 複数 prospect が同一法人番号を共有できる必要がある。
    # SQLite はカラム制約の変更ができないため、テーブル再作成で対応する。
    autoindex_names = {
        idx[1] for idx in conn.execute("PRAGMA index_list(prospects)").fetchall()
        if idx[1] and idx[1].startswith("sqlite_autoindex_prospects")
    }
    has_unique_on_corp_num = False
    for idx_name in autoindex_names:
        cols = conn.execute(f"PRAGMA index_info('{idx_name}')").fetchall()
        col_names = {col[2] for col in cols}
        # corporate_number または organization_id（リネーム後）の autoindex
        if col_names & {"corporate_number", "organization_id"}:
            has_unique_on_corp_num = True
            break

    if has_unique_on_corp_num:
        # 現在のカラム名を取得（007/008 適用済みなら name/organization_id、未適用なら company_name/corporate_number）
        col_info = conn.execute("PRAGMA table_info(prospects)").fetchall()
        current_cols = [col[1] for col in col_info]

        cols_csv = ", ".join(current_cols)
        # 新テーブルのカラム定義を動的に構築
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
                    # 式を含む DEFAULT は () で囲む必要がある
                    parts.append(f"NOT NULL DEFAULT ({default_val})")
                else:
                    parts.append("NOT NULL")
            elif default_val is not None:
                parts.append(f"DEFAULT ({default_val})")
            # UNIQUE は付けない（これが修正の目的）
            col_defs.append(" ".join(parts))

        conn.execute("ALTER TABLE prospects RENAME TO _prospects_old")
        conn.execute(f"CREATE TABLE prospects ({', '.join(col_defs)})")
        conn.execute(f"INSERT INTO prospects ({cols_csv}) SELECT {cols_csv} FROM _prospects_old")
        conn.execute("DROP TABLE _prospects_old")

    # 4. prospects に department カラム追加
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "department" not in existing_cols:
        conn.execute("ALTER TABLE prospects ADD COLUMN department TEXT")

    # 5. email / contact_form_url に UNIQUE 制約追加
    existing_indexes = {
        idx[1] for idx in conn.execute("PRAGMA index_list(prospects)").fetchall()
    }

    if "idx_prospect_unique_email" not in existing_indexes:
        # 既存の重複メールがあればログ出力（制約作成は成功する前提）
        dupes = conn.execute(
            "SELECT email, COUNT(*) as cnt FROM prospects"
            " WHERE email IS NOT NULL GROUP BY email HAVING cnt > 1"
        ).fetchall()
        if dupes:
            for d in dupes:
                print(
                    f"WARNING: 重複email検出: {d[0]} ({d[1]}件) — 手動でマージしてください",
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
                    f"WARNING: 重複form検出: {d[0]} ({d[1]}件) — 手動でマージしてください",
                    file=sys.stderr,
                )
        else:
            conn.execute(
                "CREATE UNIQUE INDEX idx_prospect_unique_form"
                " ON prospects(contact_form_url) WHERE contact_form_url IS NOT NULL"
            )
