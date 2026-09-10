"""Assign each learner every live module on their programme, and save the plan.

Most imported learners arrived with no plan at all: they have no ``Group`` to
take a preset from, so nothing seeded one. This gives each of them the full
module set authored for their programme -- the same selection the module picker
would produce if somebody ticked every box -- and saves it to
``enrolment."Created_users"."Learning_plan"``, which is the record the learner's
own "My learning" page reads.

The saved plan is hydrated first (``active_users.hydrate_training_plan``), so it
carries the authored weeks and components rather than a bare module list, and
then mirrored out by ``learning_plan.sync_learning_plan_mirror`` to
``"Learner".learners.learning_plan`` and the legacy title columns.

Only learners with **no** plan are touched. A learner whose plan somebody has
already tailored is left exactly as it is: overwriting a deliberate selection
with "everything" would be a silent curriculum change, and this command cannot
tell the two apart.

    python manage.py assign_programme_plans
    python manage.py assign_programme_plans --apply
    python manage.py assign_programme_plans --apply --programme "Marketing Executive Level 4"
"""
from collections import Counter

from django.core.management.base import BaseCommand
from django.db import DatabaseError, connections, transaction

from learner_api.active_users import hydrate_training_plan
from learner_api.learning_plan import _programme_modules, sync_learning_plan_mirror
from learner_api.mappers import _s, stored_training_plan, training_plan_field
from learner_api.models import EnrolmentUser


class Command(BaseCommand):
    help = "Give every learner with no plan the full module set for their programme."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Write the changes. Without it, only reports what it would do.")
        parser.add_argument("--programme", default=None,
                            help="Restrict to one programme name.")

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        only = _s(options.get("programme"))

        sources = list(EnrolmentUser.all_learners.all())
        if only:
            sources = [s for s in sources if _s(getattr(s, "programme", "")) == only]

        # Resolved once per programme: the module lookup is the expensive part
        # and every learner on a programme gets the same answer.
        catalogue = {}
        planned, already, no_modules = [], [], Counter()
        for source in sources:
            programme = _s(getattr(source, "programme", ""))
            if stored_training_plan(source):
                already.append(source)
                continue
            if programme not in catalogue:
                catalogue[programme] = _programme_modules(programme)
            modules = catalogue[programme]
            if not modules:
                no_modules[programme or "(none)"] += 1
                continue
            planned.append((source, modules))

        self.stdout.write(f"Learners considered            : {len(sources)}")
        self.stdout.write(f"  already have a plan (skipped): {len(already)}")
        self.stdout.write(f"  will be given a plan         : {len(planned)}")
        if no_modules:
            self.stdout.write(self.style.WARNING(
                "  no live modules for their programme, so left without a plan:"
            ))
            for programme, count in no_modules.most_common():
                self.stdout.write(f"    {programme:<44} {count}")

        by_programme = Counter(_s(getattr(s, "programme", "")) for s, _m in planned)
        for programme, count in by_programme.most_common():
            modules = catalogue[programme]
            self.stdout.write(
                f"    {programme:<44} {count:>4} learner(s) x {len(modules)} module(s)"
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING("\nDry run -- nothing written. Re-run with --apply."))
            return

        saved = 0
        try:
            with transaction.atomic(using="enrolment"):
                with connections["enrolment"].cursor() as cur:
                    # The pooler leaks default_transaction_read_only between
                    # clients, so the transaction states that it writes.
                    cur.execute("SET TRANSACTION READ WRITE")
                for source, modules in planned:
                    # Hydrated before saving: the picker's own payload is a bare
                    # selection, and delivery needs the authored week/component
                    # tree or the learner's plan renders as empty modules.
                    plan = hydrate_training_plan(modules)
                    field = training_plan_field(source)
                    setattr(source, field, plan)
                    source.save(update_fields=[field])
                    sync_learning_plan_mirror(source)
                    saved += 1
        except DatabaseError as exc:
            self.stderr.write(self.style.ERROR(f"Assignment failed and was rolled back: {exc}"))
            return

        self.stdout.write(self.style.SUCCESS(f"\nAssigned a plan to {saved} learner(s)."))
