"""Drop the redundant "Additional materials" link to a component's own document.

The curriculum import lists every extra file and link a legacy material carried,
so nothing in the export is lost. It excluded the *primary* file from that list
by comparing URLs — but once a file has been copied into our own storage its URL
no longer matches the old-site one in the export, so the document a learner is
already being shown in the viewer was listed above it as a link back to the old
WordPress site.

The importer now excludes the primary by attachment id. This repairs the
components imported before that fix, and it rewrites **only** the prose field
holding that list:

    reading      -> readingContent
    powerpoint   -> speakerNotes
    podcast      -> transcript
    video        -> lessonMaterialLinks
    assignment   -> submissionInstructions

Nothing else in settings_json is touched — in particular not resourceUrl or
uploadedFileUrl, so no file is re-pointed and nothing is re-downloaded. Quiz
components are not touched at all, which keeps this safe to run while the quiz
import is still going.

    python manage.py fix_legacy_material_links --dry-run
    python manage.py fix_legacy_material_links
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import connection

from curriculum_api import views
from curriculum_api.management.commands.import_mba_curriculum import (
    attachment_of_kinds, component_type_for, extra_materials_html, legacy_rows, primary_link,
)

#: Which settings key holds the extras list, per component type.
PROSE_FIELD = {
    'reading': 'readingContent',
    'powerpoint': 'speakerNotes',
    'podcast': 'transcript',
    'video': 'lessonMaterialLinks',
    'assignment': 'submissionInstructions',
    'live_session': 'preparationInstructions',
}
#: The attachment kinds each type treats as its primary document.
PRIMARY_KINDS = {
    'reading': {'pdf', 'word', 'excel', 'file', 'slides'},
    'powerpoint': {'slides'},
    'podcast': {'audio'},
    'video': {'video'},
    'assignment': {'pdf', 'slides', 'word', 'excel', 'file', 'audio', 'video'},
}


class Command(BaseCommand):
    help = "Remove the duplicate link to a component's own document from its prose field."

    def add_arguments(self, parser):
        parser.add_argument('--courses', default='',
                            help='Comma-separated legacy course_ids; default is every course.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Report what would change and write nothing.')

    def handle(self, *args, **options):
        course_ids = [int(value) for value in options['courses'].replace(' ', '').split(',') if value]
        dry_run = options['dry_run']
        checked = changed = missing = unchanged = 0
        samples = []

        for record in legacy_rows(course_ids or None):
            for section in record['curriculum'].get('sections') or []:
                for material in section.get('materials') or []:
                    component_id = views.clean_str(material.get('component_id'))
                    component_type = component_type_for(material)
                    field = PROSE_FIELD.get(component_type)
                    if not component_id or not field or component_type == 'quiz':
                        continue
                    checked += 1
                    row = self.settings_for(component_id)
                    if row is None:
                        missing += 1
                        continue
                    current = views.clean_str(row.get(field))
                    if 'Additional materials' not in current:
                        unchanged += 1
                        continue

                    primary = attachment_of_kinds(material, PRIMARY_KINDS.get(component_type, set()))
                    _link, link_url = primary_link(material)
                    rebuilt = extra_materials_html(
                        material.get('attachments') or [], material.get('external_links') or [],
                        primary, link_url,
                    )
                    # Whatever the author wrote comes before the generated list,
                    # so the prose is preserved by rebuilding only the tail.
                    prose = current.split('<p><strong>Additional materials</strong></p>')[0]
                    updated = prose + rebuilt
                    if updated == current:
                        unchanged += 1
                        continue
                    changed += 1
                    if len(samples) < 5:
                        samples.append(f'{component_id} ({component_type}) {field}: '
                                       f'{len(current)} -> {len(updated)} chars')
                    if not dry_run:
                        views.update_rows(
                            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id],
                            {'settings_json': views.json_db_value({**row, field: updated})},
                        )

        verb = 'would change' if dry_run else 'changed'
        self.stdout.write(self.style.SUCCESS(
            f'{checked} components checked; {changed} {verb}; '
            f'{unchanged} already correct; {missing} not in the database'
        ))
        for line in samples:
            self.stdout.write(f'  {line}')

    def settings_for(self, component_id):
        with connection.cursor() as cursor:
            cursor.execute('select settings_json from curriculum.components where id = %s', [component_id])
            row = cursor.fetchone()
        return views.parse_json_value(row[0], {}) if row else None
