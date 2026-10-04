"""Soft-exclude the explicitly approved Femi held Aptem evidence rows.

This never changes the Aptem mirror or Azure objects and never touches LMS
Activity/assignment rows.  It only deactivates local Aptem lineage for the
approved held statuses, recalculating a canonical parent conservatively from
retained support, and records the complete plan/result in activity_sync_runs.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402

REPORT = Path(__file__).resolve().parents[1] / "reports" / "femi_commercial_intelligence_current_report.json"
DEFAULT_RESULT = Path(__file__).resolve().parents[1] / "reports" / "femi_held_evidence_soft_exclude.json"
RUN_KIND = "femi-commercial-intelligence-held-evidence-soft-exclude-v1"
ACTOR_DEFAULT = "Ayman"
HELD = {"DURATION_CONFLICT", "AMBIGUOUS", "BLOCKED"}
BASIS = "reconciliation:femi-held-evidence-soft-exclude"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def fmt(seconds: int) -> str:
    seconds = int(seconds or 0)
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def insert_run(cur, values: dict[str, Any]) -> int:
    return int(cur.execute('''INSERT INTO "Learner".activity_sync_runs
        (run_key,run_kind,status,dry_run,source_counts,result_counts,prompt_version)
        VALUES (%s,%s,'running',false,%s,%s,%s) RETURNING id''', [
            values["run_key"], values["run_kind"], values["source_counts"],
            values["result_counts"], values["prompt_version"],
        ]).fetchone()["id"])


def load_held_report() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    rows = [dict(row) for row in report.get("candidates", []) if row.get("status") in HELD]
    seen = {int(row["evidence_id"]) for row in rows}
    for row in report.get("blocked", []):
        if int(row["evidence_id"]) not in seen:
            rows.append(dict(row))
    rows.sort(key=lambda row: (str(row.get("learner") or "").casefold(), int(row["evidence_id"])))
    if len(rows) != 48:
        raise ValueError(f"Expected 48 held Femi evidence rows, found {len(rows)}.")
    return report, rows


def evidence_day(value: Any) -> str | None:
    if isinstance(value, (date, datetime)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return str(value or "")[:10] or None


def build_plan(cur, report: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    eids = [int(row["evidence_id"]) for row in rows]
    evidence = {int(row["evidence_id"]): row for row in cur.execute('''SELECT e.*, coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_at
        FROM fetching_evidence.evidence_items e WHERE e.evidence_id=ANY(%s)''', [eids]).fetchall()}
    if len(evidence) != len(eids):
        raise ValueError("A held evidence row is missing from the Aptem mirror.")
    source_ids = sorted({int(sid) for row in rows for sid in (row.get("source_ids") or [])})
    sources = cur.execute('''SELECT * FROM "Learner".learner_activity_sources WHERE id=ANY(%s) AND deleted_at IS NULL''', [source_ids]).fetchall() if source_ids else []
    source_by_id = {int(row["id"]): row for row in sources}
    if len(source_by_id) != len(source_ids):
        raise ValueError("A planned active source row is missing or already changed.")
    parent_ids = sorted({int(pid) for row in rows for pid in (row.get("parent_ids") or [])})
    parents = cur.execute('''SELECT * FROM "Learner".learner_progress_entries WHERE id=ANY(%s) AND deleted_at IS NULL''', [parent_ids]).fetchall() if parent_ids else []
    parent_by_id = {int(row["id"]): row for row in parents}
    missing_parent_ids = [pid for pid in parent_ids if pid not in parent_by_id]
    # A missing parent is an explicit BLOCKED condition; it is recorded but not
    # invented or recreated by this operation.
    target_by_parent: dict[int, list[int]] = defaultdict(list)
    for row in rows:
        for sid in row.get("source_ids") or []:
            src = source_by_id.get(int(sid))
            if src and src.get("canonical_progress_id"):
                target_by_parent[int(src["canonical_progress_id"])].append(int(sid))
    parent_changes = []
    for pid, target_sids in sorted(target_by_parent.items()):
        parent = parent_by_id.get(pid)
        if not parent:
            continue
        all_sources = cur.execute('''SELECT id,source_system,source_activity_id,actual_seconds,accepted,activity_status
            FROM "Learner".learner_activity_sources WHERE canonical_progress_id=%s AND deleted_at IS NULL ORDER BY id''', [pid]).fetchall()
        target_set = set(target_sids)
        retained = [s for s in all_sources if int(s["id"]) not in target_set and bool(s.get("accepted")) and int(s.get("actual_seconds") or 0) > 0]
        non_aptem = sum(int(s["actual_seconds"] or 0) for s in retained if str(s.get("source_system") or "") != "aptem")
        retained_aptem = sum(int(s["actual_seconds"] or 0) for s in retained if str(s.get("source_system") or "") == "aptem")
        new_actual = int(parent.get("actual_seconds") or 0) if non_aptem > 0 else retained_aptem
        parent_changes.append({
            "parent_id": pid,
            "learner_id": int(parent["learner_id"]),
            "before_actual_seconds": int(parent.get("actual_seconds") or 0),
            "after_actual_seconds": int(new_actual),
            "before_accepted": bool(parent.get("accepted")),
            "before_status": parent.get("activity_status"),
            "retained_non_aptem_seconds": non_aptem,
            "retained_aptem_seconds": retained_aptem,
            "target_source_ids": sorted(target_set),
        })
    source_plan = []
    for row in rows:
        for sid in row.get("source_ids") or []:
            src = source_by_id[int(sid)]
            source_plan.append({
                "source_id": int(sid), "evidence_id": int(row["evidence_id"]), "aptem_id": int(row["aptem_id"]),
                "learner": row.get("learner"), "status": row.get("status"),
                "before_actual_raw": src.get("actual_seconds"),
                "before_actual_seconds": int(src.get("actual_seconds") or 0),
                "before_accepted_raw": src.get("accepted"),
                "before_accepted": bool(src.get("accepted")), "before_activity_status": src.get("activity_status"),
                "parent_id": int(src.get("canonical_progress_id") or 0),
            })
    held_rows = [{
        "evidence_id": int(row["evidence_id"]), "aptem_id": int(row["aptem_id"]), "learner": row.get("learner"),
        "status": row.get("status"), "reason": row.get("reason"), "resolution": row.get("resolution"),
        "spent_minutes": int(row.get("spent_minutes") or 0), "evidence_date": row.get("evidence_date") or evidence_day(evidence[int(row["evidence_id"])] .get("evidence_at")),
        "source_ids": [int(x) for x in row.get("source_ids") or []], "parent_ids": [int(x) for x in row.get("parent_ids") or []],
    } for row in rows]
    plan = {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "scope": report.get("scope"), "held_statuses": sorted(HELD), "held_evidence": held_rows,
        "source_plan": source_plan, "parent_changes": parent_changes, "missing_parent_ids": missing_parent_ids,
        "sources_to_zero": len(source_plan), "parents_to_recalculate": len(parent_changes),
        "ambiguous_or_no_local_row": sum(not row["source_ids"] for row in held_rows),
        "source_seconds_to_exclude": sum(int(row["before_actual_seconds"]) for row in source_plan),
        "run_kind": RUN_KIND,
    }
    plan["fingerprint"] = digest(plan)
    return plan


def apply(cur, plan: dict[str, Any], actor: str) -> dict[str, Any]:
    run_key = f"{RUN_KIND}:{plan['fingerprint']}"
    existing = cur.execute('SELECT id,status FROM "Learner".activity_sync_runs WHERE run_key=%s', [run_key]).fetchone()
    if existing and existing["status"] == "completed":
        raise ValueError(f"This exact soft-exclude plan was already completed as run {existing['id']}.")
    run_id = insert_run(cur, {
        "run_key": run_key, "run_kind": RUN_KIND,
        "source_counts": Jsonb({"actor": actor, "scope": plan["scope"], "held_evidence_ids": [r["evidence_id"] for r in plan["held_evidence"]], "source_ids": [r["source_id"] for r in plan["source_plan"]], "lms_excluded": 0, "apt_mirror_changed": False, "azure_changed": False}),
        "result_counts": Jsonb({}), "prompt_version": "ADDITIONAL_HOURS_RECONCILIATION_PROMPT.md:femi-held-soft-exclude-v1",
    })
    for source in plan["source_plan"]:
        cur.execute('''UPDATE "Learner".learner_activity_sources
            SET actual_seconds=0,accepted=false,completed=false,activity_status='Excluded',actual_basis=%s,
                source_payload=coalesce(source_payload,'{}'::jsonb) || %s,sync_run_id=%s,last_seen_at=now()
            WHERE id=%s AND deleted_at IS NULL AND actual_seconds IS NOT DISTINCT FROM %s
              AND accepted IS NOT DISTINCT FROM %s''', [BASIS, Jsonb({"reconciliation": {"resolution": "held_evidence_soft_excluded", "evidence_id": source["evidence_id"], "status": source["status"], "reason": source["status"], "actor": actor, "run_id": run_id, "original_actual_seconds": source["before_actual_seconds"]}}), run_id, source["source_id"], source["before_actual_raw"], source["before_accepted_raw"]])
        if cur.rowcount != 1:
            raise ValueError(f"Source {source['source_id']} changed during apply.")
    for change in plan["parent_changes"]:
        after = int(change["after_actual_seconds"])
        accepted = after > 0
        status = "Accepted" if accepted else "Excluded"
        parent_payload = {"reconciliation": {"resolution": "held_evidence_parent_recalculated", "excluded_source_ids": change["target_source_ids"], "retained_non_aptem_seconds": change["retained_non_aptem_seconds"], "retained_aptem_seconds": change["retained_aptem_seconds"], "actor": actor, "run_id": run_id, "original_actual_seconds": change["before_actual_seconds"]}}
        cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=%s,accepted=%s,activity_status=%s,actual_basis=%s,
            source_payload=coalesce(source_payload,'{}'::jsonb) || %s,sync_run_id=%s,ssot_updated_at=now()
            WHERE id=%s AND deleted_at IS NULL AND actual_seconds=%s AND accepted=%s''', [after, accepted, status, BASIS, Jsonb(parent_payload), run_id, change["parent_id"], change["before_actual_seconds"], change["before_accepted"]])
        if cur.rowcount != 1:
            raise ValueError(f"Parent {change['parent_id']} changed during apply.")
    result = {
        "read_only": False, "status": "COMPLETED", "run_id": run_id, "actor": actor,
        "held_evidence_count": len(plan["held_evidence"]), "sources_soft_excluded": len(plan["source_plan"]),
        "parents_recalculated": len(plan["parent_changes"]), "source_seconds_excluded": plan["source_seconds_to_exclude"],
        "source_hours_excluded": fmt(plan["source_seconds_to_exclude"]), "lms_excluded": 0,
        "apt_mirror_changed": False, "azure_changed": False, "ambiguous_without_local_row": plan["ambiguous_or_no_local_row"],
    }
    cur.execute('UPDATE "Learner".activity_sync_runs SET status=\'completed\',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', [Jsonb(result), run_id])
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", default=str(DEFAULT_RESULT))
    parser.add_argument("--actor", default=ACTOR_DEFAULT)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    with psycopg.connect(base.database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=120000")
            cur.execute("SET LOCAL lock_timeout=10000")
            report, rows = load_held_report()
            plan = build_plan(cur, report, rows)
            result = {"read_only": not args.apply, "database": plan["database"], "fingerprint": plan["fingerprint"], "plan": plan, "status": "DRY_RUN", "actor": args.actor}
            if args.apply:
                if args.expected_database != plan["database"] or args.expected_fingerprint != plan["fingerprint"]:
                    raise ValueError("Database or soft-exclude fingerprint changed; regenerate the dry-run.")
                result = {"database": plan["database"], "fingerprint": plan["fingerprint"], **apply(cur, plan, args.actor)}
                conn.commit()
    Path(args.result).write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
