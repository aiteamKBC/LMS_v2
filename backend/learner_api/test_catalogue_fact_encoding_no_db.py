"""Internal wire encoding must preserve the records consumed by existing rules."""
from copy import deepcopy
import json
from unittest.mock import patch

from django.test import SimpleTestCase

from . import canonical_learning as canonical
from .catalogue_fact_encoding import (
    PROGRESS_FIELDS, SOURCE_FIELDS, JOURNAL_FIELDS, HISTORICAL_FIELDS, COURSE_FIELDS,
    fact_sql, restore_fact,
)


class CatalogueFactEncodingTests(SimpleTestCase):
    def test_round_trip_preserves_every_field_null_type_and_embedded_payload(self):
        values = [None, False, True, 0, 1.25, '', '2026-11-01T12:00:00+00:00',
                  {'original_source_ref': None, 'retakeTimeChoice': 'correct'},
                  '[{"legacy":"encoded"}]', [], {'nested':[False, None, 0]}]
        for fields in (PROGRESS_FIELDS, tuple(name for name, _ in SOURCE_FIELDS),
                       tuple(name for name, _ in JOURNAL_FIELDS),
                       tuple(name for name, _ in HISTORICAL_FIELDS),
                       tuple(name for name, _ in COURSE_FIELDS)):
            for offset in range(len(values)):
                original = {field:deepcopy(values[(i+offset)%len(values)]) for i,field in enumerate(fields)}
                encoded = json.loads(json.dumps(list(original.values())))
                self.assertEqual(restore_fact(encoded, fields), original)
                self.assertEqual(restore_fact(json.dumps(encoded), fields), original)
        with self.assertRaises(ValueError):
            restore_fact([1], PROGRESS_FIELDS)

    def test_historical_course_metadata_is_restored_from_raw_sql_json_text(self):
        from . import my_learning
        fields = [name for name, _ in COURSE_FIELDS]
        facts = dict.fromkeys(fields)
        facts.update(quiz_id=4, section_order=0, created_at='2026-01-02T12:00:00Z')
        definition = {'source_course_ref':'50', 'source_activity_id':'material:7',
            'source_activity_title':'Synthetic material', 'source_payload':json.dumps(list(facts.values()))}
        with patch.object(canonical, 'query', return_value=[definition]), \
             patch.object(canonical, 'learner_course_catalogue', side_effect=lambda courses, rows: rows):
            result = my_learning.course_facts({'id':9}, [], [{'id':1,'source_course_ref':'50'}])
        self.assertEqual(result[0][0]['source_payload'], facts)

    def test_catalogue_decode_restores_facts_before_reconciliation_and_preserves_scope(self):
        payload = dict.fromkeys(PROGRESS_FIELDS)
        payload.update(id=11, learner_id=9, accepted=False, passed=False, actual_seconds=0,
            source_payload={'original_source_ref': None}, reporting_month='2026-11')
        sources = {name:None for name,_ in SOURCE_FIELDS}
        sources.update(source_id=5, source_system='old_lms', completed=True, source_activity_id='material:7')
        journal = {name:None for name,_ in JOURNAL_FIELDS}
        journal.update(group_id=50, activity_id=7, source_ref='la:50:7')
        historical = {name:None for name,_ in HISTORICAL_FIELDS}
        historical.update(source_system='old_lms', source_course_ref='50', source_activity_id='material:7')
        row = dict(payload=list(payload.values()), ksbs=[], segments=[{}],
            sources=[list(sources.values())], journal_routes=[list(journal.values())],
            historical_components=[list(historical.values())])
        expected = {**payload, 'ksbs':[], 'segments':[{}], 'sources':[sources],
                    'journal_routes':[journal], 'historical_components':[historical]}
        def query(sql, params):
            return [row] if 'WITH canonical AS' in sql else []
        with patch.object(canonical, 'query', side_effect=query) as read, \
             patch.object(canonical, 'current_records', return_value=[]) as reconcile, \
             patch.object(canonical, 'progress_records_with_completion', side_effect=lambda records, _: records), \
             patch('learner_api.journal_sources.enabled', return_value=False), \
             patch('learner_api.attendance_otjh.apply', side_effect=lambda owner, records, *args, **kwargs: records):
            result = canonical.entries_for({'id':9}, catalogue_summary=True, entry_ids=[11])
        self.assertEqual(result, [expected])
        reconcile.assert_called_once_with({'id':9}, [expected])
        statement, params = read.call_args.args
        self.assertEqual(params, [9,[11]])
        self.assertIn('progress.learner_id=%s', statement)
        self.assertIn('progress.deleted_at IS NULL', statement)
        self.assertIn('AND progress.id=ANY(%s)', statement)
        self.assertIn('ORDER BY p.reporting_month,p.reporting_started_at NULLS LAST,p.id', statement)

    def test_other_ledger_readers_keep_dictionary_sql_and_unmodified_payloads(self):
        for options in ({}, {'lineage_only':True}, {'training_summary':True}, {'monthly_summary':True}):
            with patch.object(canonical, 'query', return_value=[]) as read, \
                 patch.object(canonical, 'current_records', return_value=[]), \
                 patch.object(canonical, '_ksb_not_excluded', return_value='true'):
                canonical.entries_for({'id':9}, entry_ids=[], **options)
            sql = read.call_args_list[0].args[0]
            self.assertIn(fact_sql(SOURCE_FIELDS, compact=False), sql)
            self.assertIn(fact_sql(JOURNAL_FIELDS, compact=False), sql)
            self.assertNotIn('jsonb_build_array(', sql)
