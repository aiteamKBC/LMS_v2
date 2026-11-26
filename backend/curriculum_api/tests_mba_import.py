"""The legacy MBA import's decisions, checked without a database.

    python manage.py test curriculum_api.tests_mba_import

The import writes 17,836 components in one run, so the value here is in the
per-material judgements it makes 17,836 times: what type a material becomes,
what its settings look like, and whether the result is something the module
builder would accept back. Every payload is asserted against the app's own
``validate_component_authoring_payload`` rather than against a copy of the
schema, so a change to the authoring model shows up here as a failure.
"""
from __future__ import annotations

from django.test import SimpleTestCase

from curriculum_api import views
from curriculum_api.management.commands import import_mba_curriculum as importer


def material(**overrides):
    """One legacy material, with the keys every export row carries."""
    base = {
        'title': 'Lecture 1',
        'component_id': 'COMP-1',
        'week_id': 'WEEK-1',
        'module_id': 'MOD-1',
        'component_kind': 'lesson',
        'material_type': 'text',
        'content_html': '',
        'attachments': [],
        'external_links': [],
        'configured_duration': None,
        'configured_duration_measure': None,
        'component_order': 1,
    }
    base.update(overrides)
    return base


def attachment(kind='pdf', **overrides):
    base = {
        'attachment_id': 4242,
        'file_kind': kind,
        'filename': f'handout.{kind}',
        'title': f'Handout ({kind})',
        'mime_type': 'application/pdf',
        'file_size_bytes': 1024,
        'original_file_url': 'https://old.example.test/wp-content/handout.pdf',
        'migration_download_url': 'https://old.example.test/api/file/4242?token=abc',
    }
    base.update(overrides)
    return base


def link(provider='youtube', **overrides):
    base = {
        'provider': provider,
        'link_kind': 'link',
        'open_url': 'https://www.youtube.com/watch?v=abc123',
        'embed_url': 'https://www.youtube.com/embed/abc123',
        'original_url': 'https://youtu.be/abc123',
        'source_id': 'abc123',
    }
    base.update(overrides)
    return base


class DurationTests(SimpleTestCase):
    """``configured_duration`` is free text in the old LMS, including junk."""

    def test_reads_the_shapes_the_export_actually_contains(self):
        self.assertEqual(importer.parse_duration_hours('1 h 16 m'), 1.27)
        self.assertEqual(importer.parse_duration_hours('20 minutes '), 0.33)
        self.assertEqual(importer.parse_duration_hours('30'), 0.5)
        self.assertEqual(importer.parse_duration_hours('2', 'hours'), 2)

    def test_refuses_to_invent_hours(self):
        # A lesson title in the duration field is real export data. Guessing here
        # would inflate a programme's OTJH by thousands of hours.
        for value in (None, '', '0', 'HRM Definition', 'n/a'):
            self.assertIsNone(importer.parse_duration_hours(value), value)


class TypeMappingTests(SimpleTestCase):
    def test_component_kind_wins_where_it_is_the_specific_one(self):
        # A live lesson is stored with material_type "text".
        self.assertEqual(
            importer.component_type_for(material(component_kind='live_lesson', material_type='text')),
            'live_session',
        )
        self.assertEqual(importer.component_type_for(material(component_kind='quiz', material_type='quiz')), 'quiz')
        self.assertEqual(
            importer.component_type_for(material(component_kind='assignment', material_type='assignment')),
            'assignment',
        )

    def test_material_type_carries_the_rest(self):
        # Each case carries the source its medium needs — a "stream" is a video
        # with a video file, not a file of kind "stream".
        expected = {
            'video': ('video', 'video'), 'stream': ('video', 'video'),
            'audio': ('audio', 'podcast'), 'slides': ('slides', 'powerpoint'),
            'pdf': ('pdf', 'reading'), 'word': ('word', 'reading'),
            'excel': ('excel', 'reading'), 'text': ('pdf', 'reading'),
        }
        for material_type, (file_kind, component_type) in expected.items():
            self.assertEqual(
                importer.component_type_for(material(
                    material_type=material_type,
                    attachments=[attachment(file_kind)],
                )),
                component_type,
                material_type,
            )

    def test_a_medium_with_no_source_becomes_what_it_actually_carries(self):
        """A "video" whose only file is a handout is a reading, not a video.

        Trusting material_type here produced components the authoring validator
        rejected: a video with no video to play.
        """
        self.assertEqual(
            importer.component_type_for(material(material_type='video', attachments=[attachment('pdf')])),
            'reading',
        )
        # But a video with a link, or with a video file, stays a video.
        self.assertEqual(
            importer.component_type_for(material(material_type='video', external_links=[link()])),
            'video',
        )
        self.assertEqual(
            importer.component_type_for(material(material_type='video', attachments=[attachment('video')])),
            'video',
        )

    def test_an_unknown_material_type_falls_back_to_reading(self):
        self.assertEqual(importer.component_type_for(material(material_type='xyzzy')), 'reading')


