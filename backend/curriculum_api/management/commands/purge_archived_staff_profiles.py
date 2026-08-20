"""Delete the tutors/coaches that the old soft delete left in the database.

Deleting a staff profile used to set ``is_archived = true`` (and ``status =
'archived'``) instead of removing the row. Those rows are invisible to every
operational read, so the app reports the person as deleted while the database
still holds them — and there is no screen left that can finish the job.
``curriculum_staff_profile_detail`` now deletes the row outright; this command
applies the same outcome to everything archived before that change.

Each archived row's name is released from ``curriculum.modules.tutor_name`` /
``curriculum.groups.coach_name`` first. Skipping that would be worse than doing
nothing: the assignment mirror rebuilds a profile for any name it finds on the
curriculum, so a purged row whose name was left behind would come back as an
*active* tutor on the next save.

A name shared with a live profile is left alone — a re-hired staff member
(archived duplicate plus an active row) keeps every assignment.

Dry-run by default: pass --apply to write.
"""

import re
from datetime import datetime

from django.core.management.base import BaseCommand
from django.db import connection, transaction

# (role, staff table, assigned-curriculum table, its key column, its name column)
STAFF_PURGE_TARGETS = (
    ('tutor', 'tutors', 'modules', 'module_catalogue_id', 'tutor_name'),
    ('coach', 'coaches', 'groups', 'group_id', 'coach_name'),
)


def normalise(value):
    """Same key as views.staff_assignment_key, so both agree on what 'same name' means."""
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


BLANK_NAME_KEYS = {'', 'emptystring', 'unassigned'}


class Command(BaseCommand):
    help = (
        'Delete archived rows from curriculum.tutors / curriculum.coaches and release '
        'their names from the curriculum, finishing deletes that only archived the row.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Perform the writes. Without it the command only reports what it would change.',
        )
        parser.add_argument(
            '--role',
            choices=[role for role, *_ in STAFF_PURGE_TARGETS],
            help='Limit the purge to one role. Both are purged by default.',
        )

    def relation(self, table):
        if connection.vendor == 'postgresql':
            return f'"curriculum"."{table}"'
        return f'"{table}"'

    def rows(self, cursor, sql, params=None):
        cursor.execute(sql, params or [])
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def is_archived(self, row):
        # Both signals count: is_archived is the flag the API writes, status is
        # the text column older rows carry.
        return bool(row.get('is_archived')) or str(row.get('status') or '').strip().lower() == 'archived'

    def handle(self, *args, **options):
        apply_changes = options['apply']
        only_role = options.get('role')
        purged = 0
        released = 0

        with transaction.atomic():
            with connection.cursor() as cursor:
                for role, staff_table, target_table, key_column, name_column in STAFF_PURGE_TARGETS:
                    if only_role and role != only_role:
                        continue

                    staff_rows = self.rows(cursor, f'select * from {self.relation(staff_table)}')
                    archived_rows = [row for row in staff_rows if self.is_archived(row)]
                    if not archived_rows:
                        self.stdout.write(f'{role}: nothing archived.')
                        continue

                    active_keys = {
                        normalise(row.get('name'))
                        for row in staff_rows
                        if not self.is_archived(row)
                    } - BLANK_NAME_KEYS

                    for row in archived_rows:
                        self.stdout.write(
                            f'{role}: {staff_table}.{row.get("id")} {row.get("name")!r} archived - would be deleted'
                            if not apply_changes
                            else f'{role}: deleted {staff_table}.{row.get("id")} {row.get("name")!r}'
                        )
                    purged += len(archived_rows)

                    # Release the names first: a purged row whose name is still on
                    # the curriculum is rebuilt as an active profile on the next save.
                    release_keys = {normalise(row.get('name')) for row in archived_rows} - active_keys - BLANK_NAME_KEYS
                    stale = []
                    if release_keys:
                        target_rows = self.rows(
                            cursor,
                            f'select {key_column}, {name_column} from {self.relation(target_table)}',
                        )
                        stale = [
                            row for row in target_rows
                            if normalise(row.get(name_column)) in release_keys
                        ]
                        for row in stale:
                            self.stdout.write(
                                f'{role}: {target_table}.{row[key_column]} still assigned to '
                                f'deleted {role} {row[name_column]!r}'
                            )
                        released += len(stale)

                    if apply_changes:
                        if stale:
                            cursor.executemany(
                                f'update {self.relation(target_table)} '
                                f'set {name_column} = %s, updated_at = %s where {key_column} = %s',
                                [('', datetime.utcnow(), row[key_column]) for row in stale],
                            )
                        cursor.executemany(
                            f'delete from {self.relation(staff_table)} where id = %s',
                            [(row.get('id'),) for row in archived_rows],
                        )

            if not apply_changes:
                transaction.set_rollback(True)

        if not purged:
            self.stdout.write(self.style.SUCCESS('No archived staff profiles found.'))
        elif apply_changes:
            self.stdout.write(self.style.SUCCESS(
                f'Deleted {purged} archived staff profile(s) and released {released} stale assignment(s).'
            ))
        else:
            self.stdout.write(self.style.WARNING(
                f'Dry run: {purged} archived staff profile(s) would be deleted and '
                f'{released} stale assignment(s) released. Re-run with --apply.'
            ))
