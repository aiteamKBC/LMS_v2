"""READ-ONLY: which active learners cannot generate Curriculum Reviews.

Review recurrence anchors strictly to the learner's own
enrolment."Created_users"."Start_date" (see
coach_api.views.resolve_review_anchor_date). A learner with no enrolment row,
or one whose Start_date is blank or unparseable, generates no Reviews at all --
deliberately, rather than silently inheriting their cohort's date from the
"Learner"."learners" profile mirror.

This command lists exactly those learners so the data can be corrected. It
writes NOTHING: no learner date is touched, no cohort date is touched, no
Review instance is created.

    python manage.py audit_review_anchor_dates
    python manage.py audit_review_anchor_dates --format csv > review-anchors.csv
    python manage.py audit_review_anchor_dates --all          # every active learner
    python manage.py audit_review_anchor_dates --coach a@b.com
"""
import csv
import sys
from datetime import datetime

from django.core.management.base import BaseCommand

from coach_api.views import (
    REVIEW_ANCHOR_INVALID_START,
    REVIEW_ANCHOR_MISSING_ROW,
    REVIEW_ANCHOR_MISSING_START,
    clean_text,
    fetch_source_schedule_rows,
    normalize_email,
    parse_date_value,
    resolve_curriculum_programme_id,
    resolve_review_anchor_date,
)
from learner_api.models import LearnerProfile

COLUMNS = [
    "learner_id",
    "learner_name",
    "learner_email",
    "programme",
    "cohort",
    "created_users_match",
    "created_users_start_date",
    "profile_start_date",
    "reason",
]

REASON_HELP = {
    REVIEW_ANCHOR_MISSING_ROW: 'no enrolment."Created_users" row matches this profile email',
    REVIEW_ANCHOR_MISSING_START: 'Created_users row found, but "Start_date" is null or blank',
    REVIEW_ANCHOR_INVALID_START: 'Created_users."Start_date" is present but not a parseable date',
}


class Command(BaseCommand):
    help = "Read-only audit of active learners who cannot generate Curriculum Reviews."

    def add_arguments(self, parser):
        parser.add_argument(
            "--format", choices=["table", "csv"], default="table",
            help="Output format (default: table).",
        )
        parser.add_argument(
            "--all", action="store_true",
            help="Include learners who CAN generate Reviews (reason column is blank for those).",
        )
        parser.add_argument(
            "--coach", default="",
            help="Limit to one coach's caseload, by coach_email.",
        )

    def handle(self, *args, **options):
        profiles = list(
            LearnerProfile.objects.filter(lifecycle_status="active")
            .only(
                "id", "full_name", "email", "programme", "cohort",
                "coach_email", "start_date", "lifecycle_status",
            )
            .order_by("id")
        )
        coach = normalize_email(options["coach"])
        if coach:
            profiles = [p for p in profiles if normalize_email(getattr(p, "coach_email", "")) == coach]

        commercial_rows, enrolment_rows = fetch_source_schedule_rows(profiles)

        rows = []
        for profile in profiles:
            source_row = commercial_rows.get(profile.id) or enrolment_rows.get(profile.id)
            anchor, reason = resolve_review_anchor_date(profile.id, commercial_rows, enrolment_rows)
            if anchor is not None and not options["all"]:
                continue
            rows.append({
                "learner_id": profile.id,
                "learner_name": clean_text(profile.full_name),
                "learner_email": clean_text(profile.email),
                "programme": clean_text(profile.programme),
                "cohort": clean_text(profile.cohort),
                "created_users_match": "yes" if source_row is not None else "no",
                # The raw column value, unparsed -- this audit exists to show
                # what is actually stored, including the unparseable ones.
                "created_users_start_date": clean_text(getattr(source_row, "start_date", "")) if source_row else "",
                "profile_start_date": profile.start_date.isoformat() if profile.start_date else "",
                "reason": reason or "",
            })

        if options["format"] == "csv":
            writer = csv.DictWriter(sys.stdout, fieldnames=COLUMNS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
            return

        self._print_table(rows, profiles, options)

    def _print_table(self, rows, profiles, options):
        blocked = [row for row in rows if row["reason"]]
        self.stdout.write(self.style.MIGRATE_HEADING("Review anchor audit (read-only; nothing was changed)"))
        self.stdout.write(f"  active learners scanned : {len(profiles)}")
        self.stdout.write(f"  cannot generate Reviews : {len(blocked)}")
        by_reason = {}
        for row in blocked:
            by_reason[row["reason"]] = by_reason.get(row["reason"], 0) + 1
        for reason, count in sorted(by_reason.items()):
            self.stdout.write(f"    {reason:<28} {count:>4}   ({REASON_HELP.get(reason, '')})")
        if not rows:
            self.stdout.write(self.style.SUCCESS("\n  Every active learner has a usable Created_users.Start_date."))
            return

        widths = {column: max(len(column), *(len(str(row[column])) for row in rows)) for column in COLUMNS}
        self.stdout.write("")
        self.stdout.write("  " + "  ".join(column.ljust(widths[column]) for column in COLUMNS))
        self.stdout.write("  " + "  ".join("-" * widths[column] for column in COLUMNS))
        for row in rows:
            line = "  " + "  ".join(str(row[column]).ljust(widths[column]) for column in COLUMNS)
            self.stdout.write(self.style.WARNING(line) if row["reason"] else line)
        self.stdout.write("")
        self.stdout.write(
            "  Fix by correcting enrolment.\"Created_users\".\"Start_date\" for these learners. "
            "This command never writes; no learner or cohort date has been changed."
        )
