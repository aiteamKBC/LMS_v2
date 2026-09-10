"""Bring the active learners from the audit snapshot into enrolment.

``Last_audit.learners`` is a synced snapshot of the live Aptem/LMS caseload. This
copies the **active** learners out of it into ``enrolment."Created_users"``, which
is the table the platform's own directory, learner pages and coach queues are
built on.

Which learners
--------------
Only ``programme_status = 'Active'``. The snapshot also holds withdrawn,
completed, on-break, entered-EPA and onboarding records; importing those would
put people into the platform who are not currently being taught.

Which programme
---------------
The snapshot's ``programme_name`` is a cohort-flavoured title -- "Marketing
Manager Level 6 - Feb 2026", "NEW Level 6 Project Controls Professional PCP
July 25", "Oct 2025 Level 4 Marketing Executive" -- with 21 variants across the
active rows alone. The platform needs the *programme* those belong to, of which
there are four authored in the curriculum, so each title is matched to one by
the qualification it names rather than by string equality.

Matched on the qualification, in a deliberate order: "project control"/"PCP"
before anything else, because a few PCP titles also carry a level that would
otherwise collide, and "associate project manager" before "project", since the
two share a word but are different programmes. A title that matches nothing is
reported and skipped -- filing somebody under a programme they are not on is
worse than leaving them out.

Idempotent: matched on email, so a learner already in ``Created_users`` is
updated rather than duplicated, and re-running imports only what is new.

    python manage.py import_audit_learners
    python manage.py import_audit_learners --apply
"""
from django.core.management.base import BaseCommand
from django.db import DatabaseError, connections, transaction

#: The audit status that means "currently being taught".
ACTIVE_STATUS = "Active"

#: Curriculum programme each snapshot title maps to, keyed by the phrase that
#: identifies the qualification. Order matters and is asserted by the tests:
#: "associate project manager" has to be tried before "project control" would
#: ever see it, and both before any bare level match.
PROGRAMME_RULES = (
    (("associate project manager",), "Associate Project Manager Level 4"),
    (("project control", "pcp"), "Project Controls Professional Level 6"),
    (("marketing manager",), "Marketing Manager Level 6"),
    # "Market research executive" is the Level 4 marketing qualification under
    # its older name, so it belongs with Marketing Executive.
    (("marketing executive", "market research executive"), "Marketing Executive Level 4"),
)

#: What an imported learner looks like, matching a natively-created row.
#: 'commercial' rather than 'apprenticeship': these carry no apprenticeship
#: compliance documents in the snapshot, and the commercial progression rule
#: (plan + start date) is the one that applies to them.
IMPORT_DEFAULTS = {
    "Status": "FullUser",
    "Type": "User",
    "Learner_type": "commercial",
    "Programme_status": "Active",
    # Entitled to a platform account; the invitation email is a separate,
    # deliberate step from the Accounts page.
    "Invite_to_platform": True,
}


def _s(value):
    return str(value or "").strip()


def target_programme(programme_name):
    """The curriculum programme a snapshot title belongs to, or ''.

    Case- and format-insensitive: the snapshot writes the same qualification as
    "Level 4 Marketing Executive", "Marketing Executive Level 4 - Feb 2026" and
    "Oct 2025 Level 4 Marketing Executive", so the level and the date are
    ignored and only the qualification is matched.
    """
    name = _s(programme_name).lower()
    if not name:
        return ""
    for needles, programme in PROGRAMME_RULES:
        if any(needle in name for needle in needles):
            return programme
    return ""


