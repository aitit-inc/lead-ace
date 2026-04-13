"""prospects.company_name を prospects.name にリネーム

organizations.name = 正式法人名、prospects.name = 営業先名（学校名・部署など）
という区別を明確にするためのリネーム。
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    existing_cols = {
        col[1] for col in conn.execute("PRAGMA table_info(prospects)").fetchall()
    }
    if "company_name" in existing_cols and "name" not in existing_cols:
        conn.execute("ALTER TABLE prospects RENAME COLUMN company_name TO name")
