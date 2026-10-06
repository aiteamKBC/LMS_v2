"""Copy Aptem non-active programme statuses onto Delivery learners.

Source: "LMS".non_active_users (owner-loaded Aptem export of non-active learners).
Match:  enrolment."Created_users".aptem_id  ==  "LMS".non_active_users."ID".

Agreed scope (2026-10-04):
- Only learners currently on 'Delivery' are changed.
- 'NonStarter' and 'EnteredEpa' are written exactly as Aptem has them.
- Aptem 'Onboarding' is NOT applied (it would send the learner back to the
  onboarding wizard); those learners are flagged for manual review instead.
- Every other matched/unmatched row is reported only.

Default: read-only preflight that writes the report. --apply updates
Programme_status only, in one transaction, re-checking the old value per row.
"""
from __future__ import annotations

import argparse
from datetime import date
import os
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ["CURRICULUM_WARM"] = "0"

from config import settings as config
import psycopg
from psycopg.rows import dict_row
from openpyxl import Workbook
from openpyxl.styles import Font

APPLY_STATUSES = {"NonStarter", "EnteredEpa"}
FROM_STATUS = "Delivery"
REPORT_STEM = BACKEND / "reports" / f"non_active_users_status_update_{date(2026, 10, 4).isoformat()}"

MATCHED_SQL = '''
    SELECT c.id AS lms_id, btrim(c.aptem_id) AS aptem_id,
           coalesce(nullif(btrim(c."Username"), ''), n."FullName") AS learner,
           c."Learner_type" AS learner_type, n."Program Name" AS aptem_programme,
           c."Programme_status" AS lms_status, n."Program-Status" AS aptem_status
    FROM "LMS".non_active_users n
    JOIN enrolment."Created_users" c
      ON btrim(c.aptem_id) ~ '^[0-9]{1,19}$' AND btrim(c.aptem_id)::numeric = n."ID"
    ORDER BY n."Program-Status", c.id
'''
UNMATCHED_SQL = '''
    SELECT n."ID"::text AS aptem_id, n."FullName" AS learner,
           n."Program Name" AS aptem_programme, n."Program-Status" AS aptem_status
    FROM "LMS".non_active_users n
    WHERE NOT EXISTS (
        SELECT 1 FROM enrolment."Created_users" c
        WHERE btrim(c.aptem_id) ~ '^[0-9]{1,19}$' AND btrim(c.aptem_id)::numeric = n."ID")
    ORDER BY n."Program-Status", n."ID"
'''


def classify(row):
    lms, aptem = (row["lms_status"] or "").strip(), (row["aptem_status"] or "").strip()
    if lms.casefold() == aptem.casefold():
        return "already_correct"
    if lms == FROM_STATUS and aptem in APPLY_STATUSES:
        return "change"
    if lms == FROM_STATUS:
        return "flagged"
    return "not_delivery"


