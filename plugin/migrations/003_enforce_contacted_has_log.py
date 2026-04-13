"""Trigger that enforces the existence of an outreach_logs record when setting status to contacted

Prevents sub-agents from directly updating status = 'contacted' via SQL
without going through send_and_log.py.
Since send_and_log.py INSERTs into outreach_logs before UPDATing the status,
the normal flow is not affected by this trigger.
"""

import sqlite3


def up(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS enforce_contacted_has_log
        BEFORE UPDATE ON project_prospects
        WHEN NEW.status = 'contacted' AND OLD.status != 'contacted'
        BEGIN
            SELECT RAISE(ABORT, 'A sent record in outreach_logs is required to set status to contacted. Use send_and_log.py.')
            WHERE NOT EXISTS (
                SELECT 1 FROM outreach_logs
                WHERE project_id = NEW.project_id
                  AND prospect_id = NEW.prospect_id
                  AND status = 'sent'
            );
        END
    """)
