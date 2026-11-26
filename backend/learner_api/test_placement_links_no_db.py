"""Learner reads follow the placement's ids, so a rename never detaches a learner.

The enrolment row stores a programme, cohort and group as names; the learner
profile holds the ids they resolved to. Every read below used to look the
learner's cohort, programme or group up by name, so renaming one left the
learner pointing at nothing -- on 16 Oct 2026 a cohort rename showed its
learners "not started yet". Every DB connection is forbidden here.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase

from . import learning_plan
from .active_users import cohort_delivery_window, mirror_learner_placement
from .apprenticeship_agreement import _group_dates
from .learner_detail import _apply_cohort_schedule, _cohort_schedule
from .models import EnrolmentUser
from .placement_links import placement_ids


def _cursor(connections_path, row):
    cursor = MagicMock()
    cursor.fetchone.return_value = row
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor
    return patch(connections_path, {'default': connection, 'enrolment': connection}), cursor


class PlacementIdsTests(SimpleTestCase):
    def rows(self, manager, rows):
        manager.using.return_value.filter.return_value.values_list.return_value.__getitem__.return_value = rows

    def test_a_profile_answers_for_itself_without_a_query(self):
        profile = SimpleNamespace(programme_id='PROG-1', cohort_id='COH-1', group_id='GRP-1')
        with patch('learner_api.placement_links.LearnerProfile.objects') as manager:
            self.assertEqual(placement_ids(profile),
                             {'programme_id': 'PROG-1', 'cohort_id': 'COH-1', 'group_id': 'GRP-1'})
        manager.using.assert_not_called()

    def test_an_enrolment_reaches_its_profile_by_enrolment_id_only(self):
        source = EnrolmentUser(id=7, programme='Old programme', cohort='Old cohort', group='Old group')
        with patch('learner_api.placement_links.LearnerProfile.objects') as manager:
            self.rows(manager, [('PROG-1', 'COH-1', 'GRP-1')])
            self.assertEqual(placement_ids(source)['cohort_id'], 'COH-1')
        manager.using.assert_called_once_with('default')
        manager.using.return_value.filter.assert_called_once_with(enrolment_id=7)

    def test_the_answer_is_reused_until_the_placement_names_change(self):
        source = EnrolmentUser(id=7, programme='P', cohort='C', group='G')
        with patch('learner_api.placement_links.LearnerProfile.objects') as manager:
            self.rows(manager, [('PROG-1', 'COH-1', 'GRP-1')])
            placement_ids(source)
            placement_ids(source)
            self.assertEqual(manager.using.call_count, 1)
            source.cohort = 'Another cohort'
            placement_ids(source)
            self.assertEqual(manager.using.call_count, 2)

    def test_no_profile_and_non_text_ids_mean_no_id(self):
        source = EnrolmentUser(id=7, programme='P', cohort='C')
        with patch('learner_api.placement_links.LearnerProfile.objects') as manager:
            self.rows(manager, [])
            self.assertEqual(placement_ids(source), {'programme_id': '', 'cohort_id': '', 'group_id': ''})
        self.assertEqual(placement_ids(MagicMock())['cohort_id'], '')

    def test_an_unsaved_record_is_not_looked_up(self):
        with patch('learner_api.placement_links.LearnerProfile.objects') as manager:
            placement_ids(EnrolmentUser(programme='P', cohort='C'))
        manager.using.assert_not_called()


class CohortDatesByIdTests(SimpleTestCase):
    def test_the_cohort_id_decides_and_no_name_is_compared(self):
        connections, cursor = _cursor('learner_api.active_users.connections',
                                      (date(2026, 9, 16), date(2028, 10, 31), None))
        with connections:
            window = cohort_delivery_window('Programme', 'Old cohort name', 'COH-1')
        self.assertEqual(window, (date(2026, 9, 16), date(2028, 10, 31), None))
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['COH-1'])
        self.assertNotIn('cohort_name', sql)

    def test_without_an_id_the_names_are_still_used(self):
        connections, cursor = _cursor('learner_api.active_users.connections', None)
        with connections:
            cohort_delivery_window('Programme', 'Cohort')
        self.assertEqual(cursor.execute.call_args.args[1], ['Programme', 'Cohort'])

    def test_agreement_and_progression_dates_read_the_cohort_by_id(self):
        learner = SimpleNamespace(start_date=None, end_date=None, programme='P', cohort='Old name')
        with patch('learner_api.placement_links.placement_ids', return_value={'cohort_id': 'COH-1'}), \
                patch('learner_api.active_users.cohort_dates',
                      return_value=(date(2026, 9, 16), date(2028, 10, 31))) as dates:
            self.assertEqual(_group_dates(learner), (date(2026, 9, 16), date(2028, 10, 31), 'cohort'))
        dates.assert_called_once_with('P', 'Old name', 'COH-1')

    def test_learner_page_schedule_reads_the_cohort_by_id(self):
        connections, cursor = _cursor('learner_api.learner_detail.connections',
                                      (date(2026, 9, 16), date(2028, 10, 31), None, None, 12))
        with connections:
            self.assertEqual(_cohort_schedule('Old name', 'P', 'COH-1')['cohortStartDate'], '2026-09-16')
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['COH-1'])
        self.assertNotIn('cohort_name', sql)

    def test_learner_page_passes_the_placement_cohort_id(self):
        detail = {}
        with patch('learner_api.placement_links.placement_ids', return_value={'cohort_id': 'COH-1'}), \
                patch('learner_api.learner_detail._cohort_schedule', return_value={}) as schedule:
            _apply_cohort_schedule(detail, SimpleNamespace(cohort='Old name', programme='P'))
        schedule.assert_called_once_with('Old name', 'P', 'COH-1')


class MirrorKeepsTheWindowTests(SimpleTestCase):
    def test_a_stale_name_keeps_the_profiles_cohort_and_its_dates(self):
        # An enrolment edit after a rename the enrolment row missed: the name
        # resolves to no cohort, so the profile keeps its id -- and its dates are
        # read by that id instead of being blanked by the dead name.
        profile = SimpleNamespace(
            id=248, save=Mock(), programme='P', programme_id='PROG-1', cohort='Oct 2026',
            cohort_id='COH-1', group_name='G', group_id='GRP-1', start_date=date(2026, 9, 16),
            end_date=date(2028, 10, 31), gateway_review_date=date(2028, 8, 2), updated_at=None,
        )
        source = SimpleNamespace(pk=91, programme='P', cohort='Oct 2026', group='G')
        with patch('learner_api.active_users.learner_profile_for_source', return_value=profile), \
                patch('learner_api.active_users._resolve_linkable_programme_id', return_value='PROG-1'), \
                patch('learner_api.active_users._linkable_placement_ids', return_value=('', '')), \
                patch('learner_api.active_users.cohort_dates',
                      return_value=(date(2026, 9, 16), date(2028, 10, 31))) as dates:
            self.assertIsNone(mirror_learner_placement(source))
        dates.assert_called_once_with('P', 'Oct 2026', 'COH-1')
        self.assertEqual(profile.start_date, date(2026, 9, 16))
        profile.save.assert_not_called()

    def test_a_cleared_cohort_reads_no_window(self):
        profile = SimpleNamespace(
            id=248, save=Mock(), programme='P', programme_id='PROG-1', cohort='C', cohort_id='COH-1',
            group_name='', group_id='', start_date=None, end_date=None, gateway_review_date=None,
            updated_at=None,
        )
        with patch('learner_api.active_users.learner_profile_for_source', return_value=profile), \
                patch('learner_api.active_users._resolve_linkable_programme_id', return_value=''), \
                patch('learner_api.active_users._linkable_placement_ids', return_value=('', '')), \
                patch('learner_api.active_users.cohort_dates', return_value=(None, None)) as dates:
            mirror_learner_placement(SimpleNamespace(pk=91, programme='P', cohort='', group=''))
        dates.assert_called_once_with('P', '', '')


class LearningPlanByIdTests(SimpleTestCase):
    def test_the_programme_catalogue_is_read_by_programme_id_alone(self):
        with patch.object(learning_plan, '_rows', return_value=[]) as rows:
            learning_plan._programme_modules('Old programme name', 'PROG-1')
        sql, params = rows.call_args.args
        self.assertEqual(params, ['PROG-1'])
        self.assertNotIn('programme_name =', sql)

    def test_without_an_id_the_catalogue_matches_the_name_as_before(self):
        with patch.object(learning_plan, '_rows', return_value=[]) as rows:
            learning_plan._programme_modules('Programme')
        self.assertEqual(rows.call_args.args[1], ['Programme', 'Programme'])

    def test_the_group_preset_is_read_by_group_id(self):
        with patch.object(learning_plan, '_rows', return_value=[{'module_ids': ['M1', 'M2']}]) as rows, \
                patch.object(learning_plan, '_manual_roster_module_ids', return_value={'M2'}):
            self.assertEqual(learning_plan._group_module_ids('P', 'Old group name', group_id='GRP-1'), ['M1'])
        sql, params = rows.call_args.args
        self.assertEqual(params, ['GRP-1'])
        self.assertIn('group_id = %s', sql)
        self.assertNotIn('group_name', sql)

    def test_learner_lookups_carry_the_placement_ids(self):
        learner = SimpleNamespace(programme='Old programme', group='Old group',
                                  programme_id='PROG-1', cohort_id='COH-1', group_id='GRP-1')
        with patch.object(learning_plan, '_programme_modules', return_value=[]) as catalogue, \
                patch.object(learning_plan, '_group_module_ids', return_value=[]) as preset:
            learning_plan.learner_programme_modules(learner)
            learning_plan.learner_group_module_ids(learner)
        catalogue.assert_called_once_with('Old programme', 'PROG-1')
        preset.assert_called_once_with('Old programme', 'Old group', group_id='GRP-1')

    def test_the_request_cache_keys_a_linked_group_by_its_id(self):
        learner = SimpleNamespace(programme='P', group='G', group_id='GRP-1')
        cache = {}
        with patch.object(learning_plan, '_group_module_ids', return_value=['M1']) as preset:
            self.assertEqual(learning_plan._preset_ids_for(learner, cache), ['M1'])
            learning_plan._preset_ids_for(learner, cache)
        preset.assert_called_once_with('', '', group_id='GRP-1')
        self.assertEqual(cache, {('group_id', 'GRP-1'): ['M1']})
