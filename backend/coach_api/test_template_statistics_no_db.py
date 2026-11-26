from types import SimpleNamespace
from datetime import datetime, timezone

from django.test import SimpleTestCase

from .migrated_templates import serialize_template


class TemplateStatisticsTests(SimpleTestCase):
    def test_list_contains_counts_without_definition_or_detail_reads(self):
        definition = {'sections': [{'fields': [
            {'aptemType': 11},
            {'aptemType': 13, 'ifTrue': [{'aptemType': 11}, {'aptemType': 13}], 'ifFalse': [{'aptemType': 1}]},
        ]}, {'fields': []}]}
        template = SimpleNamespace(pk=1, scope='GLOBAL', programme_key='', review_family='PR', name='Synthetic',
                                   is_active=True, updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                                   source_metadata={}, definition_json=definition)
        summary = serialize_template(template)
        self.assertEqual(summary['statistics'], {'sections': 2, 'questions': 3})
        self.assertNotIn('definition', summary)
        self.assertEqual(serialize_template(template, definition=True)['definition'], definition)
