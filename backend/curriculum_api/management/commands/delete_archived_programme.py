"""Permanently delete an archived programme and every curriculum row beneath it.

Why this exists
---------------
``delete from curriculum."programmes" where programme_id = '...'`` is rejected by
Postgres with ``cohorts_programme_id_fkey``: migration 0038 gave cohorts, groups,
modules and week_templates ON DELETE RESTRICT foreign keys into programmes, on
purpose, so a parent cannot be removed while children still point at it. The fix
is not to drop the guard but to delete in the order it demands - children first -
which is what ``views.permanently_delete_programme_structure`` does.

Archived only
-------------
``is_archived = true`` is the switch that turns an irreversible delete on. A live
programme is refused; archive it first (the ordinary delete in the UI).

Learner data
------------
Learner accounts, progress and enrolment rows are never touched. The learner
training-plan tables reference curriculum modules, weeks and components with
ON DELETE RESTRICT, so a programme whose content a learner already holds is
refused and the blocking counts are printed instead.

Dry-run by default: pass --apply to write.
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from curriculum_api import views


class Command(BaseCommand):
    help = 'Permanently delete an archived programme and all curriculum rows beneath it.'

    def add_arguments(self, parser):
        parser.add_argument('identifiers', nargs='+', help='Programme id(s), e.g. PROG-20260819075047144635-2')
        parser.add_argument('--apply', action='store_true', help='Write the deletes (default is a dry run).')
        parser.add_argument('--json', action='store_true', help='Emit machine-readable output.')

    def handle(self, *args, **options):
        apply_changes = bool(options['apply'])
        as_json = bool(options['json'])
        report = []

        for identifier in options['identifiers']:
            views.ensure_program_config_archive_columns()
            config = views.programme_config_by_identifier(identifier)
            programme = None if config else views.programme_response(identifier)
            if not config and not programme:
                raise CommandError(f'Programme not found: {identifier}')

            name = views.clean_str((config or {}).get('name') or (programme or {}).get('name'))
            archived = views.is_archived_program_config(config) or views.programme_status_is_archived(
                (programme or {}).get('status')
            )
            if not archived:
                raise CommandError(
                    f'{identifier} ({name}) is not archived. Archive it first - this command only '
                    'removes programmes already flagged is_archived = true.'
                )

            plan = views.programme_permanent_delete_plan(identifier, programme, config)
            counts = {key: len(value) for key, value in plan['childIds'].items() if value}
            entry = {
                'id': identifier,
                'name': name,
                'matchedIds': plan['candidates'],
                'children': counts,
                'blockers': plan['blockers'],
                'learnersNamingThisProgramme': plan['learners'],
                'applied': False,
                'removed': {},
            }

            if plan['blockers']:
                report.append(entry)
                if not as_json:
                    self.stderr.write(self.style.ERROR(
                        f'{identifier} ({name}) is blocked by learner training plans: '
                        f'{json.dumps(plan["blockers"])}'
                    ))
                continue

            if apply_changes:
                with transaction.atomic():
                    entry['removed'] = views.permanently_delete_programme_structure(plan)
                entry['applied'] = True

            report.append(entry)

            if not as_json:
                self.stdout.write(f'\n{identifier}  {name}')
                self.stdout.write(f'  matched ids: {", ".join(plan["candidates"]) or "-"}')
                for key, total in sorted(counts.items()):
                    self.stdout.write(f'  {key:16s} {total}')
                if plan['learners']:
                    self.stdout.write(self.style.WARNING(
                        f'  {plan["learners"]} learner record(s) name this programme; learner rows are '
                        'not deleted and will keep the name.'
                    ))
                if entry['applied']:
                    self.stdout.write(self.style.SUCCESS(f'  deleted: {json.dumps(entry["removed"])}'))
                else:
                    self.stdout.write('  dry run - nothing written. Re-run with --apply.')

        if as_json:
            self.stdout.write(json.dumps({'apply': apply_changes, 'programmes': report}, indent=2))
