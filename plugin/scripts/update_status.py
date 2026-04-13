#!/usr/bin/env python3
"""営業先ステータス更新スクリプト（unreachable / inactive 専用）

Usage:
  python3 update_status.py <db_path> --project <id> --prospect-id <id> \
    --status <unreachable|inactive> \
    [--do-not-contact --dnc-reason <reason>]

contacted への更新は send_and_log.py、responded/rejected への更新は
record_response.py を使用すること。このスクリプトは unreachable/inactive のみ対応。

Output: JSON
  {"status": "updated"|"skipped", "previous_status": "...",
   "new_status": "...", "do_not_contact_set": true|false}

Exit code: 0 = 成功, 1 = バリデーションエラー, 2 = スクリプトエラー
"""

from __future__ import annotations

import argparse
import sqlite3
from typing import Literal, TypedDict

from sales_db import error_exit, get_connection, print_json


# ---------------------------------------------------------------------------
# 型定義
# ---------------------------------------------------------------------------

ResultStatus = Literal["updated", "skipped"]

ALLOWED_STATUSES = ("unreachable", "inactive")


class UpdateResult(TypedDict):
    status: ResultStatus
    previous_status: str
    new_status: str
    do_not_contact_set: bool


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="営業先ステータスを unreachable / inactive に更新する。"
        " contacted は send_and_log.py、responded/rejected は record_response.py を使用。",
    )
    _ = parser.add_argument("db_path", help="SQLite データベースのパス")
    _ = parser.add_argument("--project", required=True, help="プロジェクトID")
    _ = parser.add_argument("--prospect-id", type=int, required=True, help="営業先ID")
    _ = parser.add_argument(
        "--status", required=True,
        choices=list(ALLOWED_STATUSES),
        help="更新先ステータス (unreachable/inactive のみ)",
    )
    _ = parser.add_argument("--do-not-contact", action="store_true", help="do_not_contact フラグを設定")
    _ = parser.add_argument("--dnc-reason", help="do_not_contact の理由（--do-not-contact 時必須）")
    return parser


# ---------------------------------------------------------------------------
# DB操作
# ---------------------------------------------------------------------------

def update(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    new_status: str,
    do_not_contact: bool,
    dnc_reason: str | None,
) -> UpdateResult:
    """ステータスを更新し、必要に応じて do_not_contact を設定する。"""

    # 現在のステータスを取得
    row = conn.execute(
        "SELECT status FROM project_prospects WHERE project_id = ? AND prospect_id = ?",
        (project_id, prospect_id),
    ).fetchone()
    if row is None:
        error_exit(
            f"project_prospects に該当行なし (project_id={project_id}, prospect_id={prospect_id})"
        )
    previous_status: str = row[0]

    # 冪等チェック: 既に同じステータスならスキップ
    if previous_status == new_status:
        return UpdateResult(
            status="skipped",
            previous_status=previous_status,
            new_status=new_status,
            do_not_contact_set=False,
        )

    # 1. UPDATE project_prospects.status
    conn.execute(
        "UPDATE project_prospects SET status = ?, updated_at = datetime('now', 'localtime')"
        " WHERE project_id = ? AND prospect_id = ?",
        (new_status, project_id, prospect_id),
    )

    # 2. UPDATE prospects.do_not_contact（指定時のみ）
    dnc_set = False
    if do_not_contact and dnc_reason is not None:
        conn.execute(
            "UPDATE prospects SET do_not_contact = 1,"
            " notes = CASE WHEN notes IS NOT NULL AND notes != ''"
            " THEN notes || CHAR(10) || ? ELSE ? END,"
            " updated_at = datetime('now', 'localtime')"
            " WHERE id = ?",
            (dnc_reason, dnc_reason, prospect_id),
        )
        dnc_set = True

    conn.commit()

    return UpdateResult(
        status="updated",
        previous_status=previous_status,
        new_status=new_status,
        do_not_contact_set=dnc_set,
    )


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main() -> None:
    args = build_parser().parse_args()

    project_id: str = args.project
    prospect_id: int = args.prospect_id
    new_status: str = args.status
    do_not_contact: bool = args.do_not_contact
    dnc_reason: str | None = args.dnc_reason

    # バリデーション
    if do_not_contact and not dnc_reason:
        error_exit("--do-not-contact には --dnc-reason が必須です")

    conn = get_connection(args.db_path)

    try:
        result = update(conn, project_id, prospect_id, new_status, do_not_contact, dnc_reason)
        print_json(result)
    except SystemExit:
        raise
    except Exception as e:
        conn.rollback()
        error_exit(f"更新中にエラーが発生: {e}", code=2)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
