#!/usr/bin/env python3
"""営業先の一括登録スクリプト

Usage:
  echo '<json_array>' | add_prospects.py <db_path> <project_id>

stdin から営業先情報のJSON配列を受け取り、重複チェック→DB登録を一括で行う。
prospects（営業先マスタ）と project_prospects（プロジェクト紐付け）を
1トランザクションで登録する。

JSON配列の各オブジェクト:
  prospects用:
    name (必須), overview (必須), website_url (必須),
    contact_name, corporate_number, industry, email, contact_form_url, form_type, sns_accounts
  project_prospects用:
    match_reason (必須), priority (省略時: 3)
  特殊:
    existing_prospect_id: 既存prospect_idを指定（prospect新規登録をスキップし紐付けのみ行う）

Output: JSON
  {
    "added": N,
    "duplicates": N,
    "linked_existing": N,
    "errors": N,
    "details": [...]
  }
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from typing import TypedDict, cast

from check_duplicate import ALLOWED_SNS_KEYS  # pyright: ignore[reportMissingModuleSource]
from sales_db import DuplicateMatch, error_exit, get_connection, print_json, upsert_organization  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# 型定義
# ---------------------------------------------------------------------------

class ProspectEntry(TypedDict, total=False):
    """入力JSON配列の各エントリ"""
    # organizations 用
    organization_name: str  # 正式法人名（check_corporate_number.py で確認した名称）
    corporate_number: str
    # prospects 用
    name: str  # 営業先名（学校名・会社名等）
    contact_name: str
    department: str
    overview: str
    industry: str
    website_url: str
    email: str
    contact_form_url: str
    form_type: str
    sns_accounts: str | dict[str, str]
    do_not_contact: bool
    notes: str
    # project_prospects 用
    match_reason: str
    priority: int
    # 既存prospect紐付け用
    existing_prospect_id: int


class PossibleMatch(TypedDict):
    prospect_id: int
    reason: str


class EntryDetail(TypedDict, total=False):
    """各エントリの処理結果"""
    index: int
    name: str
    status: str  # "added" | "duplicate" | "linked_existing" | "error"
    prospect_id: int
    messages: list[str]
    match_detail: str
    project_linked: bool
    possible_matches: list[PossibleMatch]


class ResultSummary(TypedDict):
    """一括登録の結果サマリー"""
    added: int
    duplicates: int
    linked_existing: int
    errors: int
    details: list[EntryDetail]


# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------

PROSPECT_REQUIRED = ("name", "organization_name", "corporate_number", "overview", "website_url")
PROJECT_PROSPECT_REQUIRED = ("match_reason",)


# ---------------------------------------------------------------------------
# 処理関数
# ---------------------------------------------------------------------------

def validate_entry(entry: ProspectEntry, index: int) -> list[str]:
    """エントリのバリデーション。エラーメッセージのリストを返す。"""
    errors: list[str] = []
    # existing_prospect_id 指定時は prospect 側の必須チェックをスキップ
    if not entry.get("existing_prospect_id"):
        for field in PROSPECT_REQUIRED:
            if not entry.get(field):
                errors.append(f"[{index}] 必須フィールド '{field}' がありません")
    for field in PROJECT_PROSPECT_REQUIRED:
        if not entry.get(field):
            errors.append(f"[{index}] 必須フィールド '{field}' がありません")
    return errors


def find_duplicates(conn: sqlite3.Connection, entry: ProspectEntry) -> list[DuplicateMatch]:
    """エントリの重複チェック。法人番号で分岐し、同一法人内のみチェック。

    1. 法人番号で organizations を確認
       - 新規法人 → 重複なし（return []）
       - 既存法人 → 同一法人内の prospects で重複チェック
    2. 同一法人内の prospects に対して email / contact_form_url / SNS で重複判定
       - email / contact_form_url はグローバル UNIQUE 制約もあるため、INSERT 時にもDB側で保護される
    """
    corporate_number = entry.get("corporate_number")
    if not corporate_number:
        return []

    # 1. 法人番号で organizations を確認
    org = conn.execute(
        "SELECT corporate_number FROM organizations WHERE corporate_number = ?",
        (corporate_number,),
    ).fetchone()
    if org is None:
        return []  # 新規法人 → 重複なし

    # 2. 既存法人 → 同一法人内の prospects で重複チェック
    matches: list[DuplicateMatch] = []

    email = entry.get("email")
    if email:
        for row in conn.execute(
            "SELECT id, name FROM prospects WHERE organization_id = ? AND email = ?",
            (corporate_number, email),
        ):
            matches.append(DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=row["id"],
                name=row["name"],
                reason=f"同一法人内でemail一致: {email}",
            ))

    contact_form_url = entry.get("contact_form_url")
    if contact_form_url:
        for row in conn.execute(
            "SELECT id, name FROM prospects"
            " WHERE organization_id = ? AND contact_form_url = ?",
            (corporate_number, contact_form_url),
        ):
            matches.append(DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=row["id"],
                name=row["name"],
                reason=f"同一法人内でフォームURL一致: {contact_form_url}",
            ))

    sns_raw = entry.get("sns_accounts")
    if sns_raw is not None:
        sns: dict[str, str] = {}
        if isinstance(sns_raw, str):
            try:
                parsed: object = json.loads(sns_raw)
                if isinstance(parsed, dict):
                    sns = {str(k): str(v) for k, v in parsed.items()}
            except json.JSONDecodeError:
                pass
        else:
            sns = sns_raw
        for key, value in sns.items():
            if value and key in ALLOWED_SNS_KEYS:
                for row in conn.execute(
                    "SELECT id, name FROM prospects"
                    " WHERE organization_id = ?"
                    " AND sns_accounts IS NOT NULL"
                    f" AND json_extract(sns_accounts, '$.{key}') = ?",
                    (corporate_number, value),
                ):
                    matches.append(DuplicateMatch(
                        match_type="EXACT_MATCH",
                        prospect_id=row["id"],
                        name=row["name"],
                        reason=f"同一法人内でSNS一致: {key}={value}",
                    ))

    # 重複排除（同じ prospect_id が複数段階でヒットする場合）
    seen: set[int] = set()
    unique: list[DuplicateMatch] = []
    for m in matches:
        if m["prospect_id"] not in seen:
            seen.add(m["prospect_id"])
            unique.append(m)

    return unique


def insert_prospect(conn: sqlite3.Connection, entry: ProspectEntry) -> int:
    """prospects テーブルに1件挿入し、新しいIDを返す。

    corporate_number がある場合は organizations テーブルにも upsert する。
    """
    sns_val = entry.get("sns_accounts")
    sns_str: str | None = None
    if isinstance(sns_val, dict):
        sns_str = json.dumps(sns_val, ensure_ascii=False)
    elif isinstance(sns_val, str):
        sns_str = sns_val

    do_not_contact = 1 if entry.get("do_not_contact") else 0
    notes = entry.get("notes")

    # organizations に upsert（正式法人名で登録）
    corp_num = entry.get("corporate_number")
    org_name = entry.get("organization_name")
    prospect_name = entry.get("name")
    website_url = entry.get("website_url")
    if not corp_num or not org_name or not prospect_name or not website_url:
        raise ValueError(
            f"corporate_number, organization_name, name, website_url は必須です"
            f"（organization_name={org_name}, name={prospect_name}）"
        )
    upsert_organization(
        conn,
        corporate_number=corp_num,
        name=org_name,
        website_url=website_url,
        industry=entry.get("industry"),
        overview=entry.get("overview"),
    )

    sql = (
        "INSERT INTO prospects"
        " (name, contact_name, organization_id, department, overview, industry,"
        " website_url, email, contact_form_url, form_type, sns_accounts,"
        " do_not_contact, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    cursor = conn.execute(
        sql,
        (
            prospect_name,
            entry.get("contact_name"),
            corp_num,
            entry.get("department"),
            entry.get("overview"),
            entry.get("industry"),
            website_url,
            entry.get("email"),
            entry.get("contact_form_url"),
            entry.get("form_type"),
            sns_str,
            do_not_contact,
            notes,
        ),
    )
    row_id = cursor.lastrowid
    if row_id is None:
        raise RuntimeError("INSERT後にlastrowidが取得できませんでした")
    return row_id


def link_project_prospect(
    conn: sqlite3.Connection,
    project_id: str,
    prospect_id: int,
    entry: ProspectEntry,
) -> bool:
    """project_prospects に紐付けを登録。既存の場合はFalseを返す。"""
    sql = (
        "INSERT OR IGNORE INTO project_prospects"
        + " (project_id, prospect_id, match_reason, priority) VALUES (?, ?, ?, ?)"
    )
    cursor = conn.execute(
        sql,
        (project_id, prospect_id, entry.get("match_reason"), entry.get("priority", 3)),
    )
    return cursor.rowcount > 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "営業先の一括登録。stdin からJSON配列を読み取り、"
            + "重複チェック→prospects登録→project_prospects紐付けを一括で行う。"
        ),
    )
    _ = parser.add_argument("db_path", help="SQLite データベースのパス")
    _ = parser.add_argument("project_id", help="プロジェクトID")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    db_path: str = args.db_path
    project_id: str = args.project_id

    try:
        raw_data: object = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        error_exit(f"JSON parse error: {e}")

    if not isinstance(raw_data, list):
        error_exit("入力はJSON配列である必要があります")

    data = cast(list[ProspectEntry], raw_data)

    if not data:
        empty: ResultSummary = {
            "added": 0, "duplicates": 0, "linked_existing": 0,
            "errors": 0, "details": [],
        }
        print_json(empty)
        return

    conn = get_connection(db_path)

    results: ResultSummary = {
        "added": 0,
        "duplicates": 0,
        "linked_existing": 0,
        "errors": 0,
        "details": [],
    }

    try:
        for i, entry in enumerate(data):
            detail = EntryDetail(
                index=i,
                name=entry.get("name", ""),
            )

            # バリデーション
            errors = validate_entry(entry, i)
            if errors:
                detail["status"] = "error"
                detail["messages"] = errors
                results["errors"] += 1
                results["details"].append(detail)
                continue

            # --- existing_prospect_id が指定されている場合 ---
            existing_pid = entry.get("existing_prospect_id")
            if existing_pid is not None:
                linked = link_project_prospect(conn, project_id, existing_pid, entry)
                detail["status"] = "linked_existing"
                detail["prospect_id"] = existing_pid
                detail["project_linked"] = linked
                results["linked_existing"] += 1
                results["details"].append(detail)
                continue

            # --- 重複チェック ---
            matches = find_duplicates(conn, entry)
            exact = [m for m in matches if m["match_type"] == "EXACT_MATCH"]

            if exact:
                pid = exact[0]["prospect_id"]
                detail["status"] = "duplicate"
                detail["prospect_id"] = pid
                detail["match_detail"] = exact[0]["reason"]
                linked = link_project_prospect(conn, project_id, pid, entry)
                detail["project_linked"] = linked
                results["duplicates"] += 1
                results["details"].append(detail)
                continue

            # POSSIBLE_MATCH は新規登録する（弱いシグナルのため）
            # 呼び出し元が事前に判断済みの前提
            if matches:
                detail["possible_matches"] = [
                    PossibleMatch(prospect_id=m["prospect_id"], reason=m["reason"])
                    for m in matches
                ]

            # --- 新規登録 ---
            try:
                new_id = insert_prospect(conn, entry)
                _ = link_project_prospect(conn, project_id, new_id, entry)
                detail["status"] = "added"
                detail["prospect_id"] = new_id
                results["added"] += 1
            except Exception as e:
                detail["status"] = "error"
                detail["messages"] = [str(e)]
                results["errors"] += 1

            results["details"].append(detail)

        conn.commit()
    except Exception as e:
        conn.rollback()
        error_exit(f"Transaction failed: {e}")
    finally:
        conn.close()

    print_json(results)


if __name__ == "__main__":
    main()
