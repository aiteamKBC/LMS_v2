"""Which document a learner is shown for a component that has more than one.

Switching source type in the builder does not clear the field it moved away
from, so a component can carry an external link *and* an uploaded file. Serving
whichever came first in the lookup handed learners a link they had no access to
while the real deck sat uploaded beside it — see _component_resource_url.
"""
import json

from django.test import SimpleTestCase

from .learner_detail import _authored_source_type, _component_resource_url

LINK = 'https://kentbusinesscollege-my.sharepoint.com/:p:/p/someone/IQBoRcO'
UPLOAD = '/curriculum_api/curriculum/uploads/MOD-1/COMP-1/lesson_13_risk.pptx'


class AuthoredSourceTypeTests(SimpleTestCase):
    def test_the_builders_own_key_is_read(self):
        self.assertEqual(_authored_source_type({'powerpointSource': 'Uploaded File'}), 'Uploaded File')

    def test_a_source_kept_in_legacy_settings_is_read(self):
        # Rows written through the older authoring path nest it, as a JSON string.
        settings = {'legacySettings': json.dumps({'powerpointSource': 'Uploaded File'})}

        self.assertEqual(_authored_source_type(settings), 'Uploaded File')

    def test_unparseable_legacy_settings_are_ignored(self):
        self.assertEqual(_authored_source_type({'legacySettings': '{not json'}), '')

    def test_no_source_recorded_is_empty(self):
        self.assertEqual(_authored_source_type({'presentationUrl': LINK}), '')


class ComponentResourceUrlTests(SimpleTestCase):
    def test_an_uploaded_deck_wins_when_that_is_what_the_author_chose(self):
        settings = {
            'presentationUrl': LINK,
            'uploadedFileUrl': UPLOAD,
            'legacySettings': json.dumps({'powerpointSource': 'Uploaded File'}),
        }

        self.assertEqual(_component_resource_url(settings), UPLOAD)

    def test_the_link_wins_when_that_is_what_the_author_chose(self):
        settings = {
            'presentationUrl': LINK,
            'uploadedFileUrl': UPLOAD,
            'powerpointSource': 'External Link',
        }

        self.assertEqual(_component_resource_url(settings), LINK)

    def test_with_no_source_recorded_the_original_order_stands(self):
        # Every bulk-imported row: both fields hold the same hosted path anyway,
        # so this only has to stay predictable.
        settings = {'presentationUrl': LINK, 'uploadedFileUrl': UPLOAD}

        self.assertEqual(_component_resource_url(settings), LINK)

    def test_the_only_document_there_is_served_whatever_the_source_says(self):
        self.assertEqual(
            _component_resource_url({'powerpointSource': 'External Link', 'uploadedFileUrl': UPLOAD}),
            UPLOAD,
        )
        self.assertEqual(
            _component_resource_url({'powerpointSource': 'Uploaded File', 'presentationUrl': LINK}),
            LINK,
        )

    def test_an_explicit_resource_url_still_wins_for_other_component_types(self):
        settings = {'resourceUrl': 'https://example.com/brief.docx', 'presentationUrl': LINK}

        self.assertEqual(_component_resource_url(settings), 'https://example.com/brief.docx')

    def test_a_component_with_nothing_attached_has_no_document(self):
        self.assertIsNone(_component_resource_url({'presentationUrl': '', 'uploadedFileUrl': ''}))
