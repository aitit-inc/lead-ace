#!/usr/bin/env python3
"""営業DBの定型クエリ実行スクリプト（READ専用）

Usage:
  sales_queries.py <db_path> <command> [args...]

シェルのエスケープ問題を回避するため、シングルクォートを含む複雑なSQLを
名前付きサブコマンドとして実行する。全コマンドは SELECT のみ（書き込みなし）。

Commands:
  list-projects                        全プロジェクト一覧
  project-exists <project_id>          プロジェクトの存在確認
  count-reachable <project_id>         アプローチ可能な未送信営業先数（email/form/SNSいずれかあり）
  count-reachable-by-channel <project_id>  チャネル別の未送信営業先数
  list-reachable <project_id> <limit>  アプローチ可能な未送信営業先リスト（email→form→SNSの優先順）
  recent-outreach <project_id>         直近4営業日以内のアプローチ済み営業先
  data-sufficiency <project_id>        evaluate用のデータ充足度チェック
  last-evaluation <project_id>         最新のevaluation日時
  evaluation-history <project_id>      evaluate による改善履歴（直近10件）
  existing-list <project_id>           登録済み営業先の直近50件
  all-prospect-identifiers <project_id>  全登録済み営業先の名前・URL一覧（重複回避用）
  eval-total-outreach <project_id>     アプローチ総数
  eval-channel-counts <project_id>     チャネル別アプローチ数
  eval-response-counts <project_id>    反応数・ユニーク回答者数
  eval-sentiment-breakdown <project_id> センチメント別・反応種別の内訳
  eval-priority-response-rate <project_id> 優先度別反応率
  eval-status-counts <project_id>      ステータス別営業先数
  eval-channel-response-rate <project_id> チャネル別反応率
  eval-responded-messages <project_id> 反応ありメッセージ全文
  eval-no-response-sample <project_id> 反応なしメッセージサンプル
"""

from __future__ import annotations

import sqlite3
import sys
from collections.abc import Callable

from sales_db import error_exit, get_connection, print_json, rows_to_dicts  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# クエリ定義
# ---------------------------------------------------------------------------

