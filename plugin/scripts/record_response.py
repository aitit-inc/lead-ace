#!/usr/bin/env python3
"""返信記録のアトミック実行スクリプト

Usage:
  python3 record_response.py <db_path> --project <id> --prospect-id <id> \
    --outreach-log-id <id> --channel <channel> --content <text> \
    --sentiment <positive|neutral|negative> \
    --response-type <reply|auto_reply|bounce|meeting_request|scheduling_confirmation|rejection> \
    [--new-status <responded|rejected|inactive>] \
    [--do-not-contact --dnc-reason <reason>]

1トランザクションで以下を実行:
1. responses テーブルに返信を記録
2. (指定時) project_prospects のステータスを更新
3. (指定時) prospects の do_not_contact フラグと notes を更新

Output: JSON
  {"status": "recorded"|"skipped", "response_id": N,
   "status_updated": true|false, "do_not_contact_set": true|false}

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

RecordStatus = Literal["recorded", "skipped"]

ALLOWED_NEW_STATUSES = ("responded", "rejected", "inactive")


class RecordResult(TypedDict):
    status: RecordStatus
    response_id: int
    status_updated: bool
    do_not_contact_set: bool


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="返信記録のアトミック実行。responses INSERT + ステータス更新 + do_not_contact 設定。",
    )
    _ = parser.add_argument("db_path", help="SQLite データベースのパス")
    _ = parser.add_argument("--project", required=True, help="プロジェクトID")
    _ = parser.add_argument("--prospect-id", type=int, required=True, help="営業先ID")
    _ = parser.add_argument("--outreach-log-id", type=int, required=True, help="紐付ける outreach_logs.id")
    _ = parser.add_argument("--channel", required=True, help="返信チャネル (email/form/sns_twitter/sns_linkedin)")
    _ = parser.add_argument("--content", required=True, help="返信内容")
    _ = parser.add_argument(
        "--sentiment", required=True,
        choices=["positive", "neutral", "negative"],
        help="感情分析結果",
    )
    _ = parser.add_argument("--response-type", required=True, help="返信タイプ (reply/auto_reply/bounce/meeting_request/scheduling_confirmation/rejection)")
    _ = parser.add_argument(
        "--new-status",
        choices=list(ALLOWED_NEW_STATUSES),
        help="project_prospects の新ステータス (responded/rejected/inactive)",
    )
    _ = parser.add_argument("--do-not-contact", action="store_true", help="do_not_contact フラグを設定")
    _ = parser.add_argument("--dnc-reason", help="do_not_contact の理由（--do-not-contact 時必須）")
    return parser


# ---------------------------------------------------------------------------
# バリデーション
# ---------------------------------------------------------------------------

def validate_outreach_log(
    conn: sqlite3.Connection,
    outreach_log_id: int,
    project_id: str,
    prospect_id: int,
) -> None:
    """outreach_log_id の存在と project/prospect の一致を検証する。"""
    row = conn.execute(
        "SELECT id FROM outreach_logs WHERE id = ? AND project_id = ? AND prospect_id = ?",
        (outreach_log_id, project_id, prospect_id),
    ).fetchone()
    if row is None:
        error_exit(
            f"outreach_log_id {outreach_log_id} が見つからないか、"
            f" project_id={project_id} / prospect_id={prospect_id} と一致しません"
        )


def check_duplicate_response(
    conn: sqlite3.Connection,
    outreach_log_id: int,
    response_type: str,
) -> int | None:
    """同一 outreach_log_id + response_type の既存レコードを返す。"""
    row = conn.execute(
        "SELECT id FROM responses WHERE outreach_log_id = ? AND response_type = ?",
        (outreach_log_id, response_type),
    ).fetchone()
    if row is not None:
        return int(row[0])
    return None


# ---------------------------------------------------------------------------
# DB操作
# ---------------------------------------------------------------------------

def record(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    outreach_log_id: int,
    channel: str,
    content: str,
    sentiment: str,
    response_type: str,
    new_status: str | None,
    do_not_contact: bool,
    dnc_reason: str | None,
) -> RecordResult:
    """返信を記録し、必要に応じてステータスと do_not_contact を更新する。"""

    # 1. INSERT responses
    cursor = conn.execute(
        "INSERT INTO responses (outreach_log_id, channel, content, sentiment, response_type)"
        " VALUES (?, ?, ?, ?, ?)",
        (outreach_log_id, channel, content, sentiment, response_type),
    )
    response_id = cursor.lastrowid
    if response_id is None:
        raise RuntimeError("INSERT後にlastrowidが取得できませんでした")

    # 2. UPDATE project_prospects.status（指定時のみ）
    status_updated = False
    if new_status is not None:
        cursor_upd = conn.execute(
            "UPDATE project_prospects SET status = ?, updated_at = datetime('now', 'localtime')"
            " WHERE project_id = ? AND prospect_id = ?",
            (new_status, project_id, prospect_id),
        )
        status_updated = cursor_upd.rowcount > 0

    # 3. UPDATE prospects.do_not_contact（指定時のみ）
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

    return RecordResult(
        status="recorded",
        response_id=response_id,
        status_updated=status_updated,
        do_not_contact_set=dnc_set,
    )


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main() -> None:
    args = build_parser().parse_args()

    project_id: str = args.project
    prospect_id: int = args.prospect_id
    outreach_log_id: int = args.outreach_log_id
    channel: str = args.channel
    content: str = args.content
    sentiment: str = args.sentiment
    response_type: str = args.response_type
    new_status: str | None = args.new_status
    do_not_contact: bool = args.do_not_contact
    dnc_reason: str | None = args.dnc_reason

    # バリデーション
    if do_not_contact and not dnc_reason:
        error_exit("--do-not-contact には --dnc-reason が必須です")

    conn = get_connection(args.db_path)

    try:
        # outreach_log_id の存在確認
        validate_outreach_log(conn, outreach_log_id, project_id, prospect_id)

        # 重複チェック
        existing_id = check_duplicate_response(conn, outreach_log_id, response_type)
        if existing_id is not None:
            skipped: RecordResult = {
                "status": "skipped",
                "response_id": existing_id,
                "status_updated": False,
                "do_not_contact_set": False,
            }
            print_json(skipped)
            return

        # 記録実行
        result = record(
            conn, project_id, prospect_id, outreach_log_id,
            channel, content, sentiment, response_type,
            new_status, do_not_contact, dnc_reason,
        )
        print_json(result)

    except Exception as e:
        conn.rollback()
        error_exit(f"記録中にエラーが発生: {e}", code=2)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
