"""Reconcile two newly reviewed, previously unrepresented Additional Evidence items.

The evidence IDs are explicit because this is a continuation of the audited
89-learner scope.  The default command is read-only.  Applying requires the
database name and dry-run fingerprint printed by the preview.  The write path
uses the existing per-learner Additional-only transaction helper and never
touches LMS Activity, Assignments, Journal, Attendance, or the Aptem mirror.
"""
from __future__ import annotations

from collections import defaultdict
import argparse
import json
import sys

import psycopg
from psycopg.rows import dict_row

SCRIPT_DIR = __import__("pathlib").Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import apply_remaining_80_additional as previous  # noqa: E402
import reconcile_additional_hours_social_media as base  # noqa: E402
import reconcile_remaining_current_additional as current  # noqa: E402


SAFE_ITEMS = (
    (1000, 25443), (1000, 27691), (1000, 7016),
    (1168, 26124), (1277, 44535), (1498, 44675),
    (1570, 6353), (1570, 16133), (10208, 36469), (1392, 36233),
)
CONTENT_BASIS = {
    25443: "AssessmentReport states Time spent 90:00; accepted; content read",
    27691: "AssessmentReport states Time spent 05:00; accepted; content read",
    7016: "AssessmentReport states Time spent 02:00; accepted; content read",
    26124: "AssessmentReport states Time spent 01:00; accepted; content read",
    44535: "AssessmentReport states Time spent 02:00; accepted; content read",
    44675: "AssessmentReport states Time spent 04:00; accepted; content read",
    6353: "AssessmentReport states Time spent 01:00; accepted; content read",
    16133: "AssessmentReport states Time spent 07:00; accepted; content read",
    36469: "AssessmentReport states Time spent 03:00; accepted; content read",
    36233: "AssessmentReport states Time spent 02:30; accepted; content read; attached attendance notes total 2h30",
}


def build_plan(cur) -> dict:
    actions = [{"aid": aid, "eid": eid} for aid, eid in SAFE_ITEMS]
    state = previous.read_state(cur, actions)
    candidates = []
    represented = []
    for aid, eid in SAFE_ITEMS:
        evidence = state["evidence"].get(eid)
        if not evidence or int(evidence["learner_id"]) != aid:
            raise ValueError(f"Evidence {eid} learner identity changed or is missing.")
        if str(evidence.get("evidence_status") or "").casefold() != "accepted":
            raise ValueError(f"Evidence {eid} is no longer Accepted.")
        if not base.is_additional_component(evidence.get("component_name")):
            raise ValueError(f"Evidence {eid} is no longer Additional job activity.")
        valid, reason = base.accepted_evidence_day_valid(evidence, state)
        if not valid:
            raise ValueError(f"Evidence {eid} is not date-valid: {reason}.")
        owner = state["owners"][aid]
        owner_id = int(owner["id"])
        if cur.execute(
            '''SELECT 1 FROM "Learner".learner_activity_sources
               WHERE learner_id=%s AND source_system='aptem'
                 AND source_activity_id=%s AND deleted_at IS NULL''',
            [owner_id, f"evidence:{eid}"],
        ).fetchone():
            represented.append({"aid": aid, "eid": eid, "reason": "active_source"})
            continue
        candidates.append({
            "aid": aid,
            "eid": eid,
            "minutes": int(evidence["spent_time"]),
            "evidence": evidence,
            "owner": owner,
            "content_basis": CONTENT_BASIS[eid],
        })

    by_aid = defaultdict(list)
    for item in candidates:
        by_aid[int(item["aid"])].append(item["evidence"])
    all_segments = []
    for aid, rows in by_aid.items():
        owner_id = int(state["owners"][aid]["id"])
        used, lecture_days = base.existing_occupancy(state, owner_id, set())
        segments = base.allocate(owner_id, state, rows, set(), used, lecture_days, defaultdict(int))
        by_eid = defaultdict(list)
        for segment in segments:
            by_eid[int(segment["evidence_id"])].append(segment)
        for item in [item for item in candidates if int(item["aid"]) == aid]:
            item["segments"] = by_eid[int(item["eid"])]
            expected = int(item["minutes"]) * 60
            if sum(int(segment["seconds"]) for segment in item["segments"]) != expected:
                raise ValueError(f"Evidence {item['eid']} allocation total mismatch.")
            all_segments.append({
                "owner_id": owner_id,
                "evidence_ids": [int(item["eid"])],
                "segments": item["segments"],
            })
    violations = base.allocation_violations(all_segments)
    if violations:
        raise ValueError(f"Allocator produced timestamp violations: {violations[:3]}")
    fingerprint = previous.digest({
        "scope": list(SAFE_ITEMS),
        "candidate_ids": [int(item["eid"]) for item in candidates],
        "segments": all_segments,
        "represented": represented,
    })
    return {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "state": state,
        "candidates": candidates,
        "represented": represented,
        "fingerprint": fingerprint,
        "violations": violations,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        raise ValueError("--apply requires --expected-database and --expected-fingerprint.")
    base.bank_holidays = previous.extended_bank_holidays
    current.previous.base.bank_holidays = previous.extended_bank_holidays
    with psycopg.connect(previous.database_url(), connect_timeout=30, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=180000")
            cur.execute("SET LOCAL lock_timeout=10000")
            plan = build_plan(cur)
            azure = current.verify_azure(plan)
            summary = {
                "database": plan["database"],
                "read_only": not args.apply,
                "candidate_count": len(plan["candidates"]),
                "represented_count": len(plan["represented"]),
                "candidate_seconds": sum(int(item["minutes"]) * 60 for item in plan["candidates"]),
                "candidate_ids": [int(item["eid"]) for item in plan["candidates"]],
                "candidate_details": [
                    {"aid": int(item["aid"]), "eid": int(item["eid"]),
                     "minutes": int(item["minutes"]), "content_basis": item["content_basis"],
                     "segments": item["segments"]}
                    for item in plan["candidates"]
                ],
                "azure": azure,
                "fingerprint": plan["fingerprint"],
            }
            if args.apply:
                if plan["database"] != args.expected_database or plan["fingerprint"] != args.expected_fingerprint:
                    raise ValueError("Database or dry-run fingerprint changed; preview again before apply.")
                if azure["missing"]:
                    raise ValueError("Azure verification blocked the write.")
                written = []
                for aid in sorted({int(item["aid"]) for item in plan["candidates"]}):
                    written.append(current.insert_one_learner(plan, aid))
                summary["written"] = written
                summary["hours_added_seconds"] = sum(int(item["seconds"]) for item in written)
    print(json.dumps(summary, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
