"""Read-only reconciliation for Ray–MSP Jan 2026 and the supplied SK roster.

This wrapper deliberately reuses the project's read-only Additional Hours
engine.  It adds the two report-specific Aptem comparison rules and quality
gates needed for this review.  It never opens a write transaction.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path
import json
import sys

import psycopg
from psycopg.rows import dict_row

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402
import reconcile_femi_commercial_intelligence_dryrun as engine  # noqa: E402


RAY_IDS = [
    6254, 6310, 6329, 6425, 6436, 6473, 6498, 6524, 6536, 6563,
    6703, 6732, 6753, 7217, 7495, 7796, 8162, 8170, 8580, 8635,
    8903, 9314, 9862, 9866, 9918, 10071,
]
RAY_NAMES = [
    "Gulzhazira Suiessinova", "Leah Lewis", "Roy Hillson", "John O'Connor",
    "Darren Roberts", "Holly Smith", "Connor Hickey", "John Bridges",
    "Hilary Chapman", "Georgina Grace", "Claire Watkins", "Mark Jackson",
    "Ahmad Reshad Walizada", "Paige Hodgson", "Rebecca Edwards", "Ali Arshad",
    "Maxine Budd", "Barry Harwell", "Karin Jones", "Nathan Hogan",
    "Agnes Becsei", "Sunday Onuh", "Olha Miniailenko", "Colin Pepper",
    "Timothy White", "Emily Whyte",
]
SK_IDS = [
    1767, 1770, 2030, 2800, 14610, 2199, 1763, 1122, 1786, 1757,
    92, 1769, 1696, 1698, 2170, 471, 2429, 1761, 1411, 3404,
    87, 382, 1565, 1564, 1039, 1212, 1426, 1230, 1119, 1281,
    1900, 3117, 1504, 1759, 1456, 2144, 2324, 1424,
]
SK_NAMES = [
    "Akmal Khan", "Alice Wilkinson", "Amy-Marie Field", "Ashleigh Alden",
    "Ashley Nunes", "Israel Odumesi", "Jamie Fox", "Josef Firestone",
    "Liam McGuire", "Melissa Clennell", "Mohamed Elmasry", "Natalja Garkaja",
    "Nick Barnwell", "Prakhar Singhal", "Russell Merry", "Shabbir Molai",
    "Stephen Burns", "Stephen Gutteridge", "Barry McLaughlin", "Lauren Jewitt",
    "Steven A'Hara", "Safaa Mohamed", "Harley Fullager", "Robert Bawden",
    "Benjamin Simmonds", "Bethany Grover", "Daniel Jones", "Jake Meadwell",
    "Jamie Scott", "Josh Bunyan", "Kayleigh Hill", "Komal Akhtar",
    "Lisa Bardrick", "Lukasz Skarlak", "Marson Kwan", "Monty Douglass",
    "Simon Fennell", "Theppana Mahanuthasan",
]

TARGET_GROUPS = {
    "Ray – MSP Jan 2026": {
        "group_id": "APTEM-GROUP-4d0bf743cf6d8e9a5cb60a44d25c34b0",
        "module_id": None,
        "coach": "Patryk Zajac",
        "names": RAY_NAMES,
    },
    "SK Management (supplied roster)": {
        "group_id": None,
        "module_id": None,
        "coach": None,
        "names": SK_NAMES,
    },
}


def fmt(seconds: int) -> str:
    sign = "-" if int(seconds) < 0 else ""
    value = abs(int(seconds))
    hours, rem = divmod(value, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{sign}{hours}:{minutes:02d}:{secs:02d}"


def norm(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


def scope_ids(label: str) -> list[int]:
    return RAY_IDS if label == "Ray – MSP Jan 2026" else SK_IDS


def comparison_inventory(cur, group_name: str, ids: list[int]) -> dict:
    """Return the exact comparison totals without exposing evidence text."""
    rows = cur.execute(
        '''SELECT evidence_id,learner_id,evidence_status,spent_time,hours_type,
                  spent_time_type,evidence_name,component_name,note_content
             FROM fetching_evidence.evidence_items
            WHERE learner_id=ANY(%s) AND evidence_status='Accepted' AND spent_time>0''',
        [ids],
    ).fetchall()
    by_aid: dict[int, dict] = defaultdict(lambda: {
        "raw_seconds": 0,
        "paid_seconds": 0,
        "hours_verified_seconds": 0,
        "accepted_rows": 0,
        "paid_rows": 0,
        "additional_rows_all": 0,
        "additional_rows_paid": 0,
        "additional_not_paid": 0,
    })
    for row in rows:
        aid = int(row["learner_id"])
        seconds = int(row["spent_time"]) * 60
        item = by_aid[aid]
        item["raw_seconds"] += seconds
        item["accepted_rows"] += 1
        text = norm(" ".join(str(row.get(k) or "") for k in ("evidence_name", "component_name", "note_content")))
        if "hours verified" in text:
            item["hours_verified_seconds"] += seconds
        is_paid = row.get("hours_type") == "OffTheJobTraining" and row.get("spent_time_type") == "PaidWorkingHours"
        if is_paid:
            item["paid_seconds"] += seconds
            item["paid_rows"] += 1
        is_additional = bool(base.is_additional_component(row.get("component_name")))
        if is_additional:
            item["additional_rows_all"] += 1
            if is_paid:
                item["additional_rows_paid"] += 1
            else:
                item["additional_not_paid"] += 1
    owners = cur.execute(
        '''SELECT id,aptem_id,full_name,group_id,group_name,programme_id,programme
             FROM "Learner".learners WHERE aptem_id=ANY(%s)''', [ids]
    ).fetchall()
    owner_by_aid = {int(r["aptem_id"]): r for r in owners}
    progress = cur.execute(
        '''SELECT learner_id,coalesce(sum(actual_seconds) FILTER (WHERE deleted_at IS NULL AND accepted),0) seconds
             FROM "Learner".learner_progress_entries
            WHERE learner_id=ANY(%s) GROUP BY learner_id''',
        [[r["id"] for r in owners]],
    ).fetchall()
    ssot_by_aid = {
        int(owner_by_aid[next(a for a, r in owner_by_aid.items() if int(r["id"]) == int(row["learner_id"]))]["aptem_id"]): int(row["seconds"] or 0)
        for row in progress
    }
    result_rows = []
    for aid in ids:
        item = by_aid[aid]
        owner = owner_by_aid.get(aid, {})
        # Ray's supplied table is paid OJT minus "hours verified".  SK's
        # supplied table is the raw accepted Aptem total with no exclusion.
        if group_name.startswith("Ray"):
            comparison = item["paid_seconds"] - item["hours_verified_seconds"]
            comparison_rule = "paid OJT accepted minus evidence text containing 'hours verified'"
        else:
            comparison = item["raw_seconds"]
            comparison_rule = "all accepted Aptem evidence with spent_time > 0"
        ssot = ssot_by_aid.get(aid, 0)
        result_rows.append({
            "aptem_id": aid,
            "learner": owner.get("full_name"),
            "raw_accepted_seconds": item["raw_seconds"],
            "paid_accepted_seconds": item["paid_seconds"],
            "comparison_seconds": comparison,
            "ssot_accepted_seconds": ssot,
            "difference_seconds": ssot - comparison,
            "accepted_rows": item["accepted_rows"],
            "paid_rows": item["paid_rows"],
            "hours_verified_seconds": item["hours_verified_seconds"],
            "additional_rows_all": item["additional_rows_all"],
            "additional_rows_paid": item["additional_rows_paid"],
            "additional_not_paid": item["additional_not_paid"],
            "canonical_group_id": owner.get("group_id"),
            "canonical_group_name": owner.get("group_name"),
            "canonical_programme_id": owner.get("programme_id"),
            "comparison_rule": comparison_rule,
        })
    return {
        "rows": result_rows,
        "totals": {
            "raw_accepted_seconds": sum(r["raw_accepted_seconds"] for r in result_rows),
            "paid_accepted_seconds": sum(r["paid_accepted_seconds"] for r in result_rows),
            "comparison_seconds": sum(r["comparison_seconds"] for r in result_rows),
            "ssot_accepted_seconds": sum(r["ssot_accepted_seconds"] for r in result_rows),
            "difference_seconds": sum(r["difference_seconds"] for r in result_rows),
            "hours_verified_seconds": sum(r["hours_verified_seconds"] for r in result_rows),
            "additional_rows_all": sum(r["additional_rows_all"] for r in result_rows),
            "additional_rows_paid": sum(r["additional_rows_paid"] for r in result_rows),
            "additional_not_paid": sum(r["additional_not_paid"] for r in result_rows),
        },
    }


def duplicate_gate(cur, ids: list[int]) -> dict:
    owners = cur.execute('SELECT id,aptem_id FROM "Learner".learners WHERE aptem_id=ANY(%s)', [ids]).fetchall()
    owner_ids = [r["id"] for r in owners]
    rows = cur.execute(
        '''SELECT s.id,s.learner_id,l.aptem_id,l.full_name,s.source_system,s.source_activity_id,
                  s.actual_seconds,s.canonical_progress_id
             FROM "Learner".learner_activity_sources s
             JOIN "Learner".learners l ON l.id=s.learner_id
            WHERE s.learner_id=ANY(%s) AND s.deleted_at IS NULL
              AND s.source_activity_id IS NOT NULL
            ORDER BY l.aptem_id,s.source_activity_id,s.id''', [owner_ids]
    ).fetchall()
    grouped: dict[tuple, list] = defaultdict(list)
    for row in rows:
        grouped[(int(row["learner_id"]), row["source_system"], row["source_activity_id"])].append(row)
    duplicates = []
    for values in grouped.values():
        if len(values) > 1:
            duplicates.append({
                "aptem_id": int(values[0]["aptem_id"]),
                "learner": values[0]["full_name"],
                "source_system": values[0]["source_system"],
                "source_activity_id": values[0]["source_activity_id"],
                "rows": [{"id": int(v["id"]), "parent_id": v["canonical_progress_id"], "actual_seconds": int(v["actual_seconds"] or 0)} for v in values],
            })
    multi_parent = cur.execute(
        '''SELECT s.source_activity_id,l.aptem_id,l.full_name,count(*) source_count,
                  count(DISTINCT s.canonical_progress_id) parent_count
             FROM "Learner".learner_activity_sources s
             JOIN "Learner".learners l ON l.id=s.learner_id
            WHERE s.learner_id=ANY(%s) AND s.deleted_at IS NULL
              AND s.source_system='aptem' AND s.source_activity_id LIKE 'evidence:%%'
            GROUP BY s.source_activity_id,l.aptem_id,l.full_name
           HAVING count(*)>1 OR count(DISTINCT s.canonical_progress_id)>1''', [owner_ids]
    ).fetchall()
    return {
        "active_source_rows": len(rows),
        "duplicate_source_keys": len(duplicates),
        "duplicates": duplicates,
        "multi_parent_evidence_keys": [dict(r) for r in multi_parent],
        "gate_pass": not duplicates and not multi_parent,
    }


def augment(output: Path) -> dict:
    report = json.loads(output.read_text(encoding="utf-8"))
    all_quality = {}
    with psycopg.connect(base.database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            for group_name in TARGET_GROUPS:
                ids = scope_ids(group_name)
                comparison = comparison_inventory(cur, group_name, ids)
                duplicates = duplicate_gate(cur, ids)
                all_quality[group_name] = {
                    "comparison": comparison,
                    "duplicate_gate": duplicates,
                    "arithmetic_gate": all(
                        row["difference_seconds"] == row["ssot_accepted_seconds"] - row["comparison_seconds"]
                        for row in comparison["rows"]
                    ),
                }
    # The Ray roster contains two database learners with the same display
    # name (Mark Jackson).  The reusable name-resolving engine is therefore
    # run for SK only; Ray is added from its explicit Aptem-ID roster and its
    # independent read-only comparison/duplicate gates above.  This avoids
    # ever selecting the out-of-scope Mark Jackson row by name.
    ray_group = TARGET_GROUPS["Ray – MSP Jan 2026"]
    report.setdefault("groups", {})["Ray – MSP Jan 2026"] = {
        "group_id": ray_group["group_id"],
        "module_id": None,
        "coach": ray_group["coach"],
        "requested_roster_count": len(RAY_IDS),
        "unique_aptem_learners": len(RAY_IDS),
    }
    ray_rows = all_quality["Ray – MSP Jan 2026"]["comparison"]["rows"]
    report.setdefault("learners", [])
    existing = {int(row.get("aptem_id")) for row in report["learners"] if row.get("aptem_id") is not None}
    for row in ray_rows:
        if int(row["aptem_id"]) in existing:
            continue
        report["learners"].append({
            "aptem_id": row["aptem_id"],
            "learner": row.get("learner"),
            "target_groups": ["Ray – MSP Jan 2026"],
            "canonical_group_id": row.get("canonical_group_id"),
            "canonical_group_name": row.get("canonical_group_name"),
            "additional_accepted_valid_count": 0,
            "additional_accepted_valid_seconds": 0,
            "additional_accepted_valid": "0:00:00",
            "candidates": [],
            "counts": {"already_represented": 0, "new_legitimate": 0, "duration_conflict": 0, "ambiguous": 0, "blocked": 0},
            "ssot_accepted_before_seconds": row["ssot_accepted_seconds"],
            "ssot_accepted_before": fmt(row["ssot_accepted_seconds"]),
            "additional_new_candidate_seconds": 0,
            "expected_after_if_approved_seconds": row["ssot_accepted_seconds"],
            "expected_after_if_approved": fmt(row["ssot_accepted_seconds"]),
            "timestamp_violations": [],
            "decision": "REVIEW" if row["difference_seconds"] else "READY",
        })
    report["scope"] = {
        "groups": list(TARGET_GROUPS),
        "ray_aptem_ids": RAY_IDS,
        "sk_aptem_ids": SK_IDS,
        "target_months": "ALL",
        "note": "Both rosters are explicit. Ray is ID-scoped because Mark Jackson is duplicated by name in the database; SK is not asserted to a canonical group.",
    }
    report["comparison_inventory"] = all_quality
    report["quality_gates"] = {
        "active_source_identity_unique": all(v["duplicate_gate"]["gate_pass"] for v in all_quality.values()),
        "comparison_arithmetic_reconciles": all(v["arithmetic_gate"] for v in all_quality.values()),
        "write_performed": False,
        "no_lms_rows_selected_for_exclusion": True,
        "no_aptem_mirror_changed": True,
        "note": "A positive/negative difference is a comparison result, not permission to add or exclude hours. Exact evidence identity and duration must pass before any write.",
    }
    report["quality_gates"]["critical_checks_pass"] = (
        report["quality_gates"]["active_source_identity_unique"]
        and report["quality_gates"]["comparison_arithmetic_reconciles"]
    )
    report["decision"] = "BLOCKED" if not report["quality_gates"]["critical_checks_pass"] else report.get("decision", "REVIEW")

    # Narrow, decision-ready view for the two explicitly requested negative
    # cases.  This does not infer a write for Robert merely because his
    # learner-level decision has no Additional candidate.
    focus_ids = {382, 1564}
    focus_rows = []
    for group_info in all_quality.values():
        for row in group_info["comparison"]["rows"]:
            if int(row["aptem_id"]) not in focus_ids:
                continue
            learner = next((item for item in report.get("learners", []) if int(item.get("aptem_id", -1)) == int(row["aptem_id"])), {})
            candidates = learner.get("candidates", [])
            excluded = learner.get("additional_excluded", [])
            if int(row["aptem_id"]) == 382:
                decision = "BLOCKED"
                reason = "Accepted Additional Evidence 14645 is note-only, has no file/report blob, and its 2025-11-12 date is outside the current learner period (start 2026-08-17; end missing)."
            else:
                decision = "BLOCKED"
                reason = "No Accepted Additional job activity Evidence exists for this learner; the -05:25:00 gap has no eligible source to add and no exact duplicate to exclude."
            focus_rows.append({
                "aptem_id": row["aptem_id"],
                "learner": row.get("learner"),
                "comparison_seconds": row["comparison_seconds"],
                "ssot_seconds": row["ssot_accepted_seconds"],
                "difference_seconds": row["difference_seconds"],
                "additional_candidates": candidates,
                "additional_excluded": excluded,
                "active_duplicate_source_keys": group_info["duplicate_gate"]["duplicate_source_keys"],
                "decision": decision,
                "reason": reason,
                "proposed_write": None,
            })
    report["focus_negative_cases"] = sorted(focus_rows, key=lambda item: int(item["aptem_id"]))
    output.write_text(json.dumps(report, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def write_markdown(report: dict, path: Path) -> None:
    lines = [
        "# Ray–MSP Jan 2026 + SK Management — Additional Hours Reconciliation Dry Run",
        "",
        "- **Mode:** Read-only; no database, Aptem mirror, Azure, LMS Activity, or Assignment write was performed.",
        "- **Purpose:** Verify exact source identity, Additional Evidence eligibility, Azure references, and comparison arithmetic before any approval gate.",
        "- **Database:** `" + str(report.get("database")) + "` (connection details intentionally omitted).",
        "",
    ]
    q = report.get("quality_gates", {})
    lines += [
        "## Quality gates",
        "",
        f"- Active source identities unique: **{'PASS' if q.get('active_source_identity_unique') else 'FAIL'}**",
        f"- Comparison arithmetic reconciles: **{'PASS' if q.get('comparison_arithmetic_reconciles') else 'FAIL'}**",
        "- Write performed: **NO**",
        "",
    ]
    lines += ["## Explicit negative cases", "", "| Aptem ID | Learner | Aptem comparison | SSOT | Difference | Decision |", "|---:|---|---:|---:|---:|---|"]
    for item in report.get("focus_negative_cases", []):
        lines.append(f"| {item['aptem_id']} | {item.get('learner') or ''} | {fmt(item['comparison_seconds'])} | {fmt(item['ssot_seconds'])} | {fmt(item['difference_seconds'])} | {item['decision']} |")
        lines.append(f"  - Reason: {item['reason']}")
    lines.append("")
    for group_name, info in report.get("comparison_inventory", {}).items():
        comp = info["comparison"]
        totals = comp["totals"]
        lines += [f"## {group_name}", ""]
        group = report.get("groups", {}).get(group_name, {})
        lines += [
            f"- Coach: {group.get('coach') or 'Not supplied'}",
            f"- Roster: {len(comp['rows'])} learners",
            f"- Canonical group mapping: {'present' if group.get('group_id') else 'not asserted; supplied roster only'}",
            f"- Aptem raw accepted: **{fmt(totals['raw_accepted_seconds'])}**",
            f"- Aptem comparison basis: **{fmt(totals['comparison_seconds'])}**",
            f"- SSOT accepted: **{fmt(totals['ssot_accepted_seconds'])}**",
            f"- Difference (SSOT − comparison): **{fmt(totals['difference_seconds'])}**",
            f"- Additional Evidence rows: {totals['additional_rows_all']} total; {totals['additional_rows_paid']} paid/OJT; {totals['additional_not_paid']} outside paid/OJT filter",
            f"- Exact active duplicate source keys: {info['duplicate_gate']['duplicate_source_keys']}",
            "",
            "| Aptem ID | Learner | Aptem comparison | SSOT | Difference | Additional rows | Decision |",
            "|---:|---|---:|---:|---:|---:|---|",
        ]
        learner_map = {int(r["aptem_id"]): r for r in report.get("learners", [])}
        for row in comp["rows"]:
            learner = learner_map.get(int(row["aptem_id"]), {})
            counts = learner.get("counts", {})
            decision = learner.get("decision", "REVIEW")
            lines.append(
                f"| {row['aptem_id']} | {row.get('learner') or ''} | {fmt(row['comparison_seconds'])} | {fmt(row['ssot_accepted_seconds'])} | {fmt(row['difference_seconds'])} | {row['additional_rows_all']} | {decision} |"
            )
        lines += [
            f"| **Total** | **{len(comp['rows'])}** | **{fmt(totals['comparison_seconds'])}** | **{fmt(totals['ssot_accepted_seconds'])}** | **{fmt(totals['difference_seconds'])}** | **{totals['additional_rows_all']}** | — |",
            "",
        ]
        if info["duplicate_gate"]["duplicates"]:
            lines += ["### Duplicate source keys", ""]
            for dup in info["duplicate_gate"]["duplicates"]:
                lines.append(f"- `{dup['source_activity_id']}` — {dup['learner']} — rows {', '.join(str(v['id']) for v in dup['rows'])}")
            lines.append("")
        else:
            lines += ["### Duplicate source keys", "", "None found among active source rows.", ""]
    lines += [
        "## Decision and approval gate",
        "",
        "- The two supplied scopes are not silently merged. SK Management is reported as an explicit roster because current learner group fields are mixed or missing.",
        "- No LMS Activity or Assignment row is selected for exclusion by this dry run.",
        "- No Additional row is auto-added from a name/date/amount similarity. Candidate rows with missing exact lineage, duration conflicts, missing period, or missing Azure file remain `REVIEW`/`BLOCKED`.",
        "- Before a write, approve the exact learner/evidence rows and any source-row soft exclusions shown in the JSON report.",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    default_json = Path(__file__).resolve().parents[1] / "reports" / "ray_sk_management_reconciliation_dryrun_2026-10-04.json"
    default_md = Path(__file__).resolve().parents[1] / "reports" / "ray_sk_management_reconciliation_dryrun_2026-10-04.md"
    parser.add_argument("--output", default=str(default_json))
    parser.add_argument("--markdown", default=str(default_md))
    args = parser.parse_args()

    # Patch only the imported read-only engine's in-memory target roster.
    # Run the reusable engine for both rosters except the one duplicated
    # display-name row.  Mark Jackson has Aptem ID 6732 in-scope and a second
    # database learner with the same name is out-of-scope; the comparison and
    # duplicate gates remain ID-scoped for the full 26-person Ray roster.
    ray_engine_names = [name for name, aid in zip(RAY_NAMES, RAY_IDS) if aid != 6732]
    engine.TARGET_GROUPS = {
        "Ray – MSP Jan 2026": {**TARGET_GROUPS["Ray – MSP Jan 2026"], "names": ray_engine_names},
        "SK Management (supplied roster)": TARGET_GROUPS["SK Management (supplied roster)"],
    }
    engine.norm_name = norm
    engine.sys.argv = [engine.__file__, "--output", args.output]
    rc = engine.main()
    if rc not in (0, 2):
        return rc
    output = Path(args.output)
    if not output.exists():
        return rc
    report = augment(output)
    write_markdown(report, Path(args.markdown))
    print(json.dumps({
        "read_only": True,
        "output": str(output),
        "markdown": str(args.markdown),
        "decision": report.get("decision"),
        "quality_gates": report.get("quality_gates"),
    }, ensure_ascii=False, indent=2))
    return 0 if report.get("quality_gates", {}).get("active_source_identity_unique") else 2


if __name__ == "__main__":
    raise SystemExit(main())
