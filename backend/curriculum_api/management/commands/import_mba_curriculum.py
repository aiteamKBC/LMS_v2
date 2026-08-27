"""Import the old LMS's course material into a programme in this LMS.

The legacy export lives in ``"MBA".course_curriculum``: one row per old course,
with the whole course tree in the ``curriculum`` JSONB column. That export was
generated with this LMS's own id scheme already applied — every course carries a
``MOD-…``, every section a ``WEEK-…`` and every material a ``COMP-…`` — so this
command is a straight structural upsert rather than a re-keying migration, and
re-running it updates in place instead of duplicating.

    course row          -> curriculum.modules      (title = course_name)
    curriculum.sections -> curriculum.weeks        (title = section_title)
    section.materials   -> curriculum.components   (type mapped, see TYPE_BY_KIND)

Two phases, because they have very different costs:

The structure pass (the default) writes the modules/weeks/components and points
each file at the URL it already has on the old site, so the programme is usable
at once.

``--files`` downloads the attachments into this LMS's own upload store and
re-points the components at the local copies. It is resumable — a file already
on disk is left alone — and can be narrowed with ``--file-kinds`` because the
full set is ~51 GiB.

Nothing is deleted: material that disappeared from the legacy export is left
alone rather than removed, so a bad export cannot wipe a live programme.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import unquote, urlparse

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from curriculum_api import upload_storage, views

LEGACY_SCHEMA = 'MBA'
LEGACY_TABLE = 'course_curriculum'
DEFAULT_PROGRAMME = 'PROG-20260824104138483006'

#: component_kind decides the type outright when it is more specific than the
#: material_type beside it (a live lesson is stored as material_type "text").
TYPE_BY_KIND = {
    'quiz': 'quiz',
    'assignment': 'assignment',
    'live_lesson': 'live_session',
}
#: Otherwise the material_type carries it.
TYPE_BY_MATERIAL = {
    'video': 'video',
    'stream': 'video',
    'audio': 'podcast',
    'slides': 'powerpoint',
    'pdf': 'reading',
    'word': 'reading',
    'excel': 'reading',
    'file': 'reading',
    'text': 'reading',
}

#: Attachment kinds, for --file-kinds. "video" and "audio" are almost all of the
#: 51 GiB; documents are the long tail of small files.
ALL_FILE_KINDS = ('pdf', 'slides', 'word', 'excel', 'file', 'audio', 'video')

DURATION_RE = re.compile(
    r'^\s*(?:(?P<hours>\d+(?:\.\d+)?)\s*h\w*)?\s*(?:(?P<minutes>\d+(?:\.\d+)?)\s*m\w*)?\s*$',
    re.IGNORECASE,
)
BARE_NUMBER_RE = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*$')


def parse_duration_hours(raw, measure=''):
    """Legacy ``configured_duration`` as hours, or None when it is not a duration.

    The field is free text in the old LMS: "1 h 16 m", "20 minutes ", "30", "0"
    and — in a few rows — a lesson title. Anything unparseable yields None so the
    component records no expected OTJH rather than a made-up one.
    """
    text = views.clean_str(raw)
    if not text:
        return None
    bare = BARE_NUMBER_RE.match(text)
    if bare:
        value = float(bare.group(1))
        if value <= 0:
            return None
        unit = views.clean_str(measure).lower()
        hours = value if unit.startswith('h') else value / 60
        return round(hours, 2)
    match = DURATION_RE.match(text)
    if not match or not (match.group('hours') or match.group('minutes')):
        return None
    hours = float(match.group('hours') or 0) + float(match.group('minutes') or 0) / 60
    return round(hours, 2) or None


#: The attachment kind each media type needs to have something to play/show.
SOURCE_KIND_FOR_TYPE = {'video': 'video', 'podcast': 'audio', 'powerpoint': 'slides'}


def component_type_for(material):
    """The component type to give one legacy material.

    ``component_kind`` wins where it is the more specific of the two labels; a
    live lesson, for instance, is stored with material_type "text". Otherwise
    material_type decides — except when it claims a medium the material has no
    source for (a "video" whose only file is a handout), where what the material
    actually carries is the truer answer.
    """
    kind = views.clean_str(material.get('component_kind')).lower()
    if kind in TYPE_BY_KIND:
        return TYPE_BY_KIND[kind]
    material_type = views.clean_str(material.get('material_type')).lower()
    mapped = TYPE_BY_MATERIAL.get(material_type, 'reading')
    wanted = SOURCE_KIND_FOR_TYPE.get(mapped)
    if wanted and not primary_link(material)[1] and not attachment_of_kinds(material, {wanted}):
        if material.get('attachments') or views.clean_str(material.get('content_html')):
            return 'reading'
    return mapped


def primary_link(material):
    """The link a video/live component is actually about."""
    for link in material.get('external_links') or []:
        url = views.clean_str(link.get('open_url') or link.get('original_url'))
        if url:
            return link, url
    return None, ''


def same_target(left, right):
    """Whether two authored URLs point at the same thing.

    The export can carry one web page twice over — once as ``open_url`` and once
    as ``original_url`` — differing only in how the fragment is percent-encoded,
    which made a reading list the very article it was already pointing at.
    """
    def normalise(value):
        text = views.clean_str(value)
        if not text:
            return ''
        parsed = urlparse(unquote(text))
        return parsed._replace(fragment='').geturl().rstrip('/').lower()
    return bool(left) and normalise(left) == normalise(right)


def extra_materials_html(files, links, primary=None, skip_url=''):
    """The leftovers as a small HTML list, so nothing in the export is dropped.

    A component in this LMS holds one primary resource; the old one could carry
    several files and links at once (translations of a handout, reference PNGs).
    Those extras go into the component's own prose field rather than vanishing.

    The primary is excluded by identity rather than by URL, because by the time
    a file has been copied into our own storage its URL no longer matches the
    old-site one in the export — which listed the document a learner was already
    being shown, as a link back to the old site.
    """
    primary_id = (primary or {}).get('attachment_id')
    items = []
    for attachment in files:
        url = views.clean_str(attachment.get('original_file_url'))
        title = views.clean_str(attachment.get('title') or attachment.get('filename'))
        if primary_id is not None and attachment.get('attachment_id') == primary_id:
            continue
        if url and url != skip_url:
            items.append((title or url, url))
    for link in links:
        url = views.clean_str(link.get('open_url') or link.get('original_url'))
        if url and not same_target(url, skip_url):
            items.append((url, url))
    if not items:
        return ''
    rows = ''.join(
        '<li><a href="%s" target="_blank" rel="noreferrer">%s</a></li>' % (url, views.escape(label))
        for label, url in items
    )
    return '<p><strong>Additional materials</strong></p><ul>%s</ul>' % rows


def attachment_of_kinds(material, kinds):
    for attachment in material.get('attachments') or []:
        if views.clean_str(attachment.get('file_kind')).lower() in kinds:
            return attachment
    return None


def build_settings(component_type, material, file_url_for):
    """Settings for one component, in the shape this LMS's authoring model uses.

    Only keys the component's own schema allows are written (plus the permitted
    ``legacySourceType`` marker) — the module builder's validator rejects any
    others, so provenance beyond that marker stays in the legacy table rather
    than being smuggled in here.
    """
    files = material.get('attachments') or []
    links = material.get('external_links') or []
    content_html = views.clean_str(material.get('content_html'))
    link, link_url = primary_link(material)
    duration_hours = parse_duration_hours(
        material.get('configured_duration'), material.get('configured_duration_measure'),
    )
    duration_minutes = int(round(duration_hours * 60)) if duration_hours else 0

    # Imported material is live content, so it lands approved — except where the
    # export carried nothing at all, which is left as a draft for an author to
    # finish rather than published as an empty component.
    has_material = bool(content_html or link_url or files)
    settings = {
        'version': '0.1',
        'contentStatus': 'Approved' if has_material else 'Draft',
        'legacySourceType': 'mba-legacy',
    }

    if component_type == 'video':
        attachment = attachment_of_kinds(material, {'video'})
        video_url = file_url_for(attachment) if attachment else ''
        settings.update({
            'videoUrl': video_url or link_url,
            'provider': views.clean_str(link.get('provider')) if link else ('upload' if video_url else ''),
            'sourceType': 'Uploaded file' if video_url else 'External link',
            'durationMinutes': duration_minutes,
            'lessonContent': content_html,
            'lessonMaterialLinks': extra_materials_html(files, links, attachment, link_url),
        })
    elif component_type == 'podcast':
        attachment = attachment_of_kinds(material, {'audio'})
        audio_url = file_url_for(attachment) if attachment else ''
        settings.update({
            'podcastUrl': audio_url or link_url,
            'podcastSource': 'Device upload' if audio_url else 'External URL',
            'durationMinutes': duration_minutes,
            'transcript': content_html + extra_materials_html(files, links, attachment, link_url),
        })
        if attachment:
            settings.update(upload_settings(attachment, audio_url))
    elif component_type == 'powerpoint':
        attachment = attachment_of_kinds(material, {'slides'})
        deck_url = file_url_for(attachment) if attachment else ''
        settings.update({
            'presentationUrl': deck_url or link_url,
            'fileName': views.clean_str((attachment or {}).get('title') or (attachment or {}).get('filename')),
            'downloadAllowed': True,
            'speakerNotes': content_html + extra_materials_html(files, links, attachment, link_url),
        })
        if attachment:
            settings.update(upload_settings(attachment, deck_url))
    elif component_type == 'assignment':
        attachment = attachment_of_kinds(material, set(ALL_FILE_KINDS))
        brief_url = file_url_for(attachment) if attachment else ''
        settings.update({
            'assignmentBrief': content_html,
            'assignmentFileUrl': brief_url or link_url,
            'assignmentFileName': views.clean_str((attachment or {}).get('title') or (attachment or {}).get('filename')),
            'submissionInstructions': extra_materials_html(files, links, attachment, link_url),
        })
        if attachment:
            settings.update(upload_settings(attachment, brief_url))
    elif component_type == 'quiz':
        # The export carries no questions, only the pass mark, so the component
        # records the mark and stays unlinked rather than pointing at an empty
        # quiz. buildMode says where the questions still have to come from.
        settings.update({
            'passMarkPercentage': views.parse_int(material.get('passing_grade_percent'), 0),
            'buildMode': 'Import from legacy LMS',
            'attemptsAllowed': 0,
            'numberOfQuestions': 0,
        })
    elif component_type == 'live_session':
        settings.update({
            'liveSessionUrl': link_url,
            'durationMinutes': duration_minutes,
            'attendanceRequired': True,
            'preparationInstructions': content_html + extra_materials_html(files, links, None, link_url),
        })
    else:  # reading — the catch-all for pdf/word/excel/file/text
        attachment = attachment_of_kinds(material, {'pdf', 'word', 'excel', 'file', 'slides'})
        resource_url = file_url_for(attachment) if attachment else ''
        settings.update({
            'readingContent': content_html + extra_materials_html(files, links, attachment, link_url),
            'resourceUrl': resource_url or link_url,
            'readingSource': 'LMS resource' if (resource_url or link_url) else 'Written in LMS',
            'estimatedReadingTime': str(duration_minutes or ''),
            'requirement': 'Required',
        })
        if attachment:
            settings.update(upload_settings(attachment, resource_url))

    return views.normalise_component_settings_payload(
        views.frontend_component_type(component_type), settings,
    )


def course_label(record):
    """A name for one legacy course. Four of them have neither a course_name nor
    a course_title in the export, so the module id is the last resort."""
    payload = record.get('curriculum') if isinstance(record.get('curriculum'), dict) else {}
    return (
        views.clean_str(record.get('course_name'))
        or views.clean_str(payload.get('course_title'))
        or views.clean_str(record.get('module_id'))
        or 'untitled course'
    )


def legacy_file_url(attachment):
    """The file's URL on the old site — what a component points at until the
    download pass replaces it with a local copy."""
    return views.clean_str((attachment or {}).get('original_file_url'))


def upload_settings(attachment, url):
    """The uploaded-file block, filled in only once the file is ours."""
    if not url or not url.startswith('/curriculum_api/'):
        return {}
    return {
        'uploadedFileUrl': url,
        'uploadedFileName': views.clean_str(attachment.get('title') or attachment.get('filename')),
        'uploadedFileSize': views.parse_int(attachment.get('file_size_bytes'), 0),
        'uploadedFileContentType': views.clean_str(attachment.get('mime_type')),
        'uploadSource': 'Legacy LMS import',
    }


def legacy_rows(course_ids=None, limit=None):
    """The legacy export, newest id last, with the payload decoded.

    Every row stores the tree double-encoded — a JSON string inside the JSONB
    column — so it is decoded twice here rather than trusted as an object.
    """
    query = f'select course_id, course_name, course_category, tutor_id, tutor_name, tutor_email, module_id, curriculum from "{LEGACY_SCHEMA}".{LEGACY_TABLE}'
    params = []
    if course_ids:
        query += ' where course_id = any(%s)'
        params.append(list(course_ids))
    query += ' order by course_id'
    if limit:
        query += ' limit %s'
        params.append(limit)
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        columns = [description[0] for description in cursor.description]
        for row in cursor.fetchall():
            record = dict(zip(columns, row))
            payload = record.get('curriculum')
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except ValueError:
                    payload = {}
            record['curriculum'] = payload if isinstance(payload, dict) else {}
            yield record


#: Downloaded legacy files live together, keyed by the old LMS's attachment id.
LEGACY_FILE_DIR = '_legacy_files'


def local_upload_path(attachment_id, filename):
    """Where a downloaded attachment lives, and the URL that serves it.

    Keyed by the old LMS's attachment id rather than by component, because the
    export references the same file from many components — the same handout
    across a dozen lectures. One copy per file instead of one per reference is
    28 GiB rather than 51, and the existing uploads route serves it either way.
    """
    folder = views.safe_upload_segment(str(attachment_id or 'file'), 'file')
    safe_name = views.get_valid_filename(filename or 'resource')
    relative = f'{views.COMPONENT_UPLOAD_ROOT}/{LEGACY_FILE_DIR}/{folder}/{safe_name}'
    url = f'/curriculum_api/curriculum/uploads/{LEGACY_FILE_DIR}/{folder}/{safe_name}'
    return relative, url


class Command(BaseCommand):
    help = 'Import the legacy MBA course material into a programme in this LMS.'

    def add_arguments(self, parser):
        parser.add_argument('--programme', default=DEFAULT_PROGRAMME,
                            help=f'Target programme_id (default {DEFAULT_PROGRAMME}).')
        parser.add_argument('--courses', default='',
                            help='Comma-separated legacy course_ids; default is every course.')
        parser.add_argument('--limit', type=int, default=None,
                            help='Import only the first N courses (by course_id).')
        parser.add_argument('--files', action='store_true',
                            help='Download attachments and re-point components at the local copies.')
        parser.add_argument('--skip-structure', action='store_true',
                            help='With --files, leave the module/week/component rows untouched.')
        parser.add_argument('--file-kinds', default='pdf,slides,word,excel,file',
                            help='Attachment kinds to download (%s, or "all").' % ', '.join(ALL_FILE_KINDS))
        parser.add_argument('--max-file-mb', type=float, default=200.0,
                            help='Skip any single attachment larger than this (default 200 MB).')
        parser.add_argument('--default-otjh', type=float, default=0.0,
                            help='Expected OTJH for components whose legacy duration is '
                                 'unusable (default 0 — most of the export has none).')
        parser.add_argument('--dry-run', action='store_true',
                            help='Report what would change and write nothing.')

    def handle(self, *args, **options):
        programme_id = views.clean_str(options['programme'])
        course_ids = [int(value) for value in options['courses'].replace(' ', '').split(',') if value]
        self.dry_run = options['dry_run']

        programme = self.programme_row(programme_id)
        if not programme:
            raise CommandError(f'Programme {programme_id} does not exist.')
        self.stdout.write(f'Programme {programme_id} — "{programme["name"]}"')

        rows = list(legacy_rows(course_ids or None, options['limit']))
        if not rows:
            raise CommandError('The legacy export returned no courses.')
        self.stdout.write(f'Legacy courses: {len(rows)}')

        if not options['skip_structure']:
            self.import_structure(rows, programme, options['default_otjh'])
        if options['files']:
            kinds = ALL_FILE_KINDS if options['file_kinds'] == 'all' else tuple(
                kind.strip().lower() for kind in options['file_kinds'].split(',') if kind.strip()
            )
            self.download_files(rows, kinds, options['max_file_mb'])

    # -- helpers ------------------------------------------------------------

    def programme_row(self, programme_id):
        with connection.cursor() as cursor:
            cursor.execute(
                'select programme_id, name from curriculum.programmes where programme_id = %s',
                [programme_id],
            )
            row = cursor.fetchone()
        return {'programme_id': row[0], 'name': row[1]} if row else None

    # -- phase 1: structure -------------------------------------------------

    def import_structure(self, rows, programme, default_otjh=0.0):
        counts = {'modules': 0, 'weeks': 0, 'components': 0, 'skipped_weeks': 0, 'otjh_defaulted': 0}
        for record in rows:
            payload = record['curriculum']
            module_id = views.clean_str(payload.get('module_id') or record.get('module_id'))
            if not module_id:
                self.stderr.write(f'  course {record["course_id"]}: no module id, skipped')
                continue
            sections = payload.get('sections') or []

            week_payloads, component_payloads = [], []
            module_otjh = 0.0
            for section in sections:
                week_id = views.clean_str(section.get('week_id'))
                if not week_id:
                    counts['skipped_weeks'] += 1
                    continue
                order = views.parse_int(section.get('section_order'), len(week_payloads) + 1)
                week_payloads.append({
                    'id': week_id,
                    'module_catalogue_id': module_id,
                    'week_number': order or len(week_payloads) + 1,
                    'title': views.clean_str(section.get('section_title')) or f'Week {order}',
                    'display_order': order,
                    'is_programme_deleted': False,
                    'deleted_at': None,
                    'deleted_by': None,
                    'deleted_via_parent': None,
                })
                for index, material in enumerate(section.get('materials') or [], start=1):
                    component_id = views.clean_str(material.get('component_id'))
                    if not component_id:
                        continue
                    component_type = component_type_for(material)
                    settings = build_settings(component_type, material, legacy_file_url)
                    hours = parse_duration_hours(
                        material.get('configured_duration'),
                        material.get('configured_duration_measure'),
                    )
                    if hours is None:
                        hours = default_otjh
                        counts['otjh_defaulted'] += 1
                    module_otjh += hours
                    component_payloads.append({
                        'id': component_id,
                        'week_id': week_id,
                        'module_catalogue_id': module_id,
                        'type': views.stored_component_type(component_type),
                        'title': views.clean_str(material.get('title')) or 'Untitled',
                        'description': '',
                        'expected_otjh': hours,
                        'points': 0,
                        'reflection_required': False,
                        'workplace_evidence_required': False,
                        'tutor_validation_required': False,
                        'display_order': views.parse_int(material.get('component_order'), index),
                        'settings_json': views.json_db_value(settings),
                        'live_sessions_link': views.clean_str(settings.get('liveSessionUrl')),
                        'ksb_mappings': views.json_db_value([]),
                        'is_programme_deleted': False,
                        'deleted_at': None,
                        'deleted_by': None,
                        'deleted_via_parent': None,
                    })

            module_payload = {
                'module_catalogue_id': module_id,
                'programme_id': programme['programme_id'],
                'programme_name': programme['name'],
                'title': course_label(record),
                'description': views.clean_str(record.get('course_category')),
                'tutor_name': views.clean_str(record.get('tutor_name')),
                'tutor_email': (
                    views.clean_str(record.get('tutor_email'))
                    or views.resolve_staff_assignment_email('tutor', record.get('tutor_name'))
                ),
                'total_otjh': round(module_otjh, 2),
                'weeks_number': len(week_payloads),
                'sessions_number': len(week_payloads),
                'source_type': 'mba-legacy',
                'source_id': str(record.get('course_id')),
                'is_programme_deleted': False,
                'deleted_at': None,
                'deleted_by': None,
                'deleted_via_parent': None,
            }

            if self.dry_run:
                self.stdout.write(
                    f'  would import {module_payload["title"][:52]:<52} '
                    f'{len(week_payloads):>3} weeks {len(component_payloads):>5} components'
                )
            else:
                with transaction.atomic():
                    views.authoring_upsert(views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], module_payload)
                    views.authoring_bulk_upsert(views.AUTHORING_WEEKS_TABLE, ['id'], week_payloads)
                    views.authoring_bulk_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], component_payloads)
                self.stdout.write(
                    f'  {module_payload["title"][:52]:<52} '
                    f'{len(week_payloads):>3} weeks {len(component_payloads):>5} components'
                )
            counts['modules'] += 1
            counts['weeks'] += len(week_payloads)
            counts['components'] += len(component_payloads)

        verb = 'would import' if self.dry_run else 'imported'
        self.stdout.write(self.style.SUCCESS(
            f'Structure {verb}: {counts["modules"]} modules, {counts["weeks"]} weeks, '
            f'{counts["components"]} components '
            f'({counts["otjh_defaulted"]} had no usable duration -> {default_otjh}h)'
            + (f'; {counts["skipped_weeks"]} sections had no week id' if counts['skipped_weeks'] else '')
        ))

    # -- phase 2: files -----------------------------------------------------

    def download_files(self, rows, kinds, max_file_mb):
        media_root = Path(views.settings.MEDIA_ROOT)
        max_bytes = int(max_file_mb * 1024 * 1024)
        stats = {'downloaded': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'bytes': 0,
                 'repointed': 0, 'missing': 0}
        started = time.time()

        for record in rows:
            payload = record['curriculum']
            for section in payload.get('sections') or []:
                for material in section.get('materials') or []:
                    component_id = views.clean_str(material.get('component_id'))
                    if not component_id:
                        continue
                    local_urls = {}
                    for attachment in material.get('attachments') or []:
                        kind = views.clean_str(attachment.get('file_kind')).lower()
                        size = views.parse_int(attachment.get('file_size_bytes'), 0)
                        if kind not in kinds:
                            stats['skipped'] += 1
                            continue
                        if size and size > max_bytes:
                            self.stderr.write(
                                f'  too large ({size / 1024 / 1024:.0f} MB): '
                                f'{attachment.get("filename")}'
                            )
                            stats['skipped'] += 1
                            continue
                        name = views.clean_str(attachment.get('filename') or attachment.get('title'))
                        relative, url = local_upload_path(attachment.get('attachment_id'), name)
                        target = media_root / relative
                        # Already ours? Checked through upload_storage, not just
                        # the disk: once a file has been migrated to blob storage
                        # its local copy is gone, and a disk-only check would
                        # re-download every migrated file from the old site.
                        if upload_storage.exists(relative):
                            stats['existing'] += 1
                            local_urls[attachment.get('attachment_id')] = url
                            continue
                        if self.dry_run:
                            stats['downloaded'] += 1
                            stats['bytes'] += size
                            continue
                        fetched = self.fetch(attachment, target)
                        if fetched is None:
                            stats['failed'] += 1
                            continue
                        stats['downloaded'] += 1
                        stats['bytes'] += fetched
                        local_urls[attachment.get('attachment_id')] = url

                    if local_urls and not self.dry_run:
                        component_type = component_type_for(material)
                        # Falls back to the old-site URL for anything this run
                        # did not fetch (a kind that was filtered out, a file that
                        # was too large), so re-pointing never blanks a source.
                        settings = build_settings(
                            component_type, material,
                            lambda attachment: (
                                local_urls.get((attachment or {}).get('attachment_id'))
                                or legacy_file_url(attachment)
                            ),
                        )
                        # An update, never an upsert: this pass only re-points
                        # components the structure pass already wrote, and an
                        # insert here would create a row with no week or module.
                        updated = views.update_rows(
                            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id],
                            {'settings_json': views.json_db_value(settings)},
                        )
                        if updated:
                            stats['repointed'] += 1
                        else:
                            stats['missing'] += 1

            elapsed = time.time() - started
            self.stdout.write(
                f'  {course_label(record)[:44]:<44} '
                f'downloaded {stats["downloaded"]:>5} '
                f'({stats["bytes"] / 1024 / 1024 / 1024:.2f} GiB) '
                f'existing {stats["existing"]:>5} failed {stats["failed"]:>4} '
                f'[{elapsed / 60:.1f} min]'
            )

        self.stdout.write(self.style.SUCCESS(
            f'Files: {stats["downloaded"]} downloaded ({stats["bytes"] / 1024 / 1024 / 1024:.2f} GiB), '
            f'{stats["existing"]} already present, {stats["skipped"]} skipped, '
            f'{stats["failed"]} failed, {stats["repointed"]} components re-pointed'
            + (f', {stats["missing"]} components not found' if stats['missing'] else '')
        ))

    def fetch(self, attachment, target):
        """Download one attachment, returning its size, or None on failure.

        The signed ``migration_download_url`` is tried first because it is what
        the export provides for exactly this purpose; the public URL is the
        fallback for a token that has already expired.
        """
        urls = [
            views.clean_str(attachment.get('migration_download_url')),
            views.clean_str(attachment.get('original_file_url')),
        ]
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + '.part')
        for url in [candidate for candidate in urls if candidate]:
            try:
                request = urllib_request.Request(url, headers={'User-Agent': 'KBC-LMS-import/1.0'})
                with urllib_request.urlopen(request, timeout=120) as response, partial.open('wb') as handle:
                    size = 0
                    while True:
                        chunk = response.read(262144)
                        if not chunk:
                            break
                        handle.write(chunk)
                        size += len(chunk)
                if size <= 0:
                    partial.unlink(missing_ok=True)
                    continue
                partial.replace(target)
                return size
            except (urllib_error.URLError, OSError, TimeoutError) as error:
                partial.unlink(missing_ok=True)
                self.stderr.write(f'  fetch failed ({error}): {url[:110]}')
        return None
