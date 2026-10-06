"""Build the compact Aptem-vs-SSOT comparison requested by the user."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "reports" / "femi_commercial_intelligence_dryrun.json"
OUTPUT = ROOT / "reports" / "femi_commercial_intelligence_comparison.md"


def fmt(seconds: int) -> str:
    seconds = int(seconds or 0)
    sign = "-" if seconds < 0 else ""
    seconds = abs(seconds)
    return f"{sign}{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def main() -> int:
    report = json.loads(INPUT.read_text(encoding="utf-8"))
    lines = [
        "# Femi Commercial Intelligence — Aptem Accepted vs SSOT Actual",
        "",
        "**Read-only Dry Run — no Write or Soft Delete was performed.**  ",
        "**Coach:** Femi Falodun  ",
        "**Scope:** 47 roster entries / 46 unique learners  ",
        "",
        "> `SSOT Actual` and `الفرق` below are the current read-only values. The proposed new hours and Parent repairs are shown separately in the detailed report.",
        "",
    ]
    for group, group_data in report["groups"].items():
        lines += [
            f"## {group}",
            "",
            f"**Coach:** Femi Falodun — **{group_data['requested_roster_count']} students**  ",
            "",
            "| Aptem ID | الطالب | Aptem Accepted | SSOT Actual | الفرق |",
            "|---:|---|---:|---:|---:|",
        ]
        members = [row for row in report["learners"] if group in row.get("target_groups", [])]
        total_a = total_s = 0
        for row in sorted(members, key=lambda item: item["learner"].casefold()):
            accepted = int(row["additional_accepted_valid_seconds"])
            actual = int(row["ssot_accepted_before_seconds"])
            total_a += accepted
            total_s += actual
            diff = actual - accepted
            diff_text = f"+{fmt(diff)}" if diff >= 0 else fmt(diff)
            lines.append(f"| {row['aptem_id']} | {row['learner']} | {fmt(accepted)} | {fmt(actual)} | {diff_text} |")
        lines += [
            f"| **الإجمالي** | **{len(members)}** | **{fmt(total_a)}** | **{fmt(total_s)}** | **+{fmt(total_s - total_a)}** |",
            "",
            f"المقترح بعد الاعتماد: **{group_data['expected_after']}** (إضافات جديدة {group_data['new_candidate']} + Parent repair {group_data['parent_repair_candidate']}).",
            "",
        ]
    lines += [
        "## ملاحظات الحالة",
        "",
        "- لا يوجد طالب مفقود من الـroster؛ Helena Davies موجودة في G1 وG3 وتُحسب مرة واحدة في الإجمالي العام.",
        "- Azure: 534/534 referenced blobs موجودة.",
        "- 120 Evidence ممثلة بالفعل، و88 جديدة مقترحة، و35 Parent repair.",
        "- Blocked: Abbie Ridgway وAbikaye Mehat. توجد أيضًا 20 Duration Conflict و26 Ambiguous.",
        "- التقرير الحالي للمقارنة Read-only؛ لا يعني أن التعديلات كُتبت في قاعدة البيانات.",
        "",
    ]
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
