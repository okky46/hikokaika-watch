from __future__ import annotations

import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import requests

from common import InboxCandidate

RSS_URL = "https://news.google.com/rss/search?q={query}&hl=ja&gl=JP&ceid=JP:ja"
CODE_RE = re.compile(r"[0-9][0-9A-Z]{3}")
BRACKET_CODE_RE = re.compile(r"[（(＜<]([0-9][0-9A-Z]{3})[）)＞>]")


def load_queries(path: str | Path | None = None) -> list[str]:
    query_path = Path(path) if path else Path(__file__).resolve().parents[1] / "queries.json"
    return json.loads(query_path.read_text(encoding="utf-8"))


def extract_security_code(text: str) -> str | None:
    upper = text.upper()
    bracket = BRACKET_CODE_RE.search(upper)
    if bracket:
        return bracket.group(1)
    match = CODE_RE.search(upper)
    return match.group(0) if match else None


def parse_rss(xml_text: str, query: str) -> list[InboxCandidate]:
    root = ET.fromstring(xml_text)
    items: list[InboxCandidate] = []
    for item in root.findall(".//item"):
        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        published = item.findtext("pubDate")
        description = item.findtext("description") or ""
        if not title or not link:
            continue
        code = extract_security_code(f"{title} {description}")
        items.append(InboxCandidate(
            source_kind="news",
            title=title,
            url=link,
            published_at=published,
            security_code=code,
            suggested_event_type="observation_report",
            raw={"query": query, "description": description},
        ))
    return items


def collect(queries: list[str] | None = None, *, timeout: int = 20) -> list[InboxCandidate]:
    results: list[InboxCandidate] = []
    for query in queries or load_queries():
        url = RSS_URL.format(query=urllib.parse.quote(query))
        response = requests.get(url, timeout=timeout, headers={"User-Agent": "hikokaika-watch/collect"})
        response.raise_for_status()
        results.extend(parse_rss(response.text, query))
    return results