class SettingsTests(SimpleTestCase):
    def build(self, component_type, item, resolver=None):
        return importer.build_settings(component_type, item, resolver or importer.legacy_file_url)

    def test_video_takes_its_url_from_the_link(self):
        settings = self.build('video', material(material_type='video', external_links=[link()]))
        self.assertEqual(settings['videoUrl'], 'https://www.youtube.com/watch?v=abc123')
        self.assertEqual(settings['provider'], 'youtube')
        self.assertEqual(settings['sourceType'], 'External link')

    def test_reading_keeps_written_content_and_the_file(self):
        settings = self.build('reading', material(
            content_html='<p>Chapter 1</p>', attachments=[attachment('pdf')],
        ))
        self.assertIn('<p>Chapter 1</p>', settings['readingContent'])
        self.assertEqual(settings['resourceUrl'], 'https://old.example.test/wp-content/handout.pdf')
        self.assertEqual(settings['readingSource'], 'LMS resource')

    def test_leftover_files_and_links_are_preserved_not_dropped(self):
        """A legacy material could carry several files; a component holds one."""
        settings = self.build('reading', material(attachments=[
            attachment('pdf'),
            attachment('word', attachment_id=99, filename='notes-fr.docx',
                       original_file_url='https://old.example.test/notes-fr.docx'),
        ]))
        self.assertIn('Additional materials', settings['readingContent'])
        self.assertIn('notes-fr.docx', settings['readingContent'])

    def test_the_document_being_shown_is_not_also_listed_as_a_link(self):
        """The bug: a learner saw the PDF in the viewer and, above it, a link to
        the same PDF on the old site — because the primary was excluded by URL,
        and by then our copy had a different URL to the export's."""
        local = '/curriculum_api/curriculum/uploads/_legacy_files/4242/handout.pdf'
        settings = self.build('reading', material(attachments=[attachment('pdf')]),
                              resolver=lambda _attachment: local)
        self.assertEqual(settings['resourceUrl'], local)
        self.assertNotIn('Additional materials', settings['readingContent'])
        self.assertNotIn('old.example.test', settings['readingContent'])

    def test_a_local_copy_fills_in_the_uploaded_file_block(self):
        local = '/curriculum_api/curriculum/uploads/_legacy_files/4242/handout.pdf'
        settings = self.build('reading', material(attachments=[attachment('pdf')]),
                              resolver=lambda _attachment: local)
        self.assertEqual(settings['resourceUrl'], local)
        self.assertEqual(settings['uploadedFileUrl'], local)
        self.assertEqual(settings['uploadSource'], 'Legacy LMS import')

    def test_an_old_site_url_is_not_labelled_as_an_upload(self):
        settings = self.build('reading', material(attachments=[attachment('pdf')]))
        self.assertEqual(settings.get('uploadedFileUrl', ''), '')

    def test_quizzes_record_the_pass_mark_and_stay_unlinked(self):
        # The export carries no questions, so an imported quiz must not pretend
        # to point at one.
        settings = self.build('quiz', material(
            component_kind='quiz', material_type='quiz', passing_grade_percent=70,
        ))
        self.assertEqual(settings['passMarkPercentage'], 70)
        self.assertEqual(settings['linkedQuizId'], '')
        self.assertEqual(settings['buildMode'], 'Import from legacy LMS')

    def test_material_that_is_entirely_empty_stays_a_draft(self):
        self.assertEqual(self.build('reading', material())['contentStatus'], 'Draft')
        self.assertEqual(
            self.build('reading', material(content_html='<p>x</p>'))['contentStatus'],
            'Approved',
        )

    def test_every_type_survives_the_authoring_validator(self):
        """What the module builder would say about each imported component.

        Settings that fail here save fine but cannot be edited afterwards: the
        builder refuses the payload it just loaded.
        """
        cases = {
            'video': material(material_type='video', external_links=[link()], configured_duration='20 minutes'),
            'podcast': material(material_type='audio', attachments=[attachment('audio')]),
            'powerpoint': material(material_type='slides', attachments=[attachment('slides')]),
            'reading': material(material_type='pdf', attachments=[attachment('pdf')], content_html='<p>x</p>'),
            'quiz': material(component_kind='quiz', material_type='quiz', passing_grade_percent=60),
            'assignment': material(component_kind='assignment', material_type='assignment', content_html='<p>Brief</p>'),
            'live_session': material(component_kind='live_lesson', material_type='text', external_links=[link('external')]),
        }
        for component_type, item in cases.items():
            settings = self.build(component_type, item)
            problems = views.validate_component_authoring_payload({
                'type': views.frontend_component_type(component_type),
                'title': item['title'],
                'settings': dict(settings),
                'points': 0,
                'expectedOtjh': 1,
            }, 'component')
            self.assertEqual(problems, [], f'{component_type}: {problems}')


class CourseLabelTests(SimpleTestCase):
    """Four legacy courses have no name at all — the import must not crash."""

    def test_falls_back_through_title_then_module_id(self):
        self.assertEqual(
            importer.course_label({'course_name': 'Strategic HRM', 'curriculum': {}}),
            'Strategic HRM',
        )
        self.assertEqual(
            importer.course_label({'course_name': None, 'curriculum': {'course_title': 'Fallback'}}),
            'Fallback',
        )
        self.assertEqual(
            importer.course_label({'course_name': None, 'module_id': 'MOD-9', 'curriculum': {}}),
            'MOD-9',
        )
        self.assertEqual(importer.course_label({'curriculum': None}), 'untitled course')


class LocalPathTests(SimpleTestCase):
    def test_files_are_stored_once_per_attachment_not_per_component(self):
        """De-duplicating by attachment id is 28 GiB of downloads instead of 51."""
        first, url = importer.local_upload_path(4242, 'Chapter 1 & 2.pdf')
        second, same_url = importer.local_upload_path(4242, 'Chapter 1 & 2.pdf')
        self.assertEqual(first, second)
        self.assertEqual(url, same_url)
        self.assertTrue(url.startswith('/curriculum_api/curriculum/uploads/_legacy_files/4242/'))
        self.assertTrue(first.startswith(f'{views.COMPONENT_UPLOAD_ROOT}/_legacy_files/4242/'))
        # The served name is filesystem-safe, not the raw legacy filename.
        self.assertNotIn(' ', url)
        self.assertNotIn('&', url)
