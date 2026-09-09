"""Assign each imported learner to their coach, from the audit snapshot.

``Last_audit.learners`` records the coach each active learner is assigned to
(``coach_name`` / ``coach_email``). Those coaches already exist as staff in
``enrolment."Staff_users"``, so this matches on the email and writes the
assignment through to the two places that need it.

Two places, because they do different jobs
------------------------------------------
``enrolment."Created_users".Coach_name/Coach_email`` is the enrolment-side
record: what the directory shows, and what survives a mirror being rebuilt.

``"Learner".learners.coach_email`` is what the coach workspace actually reads --
the caseload, the marking queue and the timetable all scope on it. Writing only
to the enrolment table would look right in the directory while every coach's
workspace stayed empty, which is the failure worth avoiding here.

Most imported learners have no mirror row yet (it is created on activation), so
one is created via ``sync_active_user`` before the coach is written. That is the
platform's own path rather than a hand-rolled insert, so the mirror carries the
same programme, cohort and delivery window a natively-activated learner gets.

Matching
--------
On the lower-cased, trimmed email. The staff table is free text, so the same
address turns up with mixed case -- "Patryk.zajac@" in the snapshot against
"patryk.zajac@" in staff. A coach the snapshot names who has no staff record is
reported and their learners left unassigned: pointing a learner at a coach who
cannot sign in would be worse than leaving the field empty for somebody to fix.

    python manage.py assign_audit_coaches
    python manage.py assign_audit_coaches --apply
    python manage.py assign_audit_coaches --apply --grant-access
"""
from django.core.management.base import BaseCommand
from django.db import DatabaseError, connections, transaction

#: The audit status that means "currently being taught".
ACTIVE_STATUS = "Active"

#: The access grant a coach needs to open their workspace. Most of these staff
#: were created with no role, so being named as somebody's coach is not by
#: itself enough to let them in -- see --grant-access.
COACH_ACCESS = "coach"


def _s(value):
    return str(value or "").strip()


