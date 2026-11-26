"""The legacy assignment link move, checked as a pure transformation (no database).

    python manage.py test curriculum_api.test_move_legacy_assignment_links_no_db
"""
from __future__ import annotations

import json

from django.test import SimpleTestCase

from curriculum_api.management.commands.import_mba_curriculum import extra_materials_html
from curriculum_api.management.commands.move_legacy_assignment_links import move_legacy_links, split_legacy_links

FILES = [{'attachment_id': 7, 'title': 'Brief & template', 'original_file_url': 'https://old.example.test/brief.docx'}]
LINKS = [{'open_url': 'https://www.example.test/reading'}]
# Built by the importer itself, so a change to its markup shows up here.
LEGACY = extra_materials_html(FILES, LINKS)


class SplitLegacyLinksTests(SimpleTestCase):
    def test_the_importer_list_is_recognised_with_decoded_labels(self):
        prose, links = split_legacy_links(LEGACY)
        self.assertEqual(prose, '')
        self.assertEqual(links, [
            {'label': 'Brief & template', 'url': 'https://old.example.test/brief.docx'},
            {'label': 'https://www.example.test/reading', 'url': 'https://www.example.test/reading'},
        ])

    def test_authored_text_before_the_list_is_kept(self):
        prose, links = split_legacy_links('<p>Submit one report.</p>' + LEGACY)
        self.assertEqual(prose, '<p>Submit one report.</p>')
        self.assertEqual(len(links), 2)

    def test_other_markup_is_left_alone(self):
        for html in ('', '<p>Use the template.</p>',
                     '<p><strong>Additional materials</strong></p><p>See your coach.</p>',
                     LEGACY + '<p>Then submit.</p>',
                     LEGACY.replace(' target="_blank"', '')):
            with self.subTest(html=html):
                self.assertEqual(split_legacy_links(html), (html, []))


class MoveLegacyLinksTests(SimpleTestCase):
    def test_an_assignment_without_topics_gets_topic_one_with_link_resources(self):
        settings = {'assignmentBrief': 'Analyse your campaign.', 'submissionInstructions': LEGACY,
                    'assignmentTopics': '', 'assignmentFileUrl': '/curriculum_api/curriculum/uploads/brief.pdf',
                    'assignmentFileName': 'brief.pdf', 'dueTiming': 'End of week'}
        updated, moved = move_legacy_links(settings)
        self.assertEqual(moved, 2)
        self.assertEqual(updated['submissionInstructions'], '')
        self.assertEqual(updated['dueTiming'], 'End of week')
        topics = json.loads(updated['assignmentTopics'])
        self.assertEqual([(topic['id'], topic['question'], topic['instructions']) for topic in topics],
                         [('1', 'Analyse your campaign.', '')])
        self.assertEqual([(file['fileName'], file.get('link', False)) for file in topics[0]['resources']],
                         [('brief.pdf', False), ('Brief & template', True), ('https://www.example.test/reading', True)])
        self.assertEqual(settings['submissionInstructions'], LEGACY)  # The input is not mutated.

    def test_configured_topics_move_only_their_own_lists(self):
        existing = {'fileName': 'guide.pdf', 'url': '/curriculum_api/curriculum/uploads/guide.pdf', 'size': 1, 'contentType': 'application/pdf'}
        topics = [
            {'id': '1', 'name': '', 'question': 'Question one', 'instructions': '<p>Read this first.</p>' + LEGACY, 'resources': [existing]},
            {'id': '2', 'name': 'Planning', 'question': 'Question two', 'instructions': 'Plain instructions', 'resources': []},
        ]
        settings = {'assignmentTopics': json.dumps(topics), 'submissionInstructions': LEGACY}
        updated, moved = move_legacy_links(settings)
        self.assertEqual(moved, 2)
        result = json.loads(updated['assignmentTopics'])
        self.assertEqual(result[0]['instructions'], '<p>Read this first.</p>')
        self.assertEqual([file['url'] for file in result[0]['resources']],
                         [existing['url'], 'https://old.example.test/brief.docx', 'https://www.example.test/reading'])
        self.assertEqual(result[1], topics[1])
        # Hidden from learners once topics exist, so it is left as it was.
        self.assertEqual(updated['submissionInstructions'], LEGACY)

    def test_running_again_changes_nothing(self):
        once, _ = move_legacy_links({'assignmentBrief': 'Question', 'submissionInstructions': LEGACY})
        twice, moved = move_legacy_links(once)
        self.assertEqual(moved, 0)
        self.assertEqual(twice, once)

    def test_unmovable_or_unrecognised_content_is_not_changed(self):
        relative = LEGACY.replace('https://www.example.test/reading', 'reading.html')
        for settings in ({'submissionInstructions': '<p>Write 500 words.</p>'},
                         {'submissionInstructions': relative},
                         {'submissionInstructions': LEGACY, 'assignmentTopics': '{broken'}):
            with self.subTest(settings=settings):
                self.assertEqual(move_legacy_links(settings), (settings, 0))