class Command(BaseCommand):
    help = "Import active learners from Last_audit.learners into enrolment.Created_users."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Write the changes. Without it, the command only reports what it would do.",
        )

    def _snapshot_rows(self):
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                """
                select learner_name, learner_email, lms_learner_name,
                       programme_name, coach_name, coach_email, planned_hours_total,
                       aptem_id
                  from "Last_audit".learners
                 where programme_status = %s
                   and coalesce(btrim(learner_email), '') <> ''
                 order by learner_email
                """,
                [ACTIVE_STATUS],
            )
            columns = [c[0] for c in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]

    def _known_programmes(self):
        """The authored programme names, so a mapping cannot point at nothing."""
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "select name from curriculum.programmes "
                "where coalesce(is_archived, false) = false"
            )
            return {_s(row[0]) for row in cur.fetchall() if _s(row[0])}

    def _existing_emails(self):
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'select lower(btrim("Email")), id from enrolment."Created_users" '
                'where coalesce(btrim("Email"), \'\') <> \'\''
            )
            return {row[0]: row[1] for row in cur.fetchall()}

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))

        try:
            rows = self._snapshot_rows()
            known = self._known_programmes()
            existing = self._existing_emails()
        except DatabaseError as exc:
            self.stderr.write(self.style.ERROR(f"Could not read the snapshot: {exc}"))
            return

        self.stdout.write(f"Active learners in the snapshot: {len(rows)}")

        planned, skipped, missing_programme = [], [], {}
        for row in rows:
            programme = target_programme(row["programme_name"])
            if not programme:
                skipped.append((row["learner_email"], row["programme_name"]))
                continue
            if programme not in known:
                # The rule points at a programme nobody has authored yet. Held
                # back rather than written, so the learner is not filed against
                # a name the curriculum does not recognise.
                missing_programme.setdefault(programme, []).append(row["learner_email"])
                continue
            planned.append((row, programme))

        from collections import Counter
        by_programme = Counter(programme for _row, programme in planned)
        self.stdout.write("  mapped:")
        for programme, count in sorted(by_programme.items()):
            self.stdout.write(f"    {programme:<44} {count}")

        updates = sum(
            1 for row, _p in planned
            if _s(row["learner_email"]).lower() in existing
        )
        self.stdout.write(
            f"  to create: {len(planned) - updates}   to update (already present): {updates}"
        )

        if missing_programme:
            self.stdout.write(self.style.WARNING(
                "  held back — these programmes are not in the curriculum:"
            ))
            for programme, emails in missing_programme.items():
                self.stdout.write(f"    {programme}: {len(emails)}")

        if skipped:
            self.stdout.write(self.style.WARNING(
                f"  skipped — no programme could be matched: {len(skipped)}"
            ))
            for email, name in skipped[:10]:
                self.stdout.write(f"    {email} — {name!r}")

        if not apply_changes:
            self.stdout.write(self.style.WARNING("\nDry run — nothing written. Re-run with --apply."))
            return

        created = updated = 0
        # Written through the ORM rather than raw SQL: the underlying column for
        # `status` is literally " Status", with a leading space, and hard-coding
        # that quirk here would be a second place for it to be wrong. The model
        # already carries the mapping.
        from learner_api.models import EnrolmentUser

        try:
            with transaction.atomic(using="enrolment"):
                with connections["enrolment"].cursor() as cur:
                    cur.execute("SET TRANSACTION READ WRITE")
                for row, programme in planned:
                    email = _s(row["learner_email"])
                    name = (
                        _s(row["learner_name"])
                        or _s(row["lms_learner_name"])
                        or email.split("@")[0]
                    )
                    hours = row["planned_hours_total"]
                    # Stored as text on Created_users; the snapshot holds it as
                    # a bigint, so it is stringified rather than relying on an
                    # implicit cast.
                    aptem_id = _s(row["aptem_id"]) or None
                    key = email.lower()
                    if key in existing:
                        # Present already: correct the programme, name and
                        # planned hours rather than inserting a second row for
                        # the same person. Status is left alone — somebody may
                        # have been moved on deliberately since the snapshot.
                        EnrolmentUser.all_learners.filter(pk=existing[key]).update(
                            username=name, programme=programme, planned_hours=hours,
                            aptem_id=aptem_id,
                        )
                        updated += 1
                        continue
                    EnrolmentUser.objects.create(
                        username=name,
                        email=email,
                        programme=programme,
                        planned_hours=hours,
                        # The Aptem record this learner came from, so the
                        # platform row can be traced back to the source system.
                        aptem_id=aptem_id,
                        status=IMPORT_DEFAULTS["Status"],
                        type=IMPORT_DEFAULTS["Type"],
                        learner_type=IMPORT_DEFAULTS["Learner_type"],
                        programme_status=IMPORT_DEFAULTS["Programme_status"],
                        invite_to_platform=IMPORT_DEFAULTS["Invite_to_platform"],
                    )
                    created += 1
        except DatabaseError as exc:
            self.stderr.write(self.style.ERROR(f"Import failed and was rolled back: {exc}"))
            return

        self.stdout.write(self.style.SUCCESS(
            f"\nCreated {created} learner(s), updated {updated}."
        ))
        self.stdout.write(
            "Invitations were not sent: these accounts are provisioned on demand "
            "from the user directory or the Accounts page."
        )
