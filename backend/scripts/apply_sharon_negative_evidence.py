"""Preview/apply two reviewed unique evidence items for Sharon AI negatives.

Only Nicholas Banks (Aptem 4336, evidence 20885 = 8h) and Roobin
Yogaretnam (Aptem 4445, evidence 13859 = 6h) are in scope.  Both are
Accepted paid-working-hours evidence, were read during the audit, and have
no active canonical source.  Allocations remain explicitly estimated and are
excluded from authoritative Actual totals until normal approval.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repair_sharon_evidence_allocations as base

base.RUN_KIND = "sharon-estimated-negative-evidence-v1"
base.PLAN = {
    4336: {None: [20885]},
    4445: {705104: [13859]},
}
base.SCHEDULES = {
    # November submission: the document explicitly states 8 hours.
    20885: [("2026-01-12", 8 * 3600)],
    # Lecture 1 - Assignments: the document explicitly totals 6 hours.
    13859: [("2025-11-03", 6 * 3600)],
}


def main() -> None:
    import argparse
    import psycopg
    from psycopg.rows import dict_row
    # The Windows console may still be cp1252; JSON contains the Arabic
    # approval label and must be printable without rolling back the transaction.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(base.database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=5000")
            report = base.build_report(cur)
            if args.apply:
                database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
                run_id, result = base.apply_report(
                    cur, report, args.expected_database, args.expected_fingerprint
                )
                report["applied"] = True
                report["run_id"] = run_id
                report["result"] = result
            print(json.dumps(report, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
