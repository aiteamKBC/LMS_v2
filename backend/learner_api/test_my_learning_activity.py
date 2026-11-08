"""Owned teaching facts, sharing Curriculum's date rules; all I/O is mocked."""
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from . import my_learning_activity as activity


@override_settings(TIME_ZONE='Europe/London')
class MyLearningTeachingActivityTests(SimpleTestCase):
    def test_empty_or_unmapped_legacy_cards_do_not_read_the_catalogue(self):
        with patch.object(activity.canonical,'query') as read:
            self.assertEqual(activity.card_teaching_activity([]),{})
            self.assertEqual(activity.card_teaching_activity([{'id':'legacy:1'}]),{})
            read.assert_not_called()

    def test_owned_native_and_linked_old_cards_share_the_authoritative_teaching_window(self):
        modules=[dict(module_catalogue_id='M1',start_date='2026-09-01',source_type='module_authoring'),
                 dict(module_catalogue_id='M2',start_date='2026-10-01',teams_shared_source_module_id='OWNER'),
                 dict(module_catalogue_id='OWNER',start_date='2020-01-01')]
        series=[dict(module_catalogue_id='M1',occurrence_count=1,last_live_end='2026-10-31T23:30:00Z'),
                dict(module_catalogue_id='OWNER',occurrence_count=1,last_live_end='2026-12-01T10:00:00Z')]
        cards=[dict(id='current:M1'),dict(id='legacy:2',moduleId='M2'),dict(id='legacy:3')]
        with patch.object(activity.canonical,'query',side_effect=[modules,series]) as read:
            result=activity.card_teaching_activity(cards)
        self.assertEqual(result,{'current:M1':{'startDate':'2026-09-01','lastLiveDate':'2026-10-31'},
                                'legacy:2':{'startDate':'2026-10-01','lastLiveDate':'2026-12-01'}})
        self.assertEqual(read.call_args_list[0].args[1],[['M1','M2']])
        self.assertEqual(read.call_args_list[1].args[1],[['M1','M2','OWNER']])
        module_sql=read.call_args_list[0].args[0]
        self.assertIn('NOT m.module_catalogue_id=ANY(delivery.path)',module_sql)
        self.assertNotIn('deleted_at',module_sql)
        self.assertNotIn('is_programme_deleted',module_sql)
        self.assertNotIn('library_state',module_sql)
        self.assertEqual(module_sql.count("lower(btrim(coalesce(m.status, ''))) <> 'inactive'"),2)
        self.assertIn("lower(trim(coalesce(s.provider,'')))='microsoft teams'",read.call_args_list[1].args[0])
        self.assertNotIn('OWNER',result)

    def test_cancelled_and_undated_series_do_not_manufacture_active_dates(self):
        modules=[dict(module_catalogue_id='M1',start_date='2026-01-01')]
        for series in ([],[dict(module_catalogue_id='M1',status='cancelled',start_datetime='2027-01-01T10:00:00Z')],
                       [dict(module_catalogue_id='M1',occurrence_count=2,start_datetime='2027-01-01T10:00:00Z')]):
            with self.subTest(series=series),patch.object(activity.canonical,'query',side_effect=[modules,series]):
                self.assertEqual(activity.card_teaching_activity([dict(id='current:M1')])['current:M1']['lastLiveDate'],'')

    def test_batches_many_cards_instead_of_one_query_per_module(self):
        cards=[dict(id=f'current:M{i}') for i in range(401)]
        def query(sql,params):
            return [dict(module_catalogue_id=mid,start_date='2026-01-01') for mid in params[0]] if 'WITH RECURSIVE' in sql else []
        with patch.object(activity.canonical,'query',side_effect=query) as read:
            self.assertEqual(len(activity.card_teaching_activity(cards)),401)
        self.assertEqual(read.call_count,4)
        self.assertTrue(all(len(call.args[1][0])<=400 for call in read.call_args_list))
