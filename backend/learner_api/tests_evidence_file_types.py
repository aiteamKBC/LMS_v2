"""What a learner may upload as assignment evidence.

    python manage.py test learner_api.tests_evidence_file_types

Word and PowerPoint were missing, so a learner whose assignment was a .docx had
nothing they could submit — the file picker would not even offer it.

The awkward part is not the new types, it is how browsers report them. A machine
with no mapping for .docx sends application/octet-stream or nothing at all, so
matching on the declared type alone rejects legitimate coursework. The rule
therefore accepts a known type outright, and a generic type only when the
extension is one we allow — which is what keeps .exe out.
"""
from types import SimpleNamespace

from django.test import SimpleTestCase

from .evidence import (
    ALLOWED_EXTENSIONS,
    ALLOWED_TYPES,
    GENERIC_TYPES,
    _evidence_type_allowed,
)


def upload(name, content_type):
    return SimpleNamespace(name=name, content_type=content_type)


class EvidenceFileTypeTests(SimpleTestCase):
    def test_word_and_powerpoint_are_accepted(self):
        cases = [
            ('brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            ('brief.doc', 'application/msword'),
            ('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
            ('deck.ppt', 'application/vnd.ms-powerpoint'),
            ('show.ppsx', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow'),
        ]
        for name, content_type in cases:
            with self.subTest(name=name):
                self.assertTrue(_evidence_type_allowed(upload(name, content_type)))

    def test_what_was_already_accepted_still_is(self):
        for name, content_type in [
            ('report.pdf', 'application/pdf'),
            ('photo.png', 'image/png'),
            ('photo.jpg', 'image/jpeg'),
            ('clip.mp4', 'video/mp4'),
        ]:
            with self.subTest(name=name):
                self.assertTrue(_evidence_type_allowed(upload(name, content_type)))

    def test_a_browser_that_reports_no_type_is_judged_on_the_extension(self):
        """Otherwise a learner on such a machine cannot submit at all."""
        for content_type in GENERIC_TYPES:
            with self.subTest(content_type=content_type):
                self.assertTrue(_evidence_type_allowed(upload('brief.docx', content_type)))
                self.assertTrue(_evidence_type_allowed(upload('deck.pptx', content_type)))

    def test_a_generic_type_does_not_let_anything_through(self):
        """The extension has to be one of ours — this is the hole to not open."""
        for name in ('payload.exe', 'script.js', 'archive.zip', 'macro.docm', 'noextension'):
            with self.subTest(name=name):
                self.assertFalse(_evidence_type_allowed(upload(name, 'application/octet-stream')))

    def test_an_executable_is_refused_however_it_is_labelled(self):
        for content_type in ('application/x-msdownload', 'application/octet-stream', ''):
            with self.subTest(content_type=content_type):
                self.assertFalse(_evidence_type_allowed(upload('payload.exe', content_type)))

    def test_a_pdf_extension_cannot_smuggle_a_declared_executable(self):
        # A known-bad declared type is not rescued by a friendly extension.
        self.assertFalse(_evidence_type_allowed(upload('report.pdf', 'application/x-msdownload')))

    def test_types_this_app_does_not_take_are_still_refused(self):
        self.assertFalse(_evidence_type_allowed(
            upload('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        ))

    def test_a_charset_parameter_on_the_type_does_not_break_the_match(self):
        self.assertTrue(_evidence_type_allowed(upload('report.pdf', 'application/pdf; charset=binary')))

    def test_case_and_spacing_in_the_header_are_tolerated(self):
        self.assertTrue(_evidence_type_allowed(upload('report.PDF', ' APPLICATION/PDF ')))

    def test_the_two_lists_describe_the_same_set_of_files(self):
        """A type with no extension (or the reverse) is a gap between the two
        checks, and shows up as "the picker offers it, the server rejects it"."""
        self.assertEqual(len(ALLOWED_EXTENSIONS), 10)
        # Every Office type in the allow-list has its extension listed too.
        for suffix in ('.doc', '.docx', '.ppt', '.pptx', '.ppsx'):
            self.assertIn(suffix, ALLOWED_EXTENSIONS)
        self.assertIn('application/msword', ALLOWED_TYPES)
        self.assertIn(
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ALLOWED_TYPES,
        )
