"""Apply the reviewed Martech Additional Hours dry-run plan.

This wrapper reuses the project's audited Additional Hours writer, but applies
the stricter Martech gate: blocked learners, invalid-date evidence, and any
parent containing invalid-date evidence are held back.  No LMS row is deleted
or excluded and the Aptem mirror remains read-only.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import apply_femi_commercial_intelligence_write as impl  # noqa: E402


REPORT = SCRIPT_DIR.parent / "reports" / "martech_dryrun_2026-10-04.json"
RESULT = SCRIPT_DIR.parent / "reports" / "martech_write_result_2026-10-04.json"
BLOCKED_APTEM_IDS = {6004, 7165}  # Darcey: missing dates; Leanne: invalid capacity


def filtered_load_report(path: Path):
    report = json.loads(path.read_text(encoding="utf-8"))
    if not report.get("read_only") or report.get("write_performed"):
        raise ValueError("The input report is not a read-only dry run.")

    invalid_evidence_ids = {
        int(item["evidence_id"])
        for learner in report.get("learners", [])
        for item in learner.get("timestamp_violations", [])
    }

    # A parent may contain multiple evidence lines.  If one line is held for
    # an invalid date (or the learner is blocked), hold the whole parent.
    blocked_parent_ids: set[int] = set()
    for item in report.get("candidates", []):
        if item.get("status") != "PARENT_NEEDS_ACTUAL_REPAIR":
            continue
        if int(item["aptem_id"]) in BLOCKED_APTEM_IDS or int(item["evidence_id"]) in invalid_evidence_ids:
            blocked_parent_ids.update(int(pid) for pid in item.get("parent_ids", []))

    new_rows: dict[int, dict] = {}
    repair_rows: dict[int, dict] = {}
    held: list[dict] = []
    for item in report.get("candidates", []):
        aid = int(item["aptem_id"])
        eid = int(item["evidence_id"])
        status = item.get("status")
        if aid in BLOCKED_APTEM_IDS or eid in invalid_evidence_ids:
            held.append({"evidence_id": eid, "aptem_id": aid, "reason": "blocked_scope_or_timestamp"})
            continue
        if status == "NEW_LEGITIMATE":
            if item.get("allocation_status") != "READY":
                held.append({"evidence_id": eid, "aptem_id": aid, "reason": "blocked_allocation"})
                continue
            new_rows[eid] = item
        elif status == "PARENT_NEEDS_ACTUAL_REPAIR":
            if any(int(pid) in blocked_parent_ids for pid in item.get("parent_ids", [])):
                held.append({"evidence_id": eid, "aptem_id": aid, "reason": "parent_contains_held_evidence"})
                continue
            repair_rows[eid] = item

    plan = {
        "database": report.get("database"),
        "report_scope": report.get("scope"),
        "new_evidence_ids": sorted(new_rows),
        "repair_evidence_ids": sorted(repair_rows),
        "held_evidence": held,
        "blocked_parent_ids": sorted(blocked_parent_ids),
        "lms_excluded": 0,
    }
    return report, list(new_rows.values()), list(repair_rows.values()), impl.digest(plan)


def main() -> int:
    impl.load_report = filtered_load_report
    impl.DEFAULT_REPORT = REPORT
    impl.DEFAULT_RESULT = RESULT
    impl.RUN_KIND = "martech-additional-hours-v1"
    impl.PROMPT_VERSION = "ADDITIONAL_HOURS_RECONCILIATION_PROMPT.md:martech-safe-write-v1"
    # Keep the wrapper's CLI identical to the established audited writer.
    return impl.main()


if __name__ == "__main__":
    raise SystemExit(main())
