#!/usr/bin/env python3
"""プロジェクトの全データを1トランザクションで削除するスクリプト

Usage:
  delete_project.py <db_path> <project_id>

削除対象テーブル（外部キー制約の依存順）:
  1. responses（outreach_logs 経由）
  2. outreach_logs
  3. evaluations
  4. project_prospects
  5. projects
"""

from __future__ import annotations

import sys

from sales_db import error_exit, get_connection, print_json  # pyright: ignore[reportMissingModuleSource]


def main() -> None:
    if len(sys.argv) < 3:
        error_exit("Usage: delete_project.py <db_path> <project_id>")

    db_path = sys.argv[1]
    project_id = sys.argv[2]

    conn = get_connection(db_path)
    try:
        # プロジェクトの存在確認
        row = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if row is None:
            error_exit(f"プロジェクト '{project_id}' が見つかりません")

        # 外部キー制約の依存順に削除
        r1 = conn.execute(
            "DELETE FROM responses WHERE outreach_log_id IN "
            "(SELECT id FROM outreach_logs WHERE project_id = ?)",
            (project_id,),
        )
        r2 = conn.execute(
            "DELETE FROM outreach_logs WHERE project_id = ?",
            (project_id,),
        )
        r3 = conn.execute(
            "DELETE FROM evaluations WHERE project_id = ?",
            (project_id,),
        )
        r4 = conn.execute(
            "DELETE FROM project_prospects WHERE project_id = ?",
            (project_id,),
        )
        r5 = conn.execute(
            "DELETE FROM projects WHERE id = ?",
            (project_id,),
        )

        conn.commit()

        print_json({
            "deleted": {
                "responses": r1.rowcount,
                "outreach_logs": r2.rowcount,
                "evaluations": r3.rowcount,
                "project_prospects": r4.rowcount,
                "projects": r5.rowcount,
            }
        })
    except Exception as e:
        conn.rollback()
        error_exit(f"削除中にエラーが発生しました: {e}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
