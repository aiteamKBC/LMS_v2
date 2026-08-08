"""Ensure enrolment."Created_users" exists — the install-time name.

The table's DDL lives in create_created_users_table, which is written as a
one-time cutover from the two legacy learner tables. On a clean database there
is nothing to cut over, and a command named "create_..._table" that reports
"cutover already done" reads like it did nothing. This alias exists so a fresh
deployment has an obviously-named install step, and so the run order in
ENROLMENT_GAP_ANALYSIS.md §7.3 reads as a list of installs.

It delegates rather than duplicating the column list: two copies of a
150-column DDL would drift, and drift between a table's shape and the model that
reads it is exactly what P0-1 and P0-2 were.

    python manage.py apply_created_users_table
    python manage.py apply_created_users_table --dry-run
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Ensure enrolment."Created_users" exists (install-time alias for create_created_users_table).'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Rehearse and roll back.",
        )

    def handle(self, *args, **options):
        # Never forward --drop-old: this is the install path, and dropping the
        # legacy tables is a deliberate, separately-invoked cutover decision.
        call_command("create_created_users_table", dry_run=options["dry_run"])
