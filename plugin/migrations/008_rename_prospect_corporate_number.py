"""prospects.corporate_number を prospects.organization_id にリネーム

prospects.corporate_number は organizations テーブルへの FK だが、
カラム名がそれを表現していなかったためリネーム。
organizations.corporate_number (PK) への参照であることを明確にする。
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
    # インデックスも更新（旧インデックスを削除して新しいものを作成）
    conn.execute("DROP INDEX IF EXISTS idx_prospect_org")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_prospect_org ON prospects(organization_id)"
    )
