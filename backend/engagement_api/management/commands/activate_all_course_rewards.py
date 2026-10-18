"""Activate the authorised all-course policy once; no historical award changes."""
from django.core.management.base import BaseCommand
from django.db import connections
from engagement_api.learning_policy import at, publish, DEFAULTS
from engagement_api.shared_reward_setup import require_same_database,require_global_ready,operator_reference

class Command(BaseCommand):
    help = "Activate default all-course learning rules at server time; preserve an existing activation."
    def add_arguments(self, parser):
        parser.add_argument("--operator", required=True)
    def handle(self, *args, **options):
        require_same_database();require_global_ready()
        operator=operator_reference(options["operator"])
        with connections["default"].cursor() as cursor:
            current=at(cursor)
            cursor.execute('SELECT count(*) FROM "Engagement".points_rules WHERE key=ANY(%s) AND active',
                [['accepted_learning_hour_v2','first_submitted_quiz_v2','verified_learning_bonus_v2']])
            if cursor.fetchone()[0]!=3:
                from django.core.management.base import CommandError
                raise CommandError("Prepare the three canonical reward rules before activation.")
        if current:
            self.stdout.write("All-course policy already active; existing activation and settings preserved.")
            return
        publish(DEFAULTS,operator,None)
        self.stdout.write("All-course learning policy activated. No historical grants recalculated.")
