#!/usr/bin/env python3
"""営業先の重複チェックスクリプト

確実な判定から順にチェックし、マッチした候補を JSON で出力する。
チェック順:
  1. organizations の corporate_number（O(1) PK）
  2. prospects の email（O(1) UNIQUE INDEX）
  3. prospects の contact_form_url（O(1) UNIQUE INDEX）
  4. SNS アカウント
  5. 名称一致（フォールバック）
  6. ドメイン一致（フォールバック）

Usage:
  check_duplicate.py <db_path> [options]

Options:
  --email <email>
  --sns <key> <value>
  --corporate-number <number>
  --name <name>
  --website-url <url>
  --contact-form-url <url>

Output: JSON array of DuplicateMatch objects
Exit code: 0 = match found, 1 = no match, 2 = error
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys

from sales_db import DuplicateMatch, extract_domain, get_connection, normalize_name  # pyright: ignore[reportMissingModuleSource]


def check_corporate_number(conn: sqlite3.Connection, number: str) -> list[DuplicateMatch]:
    """法人番号で organizations → prospects を検索（O(1) PK ルックアップ）"""
    # organizations に存在するか
    org = conn.execute(
        "SELECT corporate_number, name FROM organizations WHERE corporate_number = ?",
        (number,),
    ).fetchone()
    if org is None:
        # organizations に無くても旧データの prospects にあるかもしれない
        cursor = conn.execute(
            "SELECT id, name FROM prospects WHERE organization_id = ?",
            (number,),
        )
        return [
            DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=row["id"],
                name=row["name"],
                reason=f"法人番号一致: {number}",
            )
            for row in cursor
        ]

    # organizations にある → 紐づく prospects を返す
    cursor = conn.execute(
        "SELECT id, name FROM prospects WHERE organization_id = ?",
        (number,),
    )
    results = [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"法人番号一致（法人: {org['name']}）: {number}",
        )
        for row in cursor
    ]
    # prospects が無い場合でも org は存在する → org_name を返して重複を示す
    if not results:
        results.append(
            DuplicateMatch(
                match_type="EXACT_MATCH",
                prospect_id=-1,  # org のみ存在、prospect は未登録
                name=str(org["name"]),
                reason=f"法人番号一致（organizations のみ）: {number}",
            )
        )
    return results


def check_email(conn: sqlite3.Connection, email: str) -> list[DuplicateMatch]:
    """email 完全一致チェック（UNIQUE INDEX で O(1)）"""
    cursor = conn.execute(
        "SELECT id, name FROM prospects WHERE email = ?",
        (email,),
    )
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"email一致: {email}",
        )
        for row in cursor
    ]


def check_contact_form(conn: sqlite3.Connection, url: str) -> list[DuplicateMatch]:
    """contact_form_url 完全一致チェック（UNIQUE INDEX で O(1)）"""
    cursor = conn.execute(
        "SELECT id, name FROM prospects WHERE contact_form_url = ?",
        (url,),
    )
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"フォームURL一致: {url}",
        )
        for row in cursor
    ]


ALLOWED_SNS_KEYS = {"twitter", "x", "linkedin", "facebook", "instagram"}


def check_sns(conn: sqlite3.Connection, sns_key: str, sns_value: str) -> list[DuplicateMatch]:
    """SNS アカウント完全一致チェック（json_extract 使用）"""
    if sns_key not in ALLOWED_SNS_KEYS:
        return []
    cursor = conn.execute(
        "SELECT id, name FROM prospects "
        "WHERE sns_accounts IS NOT NULL "
        f"AND json_extract(sns_accounts, '$.{sns_key}') = ?",
        (sns_value,),
    )
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"SNS一致: {sns_key}={sns_value}",
        )
        for row in cursor
    ]


def check_name(conn: sqlite3.Connection, name: str) -> list[DuplicateMatch]:
    """名称一致チェック（organizations.normalized_name INDEX 優先、フォールバックで全走査）"""
    normalized = normalize_name(name)

    # まず organizations の INDEX を使って高速チェック
    org_cursor = conn.execute(
        "SELECT o.corporate_number, o.name, p.id, p.name"
        " FROM organizations o"
        " LEFT JOIN prospects p ON o.corporate_number = p.organization_id"
        " WHERE o.normalized_name = ?",
        (normalized,),
    )
    results: list[DuplicateMatch] = []
    for row in org_cursor:
        if row["id"] is not None:
            results.append(
                DuplicateMatch(
                    match_type="EXACT_MATCH",
                    prospect_id=row["id"],
                    name=row["name"],
                    reason="名称一致（organizations経由）",
                )
            )
    if results:
        return results

    # フォールバック: organizations に無い旧データを全走査
    cursor = conn.execute("SELECT id, name FROM prospects")
    return [
        DuplicateMatch(
            match_type="EXACT_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason="名称一致",
        )
        for row in cursor
        if normalize_name(row["name"]) == normalized
    ]


def check_website_domain(conn: sqlite3.Connection, url: str) -> list[DuplicateMatch]:
    """ウェブサイトのドメイン一致チェック（organizations.domain INDEX 優先）"""
    domain = extract_domain(url)
    if not domain:
        return []

    # organizations の INDEX を使って高速チェック
    org_cursor = conn.execute(
        "SELECT o.corporate_number, o.name, p.id, p.name"
        " FROM organizations o"
        " LEFT JOIN prospects p ON o.corporate_number = p.organization_id"
        " WHERE o.domain = ?",
        (domain,),
    )
    results: list[DuplicateMatch] = []
    for row in org_cursor:
        if row["id"] is not None:
            results.append(
                DuplicateMatch(
                    match_type="POSSIBLE_MATCH",
                    prospect_id=row["id"],
                    name=row["name"],
                    reason=f"ドメイン一致（organizations経由）: {domain}",
                )
            )
    if results:
        return results

    # フォールバック: organizations に無い旧データを全走査
    cursor = conn.execute(
        "SELECT id, name, website_url FROM prospects"
        " WHERE website_url IS NOT NULL",
    )
    return [
        DuplicateMatch(
            match_type="POSSIBLE_MATCH",
            prospect_id=row["id"],
            name=row["name"],
            reason=f"ドメイン一致: {domain}",
        )
        for row in cursor
        if extract_domain(row["website_url"]) == domain
    ]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="営業先の重複チェック。確実な判定から順にチェックし、マッチした候補を JSON で出力する。",
    )
    _ = parser.add_argument("db_path", help="SQLite データベースのパス")
    _ = parser.add_argument("--email", help="メールアドレスで完全一致チェック")
    _ = parser.add_argument("--sns", nargs=2, metavar=("KEY", "VALUE"), help="SNS アカウントで完全一致チェック（例: --sns x @account）")
    _ = parser.add_argument("--corporate-number", help="法人番号で完全一致チェック")
    _ = parser.add_argument("--name", help="名称で完全一致チェック")
    _ = parser.add_argument("--website-url", help="ウェブサイトのドメインで一致チェック")
    _ = parser.add_argument("--contact-form-url", help="フォームURLで完全一致チェック")
    return parser


def main() -> None:
    args = build_parser().parse_args()

    conn = get_connection(args.db_path)
    matches: list[DuplicateMatch] = []

    try:
        if args.corporate_number:
            matches.extend(check_corporate_number(conn, args.corporate_number))

        if args.email:
            matches.extend(check_email(conn, args.email))

        if args.contact_form_url:
            matches.extend(check_contact_form(conn, args.contact_form_url))

        if args.sns:
            matches.extend(check_sns(conn, args.sns[0], args.sns[1]))

        if args.name:
            matches.extend(check_name(conn, args.name))

        if args.website_url:
            matches.extend(check_website_domain(conn, args.website_url))
    finally:
        conn.close()

    # 重複排除（同じ prospect_id が複数段階でヒットする場合）
    seen: set[int] = set()
    unique_matches: list[DuplicateMatch] = []
    for m in matches:
        if m["prospect_id"] not in seen:
            seen.add(m["prospect_id"])
            unique_matches.append(m)

    if unique_matches:
        json.dump(unique_matches, sys.stdout, ensure_ascii=False, indent=2)
        print()
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
