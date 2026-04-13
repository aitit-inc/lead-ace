"""outreach_logs に送信重複チェック用の複合インデックスを追加

send_and_log.py の check_already_attempted() クエリを高速化する。
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_outreach_dedup"
        " ON outreach_logs(project_id, prospect_id, status)"
    )
