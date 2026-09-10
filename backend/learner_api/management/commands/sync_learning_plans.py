"""Mirror every learner's assigned plan into the tables that report on it.

The plan staff edit lives on ``enrolment."Created_users"."Learning_plan"``.
This copies it to the two places that had no view of it:

* ``"Learner".learners.learning_plan`` -- what every coach, marking and
  reporting surface reads.
* ``Created_users`` Modules/Weeks/Components -- the legacy comma-joined title
  columns, so they cannot describe a plan the learner no longer has.

Resolved through ``get_training_plan``, the same resolver the learner's own "My
learning" page uses, so the mirror shows what the learner sees.

A learner with no plan gets an empty mirror, deliberately: that is the honest
answer, and a stale copy of a plan somebody has since cleared would be worse
than a blank. Most learners are currently in that state because their
programme has no live modules -- reported in the summary rather than hidden.

    python manage.py sync_learning_plans
    python manage.py sync_learning_plans --apply
    python manage.py sync_learning_plans --apply --learner 101
"""
from django.core.management.base import BaseCommand
from django.db import DatabaseError, connections, transaction

from learner_api.learning_plan import _plan_titles, sync_learning_plan_mirror
from learner_api.mappers import get_training_plan
from learner_api.models import EnrolmentUser, LearnerProfile


class Command(BaseCommand):
    help = "Mirror each learner's assigned learning plan into Learner.learners and the legacy columns."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Write the changes. Without it, the command only reports what it would do.",
        )
        parser.add_argument(
            "--learner", type=int, default=None,
            help="Only this enrolment id, for checking one learner before a full run.",
        )

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        only = options.get("learner")

        # Ids first, rows in chunks. A plan is a large jsonb column and loading
        # all 369 learners at once exceeded the statement timeout, so the run
        # never started. Ids are cheap; the rows are fetched a page at a time.
        ids = list(
            EnrolmentUser.all_learners.filter(pk=only).values_list("pk", flat=True)
            if only else
            EnrolmentUser.all_learners.values_list("pk", flat=True)
        )
        self.stdout.write(f"Learners to mirror: {len(ids)}")

        def in_chunks(values, size=25):
            for start in range(0, len(values), size):
                yield values[start:start + size]

        have_profile = set()
        for chunk in in_chunks(ids):
            have_profile.update(
                LearnerProfile.objects.filter(enrolment_id__in=chunk)
                .values_list("enrolment_id", flat=True)
            )

        with_plan, without_plan, no_profile = [], [], []
        for chunk in in_chunks(ids):
            for source in EnrolmentUser.all_learners.filter(pk__in=chunk):
                plan = get_training_plan(source) or []
                if source.pk not in have_profile:
                    no_profile.append(source)
                if plan:
                    with_plan.append((source, plan))
                else:
                    without_plan.append(source)

        self.stdout.write(f"  with a plan assigned : {len(with_plan)}")
        self.stdout.write(f"  with no plan         : {len(without_plan)}")
        if no_profile:
            self.stdout.write(self.style.WARNING(
                f"  no mirror row in Learner.learners: {len(no_profile)} "
                "-- these get the legacy columns only, and a mirror on activation."
            ))

        for source, plan in with_plan[:10]:
            modules, _weeks, _components = _plan_titles(plan)
            self.stdout.write(
                f"    {source.pk:<6} {(source.username or '')[:28]:30} "
                f"{len(plan)} module(s): {modules[:60]}"
            )
        if len(with_plan) > 10:
            self.stdout.write(f"    ... and {len(with_plan) - 10} more")

        if not apply_changes:
            self.stdout.write(self.style.WARNING("\nDry run -- nothing written. Re-run with --apply."))
            return

        mirrored = failed = 0
        # One transaction per learner, not one for the whole run. A plan can
        # carry over a thousand components, and rebuilding every learner's child
        # rows in a single transaction exceeded the statement timeout -- which
        # rolled back the lot, including the learners that had already
        # succeeded. Per-learner means a slow or failing row costs only itself.
        for source in [s for s, _p in with_plan] + without_plan:
            try:
                with transaction.atomic(using="enrolment"):
                    with connections["enrolment"].cursor() as cur:
                        # The pooler leaks default_transaction_read_only between
                        # clients, so each transaction states that it writes.
                        cur.execute("SET TRANSACTION READ WRITE")
                    sync_learning_plan_mirror(source)
                mirrored += 1
            except DatabaseError as exc:
                failed += 1
                self.stderr.write(self.style.WARNING(
                    f"  learner {source.pk}: {exc}"
                ))
            if mirrored and mirrored % 50 == 0:
                self.stdout.write(f"  ... {mirrored} mirrored")

        self.stdout.write(self.style.SUCCESS(f"\nMirrored {mirrored} learner(s)."))
        if failed:
            self.stdout.write(self.style.WARNING(f"  {failed} failed."))