class Command(BaseCommand):
    help = "Assign coaches to imported learners from the Last_audit snapshot."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Write the changes. Without it, the command only reports what it would do.",
        )
        parser.add_argument(
            "--grant-access", action="store_true",
            help=(
                "Also set Access='coach' on the matched staff, so they can open "
                "their workspace. Only touches staff who have no access yet; an "
                "existing grant is never overwritten."
            ),
        )

    # -- reads ------------------------------------------------------------

    def _assignments(self):
        """One row per active learner: their email, and their coach's."""
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                """
                select lower(btrim(a.learner_email)) as learner_email,
                       btrim(a.coach_name)           as coach_name,
                       lower(btrim(a.coach_email))   as coach_email,
                       u.id                          as enrolment_id
                  from "Last_audit".learners a
                  join enrolment."Created_users" u
                    on lower(btrim(u."Email")) = lower(btrim(a.learner_email))
                 where a.programme_status = %s
                   and coalesce(btrim(a.coach_email), '') <> ''
                 order by a.coach_email, a.learner_email
                """,
                [ACTIVE_STATUS],
            )
            columns = [c[0] for c in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]

    def _coach_staff(self):
        """Staff by lower-cased email, with the name and access they hold.

        Keyed on the normalised address because the staff table is free text and
        the snapshot's casing does not match it.
        """
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'select lower(btrim("Email")), id, "Username", "Access" '
                'from enrolment."Staff_users" '
                'where coalesce(btrim("Email"), \'\') <> \'\''
            )
            return {
                row[0]: {"id": row[1], "name": _s(row[2]), "access": _s(row[3])}
                for row in cur.fetchall()
            }

    # -- entry point ------------------------------------------------------

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        grant_access = bool(options.get("grant_access"))

        try:
            rows = self._assignments()
            staff = self._coach_staff()
        except DatabaseError as exc:
            self.stderr.write(self.style.ERROR(f"Could not read the snapshot: {exc}"))
            return

        self.stdout.write(f"Learners in the snapshot matched to an enrolment row: {len(rows)}")

        planned, unmatched = [], {}
        for row in rows:
            coach = staff.get(row["coach_email"])
            if coach is None:
                unmatched.setdefault(row["coach_email"], []).append(row["learner_email"])
                continue
            planned.append((row, coach))

        from collections import Counter
        by_coach = Counter(row["coach_email"] for row, _c in planned)
        self.stdout.write("  assignments by coach:")
        for email, count in by_coach.most_common():
            coach = staff[email]
            flag = "" if coach["access"] == COACH_ACCESS else "   (no coach access yet)"
            self.stdout.write(f"    {email:<46} {count:>4}{flag}")

        if unmatched:
            self.stdout.write(self.style.WARNING(
                "  no Staff_users record for these coaches, so their learners are "
                "left unassigned:"
            ))
            for email, learners in unmatched.items():
                self.stdout.write(f"    {email}: {len(learners)} learner(s)")

        needs_access = sorted({
            row["coach_email"] for row, coach in planned
            if coach["access"] != COACH_ACCESS
        })
        if needs_access:
            note = "will be granted" if grant_access else "run with --grant-access to fix"
            self.stdout.write(
                f"  {len(needs_access)} coach(es) cannot open a workspace yet ({note})."
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING("\nDry run -- nothing written. Re-run with --apply."))
            return

        self._write(planned, staff, needs_access if grant_access else [])

    # -- writes -----------------------------------------------------------

    def _write(self, planned, staff, grant_to):
        from learner_api.active_users import sync_active_user
        from learner_api.models import EnrolmentUser, LearnerProfile

        enrolment_updated = mirrors_created = mirrors_updated = 0
        mirror_errors = []

        try:
            with transaction.atomic(using="enrolment"):
                with connections["enrolment"].cursor() as cur:
                    cur.execute("SET TRANSACTION READ WRITE")

                for row, coach in planned:
                    # The coach's own name from Staff_users rather than the
                    # snapshot's, so the platform is self-consistent if the two
                    # ever disagree about spelling.
                    coach_name = coach["name"] or _s(row["coach_name"])
                    coach_email = row["coach_email"]

                    EnrolmentUser.all_learners.filter(pk=row["enrolment_id"]).update(
                        coach_name=coach_name,
                        coach_email=coach_email,
                        # Case_owner is the enrolment table's own long-standing
                        # field for who owns a learner, and it holds a *name*
                        # (existing rows read "Test  Coach"), not an address.
                        # Kept in step with Coach_name so the directory and the
                        # coach assignment cannot tell different stories.
                        case_owner=coach_name,
                    )
                    enrolment_updated += 1

                    # The mirror is what the coach workspace reads. Created here
                    # when absent, because these learners were imported rather
                    # than activated through the UI and so never got one.
                    profile = LearnerProfile.objects.filter(
                        enrolment_id=row["enrolment_id"]
                    ).first()
                    if profile is None:
                        source = EnrolmentUser.all_learners.filter(
                            pk=row["enrolment_id"]
                        ).first()
                        try:
                            profile = sync_active_user(source)
                            if profile is not None:
                                mirrors_created += 1
                        except DatabaseError as exc:
                            # Reported, not fatal: the enrolment record is
                            # written either way and the mirror can be retried.
                            mirror_errors.append((row["learner_email"], str(exc)))
                            continue
                    else:
                        mirrors_updated += 1

                    # Re-read rather than trusting `profile`: when the mirror
                    # was just created by sync_active_user, the local reference
                    # can be stale, and updating by its pk silently missed 367
                    # rows the first time this ran. Matching on enrolment_id
                    # writes to whatever mirror actually exists now.
                    LearnerProfile.objects.filter(
                        enrolment_id=row["enrolment_id"]
                    ).update(coach_name=coach_name, coach_email=coach_email)

                if grant_to:
                    # Only staff with no grant at all; an existing role is never
                    # overwritten by a bulk assignment.
                    with connections["enrolment"].cursor() as cur:
                        cur.execute(
                            'update enrolment."Staff_users" set "Access" = %s '
                            'where lower(btrim("Email")) = any(%s) '
                            "and coalesce(btrim(\"Access\"), '') = ''",
                            [COACH_ACCESS, list(grant_to)],
                        )
                        granted = cur.rowcount
                else:
                    granted = 0
        except DatabaseError as exc:
            self.stderr.write(self.style.ERROR(f"Assignment failed and was rolled back: {exc}"))
            return

        self.stdout.write(self.style.SUCCESS(
            f"\nAssigned {enrolment_updated} learner(s) to a coach."
        ))
        self.stdout.write(
            f"  mirrors: {mirrors_created} created, {mirrors_updated} already existed "
            f"— these are what the coach workspace reads."
        )
        if granted:
            self.stdout.write(f"  granted coach access to {granted} staff member(s).")
        if mirror_errors:
            self.stdout.write(self.style.WARNING(
                f"  {len(mirror_errors)} mirror(s) could not be created:"
            ))
            for email, reason in mirror_errors[:5]:
                self.stdout.write(f"    {email}: {reason}")
