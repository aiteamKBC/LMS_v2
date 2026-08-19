"""Clear stale ``is_programme_deleted`` flags and rebuild group module lists.

``modules.is_programme_deleted`` records *the programme's* state, not the
module's. Before the fix in ``save_module_authoring_structure`` an unsent flag
was carried over from the row being saved, so a module archived with one
programme and then re-attached to a live one kept the flag while ``deleted_at``
was cleared. Two things follow from that incoherent pair:

1. ``build_cohorts_and_groups`` filters the module out (``programme_deleted_row``
   reads the flag), so an attached module is invisible in the curriculum tree;
2. ``repair_curriculum_parent_links`` treats it as deleted and strips it from
   ``groups.module_ids``, so the group — and the cohort above it — reads as
   having no modules at all.

This command repairs rows already in that state, then rebuilds the cached module
lists of every surviving group from the surviving module rows. A flag is cleared
only when ``deleted_at`` is null (an actually deleted module keeps its stamp)
*and* the module's programme is live, so it can never resurrect curriculum that
was deliberately withdrawn.

Dry-run by default: pass --apply to write.
"""

import json
from datetime import datetime

from django.core.management.base import BaseCommand
from django.db import connection, transaction

MODULES_RELATION = '"curriculum"."modules"'
GROUPS_RELATION = '"curriculum"."groups"'
PROGRAMMES_RELATION = '"curriculum"."programmes"'

# Mirrors the active-row checks in views.soft_delete_rows.
MODULE_SURVIVES = 'deleted_at is null and is_programme_deleted is distinct from true'
PROGRAMME_IS_LIVE = (
    'p.deleted_at is null '
    'and p.is_archived is distinct from true '
    "and coalesce(p.status, '') <> 'archived'"
)


class Command(BaseCommand):
    help = (
        'Clear is_programme_deleted on modules whose programme is live, then rebuild '
        'groups.module_ids/module_names from the surviving module rows.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Perform the writes. Without it the command only reports what it would change.',
        )

    def _rows(self, cursor, sql, params=None):
        cursor.execute(sql, params or [])
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def _json_list(self, value):
        if value is None:
            return []
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except ValueError:
                return []
            return parsed if isinstance(parsed, list) else []
        return list(value) if isinstance(value, (list, tuple)) else []

    def handle(self, *args, **options):
        apply_changes = options['apply']

        with connection.cursor() as cursor:
            stale = self._rows(cursor, f"""
                select m.module_catalogue_id, m.title, m.programme_id, m.programme_name,
                       m.cohort_id, m.cohort_name, m.group_id, m.group_name, m.deleted_via_parent
                  from {MODULES_RELATION} m
                  join {PROGRAMMES_RELATION} p on p.programme_id = m.programme_id
                 where m.is_programme_deleted is true
                   and m.deleted_at is null
                   and {PROGRAMME_IS_LIVE}
                 order by m.updated_at
            """)

            self.stdout.write(f'Modules flagged programme-deleted under a live programme: {len(stale)}')
            for module in stale:
                self.stdout.write(
                    '  {id}  {title}\n'
                    '      programme: {programme_id} ({programme_name})\n'
                    '      cohort:    {cohort_id} ({cohort_name})\n'
                    '      group:     {group_id} ({group_name})\n'
                    '      archived via parent: {via_parent}'.format(
                        id=module['module_catalogue_id'],
                        title=module['title'],
                        programme_id=module['programme_id'],
                        programme_name=module['programme_name'],
                        cohort_id=module['cohort_id'],
                        cohort_name=module['cohort_name'],
                        group_id=module['group_id'],
                        group_name=module['group_name'],
                        via_parent=module['deleted_via_parent'] or '-',
                    )
                )

            # Rebuild every surviving group's cache, not only the touched ones:
            # the same defect drifted caches in both directions (a deleted module
            # left in the list, a live one missing from it).
            groups = self._rows(cursor, f"""
                select group_id, group_name, cohort_id, module_ids, module_names
                  from {GROUPS_RELATION}
                 where deleted_at is null and is_programme_deleted is distinct from true
                 order by created_at
            """)
            cleared_ids = [module['module_catalogue_id'] for module in stale]
            drifted = []
            for group in groups:
                surviving = self._rows(cursor, f"""
                    select module_catalogue_id, title
                      from {MODULES_RELATION}
                     where group_id = %s
                       and (({MODULE_SURVIVES}) or module_catalogue_id = any(%s))
                     order by created_at
                """, [group['group_id'], cleared_ids])
                next_ids = []
                next_names = []
                for module in surviving:
                    if module['module_catalogue_id'] and module['module_catalogue_id'] not in next_ids:
                        next_ids.append(module['module_catalogue_id'])
                    if module['title'] and module['title'] not in next_names:
                        next_names.append(module['title'])
                stored_ids = self._json_list(group['module_ids'])
                stored_names = self._json_list(group['module_names'])
                if sorted(next_ids) != sorted(stored_ids) or sorted(next_names) != sorted(stored_names):
                    drifted.append((group, next_ids, next_names))

            self.stdout.write(f'\nGroups whose cached module list disagrees with the rows: {len(drifted)}')
            for group, next_ids, next_names in drifted:
                self.stdout.write(
                    '  {group_id}  {group_name}  (cohort {cohort_id})\n'
                    '      stored:  {stored}\n'
                    '      rebuilt: {rebuilt}'.format(
                        group_id=group['group_id'],
                        group_name=group['group_name'],
                        cohort_id=group['cohort_id'],
                        stored=self._json_list(group['module_ids']),
                        rebuilt=next_ids,
                    )
                )

            if not apply_changes:
                self.stdout.write(self.style.WARNING('\nDry run - nothing written. Re-run with --apply.'))
                return

            if not stale and not drifted:
                self.stdout.write(self.style.SUCCESS('\nNothing to repair.'))
                return

            now = datetime.utcnow()
            with transaction.atomic():
                for module in stale:
                    cursor.execute(
                        f"""update {MODULES_RELATION}
                               set is_programme_deleted = false,
                                   deleted_by = null,
                                   deleted_via_parent = null,
                                   updated_at = %s
                             where module_catalogue_id = %s and deleted_at is null""",
                        [now, module['module_catalogue_id']],
                    )
                for group, next_ids, next_names in drifted:
                    cursor.execute(
                        f'update {GROUPS_RELATION} set module_ids = %s, module_names = %s, updated_at = %s '
                        'where group_id = %s',
                        [json.dumps(next_ids), json.dumps(next_names), now, group['group_id']],
                    )

            self.stdout.write(self.style.SUCCESS(
                f'\nCleared {len(stale)} stale flag(s) and rebuilt {len(drifted)} group module list(s).'
            ))
