"""Fill in ``curriculum.modules.tutor_email`` for modules that only ever got a name.

The column is new: every write path used to store the assigned tutor as a name
(``tutor_name``) alone. Both write paths now also resolve and store the email
(``save_module_authoring_structure`` and the group-staffing PATCH in
``update_staffing_assignment``), but a module nobody re-saves since keeps its
``tutor_email`` blank forever. This command derives it once, the same way those
write paths do -- matching ``tutor_name`` against the staff directory
(``enrolment.Staff_users``) by id, then email, then name/slug.

A ``tutor_name`` with no matching staff profile (renamed, archived and excluded,
or mistyped) is reported and left alone rather than guessed at.

Dry-run by default: pass --apply to write.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from ... import views


class Command(BaseCommand):
    help = (
        'Resolve and store curriculum.modules.tutor_email for modules that carry '
        'a tutor_name but no tutor_email yet. Dry-run unless --apply.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write the resolved emails. Without it the command only reports.',
        )

    def console_safe(self, value):
        """Coerce arbitrary stored text so a narrow-codepage Windows console
        cannot crash the whole run over one tutor name with a stray character."""
        encoding = getattr(self.stdout, 'encoding', None) or 'utf-8'
        return str(value).encode(encoding, errors='backslashreplace').decode(encoding)

    def handle(self, *args, **options):
        apply_changes = options['apply']

        views.ensure_module_authoring_tables()
        rows = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE)

        planned = []
        already_set = 0
        no_tutor = 0
        unresolved = []

        for row in rows:
            tutor_name = views.clean_str(row.get('tutor_name'))
            if views.clean_str(row.get('tutor_email')):
                already_set += 1
                continue
            if not tutor_name or views.staff_assignment_key(tutor_name) == 'unassigned':
                no_tutor += 1
                continue
            email = views.resolve_staff_assignment_email('tutor', tutor_name)
            if not email:
                unresolved.append((row.get('module_catalogue_id'), tutor_name))
                continue
            planned.append({
                'moduleCatalogueId': row.get('module_catalogue_id'),
                'tutorName': tutor_name,
                'tutorEmail': email,
            })

        for item in planned:
            self.stdout.write(f"{item['moduleCatalogueId']}: {self.console_safe(item['tutorName'])} -> {item['tutorEmail']}")

        if unresolved:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING('No matching staff profile (left alone):'))
            for module_id, tutor_name in unresolved:
                self.stdout.write(f'  {module_id}: "{self.console_safe(tutor_name)}"')

        self.stdout.write('')
        self.stdout.write(
            f'{len(rows)} modules read: {len(planned)} to fill in, {already_set} already set, '
            f'{no_tutor} with no tutor assigned, {len(unresolved)} with no matching staff profile.'
        )

        if not planned:
            self.stdout.write(self.style.SUCCESS('Nothing to do.'))
            return

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry run. Re-run with --apply to write these emails.'))
            return

        written = 0
        with transaction.atomic():
            for item in planned:
                views.update_authoring_rows(
                    views.AUTHORING_MODULES_TABLE,
                    'module_catalogue_id = %s',
                    [item['moduleCatalogueId']],
                    {'tutor_email': item['tutorEmail']},
                )
                written += 1

        views.invalidate_curriculum_cache()
        self.stdout.write(self.style.SUCCESS(f'{written} module rows updated.'))
