#!/usr/bin/env python3
"""送信ログ記録のアトミック実行スクリプト

Usage (メール送信モード):
  python3 send_and_log.py <db_path> --project <id> --prospect-id <id> \
    --account <email> --to <email> --subject <subject> \
    [--body <text> | --body-file <path>] [--from <alias>] [--cc <emails>]

Usage (ログ記録のみモード - フォーム/SNS用):
  python3 send_and_log.py <db_path> --project <id> --prospect-id <id> \
    --log-only --channel <form|sns_twitter|sns_linkedin> \
    --subject <subject> [--body <text> | --body-file <path>] \
    [--status <sent|failed>] [--error-message <msg>]

メール送信モード: gog send でメール送信し、結果をDBに記録する。
ログ記録モード: 送信処理は行わず、ログ記録+ステータス更新のみを1トランザクションで実行する。

Output: JSON
  {"status": "sent"|"failed"|"skipped", "outreach_log_id": N, "error_message": null|"..."}
  skipped: 同一営業先に既に送信成功済みのため送信をスキップした場合

Exit code: 0 = 成功, 1 = 失敗（ログは記録済み）, 2 = スクリプトエラー
"""

from __future__ import annotations

import argparse
import sqlite3
import subprocess
import sys
from typing import Literal, TypedDict

from sales_db import error_exit, get_connection, print_json  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# 型定義
# ---------------------------------------------------------------------------

# スクリプト出力用ステータス（DB値 + skipped）
SendStatus = Literal["sent", "failed", "skipped"]


class SendResult(TypedDict):
    status: SendStatus
    outreach_log_id: int
    error_message: str | None


# ---------------------------------------------------------------------------
# 処理関数
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="送信ログ記録のアトミック実行。メール送信 or ログ記録のみ。",
    )
    _ = parser.add_argument("db_path", help="SQLite データベースのパス")
    _ = parser.add_argument("--project", required=True, help="プロジェクトID")
    _ = parser.add_argument("--prospect-id", type=int, required=True, help="営業先ID")
    _ = parser.add_argument("--subject", required=True, help="件名")
    body_group = parser.add_mutually_exclusive_group()
    _ = body_group.add_argument("--body", help="本文（短い場合）")
    _ = body_group.add_argument("--body-file", help="本文ファイルパス（長い場合）")
    # メール送信モード用
    _ = parser.add_argument("--account", help="送信元メールアドレス（gog --account）")
    _ = parser.add_argument("--to", dest="to_addr", help="宛先メールアドレス")
    _ = parser.add_argument("--from", dest="from_addr", help="送信元エイリアス（gog --from）")
    _ = parser.add_argument("--cc", help="CCアドレス（カンマ区切り）")
    # ログ記録のみモード用
    _ = parser.add_argument("--log-only", action="store_true", help="送信せずログ記録+ステータス更新のみ")
    _ = parser.add_argument("--channel", help="チャネル名（log-only時必須。form/sns_twitter/sns_linkedin）")
    _ = parser.add_argument("--status", default="sent", choices=["sent", "failed"], help="記録するステータス（log-only時、デフォルト: sent）")
    _ = parser.add_argument("--error-message", help="エラーメッセージ（log-only + status=failed 時）")
    return parser


def read_body(body: str | None, body_file: str | None) -> str:
    """送信本文を取得する。"""
    if body is not None:
        return body
    if body_file is not None:
        with open(body_file, encoding="utf-8") as f:
            return f.read()
    return ""


def send_email(
    account: str,
    to_addr: str,
    subject: str,
    body: str | None,
    body_file: str | None,
    from_addr: str | None,
    cc: str | None,
) -> tuple[bool, str | None]:
    """gog send を実行し、(成功フラグ, エラーメッセージ) を返す。"""
    cmd = [
        "gog", "send", "--json", "--no-input",
        "--account", account,
        "--to", to_addr,
        "--subject", subject,
    ]

    if body is not None:
        cmd.extend(["--body", body])
    elif body_file is not None:
        cmd.extend(["--body-file", body_file])

    if from_addr is not None:
        cmd.extend(["--from", from_addr])

    if cc is not None:
        cmd.extend(["--cc", cc])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return False, "gog send がタイムアウトしました（60秒）"
    except FileNotFoundError:
        return False, "gog コマンドが見つかりません"

    if result.returncode == 0:
        return True, None

    error = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
    return False, error


