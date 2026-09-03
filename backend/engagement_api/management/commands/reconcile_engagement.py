"""Audit + (optionally) repair the engagement points economy.

    python manage.py reconcile_engagement                  # dry-run report only
    python manage.py reconcile_engagement --repair          # + backfill missing
                                                             #   quiz/video/component
                                                             #   grants
    python manage.py reconcile_engagement --repair-attendance
                                                             # + re-run the Teams
                                                             #   attendance sync
                                                             #   (heavier; hits
                                                             #   live session data)

Report-only by default. Never deletes a grant, even an orphan one — a grant
whose learner_id doesn't map to a current enrolment row may belong to a real
learner whose Created_users row was later removed (confirmed precedent: see
learner_api.management.commands.apply_learner_enrolment_id, which documents
exactly this for enrolment id 19). Orphans are reported for a human to
investigate, never auto-deleted.

--repair is idempotent and safe to re-run: it goes through
engagement_api.services.grant_points, which de-dupes on (rule,
event_reference) — a completion already awarded is a no-op, not a double
grant.
"""
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Count

from engagement_api.models import PointsGrant, PointsRule, Reward


class Command(BaseCommand):
    help = "Audit the engagement points economy; optionally backfill missing progress-driven grants."

    def add_arguments(self, parser):
        parser.add_argument(
            "--repair", action="store_true",
            help="Backfill missing quiz/video/component grants for existing progress rows.",
        )
        parser.add_argument(
            "--repair-attendance", action="store_true",
            help="Also re-run the verified Teams attendance sync (backfills live_session_attended too).",
        )

    def handle(self, *args, **options):
        self._report_orphan_grants()
        self._report_duplicate_rule_keys()
        self._report_duplicate_grant_references()
        self._report_bad_money_values()

        if options["repair"]:
            self._repair_progress_grants()
        if options["repair_attendance"]:
            self._repair_attendance_grants()

    # -- Report (always runs, always read-only) ------------------------------

    def _report_orphan_grants(self):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT g.learner_id, g.learner_name, count(*) AS grants, sum(g.points) AS points
                  FROM "Engagement"."points_grants" g
                 WHERE g.learner_id !~ '^[0-9]+$'
                    OR NOT EXISTS (
                         SELECT 1 FROM enrolment."Created_users" cu WHERE cu.id::text = g.learner_id
                       )
                 GROUP BY g.learner_id, g.learner_name
                 ORDER BY grants DESC
                """
            )
            rows = cursor.fetchall()
        if not rows:
            self.stdout.write(self.style.SUCCESS("No orphan grants (every learner_id maps to a real enrolment row)."))
            return
        self.stdout.write(self.style.WARNING(f"{len(rows)} orphan learner_id(s) — quarantined, NOT deleted:"))
        for learner_id, learner_name, grants, points in rows:
            self.stdout.write(f"  learner_id={learner_id!r} ({learner_name}): {grants} grant(s), {points} pts")

    def _report_duplicate_rule_keys(self):
        dupes = (
            PointsRule.objects.filter(active=True, key__isnull=False)
            .exclude(key="")
            .values("key")
            .annotate(count=Count("id"))
            .filter(count__gt=1)
        )
        dupes = list(dupes)
        if not dupes:
            self.stdout.write(self.style.SUCCESS("No duplicate active rule keys."))
            return
        self.stdout.write(self.style.ERROR(f"{len(dupes)} rule key(s) shared by multiple ACTIVE rules (grant_points will raise MultipleObjectsReturned):"))
        for row in dupes:
            self.stdout.write(f"  key={row['key']!r}: {row['count']} active rules")

    def _report_duplicate_grant_references(self):
        dupes = (
            PointsGrant.objects.filter(event_reference__isnull=False)
            .values("rule_id", "event_reference")
            .annotate(count=Count("id"))
            .filter(count__gt=1)
        )
        dupes = list(dupes)
        if not dupes:
            self.stdout.write(self.style.SUCCESS("No duplicate (rule, event_reference) grants."))
            return
        self.stdout.write(self.style.ERROR(f"{len(dupes)} duplicate (rule, event_reference) pair(s) — the unique index (see sql/) wasn't applied before these were written:"))
        for row in dupes:
            self.stdout.write(f"  rule_id={row['rule_id']} ref={row['event_reference']!r}: {row['count']} grants")

    def _report_bad_money_values(self):
        bad_rewards = list(Reward.objects.filter(points__lt=0).values_list("id", "name", "points"))
        bad_rules = list(PointsRule.objects.filter(points__lt=0).values_list("id", "name", "points"))
        if not bad_rewards and not bad_rules:
            self.stdout.write(self.style.SUCCESS("No negative reward/rule point values."))
            return
        for reward_id, name, points in bad_rewards:
            self.stdout.write(self.style.ERROR(f"  reward id={reward_id} {name!r}: points={points}"))
        for rule_id, name, points in bad_rules:
            self.stdout.write(self.style.ERROR(f"  rule id={rule_id} {name!r}: points={points}"))

    # -- Repair (opt-in) -------------------------------------------------------

    def _repair_progress_grants(self):
        """Re-run the progress -> engagement award for every existing, qualifying
        progress row. Safe to re-run: grant_points() de-dupes on
        (rule, event_reference), so an already-awarded completion is a no-op."""
        from learner_api.models import LearnerProgressEntry

        from .hooks import award_for_progress

        entries = (
            LearnerProgressEntry.objects.filter(attempt=1)
            .filter(kind__in=["quiz", "video", "component"])
            .select_related("learner")
        )
        awarded = 0
        skipped_no_enrolment = 0
        for entry in entries.iterator():
            learner = entry.learner
            if learner is None or learner.enrolment_id is None:
                skipped_no_enrolment += 1
                continue
            record = {
                "kind": entry.kind,
                "attempt": entry.attempt,
                "passed": entry.passed,
                "quizId": entry.quiz_ref,
                "componentId": entry.component_ref,
                "componentType": entry.component_type,
            }
            award_for_progress(learner.enrolment_id, learner.username, record)
            awarded += 1
        self.stdout.write(self.style.SUCCESS(
            f"Repair: replayed {awarded} progress row(s) through award_for_progress "
            f"({skipped_no_enrolment} skipped — no enrolment_id)."
        ))

    def _repair_attendance_grants(self):
        from learner_api.teams_attendance import sync_verified_teams_attendance_reporting

        count = sync_verified_teams_attendance_reporting(all_learners=True)
        self.stdout.write(self.style.SUCCESS(f"Repair: re-synced {count} verified Teams attendance row(s)."))
