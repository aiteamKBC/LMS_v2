import copy
import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from .live_totals import core_totals, read_totals_rows, _FIELDS


def source_rows():
    return {
        'programmes': [{'programme_id': 'P1', 'is_archived': False}, {'programme_id': 'P2', 'is_archived': True}],
        'cohorts': [
            {'cohort_id': 'C1', 'programme_id': 'P1', 'status': 'planned'},
            {'cohort_id': 'C2', 'programme_id': 'P1', 'status': 'active'},
            {'cohort_id': 'C3', 'programme_id': 'P2', 'status': 'active'},
        ],
        'groups': [{'group_id': 'G1', 'cohort_id': 'C1'}, {'group_id': 'G2', 'cohort_id': 'C3'}],
        'modules': [
            {'module_catalogue_id': 'M1', 'programme_id': 'P1'},
            {'module_catalogue_id': 'M2', 'programme_id': 'P1', 'deleted_at': '2026-01-01'},
            {'module_catalogue_id': 'M3', 'programme_id': 'P2'},
            {'module_catalogue_id': 'M4', 'group_id': 'G2'},
            {'module_catalogue_id': 'library'},
        ],
        'live_sessions': [
            {'id': 'S1', 'module_catalogue_id': 'M1', 'status': 'active'},
            {'id': 'S2', 'module_catalogue_id': 'M1', 'status': 'week-meeting'},
            {'id': 'S3', 'module_catalogue_id': 'M2', 'status': 'active'},
            {'id': 'S4', 'module_catalogue_id': 'missing', 'status': 'active'},
            {'id': 'S5', 'module_catalogue_id': 'M1', 'status': 'cancelled'},
            {'id': 'S6', 'module_catalogue_id': 'M1', 'status': 'superseded'},
            {'id': 'S7', 'module_catalogue_id': 'M1', 'status': 'feedback-test'},
        ],
    }


class CoreTotalsTests(TestCase):
    def test_counts_physical_entities_and_respects_lifecycle_and_parent_links(self):
        rows = source_rows()
        before = copy.deepcopy(rows)
        self.assertEqual(core_totals(rows), {
            'modules': {'active': 2, 'total': 5},
            'cohorts': {'active': 2, 'total': 3},
            'groups': {'active': 1, 'total': 2},
            'sessions': {'active': 2, 'total': 7},
            'programmes': {'active': 1, 'total': 2},
        })
        self.assertEqual(rows, before)

    def test_deduplicates_ids_without_merging_distinct_records_with_the_same_name(self):
        rows = source_rows()
        rows['modules'] = [
            {'module_catalogue_id': 'M1', 'title': 'Same name'},
            {'module_catalogue_id': 'M1', 'title': 'Same name'},
            {'module_catalogue_id': 'M2', 'title': 'Same name'},
        ]
        self.assertEqual(core_totals(rows)['modules'], {'active': 2, 'total': 3})

    def test_missing_or_conflicting_ids_fail_instead_of_publishing_wrong_counts(self):
        for bad_rows in ([{}], [{'module_catalogue_id': 'M1'}, {'module_catalogue_id': 'M1', 'is_deleted': True}]):
            with self.subTest(rows=bad_rows), self.assertRaises(ValueError):
                core_totals({**source_rows(), 'modules': bad_rows})

    def test_all_soft_delete_and_archive_markers_are_excluded(self):
        rows = source_rows()
        rows['modules'] = [
            {'module_catalogue_id': str(index), **flags}
            for index, flags in enumerate([
                {'is_programme_deleted': True}, {'is_deleted': 'true'},
                {'is_archived': 'yes'}, {'deleted_at': '2026-01-01'},
                {'status': 'archived'}, {'status': 'cancelled'}, {},
            ])
        ]
        self.assertEqual(core_totals(rows)['modules'], {'active': 1, 'total': 7})

    def test_an_empty_database_returns_real_zeroes(self):
        self.assertTrue(all(count == {'active': 0, 'total': 0} for count in core_totals({key: [] for key in _FIELDS}).values()))


class SourceReadTests(TestCase):
    def test_one_select_reads_only_minimal_columns_and_decodes_json(self):
        rows = source_rows()
        cursor = MagicMock()
        cursor.fetchone.return_value = tuple(json.dumps(rows[key]) for key in _FIELDS)
        db = SimpleNamespace(vendor='postgresql', ops=SimpleNamespace(quote_name=lambda name: '"' + name + '"'), cursor=MagicMock())
        db.cursor.return_value.__enter__.return_value = cursor
        self.assertEqual(read_totals_rows(db), rows)
        cursor.execute.assert_called_once()
        statement, params = cursor.execute.call_args.args
        self.assertTrue(statement.startswith('SELECT '))
        for verb in ('INSERT ', 'UPDATE ', 'DELETE ', 'CREATE ', 'ALTER '):
            self.assertNotIn(verb, statement)
        self.assertEqual(len(params), 5)
        self.assertFalse(any('description' in fields or 'organizer_email' in fields for fields in params))

    def test_unsupported_database_is_not_reported_as_zero(self):
        with self.assertRaises(ValueError):
            read_totals_rows(SimpleNamespace(vendor='sqlite'))


class EndpointTests(TestCase):
    @classmethod
    def setUpClass(cls):
        from django.conf import settings
        if not settings.configured:
            settings.configure(DEFAULT_CHARSET='utf-8', ALLOWED_HOSTS=['testserver'], USE_TZ=True)

    def test_get_returns_verified_counts_and_a_timestamp_without_cache(self):
        from django.test import RequestFactory
        from . import live_totals
        with patch.object(live_totals, 'read_totals_rows', return_value=source_rows()) as read:
            response = live_totals.curriculum_live_totals(RequestFactory().get('/curriculum_api/curriculum/live-totals/'))
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['metrics']['sessions'], {'active': 2, 'total': 7})
        self.assertEqual(len(payload['metrics']), 5)
        self.assertTrue(payload['checkedAt'].endswith('Z'))
        self.assertIn('no-store', response['Cache-Control'])
        read.assert_called_once_with(None)

    def test_source_failure_is_503_and_never_publishes_fake_zeroes_or_credentials(self):
        from django.db import OperationalError
        from django.test import RequestFactory
        from . import live_totals
        with patch.object(live_totals, 'read_totals_rows', side_effect=OperationalError('private connection detail')), patch.object(live_totals.logger, 'exception'):
            response = live_totals.curriculum_live_totals(RequestFactory().get('/curriculum_api/curriculum/live-totals/'))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('metrics', json.loads(response.content))
        self.assertNotIn(b'private connection detail', response.content)

    def test_invalid_record_identity_is_a_visible_failure(self):
        from django.test import RequestFactory
        from . import live_totals
        with patch.object(live_totals, 'read_totals_rows', return_value={**source_rows(), 'modules': [{}]}), patch.object(live_totals.logger, 'exception'):
            response = live_totals.curriculum_live_totals(RequestFactory().get('/curriculum_api/curriculum/live-totals/'))
        self.assertEqual(response.status_code, 503)

    def test_post_is_rejected_before_any_source_read(self):
        from django.test import RequestFactory
        from . import live_totals
        with patch.object(live_totals, 'read_totals_rows') as read:
            response = live_totals.curriculum_live_totals(RequestFactory().post('/curriculum_api/curriculum/live-totals/'))
        self.assertEqual(response.status_code, 405)
        read.assert_not_called()