def check_already_attempted(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
) -> tuple[int | None, str]:
    """同一 project + prospect で送信済み or 同日失敗済みの outreach_log ID と理由を返す。

    Returns:
        (outreach_log_id, reason) — スキップすべき場合は ID と理由、そうでなければ (None, "")
    """
    # sent 済みチェック（日付問わず）
    row = conn.execute(
        "SELECT id FROM outreach_logs"
        " WHERE project_id = ? AND prospect_id = ? AND status = 'sent'"
        " LIMIT 1",
        (project_id, prospect_id),
    ).fetchone()
    if row is not None:
        return int(row[0]), "already_sent"

    # 同日 failed チェック（同日中の再試行を防止）
    row = conn.execute(
        "SELECT id FROM outreach_logs"
        " WHERE project_id = ? AND prospect_id = ? AND status = 'failed'"
        " AND DATE(sent_at) = DATE('now')"
        " LIMIT 1",
        (project_id, prospect_id),
    ).fetchone()
    if row is not None:
        return int(row[0]), "failed_today"

    return None, ""


def record_result(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    channel: str,
    subject: str,
    body_text: str,
    success: bool,
    error_message: str | None,
) -> int:
    """送信結果をDBに記録する。1トランザクションで実行。"""
    status = "sent" if success else "failed"

    insert_sql = (
        "INSERT INTO outreach_logs"
        + " (project_id, prospect_id, channel, subject, body, status, error_message)"
        + " VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    cursor = conn.execute(
        insert_sql,
        (project_id, prospect_id, channel, subject, body_text, status, error_message),
    )
    log_id = cursor.lastrowid
    if log_id is None:
        raise RuntimeError("INSERT後にlastrowidが取得できませんでした")

    # 送信成功時のみ project_prospects のステータスを更新
    if success:
        update_sql = (
            "UPDATE project_prospects SET status = 'contacted', updated_at = datetime('now', 'localtime')"
            + " WHERE project_id = ? AND prospect_id = ?"
        )
        cursor_upd = conn.execute(update_sql, (project_id, prospect_id))
        if cursor_upd.rowcount == 0:
            print(
                f"WARNING: project_prospects に該当行なし (project_id={project_id}, prospect_id={prospect_id})",
                file=sys.stderr,
            )

    conn.commit()
    return log_id


def main() -> None:
    args = build_parser().parse_args()

    db_path: str = args.db_path
    project_id: str = args.project
    prospect_id: int = args.prospect_id
    subject: str = args.subject
    body: str | None = args.body
    body_file: str | None = args.body_file
    log_only: bool = args.log_only

    # 本文取得（DB記録用）
    body_text = read_body(body, body_file)

    # 重複チェック: 送信成功済み or 同日失敗済みの営業先にはアプローチしない
    conn = get_connection(db_path)
    existing_log_id, skip_reason = check_already_attempted(conn, project_id, prospect_id)
    if existing_log_id is not None:
        conn.close()
        skipped: SendResult = {
            "status": "skipped",
            "outreach_log_id": existing_log_id,
            "error_message": skip_reason,
        }
        print_json(skipped)
        return

    if log_only:
        # ログ記録のみモード（フォーム/SNS用）
        channel: str = args.channel
        if not channel:
            error_exit("--log-only 時は --channel が必須です")
        success = args.status == "sent"
        error_message: str | None = args.error_message
    else:
        # メール送信モード
        channel = "email"
        account: str | None = args.account
        to_addr: str | None = args.to_addr
        if not account or not to_addr:
            error_exit("メール送信モードでは --account と --to が必須です")
        if not body and not body_file:
            error_exit("--body または --body-file が必須です")
        success, error_message = send_email(
            account=account,
            to_addr=to_addr,
            subject=subject,
            body=body,
            body_file=body_file,
            from_addr=args.from_addr,
            cc=args.cc,
        )

    # DB記録（conn は重複チェック時に取得済み）
    try:
        log_id = record_result(
            conn, project_id, prospect_id, channel, subject, body_text, success, error_message,
        )
    except Exception as e:
        conn.rollback()
        error_exit(f"DB記録失敗: {e}")
    finally:
        conn.close()

    result: SendResult = {
        "status": "sent" if success else "failed",
        "outreach_log_id": log_id,
        "error_message": error_message,
    }
    print_json(result)

    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
