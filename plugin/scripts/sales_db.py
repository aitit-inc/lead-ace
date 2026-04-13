#!/usr/bin/env python3
"""Lead Ace DB - 共有モジュール（型定義・DB接続・共通操作）"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import unicodedata
from typing import Literal, NoReturn, TypedDict


# ---------------------------------------------------------------------------
# 型エイリアス（文字列リテラル）
# ---------------------------------------------------------------------------

FormType = Literal[
    "google_forms", "native_html", "wordpress_cf7", "iframe_embed", "with_captcha",
]
ProspectStatus = Literal[
    "new", "contacted", "responded", "converted", "rejected", "inactive", "unreachable",
]
OutreachStatus = Literal["sent", "failed"]
OutreachChannel = Literal["email", "form", "sns_twitter", "sns_linkedin"]
Sentiment = Literal["positive", "neutral", "negative"]
MatchType = Literal["EXACT_MATCH", "POSSIBLE_MATCH"]


# ---------------------------------------------------------------------------
# 型定義
# ---------------------------------------------------------------------------

class Project(TypedDict):
    id: str  # PRIMARY KEY (テキスト、例: "my-product")
    created_at: str
    updated_at: str


class Organization(TypedDict, total=False):
    corporate_number: str  # PRIMARY KEY（法人番号13桁）
    name: str
    normalized_name: str
    domain: str | None
    website_url: str
    industry: str | None
    overview: str | None
    address: str | None  # 国税庁法人番号公表サイトの所在地
    created_at: str
    updated_at: str


class Prospect(TypedDict, total=False):
    id: int
    name: str  # 営業先名（法人名・学校名等。小さい会社は organizations.name と同じ）
    contact_name: str | None
    organization_id: str | None  # FK → organizations.corporate_number（レガシーデータは NULL）
    department: str | None  # 法人内の区分（部署名・学科名等）
    overview: str
    industry: str | None
    website_url: str
    email: str | None
    contact_form_url: str | None
    form_type: FormType | None
    sns_accounts: str | None  # JSON string
    do_not_contact: int
    org_lookup_status: str | None  # NULL=未検索, not_applicable, unresolvable
    notes: str | None
    created_at: str
    updated_at: str


class ProjectProspect(TypedDict, total=False):
    id: int
    project_id: str
    prospect_id: int
    match_reason: str
    priority: int
    status: ProspectStatus
    created_at: str
    updated_at: str


class OutreachLog(TypedDict, total=False):
    id: int
    project_id: str
    prospect_id: int
    channel: OutreachChannel
    subject: str | None
    body: str
    status: OutreachStatus
    sent_at: str
    error_message: str | None


class Response(TypedDict, total=False):
    id: int
    outreach_log_id: int
    channel: OutreachChannel
    content: str
    sentiment: Sentiment
    response_type: str
    received_at: str


class Evaluation(TypedDict, total=False):
    id: int
    project_id: str
    evaluation_date: str
    metrics: str  # JSON string
    findings: str
    improvements: str  # JSON string


class DuplicateMatch(TypedDict):
    match_type: MatchType
    prospect_id: int
    name: str  # 営業先名
    reason: str


# ---------------------------------------------------------------------------
# Prospect フィールドグループ
# TypedDict と同期必須。下部の assertion でインポート時に完全性を自動検証する。
# ---------------------------------------------------------------------------

# DB自動生成フィールド（id, timestamps）
_PROSPECT_AUTO_FIELDS = frozenset({"id", "created_at", "updated_at"})

# Phase 1（候補収集）で取得するフィールド
PROSPECT_CANDIDATE_FIELDS: tuple[str, ...] = (
    "name", "organization_id", "department", "overview", "industry", "website_url",
    "org_lookup_status",
)

# Phase 2（連絡先取得）で取得するフィールド
PROSPECT_CONTACT_FIELDS: tuple[str, ...] = (
    "contact_name", "email", "contact_form_url", "form_type", "sns_accounts",
    "do_not_contact", "notes",
)

# 完全性チェック: 全 Prospect フィールドがいずれかのグループに属すること
_all_prospect_fields = frozenset(Prospect.__annotations__)
_grouped_prospect_fields = (
    frozenset(PROSPECT_CANDIDATE_FIELDS)
    | frozenset(PROSPECT_CONTACT_FIELDS)
    | _PROSPECT_AUTO_FIELDS
)
assert _all_prospect_fields == _grouped_prospect_fields, (
    f"Prospect フィールドグループの不整合 — "
    f"グループ未登録: {_all_prospect_fields - _grouped_prospect_fields}, "
    f"TypedDict未定義: {_grouped_prospect_fields - _all_prospect_fields}"
)


# ---------------------------------------------------------------------------
# DB接続
# ---------------------------------------------------------------------------

def get_db_path(explicit_path: str | None = None) -> str:
    """DBパスを決定する。明示的に指定されていなければCWDの data.db を使う。"""
    if explicit_path:
        return explicit_path
    return os.path.join(os.getcwd(), "data.db")


def get_connection(db_path: str) -> sqlite3.Connection:
    """SQLite接続を取得する。外部キー制約を有効化し、行をdictで返す設定。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _ = conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_schema_path() -> str:
    """スキーマファイルのパスを返す。"""
    return os.path.join(os.path.dirname(__file__), "sales-db.sql")


# ---------------------------------------------------------------------------
# 出力ヘルパー
# ---------------------------------------------------------------------------

def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, object]]:
    """sqlite3.Row のリストを dict のリストに変換する。"""
    return [dict(row) for row in rows]


def print_json(data: object) -> None:
    """JSON を stdout に出力する。"""
    json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
    print()


def error_exit(message: str, code: int = 1) -> NoReturn:
    """エラーメッセージを stderr に出力して終了する。"""
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------------
# 文字列ユーティリティ
# ---------------------------------------------------------------------------

def normalize_name(name: str) -> str:
    """企業名を正規化する。全角→半角変換、小文字化、前後空白除去。"""
    return unicodedata.normalize("NFKC", name).lower().strip()


def extract_domain(url: str) -> str:
    """URLからドメインを抽出する。プロトコル・www・パスを除去し、小文字化する。"""
    domain = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    domain = re.sub(r"^www\.", "", domain, flags=re.IGNORECASE)
    domain = domain.split("/")[0]
    return domain.lower()


# ---------------------------------------------------------------------------
# Organization 操作
# ---------------------------------------------------------------------------

def upsert_organization(
    conn: sqlite3.Connection,
    corporate_number: str,
    name: str,
    website_url: str,
    industry: str | None = None,
    overview: str | None = None,
    address: str | None = None,
) -> None:
    """organizations テーブルに INSERT or UPDATE する。"""
    domain = extract_domain(website_url) if website_url else None
    normalized = normalize_name(name)
    conn.execute(
        "INSERT INTO organizations"
        " (corporate_number, name, normalized_name, domain, website_url, industry, overview, address)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(corporate_number) DO UPDATE SET"
        "   name = excluded.name,"
        "   normalized_name = excluded.normalized_name,"
        "   domain = excluded.domain,"
        "   website_url = excluded.website_url,"
        "   industry = COALESCE(excluded.industry, organizations.industry),"
        "   overview = COALESCE(excluded.overview, organizations.overview),"
        "   address = COALESCE(excluded.address, organizations.address),"
        "   updated_at = datetime('now', 'localtime')",
        (corporate_number, name, normalized, domain, website_url, industry, overview, address),
    )
