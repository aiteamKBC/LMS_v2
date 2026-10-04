"""Guarded Additional Hours reconciler for Keith Customer Journey groups.

The default invocation is read-only.  ``--apply`` is protected by the
reviewed database name and plan fingerprint, and only creates/repairs the
independent Aptem Additional Hours lineage.  It does not classify or create
LMS Activity/Assignment rows and never edits the Aptem mirror.
"""
from __future__ import annotations

import sys
import os
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reconcile_additional_hours_social_media as base  # noqa: E402


base.GROUPS = {
    "G1-Keith Customer Journey Optimisation": {
        "group_id": "GROUP-20260928143455519285CEBAAAED556C",
        "module_id": "MOD-20260911124647037289",
        "coach": "Omar Badr",
        "tutor": "Keith Rowland",
        "aptem_ids": [
            15791, 10624, 14880, 15751, 15951, 16749, 15433,
            15073, 15489, 16549, 15588, 17753, 16474,
        ],
    },
    "G2-Keith Customer Journey Optimisation": {
        "group_id": "GROUP-20260930135400889703823E0C35DCAE",
        "module_id": "MOD-202609301354380952694569FE544702",
        "coach": "Omar Badr",
        "tutor": "Keith Rowland",
        "aptem_ids": [
            17705, 19694, 18616, 6409, 18716, 17825, 16476,
            17930, 17952, 16482, 17417, 18705, 16477, 17254,
        ],
    },
}

base.ALL_APTEM_IDS = sorted({aid for group in base.GROUPS.values() for aid in group["aptem_ids"]})
base.GROUPS_BY_LEARNER = defaultdict(list)
for _group_name, _group in base.GROUPS.items():
    for _aid in _group["aptem_ids"]:
        base.GROUPS_BY_LEARNER[_aid].append(_group_name)

base.RUN_KIND = "keith-customer-journey-additional-only-v1"
base.PROMPT_VERSION = "additional-hours-reconciliation-prompt-v1"

# A reviewed write may narrow this wrapper to an explicitly approved set of
# Evidence IDs.  This keeps blocked/review rows in the inventory while making
# the approved transaction learner-scoped and idempotent.
_approved_raw = os.environ.get("KEITH_APPROVED_EVIDENCE_IDS", "").strip()
APPROVED_EVIDENCE_IDS = {
    int(value.strip())
    for value in _approved_raw.split(",")
    if value.strip().isdigit()
}


# The shared planner normally stops on a missing/duplicate Aptem lineage.  A
# dry-run must still report all other learners, so quarantine only those exact
# evidence IDs and expose them as blockers in the report.
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
        okay, _reason = base.accepted_evidence_day_valid(row, state)
        if not okay:
            continue
        aid = int(row["learner_id"])
        eid = int(row["evidence_id"])
        sources = source_by_evidence[(aid, eid)]
        if len(sources) != 1:
            blocked_ids.add(eid)
            blocked.append({
                "evidence_id": eid,
                "aptem_id": aid,
                "reason": "active_aptem_source_count_not_one",
                "source_count": len(sources),
            })
            continue
        source = sources[0]
        parent_id = source.get("canonical_progress_id")
        parent = progress_by_id.get(int(parent_id)) if parent_id else None
        if not parent_id or not parent or parent.get("deleted_at") or parent.get("source_system") != "aptem":
            blocked_ids.add(eid)
            blocked.append({
                "evidence_id": eid,
                "aptem_id": aid,
                "reason": "missing_or_non_aptem_canonical_parent",
                "source_id": int(source["id"]),
                "parent_id": parent_id,
            })

    safe_state = dict(state)
    safe_evidence = list(state["evidence"])
    if blocked_ids:
        safe_evidence = [row for row in safe_evidence if int(row["evidence_id"]) not in blocked_ids]
    if APPROVED_EVIDENCE_IDS:
        safe_evidence = [row for row in safe_evidence if int(row["evidence_id"]) in APPROVED_EVIDENCE_IDS]
    safe_state["evidence"] = safe_evidence
    report = _original_build_plan(safe_state)
    if APPROVED_EVIDENCE_IDS:
        blocked = [
            item for item in blocked
            if int(item.get("evidence_id") or 0) in APPROVED_EVIDENCE_IDS
        ]
    report.setdefault("blocked", []).extend(blocked)
    report["blocked"] = sorted(
        report["blocked"],
        key=lambda row: (int(row.get("aptem_id") or 0), int(row.get("evidence_id") or 0)),
    )
    report["decision"] = "REVIEW" if report["blocked"] or report.get("decision") != "READY" else "READY"
    report["ready"] = report["decision"] == "READY"
    return report


base.build_plan = _safe_build_plan


if __name__ == "__main__":
    base.main()
