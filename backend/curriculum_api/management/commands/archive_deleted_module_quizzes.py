from django.core.management.base import BaseCommand
from django.db import transaction

from curriculum_api import views


class Command(BaseCommand):
    help = (
        "Find quizzes owned only by already soft-deleted modules and move them "
        "to the Quiz Archive. Shared quizzes remain active."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply the archive updates. Without this flag the command is read-only.",
        )

    def handle(self, *args, **options):
        apply_changes = bool(options["apply"])
        views.ensure_module_authoring_tables()
        deleted_condition = views.deleted_sql_condition(views.AUTHORING_MODULES_TABLE)
        archived_modules = views.authoring_fetch_all(
            views.AUTHORING_MODULES_TABLE,
            deleted_condition,
        )
        module_ids = sorted({
            views.clean_str(row.get("module_catalogue_id"))
            for row in archived_modules
            if views.clean_str(row.get("module_catalogue_id"))
        })

        quiz_ids = set()
        with transaction.atomic():
            for module_id in module_ids:
                quiz_ids.update(views.archive_module_child_quizzes(
                    module_id,
                    include_deleted_children=True,
                    apply=apply_changes,
                ))
            if not apply_changes:
                transaction.set_rollback(True)

        mode = "APPLIED" if apply_changes else "DRY RUN"
        self.stdout.write(f"{mode}: archived modules scanned: {len(module_ids)}")
        self.stdout.write(f"{mode}: exclusive quizzes eligible: {len(quiz_ids)}")
        if quiz_ids:
            self.stdout.write("Quiz ids: " + ", ".join(str(value) for value in sorted(quiz_ids)))
        if not apply_changes:
            self.stdout.write(self.style.WARNING("No data changed. Re-run with --apply to archive these quizzes."))
        elif quiz_ids:
            self.stdout.write(self.style.SUCCESS("Eligible quizzes moved to Quiz Archive; shared quizzes were left active."))
        else:
            self.stdout.write(self.style.SUCCESS("No eligible quizzes found; no data changed."))
