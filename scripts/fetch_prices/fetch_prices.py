#!/usr/bin/env python3
"""Fetch JST daily closes for visible active cases and store them in Supabase."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from time import sleep
from zoneinfo import ZoneInfo

from sources import SOURCE_NAME, fetch_close

ACTIVE_STATUSES = ("rumored", "commented", "denied", "announced")
JST = ZoneInfo("Asia/Tokyo")


@dataclass(frozen=True)
class TargetCase:
    case_id: str
    security_code: str


def jst_today() -> date:
    return datetime.now(JST).date()


def get_config() -> tuple[str | None, str | None]:
    return os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def headers(service_role_key: str, *, representation: bool = False) -> dict[str, str]:
    values = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}
    if representation:
        values["Prefer"] = "return=representation"
    return values


def fetch_targets(base_url: str, service_role_key: str) -> list[TargetCase]:
    response = requests.get(
        f"{base_url.rstrip('/')}/rest/v1/cases",
        params={
            "select": "id,companies!inner(security_code)",
            "is_visible": "eq.true",
            "status": f"in.({','.join(ACTIVE_STATUSES)})",
        },
        headers=headers(service_role_key),
        timeout=20,
    )
    response.raise_for_status()
    targets: list[TargetCase] = []
    for row in response.json():
        company = row.get("companies") or {}
        code = company.get("security_code") if isinstance(company, dict) else None
        if isinstance(row.get("id"), str) and isinstance(code, str) and code:
            targets.append(TargetCase(case_id=row["id"], security_code=code))
        else:
            print("[price-fetch] skipping case with no usable string security_code")
    return targets


def write_daily_close(
    base_url: str, service_role_key: str, target: TargetCase, price_date: date, price: Decimal
) -> str:
    """Update existing rows or insert one, without relying on a nonexistent unique key.

    price_snapshots intentionally has no unique constraint for this combination.
    The admin UI prevents duplicates and public reads normalize any historical
    duplicates, so this batch follows that established application-level design
    instead of using PostgREST's conflict-based upsert.
    """
    endpoint = f"{base_url.rstrip('/')}/rest/v1/price_snapshots"
    params = {
        "select": "id",
        "case_id": f"eq.{target.case_id}",
        "price_type": "eq.daily_close",
        "price_date": f"eq.{price_date.isoformat()}",
    }
    existing = requests.get(endpoint, params=params, headers=headers(service_role_key), timeout=20)
    existing.raise_for_status()
    rows = existing.json()
    payload = {
        "price": format(price, ".2f"),
        "source_name": SOURCE_NAME,
    }
    if rows:
        # PATCHing the same predicate also repairs any legacy duplicate rows.
        updated = requests.patch(
            endpoint,
            params={key: value for key, value in params.items() if key != "select"},
            headers=headers(service_role_key, representation=True),
            json=payload,
            timeout=20,
        )
        updated.raise_for_status()
        return "updated"

    created = requests.post(
        endpoint,
        headers=headers(service_role_key, representation=True),
        json={
            "case_id": target.case_id,
            "price_type": "daily_close",
            "price_date": price_date.isoformat(),
            **payload,
        },
        timeout=20,
    )
    created.raise_for_status()
    return "inserted"


def trigger_deploy_hook() -> None:
    hook_url = os.getenv("CLOUDFLARE_DEPLOY_HOOK_URL")
    if not hook_url:
        print("[price-fetch] deploy hook is not configured; skipping rebuild trigger")
        return
    response = requests.post(hook_url, timeout=20)
    response.raise_for_status()
    print("[price-fetch] deploy hook triggered")


def local_dry_run_targets() -> list[TargetCase]:
    # This intentionally non-existent code proves the string ticker path for 130A.
    return [TargetCase(case_id="dry-run-case-130a", security_code="130A")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="log only; do not write or trigger deployment")
    args = parser.parse_args()
    price_date = jst_today()
    base_url, service_role_key = get_config()

    if args.dry_run and (not base_url or not service_role_key):
        print("[price-fetch] dry-run local validation mode: Supabase credentials are absent")
        targets = local_dry_run_targets()
    elif not base_url or not service_role_key:
        print("[price-fetch] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", file=sys.stderr)
        return 2
    else:
        global requests
        try:
            import requests
        except ImportError:
            print("[price-fetch] requests is unavailable; run pip install -r requirements.txt", file=sys.stderr)
            return 2
        try:
            targets = fetch_targets(base_url, service_role_key)
        except requests.RequestException as error:
            print(f"[price-fetch] target fetch failed ({type(error).__name__})", file=sys.stderr)
            return 1

    print(f"[price-fetch] JST date={price_date} targets={len(targets)} dry_run={args.dry_run}")
    writes = 0
    for index, target in enumerate(targets):
        print(f"[price-fetch] processing case={target.case_id} security_code={target.security_code}")
        close = fetch_close(target.security_code, price_date)
        if close is None:
            print(f"[price-fetch] {target.security_code}: skipped (no close available)")
        else:
            print(f"[price-fetch] planned daily_close case={target.case_id} date={price_date} price={close:.2f}")
            if not args.dry_run:
                try:
                    action = write_daily_close(base_url, service_role_key, target, price_date, close)
                    writes += 1
                    print(f"[price-fetch] {target.security_code}: {action}")
                except requests.RequestException as error:
                    print(f"[price-fetch] {target.security_code}: write failed ({type(error).__name__})")
        if index < len(targets) - 1:
            sleep(0.25)

    if args.dry_run:
        print("[price-fetch] dry-run: Supabase writes and deploy hook skipped")
    elif writes:
        try:
            trigger_deploy_hook()
        except requests.RequestException as error:
            print(f"[price-fetch] deploy hook failed ({type(error).__name__})")
    else:
        print("[price-fetch] no writes; deploy hook skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