def write_reports(groups, unmatched, applied):
    REPORT_STEM.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    sheets = [
        ("Changed" if applied else "To change", groups["change"],
         ["lms_id", "aptem_id", "learner", "learner_type", "aptem_programme", "lms_status", "aptem_status"]),
        ("Flagged - review", groups["flagged"],
         ["lms_id", "aptem_id", "learner", "learner_type", "aptem_programme", "lms_status", "aptem_status"]),
        ("Already correct", groups["already_correct"],
         ["lms_id", "aptem_id", "learner", "learner_type", "aptem_programme", "lms_status", "aptem_status"]),
        ("Matched not Delivery", groups["not_delivery"],
         ["lms_id", "aptem_id", "learner", "learner_type", "aptem_programme", "lms_status", "aptem_status"]),
        ("No LMS match", unmatched, ["aptem_id", "learner", "aptem_programme", "aptem_status"]),
    ]
    headers = {"lms_status": "lms_status_before" if applied else "lms_status"}
    wb.remove(wb.active)
    for title, rows, cols in sheets:
        ws = wb.create_sheet(title)
        ws.append([headers.get(c, c) for c in cols])
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for r in rows:
            ws.append([r[c] for c in cols])
        for i, c in enumerate(cols, 1):
            width = max([len(str(ws.cell(1, i).value))] + [len(str(r[c] or "")) for r in rows])
            ws.column_dimensions[ws.cell(1, i).column_letter].width = min(width + 2, 60)
        ws.freeze_panes = "A2"
    wb.save(f"{REPORT_STEM}.xlsx")

    def count_by(rows, key):
        out = {}
        for r in rows:
            out[r[key] or "(blank)"] = out.get(r[key] or "(blank)", 0) + 1
        return ", ".join(f"{k}: {v}" for k, v in sorted(out.items())) or "none"

    change = groups["change"]
    lines = [
        "# Aptem non-active users - Programme_status update",
        "",
        f"- Date: 2026-10-04",
        f"- Mode: {'APPLIED' if applied else 'PREFLIGHT (no writes)'}",
        '- Source: `"LMS".non_active_users` matched to `enrolment."Created_users"` on `aptem_id` = `ID`',
        "- Rule: only learners on `Delivery` whose Aptem status is `NonStarter` or `EnteredEpa` are changed,"
        " written exactly as Aptem has them. Only `Programme_status` is written.",
        f"- Full learner list: `{REPORT_STEM.name}.xlsx`",
        "",
        "## Summary",
        "",
        "| Outcome | Learners | Breakdown |",
        "| --- | ---: | --- |",
        f"| {'Changed' if applied else 'To change'} (Delivery -> Aptem status) | {len(change)} | {count_by(change, 'aptem_status')} |",
        f"| Flagged for manual review (left on Delivery) | {len(groups['flagged'])} | {count_by(groups['flagged'], 'aptem_status')} |",
        f"| Already matching Aptem | {len(groups['already_correct'])} | {count_by(groups['already_correct'], 'aptem_status')} |",
        f"| Matched, not on Delivery, differs (untouched) | {len(groups['not_delivery'])} | {count_by(groups['not_delivery'], 'aptem_status')} |",
        f"| Aptem ID not found in Created_users | {len(unmatched)} | {count_by(unmatched, 'aptem_status')} |",
        "",
        "## Changed learners (LMS id -> new status)" if applied else "## Learners to change (LMS id -> new status)",
        "",
        "| LMS id | Aptem id | Old status | New status |",
        "| ---: | ---: | --- | --- |",
        *[f"| {r['lms_id']} | {r['aptem_id']} | {r['lms_status']} | {r['aptem_status']} |" for r in change],
        "",
        "## Flagged for manual review",
        "",
        "Aptem says `Onboarding`, but moving a Delivery learner back to Onboarding redirects them to the"
        " onboarding wizard, so this was left unchanged by agreement.",
        "",
        "| LMS id | Aptem id | LMS status | Aptem status |",
        "| ---: | ---: | --- | --- |",
        *[f"| {r['lms_id']} | {r['aptem_id']} | {r['lms_status']} | {r['aptem_status']} |" for r in groups["flagged"]],
        "",
        "## Notes",
        "",
        "- `NonStarter` and `EnteredEpa` are not in `PROGRAMME_STATUS_CHOICES`; they display as-is, the"
        " learning plan becomes read-only, and they cannot be re-selected from the status dropdown.",
        "- Unmatched Aptem IDs (see the `No LMS match` sheet) have no `Created_users.aptem_id`; they were not"
        " matched by name or email.",
        "",
    ]
    Path(f"{REPORT_STEM}.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with psycopg.connect(config._enrolment_database_url, row_factory=dict_row) as conn:
        with conn.transaction():
            cur = conn.cursor()
            cur.execute(MATCHED_SQL)
            matched = cur.fetchall()
            cur.execute(UNMATCHED_SQL)
            unmatched = cur.fetchall()
            groups = {k: [] for k in ("change", "flagged", "already_correct", "not_delivery")}
            for row in matched:
                groups[classify(row)].append(row)

            if args.apply:
                for r in groups["change"]:
                    cur.execute(
                        'UPDATE enrolment."Created_users" SET "Programme_status" = %s '
                        'WHERE id = %s AND "Programme_status" = %s',
                        [r["aptem_status"], r["lms_id"], FROM_STATUS],
                    )
                    if cur.rowcount != 1:
                        raise RuntimeError(f"Row {r['lms_id']} changed since preflight; nothing written.")

    write_reports(groups, unmatched, args.apply)
    print({k: len(v) for k, v in groups.items()}, "unmatched:", len(unmatched),
          "APPLIED" if args.apply else "preflight only")
    print(f"Reports: {REPORT_STEM}.xlsx / .md")


if __name__ == "__main__":
    main()
