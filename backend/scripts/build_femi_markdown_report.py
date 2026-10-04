"""Create a human-readable, read-only Markdown report from the Femi dry run."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "reports" / "femi_commercial_intelligence_dryrun.json"
OUTPUT = ROOT / "reports" / "femi_commercial_intelligence_report.md"


def h(seconds: int) -> str:
    seconds = int(seconds or 0)
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def esc(value: object) -> str:
    return str(value if value is not None else "—").replace("|", "\\|").replace("\n", " ")


def main() -> int:
    report = json.loads(INPUT.read_text(encoding="utf-8"))
    learners = report["learners"]
    candidates = report["candidates"]
    by_aid: dict[int, list[dict]] = {}
    for row in candidates:
        by_aid.setdefault(int(row["aptem_id"]), []).append(row)

    lines = [
        "# Femi Commercial Intelligence — Additional Hours Report",
        "",
        "**Mode:** Read-only Dry Run — no database write or soft delete performed  ",
        f"**Database:** `{report.get('database')}`  ",
        "**Coach:** Femi Falodun  ",
        "**Scope:** G1 Wednesday, G2 Thursday, G3 Friday; 47 roster entries / 46 unique learners  ",
        "**Azure:** 534/534 referenced blobs exist; evidence review artifact contains hashes/metadata only  ",
        "",
        "## Group summary",
        "",
        "| Group | Students | Additional Accepted | Before | New candidate | Parent repair | Expected after | Decision |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for group, data in report["groups"].items():
        lines.append(
            f"| {esc(group)} | {data['requested_roster_count']} | {data['additional_valid']} | "
            f"{data['ssot_before']} | {data['new_candidate']} | {data['parent_repair_candidate']} | "
            f"{data['expected_after']} | REVIEW/BLOCKED |"
        )
    lines += [
        "",
        "> Helena Davies appears in G1 and G3. The global unique-learner totals count her once.",
        "",
        "## Learner detail",
        "",
    ]
    for group, data in report["groups"].items():
        lines += [f"### {group}", "", "| Aptem ID | Learner | Additional accepted | Before | New | Parent repair | Expected after | Review |", "|---:|---|---:|---:|---:|---:|---:|---|"]
        members = [row for row in learners if group in row.get("target_groups", [])]
        for row in sorted(members, key=lambda item: item["learner"].casefold()):
            rows = by_aid.get(int(row["aptem_id"]), [])
            counts = {"NEW_LEGITIMATE": 0, "ALREADY_REPRESENTED": 0, "PARENT_NEEDS_ACTUAL_REPAIR": 0, "DURATION_CONFLICT": 0, "AMBIGUOUS": 0, "BLOCKED": 0}
            for candidate in rows:
                counts[candidate.get("status")] = counts.get(candidate.get("status"), 0) + 1
            review = []
            if counts["NEW_LEGITIMATE"]:
                review.append(f"new {counts['NEW_LEGITIMATE']}")
            if counts["PARENT_NEEDS_ACTUAL_REPAIR"]:
                review.append(f"parent {counts['PARENT_NEEDS_ACTUAL_REPAIR']}")
            if counts["DURATION_CONFLICT"]:
                review.append(f"conflict {counts['DURATION_CONFLICT']}")
            if counts["AMBIGUOUS"]:
                review.append(f"ambiguous {counts['AMBIGUOUS']}")
            if counts["BLOCKED"] or row.get("additional_excluded"):
                review.append("BLOCKED")
            if not review:
                review.append("represented")
            lines.append(
                f"| {row['aptem_id']} | {esc(row['learner'])} | {row['additional_accepted_valid']} | "
                f"{row['ssot_accepted_before']} | {h(row['additional_new_candidate_seconds'])} | "
                f"{h(row['parent_repair_candidate_seconds'])} | {row['expected_after_if_approved']} | "
                f"{esc(', '.join(review))} |"
            )
        lines.append("")

    lines += [
        "## Global decision ledger",
        "",
        f"- Additional Accepted valid: **{report['summary']['additional_valid']}**",
        f"- Current learner-wide accepted SSOT: **{report['summary']['ssot_before']}**",
        f"- New candidate additions: **{report['summary']['new_candidate']}** across 88 Evidence",
        f"- Existing Parent repairs: **{report['summary']['parent_repair_candidate']}** across 35 Evidence; these do not create a second Activity",
        "- Already represented: **120 Evidence**; no additional hours should be added",
        "- Duration conflicts: **20 Evidence** — hold for manual decision",
        "- Ambiguous: **26 Evidence** — hold for component/date/duration matching",
        "- Blocked: **3 Evidence** across Abbie Ridgway and Abikaye Mehat",
        "- Proposed LMS soft deletes: **0**",
        "",
        "## Blocked items",
        "",
        "- **Abbie Ridgway (18518):** two Evidence rows (23:00:00) point to missing canonical Parents.",
        "- **Abikaye Mehat (6740):** Evidence 29557 (6:00:00) has no authoritative End Date; no date was invented.",
        "- The current target module IDs have no matching legacy ledger rows; current Before totals are learner-wide comparison totals, not proof of module-only totals.",
        "",
        "## Approval gate",
        "",
        "Write is still pending explicit approval of the exact 88 additions and 35 Parent repairs. Conflicts, ambiguous rows, blocked rows, and all soft deletes remain untouched.",
        "",
        "Full machine-readable details are in `femi_commercial_intelligence_write_review.json` and `femi_commercial_intelligence_evidence_review.json`.",
        "",
    ]
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
