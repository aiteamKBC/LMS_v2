"""Regression coverage for canonical KSB behavior across extracted owners."""
from datetime import datetime
from unittest.mock import Mock

from django.test import SimpleTestCase

from curriculum_api.catalogue.application import week_templates
from curriculum_api.catalogue.infrastructure import schema_reads, schema_relations
from curriculum_api.catalogue.infrastructure.free_course_native_schema import _ksb_read_source
from curriculum_api.reporting.infrastructure.statistics_reads import latest_progress_weights


class CanonicalMergeTests(SimpleTestCase):
    def test_mapping_column_discovery_uses_the_canonical_cached_schema(self):
        read = Mock(side_effect=AssertionError('Canonical cached columns require no query'))
        columns = schema_reads.column_names(
            'ksb_mappings', CURRICULUM_SCHEMA='curriculum',
            _TABLE_COLUMNS_CACHE={'curriculum.ksb_component_mappings': {'id', 'standard_ksb_id'}},
            columns_listed=lambda: True, connection=Mock(vendor='postgresql'),
            defaultdict=None, fetch_all=read, free_course_columns=lambda: {},
            mark_columns_listed=Mock(), native_only=lambda: False, quote_ident=lambda value: value,
        )
        self.assertEqual(columns, {'id', 'standard_ksb_id'})
        read.assert_not_called()

    def test_old_collection_key_resolves_only_to_canonical_physical_table(self):
        for vendor, expected in (
            ('postgresql', '"curriculum"."ksb_component_mappings"'),
            ('sqlite', '"ksb_component_mappings"'),
        ):
            self.assertEqual(schema_relations._qualified('ksb_mappings', connection=Mock(vendor=vendor)), expected)

    def test_free_course_preparation_reads_canonical_mapping_identity(self):
        query = _ksb_read_source()
        self.assertIn('"curriculum"."ksb_component_mappings"', query)
        self.assertIn('"curriculum"."ksb_standard_definitions"', query)
        self.assertIn('as ksb_id', query)
        self.assertIn('where m.component_id is not null', query)
        self.assertNotIn('"curriculum"."ksb_mappings"', query)

    def test_progress_statistics_use_verified_canonical_progress(self):
        read = Mock(return_value=[])
        latest_progress_weights(
            [{'kind': 'reading', 'passed': True}], ['SYNTHETIC'], ['K1'],
            _STRIP_CHARS=' ', and_not_excluded=lambda *args: '',
            connection=Mock(vendor='postgresql'), fetch_all=read,
        )
        query = read.call_args.args[0]
        self.assertIn('ksb_learner_progress', query)
        self.assertNotIn('"learner_progress_ksbs"', query)
        self.assertIn('standard_ksb_id', query)

    def save(self, components, existing=()):
        self.insert = Mock()
        self.update = Mock()
        self.replace = Mock()
        self.delete = Mock()
        self.lock = Mock()
        return week_templates.save_week_template_components(
            'WT-SYNTHETIC', components,
            LEGACY_REFLECTION_QUESTION_SETTING='reflectionQuestion',
            WEEK_TEMPLATE_COMPONENTS_TABLE='week_template_components',
            WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN='reflection_question',
            WEEK_TEMPLATES_TABLE='week_templates', clean_str=lambda v: str(v or ''),
            datetime=datetime, delete_rows=Mock(), ensure_week_template_tables=Mock(),
            insert_row=self.insert, json_db_value=lambda v: v, parse_int=lambda v, d=0: int(v or d),
            payload_coach_validation=lambda v: True, payload_reflection_question=lambda *args: '',
            unique_prefixed_id=lambda *args: 'WTC-NEW', week_template_number=lambda v: float(v or 0),
            lock_record_row=self.lock, get_week_template_component_rows=lambda _: list(existing),
            occupied_template_component_ids=lambda ids: set(ids), update_rows=self.update,
            replace_template_mappings=self.replace, delete_template_components=self.delete,
        )

    def test_template_edit_preserves_existing_identity_and_omitted_mappings(self):
        self.save([{'id': 'WTC-KEPT', 'title': 'Updated'}], [{'id': 'WTC-KEPT'}, {'id': 'WTC-REMOVED'}])
        self.insert.assert_not_called()
        self.replace.assert_not_called()
        self.update.assert_called_once()
        self.assertNotIn('created_at', self.update.call_args.args[3])
        self.assertNotIn('ksb_mappings', self.update.call_args.args[3])
        self.delete.assert_called_once_with('WT-SYNTHETIC', ['WTC-REMOVED'])
        self.lock.assert_called_once()

    def test_template_explicit_empty_mapping_list_clears_canonical_links(self):
        self.save([{'id': 'WTC-KEPT', 'ksbMappings': []}], [{'id': 'WTC-KEPT'}])
        self.replace.assert_called_once_with('WTC-KEPT', [])

    def test_copy_does_not_reuse_another_templates_child_identity(self):
        rows = self.save([{'id': 'WTC-OTHER', 'ksbMappings': [{'standardKsbId': 1}]}])
        self.assertEqual(rows[0]['id'], 'WTC-NEW')
        self.replace.assert_called_once_with('WTC-NEW', [{'standardKsbId': 1}])
        self.update.assert_not_called()
