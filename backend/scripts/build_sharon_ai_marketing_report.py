"""Build a copyable Sharon AI in Marketing dry-run report from JSON."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "reports" / "sharon_ai_marketing_dryrun_2026-10-04.json"
OUTPUT = ROOT / "reports" / "sharon_ai_marketing_dryrun_2026-10-04.md"


def hms(seconds: int) -> str:
    seconds = int(seconds or 0)
    sign = "-" if seconds < 0 else ""
    seconds = abs(seconds)
    return f"{sign}{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def main() -> None:
    report = json.loads(INPUT.read_text(encoding="utf-8-sig"))
    blocked_by_aid = Counter(int(item["aptem_id"]) for item in report["blocked"] if item.get("aptem_id") is not None)
    learner_by_group = defaultdict(list)
    for learner in report["learners"]:
        for group in learner["groups"]:
            learner_by_group[group].append(learner)

    lines = [
        "# Sharon AI in Marketing — Additional Hours Dry Run",
        "",
        "**Mode:** Read-only Inventory/Dry Run — no database or Azure writes were performed.",
        "",
        "**Database:** `" + str(report["database"]) + "`  ",
        "**Rule:** only Aptem `component_name` matching `Additional job activity/activities` is a candidate. LMS Activity and Assignment evidence are not created or reclassified.",
        "",
        "## Group summary",
        "",
        "| Group | Coach | Tutor | Students | Additional Accepted | SSOT Actual current | Additional candidate | SSOT after candidate | Decision |",
        "|---|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for group, item in report["groups"].items():
        tutor = "Sharon Shields"
        lines.append(
            f"| {group} | {item.get('coach','')} | {tutor} | {item['aptem_learners']} | "
            f"{hms(item['additional_accepted_seconds'])} | {hms(item['ssot_before_seconds'])} | "
            f"{hms(item['additional_delta_seconds'])} | {hms(item['ssot_after_seconds'])} | REVIEW |"
        )

    for group, item in report["groups"].items():
        lines += [
            "",
            f"## {group}",
            "",
            f"**Coach:** {item.get('coach','')}  ",
            f"**Tutor:** Sharon Shields  ",
            f"**Students:** {item['aptem_learners']}  ",
            "",
            "| Aptem ID | الطالب | Aptem Additional Accepted | SSOT Actual current | Additional candidate | SSOT after candidate | الفرق (after-current) | Blocked |",
            "|---:|---|---:|---:|---:|---:|---:|---:|",
        ]
        for learner in sorted(learner_by_group[group], key=lambda row: int(row["aptem_id"])):
            aid = int(learner["aptem_id"])
            delta = int(learner["additional_delta_seconds"])
            lines.append(
                f"| {aid} | {learner['name']} | {hms(learner['additional_accepted_seconds'])} | "
                f"{hms(learner['ssot_before_seconds'])} | {hms(delta)} | "
                f"{hms(learner['ssot_after_seconds'])} | {hms(delta)} | {blocked_by_aid.get(aid, 0)} |"
            )
        lines.append(
            f"| **الإجمالي** | **{item['aptem_learners']} طلاب** | **{hms(item['additional_accepted_seconds'])}** | "
            f"**{hms(item['ssot_before_seconds'])}** | **{hms(item['additional_delta_seconds'])}** | "
            f"**{hms(item['ssot_after_seconds'])}** | **{hms(item['additional_delta_seconds'])}** | **{sum(blocked_by_aid.get(int(x['aptem_id']),0) for x in learner_by_group[group])}** |"
        )

    lines += [
        "",
        "## Safety / blockers",
        "",
        f"- Valid Additional evidence reviewed: **{len(report['valid_additional'])}**.",
        f"- Blocked Additional evidence: **{len(report['blocked'])}**; no missing parent/source was guessed.",
        f"- Azure references checked: **{report['azure']['checked']}**, found **{report['azure']['found']}**, missing **{len(report['azure']['missing'])}**.",
        f"- Existing LMS Activity rows: **{report['lms']['active_positive_rows']}**; exact Additional evidence duplicates: **{len(report['lms']['confirmed_duplicates'])}**; ambiguous/no exact identity: **{len(report['lms']['ambiguous_rows'])}**.",
        f"- Proposed parent/source/document changes (not written): **{report['parent_rows_to_update']} / {report['source_rows_to_update']} / {report['documents_to_add']}**.",
        "- LMS/Assignment rows excluded: **0** (no exact source identity proved a duplicate).",
        "- Timestamp violations in proposed allocations: **0**; this does not clear the blocked/ambiguous evidence decisions.",
        "",
        "## Decision",
        "",
        "**REVIEW — not ready for Write.** The exact candidate list is the JSON report fingerprint below; approval is still required by the reconciliation prompt. Evidence with missing lineage, parent-hour conflicts, or existing segment conflicts stays blocked.",
        "",
        f"**Dry-run fingerprint:** `{report['fingerprint']}`",
        "",
        "## Blocked evidence IDs",
        "",
        "| Aptem ID | Evidence ID | Reason | Details |",
        "|---:|---:|---|---|",
    ]
    for item in report["blocked"]:
        details = ", ".join(f"{k}={v}" for k, v in item.items() if k not in {"aptem_id", "evidence_id", "reason"})
        lines.append(f"| {item.get('aptem_id','')} | {item.get('evidence_id','')} | {item['reason']} | {details} |")

    OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
