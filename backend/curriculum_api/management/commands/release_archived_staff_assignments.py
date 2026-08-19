"""Take deleted tutors/coaches off the curriculum they are still attached to.

Deleting a staff profile archives its row in ``curriculum.tutors`` /
``curriculum.coaches``, but the person's *name* is stored separately on
``curriculum.modules.tutor_name`` and ``curriculum.groups.coach_name``. Until the
fix in ``curriculum_staff_profile_detail`` those names were left behind, and
because the curriculum read model derives stand-in profiles from them, every
deleted tutor and coach came back on the next read — under a synthetic
``tutor-<slug>`` id, reported as active.

The API now releases the name as part of the delete, and refuses to rebuild a
profile for an archived person either way. This command applies the same release
to rows deleted *before* that fix, so the stored curriculum matches what a delete
does today.

Only names belonging to an archived profile are cleared, and only when no active
profile shares that name — a re-hired staff member (archived duplicate plus a
live row) keeps every assignment.

Dry-run by default: pass --apply to write.
"""

import re
from datetime import datetime

from django.core.management.base import BaseCommand
from django.db import connection, transaction

# (role, staff table, assigned-curriculum table, its key column, its name column)
STAFF_RELEASE_TARGETS = (
    ('tutor', 'tutors', 'modules', 'module_catalogue_id', 'tutor_name'),
    ('coach', 'coaches', 'groups', 'group_id', 'coach_name'),
)


def normalise(value):
    """Same key as views.staff_assignment_key, so both agree on what 'same name' means."""
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


BLANK_NAME_KEYS = {'', 'emptystring', 'unassigned'}


class Command(BaseCommand):
    help = (
        'Clear archived tutors/coaches off curriculum.modules.tutor_name and '
        'curriculum.groups.coach_name so deleted staff stop being rebuilt from them.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Perform the writes. Without it the command only reports what it would change.',
        )

    def relation(self, table):
        if connection.vendor == 'postgresql':
            return f'"curriculum"."{table}"'
        return f'"{table}"'

    def rows(self, cursor, sql, params=None):
        cursor.execute(sql, params or [])
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def handle(self, *args, **options):
        apply_changes = options['apply']
        total = 0

        with transaction.atomic():
            with connection.cursor() as cursor:
                for role, staff_table, target_table, key_column, name_column in STAFF_RELEASE_TARGETS:
                    staff_rows = self.rows(
                        cursor, f'select name, coalesce(is_archived, false) as is_archived from {self.relation(staff_table)}'
                    )
                    archived_keys = set()
                    active_keys = set()
                    for row in staff_rows:
                        key = normalise(row.get('name'))
                        if key in BLANK_NAME_KEYS:
                            continue
                        (archived_keys if row.get('is_archived') else active_keys).add(key)
                    # A re-hired member has both an archived duplicate and a live
                    # row; their assignments are still current, so leave them be.
                    release_keys = archived_keys - active_keys
                    if not release_keys:
                        self.stdout.write(f'{role}: nothing to release.')
                        continue

                    target_rows = self.rows(
                        cursor,
                        f'select {key_column}, {name_column} from {self.relation(target_table)}',
                    )
                    stale = [
                        row for row in target_rows
                        if normalise(row.get(name_column)) in release_keys
                    ]
                    if not stale:
                        self.stdout.write(f'{role}: nothing to release.')
                        continue

                    for row in stale:
                        self.stdout.write(
                            f'{role}: {target_table}.{row[key_column]} still assigned to '
                            f'deleted {role} {row[name_column]!r}'
                        )
                    total += len(stale)

                    if apply_changes:
                        cursor.executemany(
                            f'update {self.relation(target_table)} '
                            f'set {name_column} = %s, updated_at = %s where {key_column} = %s',
                            [('', datetime.utcnow(), row[key_column]) for row in stale],
                        )

            if not apply_changes:
                transaction.set_rollback(True)

        if not total:
            self.stdout.write(self.style.SUCCESS('No stale staff assignments found.'))
        elif apply_changes:
            self.stdout.write(self.style.SUCCESS(f'Released {total} stale staff assignment(s).'))
        else:
            self.stdout.write(
                self.style.WARNING(f'Dry run: {total} stale staff assignment(s) would be released. Re-run with --apply.')
            )
