"""Guarded parity and database-read budgets for measured-stage optimizations."""
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from contextlib import ExitStack

from django.test import SimpleTestCase
from . import teams_attendance as teams
from .builder_activity_dates import read_builder_activity_dates


class ReadSet:
    def __init__(self, name, rows, reads):
        self.name, self.rows, self.reads = name, rows, reads
        self.filters = []
    def using(self, *args): return self
    def filter(self, *args, **kwargs):
        self.filters.append((args, kwargs))
        return self
    def only(self, *args):
        self.only_fields = args
        return self
    def order_by(self, *args): return self
    def values(self, *args): return []  # Unevaluated SQL subquery stand-in.
    def values_list(self, *args):
        return [(row.id, row.live_session_id) for row in self.rows] if self.name == 'occurrence' else []
    def __iter__(self):
        self.reads[self.name] += 1
        return iter(self.rows)


class BottleneckReadParityTests(SimpleTestCase):
    def attendance(self, optimized, status='present', *, reuse=False, recovery=False, extra=False):
        reads = Counter()
        now = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        profile = SimpleNamespace(id=9, enrolment_id=7, full_name='Synthetic Learner',
                                  email='learner@example.test', coach_name='')
        session = SimpleNamespace(id='S1', module_catalogue_id='M1', module_title='Module', attendees=[])
        occurrence = SimpleNamespace(id='O1', live_session_id='S1', session_number=1,
            actual_start=now, actual_end=now, scheduled_start=now, scheduled_end=now,
            attendance_report_id='R1', artifacts_synced_at=now, updated_at=now)
        record = SimpleNamespace(id='A1', occurrence_id='O1', graph_record_id='G1',
            email=profile.email, display_name=profile.full_name, role='attendee', raw_data={},
            total_attendance_seconds=181, intervals=[])
        session_rows, occurrence_rows = [session], [occurrence]
        evidence_rows = [record] if status == 'present' else []
        guests = defaultdict(set)
        if extra:
            occurrence_rows.append(SimpleNamespace(**{**vars(occurrence), 'id':'O2'}))
            evidence_rows.append(SimpleNamespace(**{**vars(record), 'id':'A2', 'occurrence_id':'O2'}))
        if recovery:
            session_rows.append(SimpleNamespace(id='S2', module_catalogue_id='M2', module_title='Alternative', attendees=[]))
            occurrence_rows.append(SimpleNamespace(**{**vars(occurrence), 'id':'ALT', 'live_session_id':'S2'}))
            evidence_rows.append(SimpleNamespace(**{**vars(record), 'id':'AA', 'occurrence_id':'ALT'}))
            guests['ALT'].add(profile.email)
        fixtures = [(teams.LearnerProfile, 'profile', [profile]),
                    (teams.LiveSession, 'series', session_rows),
                    (teams.LiveSessionOccurrence, 'occurrence', occurrence_rows),
                    (teams.LiveSessionAttendance, 'evidence', evidence_rows),
                    (teams.ModuleAuthoringModule, 'group', [SimpleNamespace(module_catalogue_id='M1', group_id='G1', group_name='Synthetic group')]),
                    (teams.LearnerTrainingPlanModule, 'assignment_subquery', [])]
        with ExitStack() as stack:
            sets = {}
            for model, name, rows in fixtures:
                sets[name] = ReadSet(name, rows, reads)
                stack.enter_context(patch.object(model, 'objects', sets[name]))
            stack.enter_context(patch.object(teams.router, 'db_for_read', return_value='enrolment'))
            stack.enter_context(patch.object(teams, '_assigned_learner_emails_by_module',
                return_value=defaultdict(set, {'M1': {profile.email, 'same-name@example.test'}})))
            def counted(name, value):
                def read(*args):
                    reads[name] += 1
                    sets[name] = args
                    return value
                return read
            stack.enter_context(patch.object(teams, '_attendance_alias_rows', side_effect=counted('aliases', [])))
            stack.enter_context(patch.object(teams, '_attendance_identity_link_rows', side_effect=counted('links', [])))
            stack.enter_context(patch.object(teams, '_attendance_review_rows', side_effect=counted('review_batch', ([],[]))))
            stack.enter_context(patch.object(teams, '_replaced_attendance_sources', side_effect=counted('replacement', {})))
            stack.enter_context(patch.object(teams, 'identity_rules', return_value=[]))
            stack.enter_context(patch('learner_api.alternative_recovery.approved_alternative_guests', return_value=guests))
            stack.enter_context(patch('learner_api.session_recovery.apply_recovery_to_rows', side_effect=lambda rows: rows))
            def match(rows, *args, **kwargs):
                sets.setdefault('identity_rosters', []).append(kwargs['learners'])
                return rows
            stack.enter_context(patch.object(teams, 'apply_reviewed_identities', side_effect=match))
            stack.enter_context(patch.object(teams.timezone, 'now', return_value=now))
            options = {'verified_profile': profile, 'include_group_metadata': False} if optimized else {}
            if reuse:
                options['register_schedule'] = [{'session_id':'O1', 'attendance_source_occurrence_id':'O1',
                                                  'attendance_report_id':'R1'}]
            result = teams.fetch_verified_teams_attendance_rows(learner_emails=[profile.email], **options)
        return result, reads, sets

    def test_attendance_outputs_equal_with_two_fewer_materialized_reads(self):
        for status in ('present', 'absent'):
            with self.subTest(status=status):
                before, old, _ = self.attendance(False, status)
                after, new, sets = self.attendance(True, status)
                from .live_session_progress import project_live_credits
                component = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'live_session',
                             'teamsOccurrenceId': 'O1'}
                self.assertEqual(project_live_credits([component], after),
                                 project_live_credits([component], before))
                self.assertEqual([{k:v for k,v in row.items() if k not in {'group_id','group_name'}} for row in after],
                                 [{k:v for k,v in row.items() if k not in {'group_id','group_name'}} for row in before])
                self.assertEqual(old['profile'], 2)
                self.assertEqual(new['profile'], 1)  # Full ambiguity roster retained.
                self.assertEqual(old['group'], 1)
                self.assertEqual(new['group'], 0)
                self.assertEqual(sum(old.values()) - sum(new.values()), 2)
                self.assertTrue(sets['series'].filters)  # Learner plan/recovery scope.
                self.assertEqual(after[0]['attendance_status'], status)

    def test_report_reader_does_not_fetch_unused_stored_invitation_snapshots(self):
        rows, _, sets = self.attendance(True)
        self.assertEqual(rows[0]['attendance_status'], 'present')
        self.assertNotIn('attendees', sets['series'].only_fields)
        self.assertIn('module_title', sets['series'].only_fields)

    def test_same_module_occurrences_reuse_full_identity_roster_without_changing_presence(self):
        rows, _, sets = self.attendance(True, extra=True)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['attendance_status'] == 'present' for row in rows))
        self.assertEqual(len(sets['identity_rosters']), 2)
        self.assertIs(sets['identity_rosters'][0], sets['identity_rosters'][1])
        self.assertEqual(set(sets['identity_rosters'][0]), {'learner@example.test'})

    def test_schedule_reuse_and_review_batch_remove_two_more_selects(self):
        for status in ('present', 'absent'):
            before, old, _ = self.attendance(True, status)
            after, new, sets = self.attendance(True, status, reuse=True)
            self.assertEqual(after, before)
            self.assertEqual((old['replacement'], new['replacement']), (1,0))
            self.assertEqual((old['aliases']+old['links'], new['review_batch']), (2,1))
            self.assertEqual(sum(old.values()) - sum(new.values()), 2)

    def test_approved_alternative_stays_in_scope_and_uses_missing_source_reader(self):
        before, _, _ = self.attendance(True, recovery=True)
        after, reads, sets = self.attendance(True, reuse=True, recovery=True)
        self.assertEqual(after, before)
        alternative = next(row for row in after if row['occurrence_id'] == 'ALT')
        self.assertEqual(alternative['eligibility_reason'], 'approved_recovery_guest')
        self.assertEqual(alternative['attendance_status'], 'present')
        self.assertEqual(sets['replacement'][1], ['ALT'])
        scope_filters = [kwargs['id__in'] for _, kwargs in sets['occurrence'].filters if 'id__in' in kwargs]
        self.assertIn(['ALT','O1'], scope_filters)
        self.assertEqual(reads['review_batch'], 1)

    def test_strict_native_projection_flattens_only_retained_legacy_snapshots(self):
        from . import weekly_learning as weekly
        from .mappers import flatten_training_plan
        source = SimpleNamespace(id=7, programme='', cohort='', group='')
        legacy = {'moduleTitle': 'Legacy', 'weeks': [{'weekTitle': 'Week 1',
                  'components': [{'componentTitle': 'Historical'}]}]}
        plan = [{'moduleId': 'M1', 'moduleTitle': 'Native', 'weeks': [
            {'weekId': 'W1', 'components': [{'componentId': str(i)} for i in range(1000)]}]}, legacy]
        with patch.object(weekly, 'get_training_plan', return_value=plan), \
             patch.object(weekly, 'flatten_training_plan', wraps=flatten_training_plan) as flatten, \
             patch('learner_api.learner_detail._resolve_from_master', side_effect=lambda m,w,c,**kw: (m,w,c)), \
             patch('learner_api.learner_detail._append_week_quizzes', side_effect=lambda w,c,**kw: (w,c)):
            result = weekly.build_learning_content_summary(source, 7, assigned_modules=[{'moduleId': 'M1'}],
                identities_only=True, preserve_legacy=True, strict=True, resolved_metadata={}, progress=([],[],[]))
        flatten.assert_called_once_with([legacy])
        self.assertEqual(result['components'][0]['component'], 'Historical')

    def test_native_read_supplies_separate_text_schedule_facts_without_extra_select(self):
        from . import learner_detail
        cursor = MagicMock()
        native = {'teamsSessionNumber': 2, 'teamsLiveSessionId': 'S1', 'sessionDate': '2026-10-01'}
        schedule = {**native, 'teamsSessionNumber': '2', 'dueTiming': 'End of week'}
        cursor.fetchall.return_value = [('C1','W1','M1','live_session','Live','',native,
                                        None,0,None,False,None,False,schedule)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        metadata = {'module_titles': {'M1': 'Module'}, 'weeks': [('W1','M1','Week 1',1,0)],
                    'live_credit_components': [], 'schedule_components': []}
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            learner_detail._resolve_from_master([],[],[],assigned_modules=[{'moduleId':'M1'}],
                compact=True,identities_only=True,catalogue_facts=True,live_session_ids=False,
                resolved_metadata=metadata,strict=True)
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertEqual(metadata['schedule_components'], [('C1','M1','W1','Live','live_session',schedule)])
        self.assertEqual(metadata['live_credit_components'][0]['teamsSessionNumber'], '2')
        sql = cursor.execute.call_args.args[0]
        self.assertIn("settings_json->>'dueTiming'", sql)
        self.assertIn('visible_parent.module_catalogue_id=components.module_catalogue_id', sql)

    def test_register_reuses_canonical_owner_but_keeps_corrections(self):
        from . import attendance_lectures as lectures
        from .models import LearnerProfile
        source = SimpleNamespace(id=7, _case_file_profile=SimpleNamespace(pk=9, enrolment_id=7),
                                 _canonical_profile={'id': 9})
        with patch.object(LearnerProfile, 'objects') as profiles, \
             patch('learner_api.attendance_confirmation.read_confirmations', return_value={}), \
             patch.object(lectures, '_apply_coach_source_adjustments', return_value=[]) as corrections:
            profiles.filter.return_value.values_list.return_value = [9]
            before = lectures.lecture_register(source, records=[], scheduled=[])
            profiles.filter.assert_called_once_with(enrolment_id=7)
            profiles.reset_mock()
            after = lectures.lecture_register(source, records=[], scheduled=[], credit_projection=True)
            profiles.filter.assert_not_called()
        self.assertEqual(after, before)
        self.assertEqual(corrections.call_count, 2)
        self.assertTrue(all(call.args[1] == 9 for call in corrections.call_args_list))

    def test_other_owner_cannot_supply_reused_attendance_identity(self):
        from . import attendance
        source = SimpleNamespace(id=7, email='learner@example.test', aptem_id=None,
            _case_file_profile=SimpleNamespace(pk=9, enrolment_id=8), _canonical_profile={'id': 9})
        with patch.object(attendance, 'fetch_verified_teams_attendance_rows', return_value=[]) as fetch:
            attendance.combined_attendance_rows(source, credit_projection=True)
        fetch.assert_called_once_with(learner_emails=[source.email], include_group_metadata=False)

    def test_schedule_reuse_removes_three_selects_with_identical_dates(self):
        module = ('M1', '2026-10-05', 3, 'Monday', '10:00', '11:00', 'CO1', {})
        weeks = [('W1', 'M1', 'Week 1'), ('W2', 'M1', 'Reading week'), ('W3', 'M1', 'Week 3')]
        components = [('C1', 'M1', 'W1', 'Reading', 'reading', {}),
                      ('C2', 'M1', 'W3', 'Live', 'live_session', {'teamsStartDateTimeUtc': '2026-10-31T23:30:00Z'}),
                      ('C3', 'M1', 'removed', 'Deleted', 'reading', {})]
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[module], weeks, deepcopy(components)]
        metadata = {'schedule_modules': {'M1': dict(zip(('module_catalogue_id','start_date','sessions_number',
            'session_week_day','session_start_time','session_end_time','cohort_id','session_overrides'), module))},
            'weeks': [(wid, mid, title, i, i) for i, (wid, mid, title) in enumerate(weeks)],
            'schedule_components': deepcopy(components)}
        with patch('curriculum_api.views.cohort_selected_holidays_by_cohort', return_value={'CO1': []}):
            expected = read_builder_activity_dates(cursor, ['M1'])
            reused = MagicMock()
            actual = read_builder_activity_dates(reused, ['M1'], resolved_metadata=metadata)
        self.assertEqual(actual, expected)
        self.assertEqual(cursor.execute.call_count, 3)
        reused.execute.assert_not_called()
        self.assertNotIn('C3', actual)
