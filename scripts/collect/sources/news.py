from __future__ import annotations

import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import requests

from common import InboxCandidate, normalize_url

RSS_URL = "https://news.google.com/rss/search?q={query}&hl=ja&gl=JP&ceid=JP:ja"
SECURITY_CODE_PATTERN = r"([0-9]{4}|[0-9]{3}[A-Z])"
BRACKET_CODE_RE = re.compile(rf"[（(＜<]{SECURITY_CODE_PATTERN}[）)＞>]", re.IGNORECASE)
LABEL_CODE_RE = re.compile(rf"(?:証券コード|銘柄コード|コード)\s*[:：]?\s*{SECURITY_CODE_PATTERN}", re.IGNORECASE)
RELATED_RE = re.compile(r"非公開化|MBO|TOB|公開買付|公開買い付け|買収提案", re.IGNORECASE)
JST = timezone(timedelta(hours=9))


def load_queries(path: str | Path | None = None) -> list[str]:
    query_path = Path(path) if path else Path(__file__).resolve().parents[1] / "queries.json"
    return json.loads(query_path.read_text(encoding="utf-8"))


def current_jst_year() -> int:
    return datetime.now(JST).year


def is_likely_recent_year_code(code: str, base_year: int, *, window: int = 3) -> bool:
    if not re.fullmatch(r"[0-9]{4}", code):
        return False
    value = int(code)
    return base_year - window <= value <= base_year + window


def extract_security_code(text: str, *, base_year: int | None = None) -> str | None:
    upper = text.upper()
    label_match = LABEL_CODE_RE.search(upper)
    if label_match:
        return label_match.group(1).upper()
    year = base_year if base_year is not None else current_jst_year()
    bracket_match = BRACKET_CODE_RE.search(upper)
    if bracket_match:
        code = bracket_match.group(1).upper()
        if is_likely_recent_year_code(code, year):
            return None
        return code
    return None


def has_related_keyword(text: str) -> bool:
    return RELATED_RE.search(text) is not None


def parse_pub_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(JST).date()


def default_date_range(today: date | None = None) -> tuple[date, date]:
    end = today or datetime.now(JST).date()
    start_delta = 3 if end.weekday() == 0 else 2
    return end - timedelta(days=start_delta), end


def format_query(query: str, date_from: date | None = None, date_to: date | None = None) -> str:
    if date_from and date_to:
        return f"{query} after:{date_from.isoformat()} before:{(date_to + timedelta(days=1)).isoformat()}"
    return query


def in_date_range(pub_date: str | None, date_from: date | None, date_to: date | None) -> bool:
    if not date_from and not date_to:
        return True
    parsed = parse_pub_date(pub_date)
    if parsed is None:
        return False
    if date_from and parsed < date_from:
        return False
    if date_to and parsed > date_to:
        return False
    return True


def dedupe_candidates(candidates: list[InboxCandidate]) -> list[InboxCandidate]:
    seen: set[str] = set()
    unique: list[InboxCandidate] = []
    for candidate in candidates:
        key = normalize_url(candidate.url)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def parse_rss(xml_text: str, query: str, *, date_from: date | None = None, date_to: date | None = None) -> list[InboxCandidate]:
    root = ET.fromstring(xml_text)
    items: list[InboxCandidate] = []
    for item in root.findall(".//item"):
        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        published = item.findtext("pubDate")
        description = item.findtext("description") or ""
        haystack = f"{title} {description}"
        if not title or not link:
            continue
        if not has_related_keyword(haystack):
            continue
        if not in_date_range(published, date_from, date_to):
            continue
        code = extract_security_code(haystack)
        if not code:
            continue
        items.append(InboxCandidate(
            source_kind="news",
            title=title,
            url=link,
            published_at=published,
            security_code=code,
            suggested_event_type="observation_report",
            raw={"query": query, "description": description},
        ))
    return dedupe_candidates(items)


def collect(queries: list[str] | None = None, *, timeout: int = 20, date_from: date | None = None, date_to: date | None = None) -> list[InboxCandidate]:
    results: list[InboxCandidate] = []
    for query in queries or load_queries():
        rss_query = format_query(query, date_from, date_to)
        url = RSS_URL.format(query=urllib.parse.quote(rss_query))
        response = requests.get(url, timeout=timeout, headers={"User-Agent": "hikokaika-watch/collect"})
        response.raise_for_status()
        results.extend(parse_rss(response.text, query, date_from=date_from, date_to=date_to))
    return dedupe_candidates(results)
