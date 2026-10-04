"""Build the approval-gate artifact from the Femi read-only dry run."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "reports" / "femi_commercial_intelligence_dryrun.json"
OUTPUT = ROOT / "reports" / "femi_commercial_intelligence_write_review.json"


def main() -> int:
    report = json.loads(INPUT.read_text(encoding="utf-8"))
    learners = {int(row["aptem_id"]): row for row in report.get("learners", [])}
    candidates = report.get("candidates", [])

    def base_row(row: dict) -> dict:
        learner = learners.get(int(row["aptem_id"]), {})
        return {
            "aptem_id": int(row["aptem_id"]),
            "learner": row.get("learner"),
            "target_groups": learner.get("target_groups", []),
            "evidence_id": int(row["evidence_id"]),
            "source_ref": f"evidence:{int(row['evidence_id'])}",
            "spent_minutes": int(row.get("spent_minutes") or 0),
            "evidence_date": row.get("evidence_date"),
            "component_id": row.get("component_id"),
            "azure_file_present": bool(row.get("file_blob_present")),
            "azure_report_present": bool(row.get("report_blob_present")),
            "evidence_read_status": "see femi_commercial_intelligence_evidence_review.json",
        }

    add_rows = []
    repair_rows = []
    represented_rows = []
    conflict_rows = []
    ambiguous_rows = []
    blocked_rows = []
    for row in candidates:
        status = row.get("status")
        item = base_row(row)
        if status == "NEW_LEGITIMATE":
            item["proposed_segments"] = row.get("proposed_segments", [])
            item["allocation_status"] = row.get("allocation_status")
            add_rows.append(item)
        elif status == "PARENT_NEEDS_ACTUAL_REPAIR":
            item.update({
                "source_ids": row.get("source_ids", []),
                "parent_ids": row.get("parent_ids", []),
                "source_actual_seconds": row.get("source_actual_seconds", []),
                "parent_actual_seconds": row.get("parent_actual_seconds"),
                "action": "UPDATE_EXISTING_PARENT_NO_NEW_ACTIVITY",
            })
            repair_rows.append(item)
        elif status == "ALREADY_REPRESENTED":
            item.update({"source_ids": row.get("source_ids", []), "parent_ids": row.get("parent_ids", []), "action": row.get("resolution")})
            represented_rows.append(item)
        elif status == "DURATION_CONFLICT":
            item.update({
                "source_ids": row.get("source_ids", []),
                "parent_ids": row.get("parent_ids", []),
                "source_actual_seconds": row.get("source_actual_seconds", []),
                "parent_actual_seconds": row.get("parent_actual_seconds"),
                "action": "DO_NOT_ADD_UNTIL_DURATION_REVIEW",
            })
            conflict_rows.append(item)
        elif status == "AMBIGUOUS":
            item.update({"action": "MATCH_COMPONENT_DATE_DURATION_BEFORE_ADD", "reason": row.get("reason")})
            ambiguous_rows.append(item)
        elif status == "BLOCKED":
            item.update({"action": row.get("resolution"), "reason": row.get("reason"), "source_ids": row.get("source_ids", []), "parent_ids": row.get("parent_ids", [])})
            blocked_rows.append(item)

    # The separate excluded list contains the missing Start/End blocker, which
    # is not in candidates because it cannot pass the date gate.
    for row in report.get("blocked", []):
        if not any(int(existing.get("evidence_id")) == int(row.get("evidence_id")) for existing in blocked_rows):
            learner = learners.get(int(row["aptem_id"]), {})
            blocked_rows.append({
                "aptem_id": int(row["aptem_id"]),
                "learner": row.get("learner"),
                "target_groups": learner.get("target_groups", []),
                "evidence_id": int(row["evidence_id"]),
                "spent_minutes": int(row.get("spent_minutes") or 0),
                "evidence_date": row.get("evidence_date"),
                "action": row.get("resolution"),
                "reason": row.get("reason"),
            })

    output = {
        "read_only": True,
        "write_performed": False,
        "database": report.get("database"),
        "scope": report.get("scope"),
        "approval_required": True,
        "proposed_add_rows": add_rows,
        "proposed_parent_repairs": repair_rows,
        "already_represented_keep": represented_rows,
        "duration_conflicts_hold": conflict_rows,
        "ambiguous_hold": ambiguous_rows,
        "blocked_hold": blocked_rows,
        "proposed_lms_soft_deletes": [],
        "notes": [
            "No LMS Activity row is proposed for soft delete until a source/evidence duplicate is explicitly confirmed.",
            "Parent repairs update existing lineage; they do not create a second Activity.",
            "Current SSOT-before is learner-wide because many legacy rows have null/unrelated module_ref; target module membership was not inferred or changed.",
            "Azure is linked by Evidence ID through the existing fetch-aptem-evidences/document endpoint; no new blob upload is proposed.",
        ],
    }
    canonical = json.dumps(output, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    output["fingerprint"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps({
        "output": str(OUTPUT),
        "fingerprint": output["fingerprint"],
        "add_rows": len(add_rows),
        "parent_repairs": len(repair_rows),
        "already_represented": len(represented_rows),
        "duration_conflicts": len(conflict_rows),
        "ambiguous": len(ambiguous_rows),
        "blocked": len(blocked_rows),
        "soft_deletes": 0,
        "write_performed": False,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
