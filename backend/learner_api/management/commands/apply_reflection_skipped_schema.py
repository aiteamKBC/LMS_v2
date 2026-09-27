from django.core.management.base import BaseCommand
from django.db import connections


class Command(BaseCommand):
    help = 'Add the canonical reflection_skipped flag to learner progress.'

    def handle(self, *args, **options):
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(
                'alter table "Learner"."learner_progress_entries" '
                'add column if not exists reflection_skipped boolean not null default false'
            )
        self.stdout.write(self.style.SUCCESS('reflection_skipped is available'))