def cmd_list_projects(conn: sqlite3.Connection, args: list[str]) -> None:
    """全プロジェクト一覧"""
    cursor = conn.execute(
        "SELECT id, created_at FROM projects ORDER BY created_at ASC",
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_project_exists(conn: sqlite3.Connection, args: list[str]) -> None:
    """プロジェクトの存在確認"""
    if len(args) < 1:
        error_exit("Usage: project-exists <project_id>")
    cursor = conn.execute("SELECT id FROM projects WHERE id = ?", (args[0],))
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_count_reachable(conn: sqlite3.Connection, args: list[str]) -> None:
    """アプローチ可能な未送信営業先数（email/form/SNSいずれかあり）"""
    if len(args) < 1:
        error_exit("Usage: count-reachable <project_id>")
    cursor = conn.execute(
        "SELECT COUNT(*) as count"
        " FROM project_prospects pp"
        " JOIN prospects p ON pp.prospect_id = p.id"
        " WHERE pp.project_id = ? AND pp.status = 'new'"
        " AND p.do_not_contact = 0"
        " AND ("
        "   (p.email IS NOT NULL AND p.email != '')"
        "   OR (p.contact_form_url IS NOT NULL AND p.contact_form_url != ''"
        "       AND (p.form_type IS NULL OR p.form_type NOT IN ('iframe_embed', 'with_captcha')))"
        "   OR (p.sns_accounts IS NOT NULL AND p.sns_accounts != '{}')"
        " )",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_count_reachable_by_channel(conn: sqlite3.Connection, args: list[str]) -> None:
    """チャネル別の未送信営業先数"""
    if len(args) < 1:
        error_exit("Usage: count-reachable-by-channel <project_id>")
    cursor = conn.execute(
        "SELECT"
        "   SUM(CASE WHEN p.email IS NOT NULL AND p.email != '' THEN 1 ELSE 0 END) as email,"
        "   SUM(CASE WHEN (p.email IS NULL OR p.email = '')"
        "     AND p.contact_form_url IS NOT NULL AND p.contact_form_url != ''"
        "     AND (p.form_type IS NULL OR p.form_type NOT IN ('iframe_embed', 'with_captcha'))"
        "     THEN 1 ELSE 0 END) as form_only,"
        "   SUM(CASE WHEN (p.email IS NULL OR p.email = '')"
        "     AND (p.contact_form_url IS NULL OR p.contact_form_url = '')"
        "     AND p.sns_accounts IS NOT NULL AND p.sns_accounts != '{}' THEN 1 ELSE 0 END) as sns_only"
        " FROM project_prospects pp"
        " JOIN prospects p ON pp.prospect_id = p.id"
        " WHERE pp.project_id = ? AND pp.status = 'new'"
        " AND p.do_not_contact = 0"
        " AND ("
        "   (p.email IS NOT NULL AND p.email != '')"
        "   OR (p.contact_form_url IS NOT NULL AND p.contact_form_url != ''"
        "       AND (p.form_type IS NULL OR p.form_type NOT IN ('iframe_embed', 'with_captcha')))"
        "   OR (p.sns_accounts IS NOT NULL AND p.sns_accounts != '{}')"
        " )",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_list_reachable(conn: sqlite3.Connection, args: list[str]) -> None:
    """アプローチ可能な未送信営業先リスト（email→form→SNSの優先順）"""
    if len(args) < 1:
        error_exit("Usage: list-reachable <project_id> [limit]")
    if len(args) < 2:
        args.append("30")
    cursor = conn.execute(
        "SELECT p.id, p.name, p.contact_name, p.department, p.overview, p.email,"
        " p.contact_form_url, p.form_type, p.sns_accounts,"
        " p.organization_id, pp.match_reason, pp.priority"
        " FROM prospects p"
        " JOIN project_prospects pp ON p.id = pp.prospect_id"
        " LEFT JOIN organizations o ON p.organization_id = o.corporate_number"
        " WHERE pp.project_id = ? AND pp.status = 'new'"
        " AND p.do_not_contact = 0"
        " AND ("
        "   (p.email IS NOT NULL AND p.email != '')"
        "   OR (p.contact_form_url IS NOT NULL AND p.contact_form_url != ''"
        "       AND (p.form_type IS NULL OR p.form_type NOT IN ('iframe_embed', 'with_captcha')))"
        "   OR (p.sns_accounts IS NOT NULL AND p.sns_accounts != '{}')"
        " )"
        " ORDER BY"
        "   CASE WHEN p.email IS NOT NULL AND p.email != '' THEN 0 ELSE 1 END,"
        "   CASE WHEN p.contact_form_url IS NOT NULL AND p.contact_form_url != ''"
        "     THEN 0 ELSE 1 END,"
        "   CASE WHEN p.sns_accounts IS NOT NULL AND p.sns_accounts != '{}'"
        "     THEN 0 ELSE 1 END,"
        "   pp.priority ASC, p.id ASC"
        " LIMIT ?",
        (args[0], args[1]),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_recent_outreach(conn: sqlite3.Connection, args: list[str]) -> None:
    """直近4営業日以内のアプローチ済み営業先"""
    if len(args) < 1:
        error_exit("Usage: recent-outreach <project_id>")
    cursor = conn.execute(
        "SELECT p.id, p.name, p.email, p.website_url, p.sns_accounts,"
        " o.id as outreach_id, o.channel, o.subject, o.sent_at"
        " FROM prospects p"
        " JOIN project_prospects pp ON p.id = pp.prospect_id"
        " JOIN outreach_logs o ON p.id = o.prospect_id AND o.project_id = pp.project_id"
        " WHERE pp.project_id = ? AND pp.status = 'contacted'"
        " AND o.sent_at >= datetime('now', 'localtime', '-6 days')"
        " ORDER BY o.sent_at ASC",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_data_sufficiency(conn: sqlite3.Connection, args: list[str]) -> None:
    """evaluate用のデータ充足度チェック"""
    if len(args) < 1:
        error_exit("Usage: data-sufficiency <project_id>")
    cursor = conn.execute(
        "SELECT COUNT(*) as total_sent, MAX(sent_at) as last_sent"
        " FROM outreach_logs"
        " WHERE project_id = ? AND status = 'sent'",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_last_evaluation(conn: sqlite3.Connection, args: list[str]) -> None:
    """最新のevaluation日時"""
    if len(args) < 1:
        error_exit("Usage: last-evaluation <project_id>")
    cursor = conn.execute(
        "SELECT evaluation_date"
        " FROM evaluations"
        " WHERE project_id = ?"
        " ORDER BY evaluation_date DESC LIMIT 1",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_evaluation_history(conn: sqlite3.Connection, args: list[str]) -> None:
    """evaluate による改善履歴（直近10件）"""
    if len(args) < 1:
        error_exit("Usage: evaluation-history <project_id>")
    cursor = conn.execute(
        "SELECT evaluation_date, improvements, findings"
        " FROM evaluations"
        " WHERE project_id = ?"
        " ORDER BY evaluation_date DESC LIMIT 10",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_existing_list(conn: sqlite3.Connection, args: list[str]) -> None:
    """登録済み営業先の直近50件"""
    if len(args) < 1:
        error_exit("Usage: existing-list <project_id>")
    cursor = conn.execute(
        "SELECT p.name, p.department, p.organization_id, p.industry, p.website_url"
        " FROM prospects p"
        " JOIN project_prospects pp ON p.id = pp.prospect_id"
        " WHERE pp.project_id = ?"
        " ORDER BY p.id DESC LIMIT 50",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_all_prospect_identifiers(conn: sqlite3.Connection, args: list[str]) -> None:
    """全登録済み営業先の名前・URL・法人番号一覧（重複回避用）"""
    if len(args) < 1:
        error_exit("Usage: all-prospect-identifiers <project_id>")
    cursor = conn.execute(
        "SELECT p.name, p.organization_id, p.website_url"
        " FROM prospects p"
        " JOIN project_prospects pp ON p.id = pp.prospect_id"
        " WHERE pp.project_id = ?",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


# ---------------------------------------------------------------------------
# 評価用クエリ（evaluate スキル用）
# ---------------------------------------------------------------------------

def cmd_eval_total_outreach(conn: sqlite3.Connection, args: list[str]) -> None:
    """アプローチ総数"""
    if len(args) < 1:
        error_exit("Usage: eval-total-outreach <project_id>")
    cursor = conn.execute(
        "SELECT COUNT(*) as total_outreach FROM outreach_logs WHERE project_id = ?",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_channel_counts(conn: sqlite3.Connection, args: list[str]) -> None:
    """チャネル別アプローチ数"""
    if len(args) < 1:
        error_exit("Usage: eval-channel-counts <project_id>")
    cursor = conn.execute(
        "SELECT channel, COUNT(*) as count"
        " FROM outreach_logs"
        " WHERE project_id = ?"
        " GROUP BY channel",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_response_counts(conn: sqlite3.Connection, args: list[str]) -> None:
    """反応数・ユニーク回答者数"""
    if len(args) < 1:
        error_exit("Usage: eval-response-counts <project_id>")
    cursor = conn.execute(
        "SELECT"
        "   COUNT(*) as total_responses,"
        "   COUNT(DISTINCT o.prospect_id) as unique_responders"
        " FROM responses r"
        " JOIN outreach_logs o ON r.outreach_log_id = o.id"
        " WHERE o.project_id = ?",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_sentiment_breakdown(conn: sqlite3.Connection, args: list[str]) -> None:
    """センチメント別・反応種別の内訳"""
    if len(args) < 1:
        error_exit("Usage: eval-sentiment-breakdown <project_id>")
    cursor = conn.execute(
        "SELECT sentiment, response_type, COUNT(*) as count"
        " FROM responses r"
        " JOIN outreach_logs o ON r.outreach_log_id = o.id"
        " WHERE o.project_id = ?"
        " GROUP BY sentiment, response_type",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_priority_response_rate(conn: sqlite3.Connection, args: list[str]) -> None:
    """優先度別の反応率"""
    if len(args) < 1:
        error_exit("Usage: eval-priority-response-rate <project_id>")
    cursor = conn.execute(
        "SELECT"
        "   pp.priority,"
        "   COUNT(DISTINCT CASE WHEN o.id IS NOT NULL THEN pp.prospect_id END) as contacted,"
        "   COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN pp.prospect_id END) as responded"
        " FROM project_prospects pp"
        " LEFT JOIN outreach_logs o ON pp.prospect_id = o.prospect_id AND o.project_id = pp.project_id"
        " LEFT JOIN responses r ON o.id = r.outreach_log_id"
        " WHERE pp.project_id = ?"
        " GROUP BY pp.priority",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_status_counts(conn: sqlite3.Connection, args: list[str]) -> None:
    """ステータス別営業先数"""
    if len(args) < 1:
        error_exit("Usage: eval-status-counts <project_id>")
    cursor = conn.execute(
        "SELECT status, COUNT(*) as count"
        " FROM project_prospects"
        " WHERE project_id = ?"
        " GROUP BY status",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_channel_response_rate(conn: sqlite3.Connection, args: list[str]) -> None:
    """チャネル別反応率"""
    if len(args) < 1:
        error_exit("Usage: eval-channel-response-rate <project_id>")
    cursor = conn.execute(
        "SELECT"
        "   o.channel,"
        "   COUNT(DISTINCT o.prospect_id) as contacted,"
        "   COUNT(DISTINCT r.outreach_log_id) as responded,"
        "   ROUND(CAST(COUNT(DISTINCT r.outreach_log_id) AS FLOAT)"
        "     / NULLIF(COUNT(DISTINCT o.id), 0) * 100, 1) as response_rate_pct"
        " FROM outreach_logs o"
        " LEFT JOIN responses r ON o.id = r.outreach_log_id"
        " WHERE o.project_id = ?"
        " GROUP BY o.channel",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_responded_messages(conn: sqlite3.Connection, args: list[str]) -> None:
    """反応があったメールの本文（全件）"""
    if len(args) < 1:
        error_exit("Usage: eval-responded-messages <project_id>")
    cursor = conn.execute(
        "SELECT o.id, o.channel, o.subject, o.body, r.sentiment, r.response_type"
        " FROM outreach_logs o"
        " JOIN responses r ON o.id = r.outreach_log_id"
        " WHERE o.project_id = ?"
        " ORDER BY r.received_at DESC",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


def cmd_eval_no_response_sample(conn: sqlite3.Connection, args: list[str]) -> None:
    """反応がなかったメールの本文（サンプル10件）"""
    if len(args) < 1:
        error_exit("Usage: eval-no-response-sample <project_id>")
    cursor = conn.execute(
        "SELECT o.id, o.channel, o.subject, o.body"
        " FROM outreach_logs o"
        " LEFT JOIN responses r ON o.id = r.outreach_log_id"
        " WHERE o.project_id = ? AND r.id IS NULL"
        " ORDER BY o.sent_at DESC"
        " LIMIT 10",
        (args[0],),
    )
    print_json(rows_to_dicts(cursor.fetchall()))


# ---------------------------------------------------------------------------
# コマンドディスパッチ
# ---------------------------------------------------------------------------

COMMANDS: dict[str, tuple[str, Callable[[sqlite3.Connection, list[str]], None]]] = {
    "list-projects": ("全プロジェクト一覧", cmd_list_projects),
    "project-exists": ("プロジェクトの存在確認", cmd_project_exists),
    "count-reachable": ("アプローチ可能な未送信営業先数（email/form/SNSいずれかあり）", cmd_count_reachable),
    "count-reachable-by-channel": ("チャネル別の未送信営業先数", cmd_count_reachable_by_channel),
    "list-reachable": ("未送信営業先リスト（email→form→SNS優先順）", cmd_list_reachable),
    "recent-outreach": ("直近アプローチ済み営業先", cmd_recent_outreach),
    "data-sufficiency": ("evaluate用データ充足度", cmd_data_sufficiency),
    "last-evaluation": ("最新evaluation日時", cmd_last_evaluation),
    "evaluation-history": ("evaluate改善履歴（直近10件）", cmd_evaluation_history),
    "existing-list": ("登録済み営業先の直近50件", cmd_existing_list),
    "all-prospect-identifiers": ("全登録済み営業先の名前・URL一覧", cmd_all_prospect_identifiers),
    # 評価用クエリ
    "eval-total-outreach": ("アプローチ総数", cmd_eval_total_outreach),
    "eval-channel-counts": ("チャネル別アプローチ数", cmd_eval_channel_counts),
    "eval-response-counts": ("反応数・ユニーク回答者数", cmd_eval_response_counts),
    "eval-sentiment-breakdown": ("センチメント別・反応種別の内訳", cmd_eval_sentiment_breakdown),
    "eval-priority-response-rate": ("優先度別反応率", cmd_eval_priority_response_rate),
    "eval-status-counts": ("ステータス別営業先数", cmd_eval_status_counts),
    "eval-channel-response-rate": ("チャネル別反応率", cmd_eval_channel_response_rate),
    "eval-responded-messages": ("反応ありメッセージ全文", cmd_eval_responded_messages),
    "eval-no-response-sample": ("反応なしメッセージサンプル", cmd_eval_no_response_sample),
}


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: sales_queries.py <db_path> <command> [args...]", file=sys.stderr)
        print("\nCommands:", file=sys.stderr)
        for name, (desc, _) in COMMANDS.items():
            print(f"  {name:20s} {desc}", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    command = sys.argv[2]
    args = sys.argv[3:]

    if command not in COMMANDS:
        error_exit(f"Unknown command: {command}. Use -h for help.")

    _, handler = COMMANDS[command]
    conn = get_connection(db_path)
    try:
        handler(conn, args)
    except Exception as e:
        error_exit(str(e))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
