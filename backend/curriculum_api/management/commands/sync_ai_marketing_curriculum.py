"""Synchronise AI in Marketing into the normal authored learner journey."""

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.ai_marketing_curriculum import MODULE_ID, MODULE_TITLE, build_projection, sync_projection
from learner_api.active_users import sync_active_user
from learner_api.models import EnrolmentUser


DEMO_EMAIL = "learner-mm@learner.local"


class Command(BaseCommand):
    help = "Project the AI audit table into curriculum and assign it to the MM demo learner."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write changes. Default is dry-run.")

    def handle(self, *args, **options):
        rows, components, total_otjh = build_projection()
        if not rows:
            raise CommandError("programme_audit.ai_in_marketing is missing or empty.")
        self.stdout.write(
            f"AI in Marketing: {len(rows)} audit rows -> {len(components)} components, {total_otjh}h"
        )
        if not options["apply"]:
            self.stdout.write(self.style.WARNING("DRY RUN: pass --apply to write and assign the module."))
            return

        result = sync_projection()
        learner = EnrolmentUser.all_learners.filter(email__iexact=DEMO_EMAIL).first()
        if learner is None:
            raise CommandError(f"The demo learner {DEMO_EMAIL} does not exist.")
        plan = list(learner.learning_plan or [])
        if not any(str(item.get("moduleId") or "") == MODULE_ID for item in plan if isinstance(item, dict)):
            plan.append({"moduleId": MODULE_ID, "moduleTitle": MODULE_TITLE, "weeks": []})
            learner.learning_plan = plan
            learner.save(update_fields=["learning_plan"])
        # Preserve password, sessions and learner progress; refresh only the
        # active learner's plan snapshot from the authored curriculum.
        sync_active_user(learner)
        self.stdout.write(self.style.SUCCESS(
            f'COMMITTED: {result["components"]} components; assigned {MODULE_ID} to {DEMO_EMAIL}.'
        ))

