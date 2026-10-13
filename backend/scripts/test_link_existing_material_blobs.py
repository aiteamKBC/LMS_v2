"""Exact archive identity and preservation checks; no database or network."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('link_blobs', Path(__file__).with_name('link_existing_material_blobs.py'))
link = importlib.util.module_from_spec(spec)
spec.loader.exec_module(link)


class LinkExistingMaterialTests(unittest.TestCase):
    def setUp(self):
        self.name = '_legacy_files/91/lesson.mp4'
        self.blobs = {self.name: {'size': 1000, 'content_type': 'video/mp4'}}
        self.material = {'id': 1, 'material_id': 5, 'content_type': 'video',
            'backup_status': 'pending', 'updated_at': 'version-1',
            'source_url': 'https://source.test/stm-lessons/lesson/',
            'video_iframe_url': 'https://source.test/stm-lessons/lesson/',
            'component_refs': ['component-one', 'component-two'], 'payload': {'completed': True}}
        self.assets = [{'component_id': 'component-one', 'source_url': link.UPLOAD_PREFIX + self.name},
                       {'component_id': 'component-two', 'embed_url': link.UPLOAD_PREFIX + self.name}]

    def plan(self):
        return link.plan_links([self.material], self.assets, self.blobs, 'files', 'curriculum', 'source.test')

    def test_exact_component_links_deduplicate_without_changing_saved_data(self):
        before = deepcopy(self.material)
        plans, skipped = self.plan()
        self.assertEqual(skipped, {})
        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0]['blob_name'], self.name)
        self.assertEqual(self.material, before)

    def test_titles_never_select_another_materials_file(self):
        self.material['component_refs'] = ['unrelated']
        self.material['title'] = self.assets[0]['title'] = 'Same title'
        self.assertEqual(self.plan(), ([], {'no_exact_mapping': 1}))

    def test_conflicting_components_are_not_resolved_by_order(self):
        self.assets[1]['embed_url'] = link.UPLOAD_PREFIX + '_legacy_files/92/other.mp4'
        self.assertEqual(self.plan(), ([], {'ambiguous': 1}))

    def test_direct_attachment_id_can_recover_without_component_link(self):
        self.material['component_refs'] = []
        self.material['video_iframe_url'] = 'https://source.test/view?attachment_id=91'
        self.assertEqual(self.plan()[0][0]['blob_name'], self.name)
        self.material['video_iframe_url'] = 'https://elsewhere.test/view?attachment_id=91'
        self.assertEqual(self.plan(), ([], {'no_exact_mapping': 1}))

    def test_attachment_and_component_disagreement_stays_visible(self):
        self.material['video_iframe_url'] = 'https://source.test/view?attachment_id=92'
        self.assertEqual(self.plan(), ([], {'component_attachment_conflict': 1}))

    def test_multiple_files_for_attachment_are_not_guessed(self):
        self.material['component_refs'] = []
        self.material['video_iframe_url'] = 'https://source.test/view?attachment_id=91'
        self.blobs['_legacy_files/91/revision.mp4'] = {'size': 20, 'content_type': 'video/mp4'}
        self.assertEqual(self.plan(), ([], {'ambiguous': 1}))

    def test_missing_empty_and_incompatible_blobs_cannot_be_marked_available(self):
        for blobs, expected in [({}, 'missing_or_empty_blob'),
                ({self.name: {'size': 0, 'content_type': 'video/mp4'}}, 'missing_or_empty_blob'),
                ({self.name: {'size': 100, 'content_type': 'text/html'}}, 'type_mismatch'),
                ({self.name: {'size': 100, 'content_type': 'application/pdf'}}, 'type_mismatch')]:
            with self.subTest(expected=expected, blobs=blobs):
                self.blobs = blobs
                self.assertEqual(self.plan(), ([], {expected: 1}))

    def test_existing_backup_and_companion_media_are_preserved(self):
        self.material['backup_status'] = 'available'
        self.assertEqual(self.plan(), ([], {'already_available': 1}))
        self.material['backup_status'] = 'pending'
        self.material['reading_iframe_url'] = 'https://source.test/companion.pdf'
        before = deepcopy(self.material)
        self.assertEqual(self.plan()[0][0]['url_field'], 'video_iframe_url')
        self.assertEqual(self.material, before)

    def test_snapshot_primary_attachment_must_agree_with_the_archive(self):
        self.material['payload']['source'] = {'attachments': [{'attachment_id': 92}]}
        self.assertEqual(self.plan(), ([], {'primary_attachment_conflict': 1}))

    def test_explicit_playable_attachment_keeps_its_identity_alongside_other_attachments(self):
        self.material['video_iframe_url'] = 'https://source.test/view?attachment_id=91'
        self.material['payload']['source'] = {'attachments': [{'attachment_id': 92}]}
        before = deepcopy(self.material)
        self.assertEqual(self.plan()[0][0]['blob_name'], self.name)
        self.assertEqual(self.material, before)

    def test_duplicate_links_in_another_media_field_do_not_hide_the_same_file(self):
        self.material['reading_iframe_url'] = self.material['video_iframe_url']
        self.assertEqual(self.plan()[0][0]['blob_name'], self.name)

    def test_supported_media_types_use_their_real_mime(self):
        for kind, mime, suffix in [('pdf', 'application/pdf', 'pdf'), ('audio', 'audio/mpeg', 'mp3'),
                ('word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'),
                ('ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx')]:
            with self.subTest(kind=kind):
                row = {**self.material, 'content_type': kind, 'video_iframe_url': None}
                name = '_legacy_files/91/lesson.' + suffix
                plans, skipped = link.plan_links([row], [{'component_id': 'component-one',
                    'source_url': link.UPLOAD_PREFIX + name}], {name: {'size': 100, 'content_type': mime}},
                    'files', 'curriculum', 'source.test')
                self.assertEqual(skipped, {})
                self.assertEqual(plans[0]['content_type'], mime)

    def test_archive_paths_reject_wrong_accounts_external_routes_and_traversal(self):
        for value in ('https://evil.test' + link.UPLOAD_PREFIX + self.name,
                'https://other.blob.core.windows.net/curriculum/' + self.name,
                '//evil.test' + link.UPLOAD_PREFIX + self.name,
                link.UPLOAD_PREFIX + '_legacy_files/91/%2e%2e',
                link.UPLOAD_PREFIX + '_legacy_files/91/../file.mp4',
                link.UPLOAD_PREFIX + '_legacy_files/91/%5cfile.mp4'):
            with self.subTest(value=value):
                self.assertIsNone(link.archive_blob(value, 'files', 'curriculum'))
        self.assertEqual(link.archive_blob('https://files.blob.core.windows.net/curriculum/' + self.name,
                                         'files', 'curriculum'), self.name)


if __name__ == '__main__':
    unittest.main()
