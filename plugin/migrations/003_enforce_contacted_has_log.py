"""contacted ステータスへの更新を outreach_logs の存在で制約するトリガー

サブエージェントが send_and_log.py を経由せず直接 SQL で
status = 'contacted' に更新することを防止する。
send_and_log.py は先に outreach_logs に INSERT してから status を UPDATE するため、
正常フローはこのトリガーに影響されない。
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS enforce_contacted_has_log
        BEFORE UPDATE ON project_prospects
        WHEN NEW.status = 'contacted' AND OLD.status != 'contacted'
        BEGIN
            SELECT RAISE(ABORT, 'contacted にするには outreach_logs に sent レコードが必要です。send_and_log.py を経由してください')
            WHERE NOT EXISTS (
                SELECT 1 FROM outreach_logs
                WHERE project_id = NEW.project_id
                  AND prospect_id = NEW.prospect_id
                  AND status = 'sent'
            );
        END
    """)
