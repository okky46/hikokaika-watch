from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

ACTIVE_STATUSES = ("rumored", "commented", "denied", "announced")
JST = ZoneInfo("Asia/Tokyo")

@dataclass(frozen=True)
class ActiveCase:
    case_id: str
    security_code: str

@dataclass(frozen=True)
class InboxCandidate:
    source_kind: str
    title: str
    url: str
    published_at: str | None = None
    security_code: str | None = None
    suggested_event_type: str | None = None
    suggested_comment_tags: tuple[str, ...] = ()
    raw: dict[str, Any] | None = None
    matched_case_id: str | None = None
    dedup_identity: str | None = None


def headers(service_role_key: str, *, representation: bool = False) -> dict[str, str]:
    values = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}
    if representation:
        values["Prefer"] = "return=representation"
    return values


def is_allowed_http_url(url: str) -> bool:
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return False
    return parts.scheme.lower() in {"http", "https"} and bool(parts.netloc)


def normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower() or "https"
    netloc = parts.netloc.lower()
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((scheme, netloc, path, "", ""))


def sha256_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def dedup_key(url: str) -> str:
    return sha256_key(normalize_url(url))


def candidate_dedup_key(candidate: InboxCandidate) -> str:
    if candidate.dedup_identity:
        return sha256_key(candidate.dedup_identity)
    return dedup_key(candidate.url)


def now_jst_iso() -> str:
    return datetime.now(JST).isoformat()


def get_config() -> tuple[str | None, str | None]:
    return os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def validate_startup_config(base_url: str | None, service_key: str | None) -> list[str]:
    errors: list[str] = []
    if not base_url or not is_allowed_http_url(base_url):
        errors.append("SUPABASE_URL must be an absolute http/https URL")
    if not service_key:
        errors.append("SUPABASE_SERVICE_ROLE_KEY must be set")
    return errors
