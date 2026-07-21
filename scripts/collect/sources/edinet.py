from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import requests

from common import InboxCandidate, JST, is_allowed_http_url

EDINET_API_BASE_URL = os.getenv("EDINET_API_BASE_URL") or "https://api.edinet-fsa.go.jp/api/v2"
EDINET_VIEWER_URL = os.getenv("EDINET_VIEWER_URL") or "https://disclosure2.edinet-fsa.go.jp/"
DOC_TYPES = ("大量保有報告書", "変更報告書")

class EDINETConfigError(RuntimeError): pass
class EDINETAPIError(RuntimeError): pass

def normalize_sec_code(value: Any) -> str | None:
    code = str(value or "").strip().upper()
    if len(code) == 5 and code.endswith("0"):
        return code[:4]
    return code or None

def public_url(doc_id: Any) -> str:
    # EDINET API download URLs require auth/query params; store a stable public viewer entry instead.
    return EDINET_VIEWER_URL

def _skip_row(index: int, reason: str, *, code: str | None = None, has_doc_id: bool | None = None) -> None:
    details = [f"row={index}", f"reason={reason}"]
    if code:
        details.append(f"secCode={code}")
    if has_doc_id is not None:
        details.append(f"has_docID={has_doc_id}")
    print(f"[collect] source=edinet skip malformed {' '.join(details)}")


def parse_documents(payload: dict[str, Any], active_codes: set[str]) -> list[InboxCandidate]:
    status = payload.get("statusCode")
    if status not in (None, 200, "200"):
        raise EDINETAPIError(f"EDINET API metadata statusCode={status}")
    results_raw = payload.get("results")
    if results_raw is None:
        raise EDINETAPIError("EDINET API response missing results")
    if not isinstance(results_raw, list):
        raise EDINETAPIError("EDINET API results is not an array")
    results: list[InboxCandidate] = []
    normalized_active = {c.upper() for c in active_codes}
    for index, doc in enumerate(results_raw):
        if not isinstance(doc, dict):
            _skip_row(index, "row is not an object")
            continue
        title = str(doc.get("docDescription") or "").strip()
        if not title:
            _skip_row(index, "docDescription missing", code=str(doc.get("secCode") or ""), has_doc_id=bool(doc.get("docID")))
            continue
        if not any(t in title for t in DOC_TYPES):
            continue
        code = normalize_sec_code(doc.get("secCode"))
        if not code:
            _skip_row(index, "secCode invalid", has_doc_id=bool(doc.get("docID")))
            continue
        if code not in normalized_active:
            continue
        doc_id = str(doc.get("docID") or "").strip()
        if not doc_id:
            _skip_row(index, "docID missing", code=code, has_doc_id=False)
            continue
        url = public_url(doc_id)
        if not is_allowed_http_url(url):
            raise EDINETAPIError("EDINET public viewer URL is invalid")
        filing_date = str(doc.get("submitDateTime") or "")[:10] or None
        change_type = "new" if "大量保有報告書" in title and "変更" not in title else "increase"
        metadata_draft = {"holder_name": doc.get("filerName"), "ratio": None, "previous_ratio": None, "filing_date": filing_date, "change_type": change_type, "doc_id": doc_id}
        safe_doc = {k: v for k, v in doc.items() if "key" not in k.lower() and "subscription" not in k.lower()}
        results.append(InboxCandidate("edinet", title, url, doc.get("submitDateTime"), code, "large_shareholding_report", (), {"edinet": {**safe_doc, "docID": doc_id}, "metadata_draft": metadata_draft}, None, f"edinet:{doc_id}"))
    return results

def collect(active_codes: set[str], *, timeout: int = 20) -> list[InboxCandidate]:
    if not active_codes:
        return []
    api_key = os.getenv("EDINET_API_KEY")
    if not api_key:
        print("[collect] source=edinet skipped: EDINET_API_KEY is not set")
        return []
    base = EDINET_API_BASE_URL.rstrip("/")
    if not is_allowed_http_url(base):
        raise EDINETConfigError("EDINET_API_BASE_URL must be an absolute http/https URL")
    date = datetime.now(JST).date().isoformat()
    params = {"date": date, "type": "2", "Subscription-Key": api_key}
    response = requests.get(f"{base}/documents.json", params=params, timeout=timeout, headers={"User-Agent": "hikokaika-watch/collect"})
    response.raise_for_status()
    return parse_documents(response.json(), active_codes)
