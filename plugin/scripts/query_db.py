#!/usr/bin/env python3
"""SQL クエリ実行スクリプト（パラメータバインディング対応）

**このスクリプトは /docker スキル専用。通常のスキルからは使用禁止。**

通常の DB 操作には以下の専用スクリプトを使用すること:
- READ クエリ: sales_queries.py
- メール送信+ログ: send_and_log.py
- 返信記録: record_response.py
- ステータス更新: update_status.py
- 評価記録: record_evaluation.py
- 営業先登録: add_prospects.py
- DB初期化: init_db.py

Usage:
  query_db.py <db_path> <sql> [param1] [param2] ...

SELECT の場合は結果を JSON 配列で stdout に出力する。
INSERT の場合は {"last_id": <rowid>} を出力する。
UPDATE/DELETE の場合は {"rows_affected": <count>} を出力する。

パラメータは SQL 内の ? プレースホルダに順番に対応する。
"""

from __future__ import annotations

import re
import sys

from sales_db import error_exit, get_connection, print_json, rows_to_dicts


def detect_stmt_type(sql: str) -> str:
    """SQL文の種別を判定する。コメントや WITH 句を考慮する。"""
    # 行コメント (-- ...) を除去
    clean = re.sub(r"--[^\n]*", "", sql).strip().upper()
    if not clean:
        return "UNKNOWN"
    first = clean.split()[0]
    # WITH ... SELECT のケース
    if first == "WITH":
        if "SELECT" in clean:
            return "SELECT"
        return "UNKNOWN"
    return first


def main() -> None:
    if len(sys.argv) < 3:
        error_exit("Usage: query_db.py <db_path> <sql> [param1] [param2] ...")

    db_path = sys.argv[1]
    sql = sys.argv[2]
    params = sys.argv[3:]

    conn = get_connection(db_path)
    try:
        cursor = conn.execute(sql, params)

        stmt_type = detect_stmt_type(sql)
        if stmt_type == "SELECT":
            rows = cursor.fetchall()
            print_json(rows_to_dicts(rows))
        elif stmt_type == "INSERT":
            conn.commit()
            print_json({"last_id": cursor.lastrowid})
        else:
            conn.commit()
            print_json({"rows_affected": cursor.rowcount})
    except Exception as e:
        error_exit(str(e))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
