"""Apply the reviewed, previously unrepresented Sophie evidence as estimated hours.

This wrapper reuses the guarded Sharon reconciliation writer but narrows it to
three documents whose contents were read and whose activities do not have a
Journal/source lineage match.  Reporting dates are deliberately estimated
within the evidence's month/date order; the rows stay labelled as requiring
approval and never replace Journal history.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_sharon_remaining_evidence as impl


LABEL = "\u062a\u0642\u062f\u064a\u0631\u064a \u2014 \u064a\u062d\u062a\u0627\u062c \u0627\u0639\u062a\u0645\u0627د"

# Sophie Graham (Aptem 4365); all three parents/sources are intentionally new.
impl.PLAN = [
    (4365, None, [46439]),
    (4365, None, [53571]),
    (4365, None, [55552]),
]

# Totals match the read documents exactly: 25h + 28h + 30h = 83h.
# The writer's allocator moves blocks to the nearest weekday with remaining
# capacity after existing Journal usage, preserving the sequence and daily cap.
impl.SCHEDULES = {
    46439: [
        ("2026-06-11", 4 * 3600),
        ("2026-06-24", 8 * 3600),
        ("2026-06-26", 11 * 3600),
        ("2026-06-29", 2 * 3600),
    ],
    53571: [
        ("2026-06-29", 4 * 3600),
        ("2026-07-07", 4 * 3600),
        ("2026-07-14", 4 * 3600),
        ("2026-07-21", 8 * 3600),
        ("2026-08-10", 8 * 3600),
    ],
    55552: [
        ("2026-08-13", 6 * 3600),
        ("2026-08-20", 6 * 3600),
        ("2026-08-04", 2 * 3600),
        ("2026-08-11", 2 * 3600),
        ("2026-08-18", 2 * 3600),
        ("2026-08-25", 2 * 3600),
        ("2026-08-26", 2 * 3600),
        ("2026-08-27", 4 * 3600),
        ("2026-08-28", 4 * 3600),
    ],
}

impl.RUN_KIND = "sharon-estimated-sophie-additional-evidence-v1"
impl.LABEL = LABEL
impl.base.LABEL = LABEL

if __name__ == "__main__":
    impl.main()
