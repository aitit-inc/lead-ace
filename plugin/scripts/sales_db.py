#!/usr/bin/env python3
"""Lead Ace DB - shared module (type definitions, DB connection, common operations)"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import unicodedata
from typing import Literal, NoReturn, TypedDict


# ---------------------------------------------------------------------------
# Type aliases (string literals)
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
# Type definitions
# ---------------------------------------------------------------------------

class Project(TypedDict):
    id: str  # PRIMARY KEY (text, e.g. "my-product")
    created_at: str
    updated_at: str


class Organization(TypedDict, total=False):
    domain: str  # PRIMARY KEY (apex domain, e.g., "example.com")
    name: str
    normalized_name: str
    website_url: str
    country: str | None  # ISO 3166-1 alpha-2 (e.g., "JP", "US")
    address: str | None
    industry: str | None
    overview: str | None
    created_at: str
    updated_at: str


class Prospect(TypedDict, total=False):
    id: int
    name: str  # Prospect name (corporate name, school name, etc. Same as organizations.name for small companies)
    contact_name: str | None
    organization_id: str  # FK → organizations.domain
    department: str | None  # Division within the organization (department, school, etc.)
    overview: str
    industry: str | None
    website_url: str
    email: str | None
    contact_form_url: str | None
    form_type: FormType | None
    sns_accounts: str | None  # JSON string
    do_not_contact: int
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
    name: str  # Prospect name
    reason: str


# ---------------------------------------------------------------------------
# Prospect field groups
# Must be kept in sync with the TypedDict. The assertion below automatically
# verifies completeness at import time.
# ---------------------------------------------------------------------------

# DB auto-generated fields (id, timestamps)
_PROSPECT_AUTO_FIELDS = frozenset({"id", "created_at", "updated_at"})

# Fields retrieved in Phase 1 (candidate collection)
PROSPECT_CANDIDATE_FIELDS: tuple[str, ...] = (
    "name", "organization_id", "department", "overview", "industry", "website_url",
)

# Fields retrieved in Phase 2 (contact enrichment)
PROSPECT_CONTACT_FIELDS: tuple[str, ...] = (
    "contact_name", "email", "contact_form_url", "form_type", "sns_accounts",
    "do_not_contact", "notes",
)

# Completeness check: all Prospect fields must belong to one of the groups
_all_prospect_fields = frozenset(Prospect.__annotations__)
_grouped_prospect_fields = (
    frozenset(PROSPECT_CANDIDATE_FIELDS)
    | frozenset(PROSPECT_CONTACT_FIELDS)
    | _PROSPECT_AUTO_FIELDS
)
assert _all_prospect_fields == _grouped_prospect_fields, (
    f"Prospect field group mismatch — "
    f"not in any group: {_all_prospect_fields - _grouped_prospect_fields}, "
    f"not in TypedDict: {_grouped_prospect_fields - _all_prospect_fields}"
)


# ---------------------------------------------------------------------------
# DB connection
# ---------------------------------------------------------------------------

def get_db_path(explicit_path: str | None = None) -> str:
    """Determine the DB path. Uses data.db in the CWD if not explicitly specified."""
    if explicit_path:
        return explicit_path
    return os.path.join(os.getcwd(), "data.db")


def get_connection(db_path: str) -> sqlite3.Connection:
    """Get a SQLite connection with foreign keys enabled and rows returned as dicts."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _ = conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_schema_path() -> str:
    """Return the path to the schema file."""
    return os.path.join(os.path.dirname(__file__), "sales-db.sql")


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, object]]:
    """Convert a list of sqlite3.Row objects to a list of dicts."""
    return [dict(row) for row in rows]


def print_json(data: object) -> None:
    """Print JSON to stdout."""
    json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
    print()


def error_exit(message: str, code: int = 1) -> NoReturn:
    """Print an error message to stderr and exit."""
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------------
# String utilities
# ---------------------------------------------------------------------------

def normalize_name(name: str) -> str:
    """Normalize a company name: full-width to half-width conversion, lowercase, strip whitespace."""
    return unicodedata.normalize("NFKC", name).lower().strip()


def extract_domain(url: str) -> str:
    """Extract the domain from a URL, removing protocol, www prefix, and path. Returns lowercase."""
    domain = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    domain = re.sub(r"^www\.", "", domain, flags=re.IGNORECASE)
    domain = domain.split("/")[0]
    return domain.lower()


# ---------------------------------------------------------------------------
# Organization operations
# ---------------------------------------------------------------------------

def upsert_organization(
    conn: sqlite3.Connection,
    name: str,
    website_url: str,
    country: str | None = None,
    industry: str | None = None,
    overview: str | None = None,
    address: str | None = None,
) -> str:
    """INSERT or UPDATE the organizations table. Returns the domain (PK)."""
    domain = extract_domain(website_url)
    normalized = normalize_name(name)
    conn.execute(
        "INSERT INTO organizations"
        " (domain, name, normalized_name, website_url, country, address, industry, overview)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(domain) DO UPDATE SET"
        "   name = excluded.name,"
        "   normalized_name = excluded.normalized_name,"
        "   website_url = excluded.website_url,"
        "   country = COALESCE(excluded.country, organizations.country),"
        "   address = COALESCE(excluded.address, organizations.address),"
        "   industry = COALESCE(excluded.industry, organizations.industry),"
        "   overview = COALESCE(excluded.overview, organizations.overview),"
        "   updated_at = datetime('now', 'localtime')",
        (domain, name, normalized, website_url, country, address, industry, overview),
    )
    return domain
