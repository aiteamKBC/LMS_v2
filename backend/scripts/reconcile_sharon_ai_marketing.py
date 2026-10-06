"""Read-only Sharon AI in Marketing Additional Hours inventory/dry-run.

This wrapper reuses the guarded Additional-only reconciler.  It deliberately
does not classify LMS Activity or Assignment evidence as Additional Hours, and
the default invocation is read-only.  Apply remains protected by the base
reconciler's database/fingerprint gate and is not run by this task.
"""
from __future__ import annotations

import sys
from copy import copy
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reconcile_additional_hours_social_media as base


base.GROUPS = {
    "G1-Sharon Ai in Marketing Tuesday": {
        "group_id": "GROUP-202609211450104210840E55F05D542A",
        "module_id": "MOD-202609211343157699387AACDDCD8A5B",
        "coach": "Aryan Harikumar",
        "tutor": "Sharon Shields",
        "aptem_ids": [
            4002, 4336, 4365, 4445, 4490, 4521, 4526, 4626,
            4783, 4841, 4886, 4937, 4947, 4988, 5170,
        ],
    },
    "G2-Sharon Ai in Marketing Wednesday": {
        "group_id": "GROUP-202609210905110684506B246BDED88E",
        "module_id": "MOD-20260921085233798880517CB0D243D0",
        "coach": "Omar Elshafey",
        "tutor": "Sharon Shields",
        "aptem_ids": [4342, 4443, 4579, 4605, 4660, 4925, 5053],
    },
    "G3-Sharon Ai in Marketing Friday": {
        "group_id": "GROUP-2026092114510315918150BCE8C38FD8",
        "module_id": "MOD-20260921085217095815146F2085A499",
        "coach": "Aryan Harikumar",
        "tutor": "Sharon Shields",
        # Resolved from the target module roster; the user supplied L01-L15
        # labels, so the report preserves both the canonical names and IDs.
        "aptem_ids": [
            4110, 4124, 4256, 4275, 4311, 4316, 4317, 4513,
            4737, 4778, 4830, 4929, 5167, 5256, 5323,
        ],
    },
}

base.ALL_APTEM_IDS = sorted({aid for group in base.GROUPS.values() for aid in group["aptem_ids"]})
base.GROUPS_BY_LEARNER = defaultdict(list)
for _group_name, _group in base.GROUPS.items():
    for _aid in _group["aptem_ids"]:
        base.GROUPS_BY_LEARNER[_aid].append(_group_name)

base.RUN_KIND = "sharon-ai-marketing-additional-only-v1"
base.PROMPT_VERSION = "additional-hours-reconciliation-prompt-v1"


# The shared reconciler intentionally raises on missing/duplicate lineage.  A
# dry-run needs to inventory the safe rows as well, so quarantine only those
# exact evidence IDs as blockers and let the original planner process the rest.
_original_build_plan = base.build_plan


def _safe_build_plan(state):
    progress_by_id = {int(row["id"]): row for row in state["progress"]}
    owner_by_id = {int(owner["id"]): int(aid) for aid, owner in state["owners"].items()}
    source_by_evidence = defaultdict(list)
    for source in state["sources"]:
        if source.get("source_system") != "aptem":
            continue
        evidence_id = base.evidence_id_from_source(source)
        owner_aptem = owner_by_id.get(int(source["learner_id"]))
        if evidence_id is not None and owner_aptem is not None:
            source_by_evidence[(owner_aptem, evidence_id)].append(source)

    blocked_ids = set()
    blocked = []
    for row in state["evidence"]:
        if not base.is_additional_component(row.get("component_name")):
            continue
        okay, reason = base.accepted_evidence_day_valid(row, state)
        if not okay:
            continue
        aid = int(row["learner_id"])
        eid = int(row["evidence_id"])
        sources = source_by_evidence[(aid, eid)]
        if len(sources) != 1:
            blocked_ids.add(eid)
            blocked.append({"evidence_id": eid, "aptem_id": aid,
                            "reason": "active_aptem_source_count_not_one",
                            "source_count": len(sources)})
            continue
        source = sources[0]
        parent_id = source.get("canonical_progress_id")
        parent = progress_by_id.get(int(parent_id)) if parent_id else None
        if not parent_id or not parent or parent.get("deleted_at") or parent.get("source_system") != "aptem":
            blocked_ids.add(eid)
            blocked.append({"evidence_id": eid, "aptem_id": aid,
                            "reason": "missing_or_non_aptem_canonical_parent",
                            "source_id": int(source["id"]),
                            "parent_id": parent_id})

    if blocked_ids:
        safe_state = dict(state)
        safe_state["evidence"] = [row for row in state["evidence"] if int(row["evidence_id"]) not in blocked_ids]
    else:
        safe_state = state
    report = _original_build_plan(safe_state)
    report.setdefault("blocked", []).extend(blocked)
    report["blocked"] = sorted(report["blocked"], key=lambda row: (int(row.get("aptem_id") or 0), int(row.get("evidence_id") or 0)))
    report["decision"] = "REVIEW" if report["blocked"] or report.get("decision") != "READY" else "READY"
    report["ready"] = report["decision"] == "READY"
    return report


base.build_plan = _safe_build_plan


if __name__ == "__main__":
    base.main()
