#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from typing import Callable

import requests

from common import ACTIVE_STATUSES, ActiveCase, InboxCandidate, dedup_key, get_config, headers, is_allowed_http_url
from notify_discord import notify
from sources import edinet, news, tdnet

SourceFn = Callable[[], list[InboxCandidate]]

def fetch_active_cases(base_url: str, service_key: str) -> list[ActiveCase]:
    response = requests.get(f"{base_url.rstrip('/')}/rest/v1/cases", params={"select": "id,companies!inner(security_code)", "status": f"in.({','.join(ACTIVE_STATUSES)})"}, headers=headers(service_key), timeout=20)
    response.raise_for_status()
    cases = []
    for row in response.json():
        co = row.get("companies") or {}
        code = co.get("security_code") if isinstance(co, dict) else None
        if isinstance(row.get("id"), str) and isinstance(code, str):
            cases.append(ActiveCase(row["id"], code.upper()))
    return cases

def match_case(candidate: InboxCandidate, active_cases: list[ActiveCase]) -> InboxCandidate:
    if not candidate.security_code:
        return candidate
    matched = next((c.case_id for c in active_cases if c.security_code.upper() == candidate.security_code.upper()), None)
    return InboxCandidate(**{**candidate.__dict__, "matched_case_id": matched})

def candidate_payload(c: InboxCandidate) -> dict:
    return {"source_kind": c.source_kind, "title": c.title, "url": c.url, "published_at": c.published_at, "security_code": c.security_code, "matched_case_id": c.matched_case_id, "suggested_event_type": c.suggested_event_type, "suggested_comment_tags": list(c.suggested_comment_tags), "raw": c.raw, "dedup_key": dedup_key(c.url)}

def similar_exists(base_url: str, service_key: str, c: InboxCandidate) -> bool:
    if not c.security_code:
        return False
    response = requests.get(f"{base_url.rstrip('/')}/rest/v1/inbox_items", params={"select": "id", "security_code": f"eq.{c.security_code}", "title": f"like.{c.title[:30]}%", "limit": "1"}, headers=headers(service_key), timeout=20)
    response.raise_for_status()
    return bool(response.json())

def insert_candidate(base_url: str, service_key: str, c: InboxCandidate) -> dict | None:
    if similar_exists(base_url, service_key, c):
        print(f"[collect] skip similar title security_code={c.security_code} title={c.title[:30]}")
        return None
    response = requests.post(f"{base_url.rstrip('/')}/rest/v1/inbox_items", headers=headers(service_key, representation=True), json=candidate_payload(c), timeout=20)
    if response.status_code == 409:
        print(f"[collect] skip duplicate url title={c.title[:40]}")
        return None
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None

def run_sources(source_fns: list[tuple[str, SourceFn]]) -> list[InboxCandidate]:
    all_items: list[InboxCandidate] = []
    for name, fn in source_fns:
        try:
            items = fn()
            all_items.extend(items)
            print(f"[collect] source={name} candidates={len(items)}")
        except Exception as error:
            print(f"[collect] source={name} failed ({type(error).__name__}); continuing", file=sys.stderr)
    return all_items

def local_dry_run_candidates() -> list[InboxCandidate]:
    return [InboxCandidate("news", "テスト企業（130A）がMBO検討と報道", "https://example.com/news?id=1&utm=x", security_code="130A", suggested_event_type="observation_report", raw={"dry_run": True})]

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    base_url, service_key = get_config()
    if args.dry_run and (not base_url or not service_key):
        active_cases = [ActiveCase("dry-run-case-130a", "130A")]
        candidates = local_dry_run_candidates()
        print("[collect] dry-run local validation mode: Supabase credentials are absent")
    elif not base_url or not service_key:
        print("[collect] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", file=sys.stderr)
        return 2
    else:
        try:
            active_cases = fetch_active_cases(base_url, service_key)
        except requests.RequestException as error:
            print(f"[collect] active case fetch failed ({type(error).__name__})", file=sys.stderr)
            active_cases = []
        active_codes = {c.security_code for c in active_cases}
        candidates = run_sources([("tdnet", tdnet.collect), ("edinet", lambda: edinet.collect(active_codes)), ("news", news.collect)])
    matched = [match_case(c, active_cases) for c in candidates if c.url and is_allowed_http_url(c.url)]
    inserted: list[dict] = []
    for c in matched:
        payload = candidate_payload(c)
        print(f"[collect] candidate source={c.source_kind} code={c.security_code} matched={bool(c.matched_case_id)} dedup={payload['dedup_key'][:8]} title={c.title[:60]}")
        if args.dry_run:
            continue
        try:
            row = insert_candidate(base_url, service_key, c)
            if row:
                inserted.append(row)
        except requests.RequestException as error:
            print(f"[collect] insert failed ({type(error).__name__}); continuing", file=sys.stderr)
    notify(inserted, dry_run=args.dry_run)
    print(f"[collect] summary candidates={len(matched)} inserted={len(inserted)} dry_run={args.dry_run}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
