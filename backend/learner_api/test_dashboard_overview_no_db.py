"""Synthetic Overview regressions; every database connection is forbidden."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory
from django.utils import timezone as django_timezone
from . import dashboard_overview as overview


class OverviewAttendanceTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
        self.source = SimpleNamespace(id=265, pk=265, aptem_id=1001,
                                      username='Synthetic learner', email='learner@example.test')
        self.profile = SimpleNamespace(pk=17, enrolment_id=265)
        self.enterContext(django_timezone.override('Europe/London'))
        self.kbc = self.enterContext(patch('learner_api.attendance.fetch_kbc_attendance_rows', return_value=[]))
        self.enterContext(patch('learner_api.attendance_lectures.lecture_register',
                                side_effect=AssertionError('Do not recompute attendance')))
        self.enterContext(patch('learner_api.teams_attendance.fetch_verified_teams_attendance_rows',
                                side_effect=AssertionError('Do not substitute raw Teams evidence')))

    def row(self, identity, day, status='present', **extra):
        return {'session_id': identity, 'session_date': date.fromisoformat(day),
                'attendance_status': status, **extra}

    def read(self, historical=(), live=()):
        self.kbc.return_value = list(historical)
        with patch('coach_api.bulk_register.register_rows', return_value={'17': list(live)}) as saved:
            result = overview.attendance_to_date(self.source, self.profile, now=self.now)
        saved.assert_called_once()
        self.assertEqual(saved.call_args.args[0][0].id, 17)
        self.assertIs(saved.call_args.args[0][0]._caseload_source, self.source)
        return result

    def test_keeps_kbc_history_and_late_counts_without_live_rows(self):
        result = self.read([
            self.row('old-1', '2026-09-01'), self.row('old-2', '2026-09-08', 'late'),
            self.row('old-3', '2026-09-15', 'absent')])
        self.assertEqual(result, {'present': 2, 'sessions': 3, 'attendanceRate': 67})
        self.kbc.assert_called_once_with(aptem_id=1001, learner_id=265,
            learner_name='Synthetic learner', learner_email='learner@example.test')

    def test_adds_new_modules_for_commercial_and_apprenticeship_learners(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.source.learner_type = kind
                result = self.read([self.row('old', '2026-09-01', 'absent')], [
                    self.row('new-1', '2026-10-01', module_catalogue_id='M1'),
                    self.row('new-2', '2026-10-08', module_catalogue_id='M2')])
                self.assertEqual(result, {'present': 2, 'sessions': 3, 'attendanceRate': 67})

    def test_live_wins_on_overlapping_day_without_collapsing_separate_live_sessions(self):
        result = self.read([
            self.row('old-1', '2026-09-01'), self.row('old-2', '2026-10-01'),
            self.row('old-3', '2026-10-01')], [
            self.row('new-1', '2026-10-01', 'absent'), self.row('new-2', '2026-10-01')])
        self.assertEqual(result, {'present': 2, 'sessions': 3, 'attendanceRate': 67})

    def test_unfinished_and_invalid_rows_neither_count_nor_replace_kbc(self):
        result = self.read([self.row('old', '2026-10-20')], [
            self.row('future', '2026-10-21', scheduled_start=self.now + timedelta(days=1)),
            self.row('active', '2026-10-20', scheduled_start=self.now - timedelta(minutes=10),
                     scheduled_end=self.now + timedelta(minutes=50)),
            self.row('cancelled', '2026-10-20', occurrence_status='cancelled'),
            self.row('unknown', '2026-10-20', 'pending')])
        self.assertEqual(result, {'present': 1, 'sessions': 1, 'attendanceRate': 100})

    def test_live_only_learner_does_not_need_an_aptem_id_or_raw_report(self):
        self.source.aptem_id = None
        result = self.read(live=[self.row('new', '2026-10-01', attended_seconds=0, attendance_report_id='')])
        self.assertEqual(result, {'present': 1, 'sessions': 1, 'attendanceRate': 100})
        self.kbc.assert_not_called()

    def test_empty_history_stays_unavailable_and_all_absent_is_zero_percent(self):
        self.assertIsNone(self.read())
        self.assertEqual(self.read(live=[self.row('new', '2026-10-01', 'absent')]),
                         {'present': 0, 'sessions': 1, 'attendanceRate': 0})

    def test_mismatched_profile_fails_before_reading_either_register(self):
        from old_otjh.service import ServiceError
        with patch('coach_api.bulk_register.register_rows') as saved:
            for profile in (None, SimpleNamespace(pk=17, enrolment_id=999)):
                with self.subTest(profile=profile), self.assertRaises(ServiceError):
                    overview.attendance_to_date(self.source, profile, now=self.now)
        saved.assert_not_called()
        self.kbc.assert_not_called()

    def test_unavailable_source_does_not_return_partial_totals(self):
        with patch('coach_api.bulk_register.register_rows', side_effect=DatabaseError('Synthetic failure')):
            self.kbc.return_value = [self.row('old', '2026-09-01')]
            with self.assertRaises(DatabaseError):
                overview.attendance_to_date(self.source, self.profile, now=self.now)
        self.kbc.side_effect = RuntimeError('Synthetic KBC failure')
        with patch('coach_api.bulk_register.register_rows', return_value={'17': []}):
            with self.assertRaises(RuntimeError):
                overview.attendance_to_date(self.source, self.profile, now=self.now)

    def test_saved_reader_scopes_learner_and_merges_using_business_date(self):
        from coach_api import bulk_register
        self.kbc.return_value = [self.row('old', '2026-10-19')]
        record = {'learner_profile_id': 17, 'occurrence_id': 'occ-1', 'live_session_id': 'series',
                  'module_catalogue_id': 'M1', 'attendance_status': 'absent',
                  'scheduled_start': datetime(2026, 10, 18, 23, 30, tzinfo=timezone.utc),
                  'scheduled_end': datetime(2026, 10, 19, 0, 30, tzinfo=timezone.utc),
                  'session_number': 1, 'module_title': 'Synthetic module'}
        columns = list(record)
        cursor = MagicMock()
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [tuple(row[column] for column in columns) for row in (
            record, {**record, 'learner_profile_id': 999, 'attendance_status': 'present'})]
        with patch.object(bulk_register, 'connections') as connections:
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            result = overview.attendance_to_date(self.source, self.profile, now=self.now)
        self.assertEqual(result, {'present': 0, 'sessions': 1, 'attendanceRate': 0})
        sql, params = cursor.execute.call_args.args
        self.assertIn('FROM curriculum.live_session_learner_attendance r', sql)
        self.assertEqual(params, [[17]])
        self.assertNotIn('FOR UPDATE', sql)


class OverviewModuleAttendanceTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
        self.source = SimpleNamespace(id=265, pk=265)
        self.profile = SimpleNamespace(pk=17, enrolment_id=265)
        self.enterContext(django_timezone.override('Europe/London'))

    def module(self, ref='current:M1', module_id='M1', title='Module'):
        return {'id': ref, 'moduleId': module_id, 'title': title,
                'detail': {'title': title, 'educational_session_count': 17}}

    def row(self, ref, day='2026-10-01', status='present', **fields):
        return {'session_id': ref, 'session_date': date.fromisoformat(day),
                'attendance_status': status, **fields}

    def read(self, modules, *, historical=(), live=(), legacy_subjects=()):
        with patch('learner_api.attendance.kbc_attendance_rows', return_value=list(historical)), \
             patch('coach_api.bulk_register.register_rows', return_value={'17': list(live)}):
            register = overview.saved_attendance_rows(self.source, self.profile, now=self.now)
        return overview.module_attendance_to_date(modules, register, now=self.now, legacy_subjects=legacy_subjects)

    def test_six_present_two_absent_uses_eight_recorded_sessions_not_seventeen_authored(self):
        live = [self.row(f'live-{i}', status='present' if i < 6 else 'absent', module_catalogue_id='M1')
                for i in range(8)]
        live += [self.row('future', day='2026-11-01', module_catalogue_id='M1'),
                 self.row('active', day='2026-10-20', module_catalogue_id='M1',
                          scheduled_start=self.now - timedelta(minutes=30), scheduled_end=self.now + timedelta(minutes=30)),
                 self.row('unmarked', status='pending', module_catalogue_id='M1'),
                 self.row('cancelled', occurrence_status='cancelled', module_catalogue_id='M1')]
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.source.learner_type = kind
                self.assertEqual(self.read([self.module()], live=live), {'current:M1': {'attended': 6, 'total': 8}})

    def test_legacy_only_module_uses_original_subject_title_and_existing_normalization(self):
        result = self.read([self.module('legacy:7', None, 'Renamed course')],
            historical=[self.row('old', module_title='Level 6 - Safety &amp; Risk', status='late')],
            legacy_subjects=[{'id': 7, 'name': 'Safety & Risk'}])
        self.assertEqual(result, {'legacy:7': {'attended': 1, 'total': 1}})

    def test_linked_previous_and_current_cards_share_register_without_duplicate_credit(self):
        result = self.read([self.module('legacy:7'), self.module()],
            historical=[self.row('old-1', module_title='Module'),
                        self.row('old-2', day='2026-09-01', module_title='Module', status='absent')],
            live=[self.row('live-1', status='absent', module_catalogue_id='M1'),
                  self.row('live-2', day='2026-10-02', module_catalogue_id='M1')])
        self.assertEqual(result, {'legacy:7': {'attended': 1, 'total': 3},
                                  'current:M1': {'attended': 1, 'total': 3}})

    def test_other_module_on_same_day_does_not_erase_kbc_history(self):
        result = self.read([self.module('legacy:7', None, 'Old course'), self.module()],
            historical=[self.row('old', module_title='Old course')],
            live=[self.row('live', status='absent', module_catalogue_id='M1')])
        self.assertEqual(result, {'legacy:7': {'attended': 1, 'total': 1},
                                  'current:M1': {'attended': 0, 'total': 1}})

    def test_duplicate_titles_do_not_transfer_live_credit_or_guess_legacy_membership(self):
        result = self.read([self.module(), self.module('current:M2', 'M2')],
            historical=[self.row('ambiguous', module_title='Module')],
            live=[self.row('live', module_catalogue_id='M1'),
                  self.row('unassigned', module_catalogue_id='M3', module_title='Module')])
        self.assertEqual(result, {'current:M1': {'attended': 1, 'total': 1}, 'current:M2': None})

    def test_no_recorded_outcomes_remain_unavailable_and_future_live_cannot_hide_history(self):
        self.assertEqual(self.read([self.module()]), {'current:M1': None})
        result = self.read([self.module()],
            historical=[self.row('old', day='2026-10-20', module_title='Module')],
            live=[self.row('future', day='2026-10-20', module_catalogue_id='M1',
                           scheduled_start=self.now + timedelta(hours=2))])
        self.assertEqual(result, {'current:M1': {'attended': 1, 'total': 1}})

    def test_g1_confirmed_legacy_alias_adds_twenty_two_records_to_the_five_already_matched(self):
        title = 'G1- Ray - Project Management Professional - Jan 26'
        historical = [self.row(f'old-{i}', day=f'2026-09-{i + 1:02}',
                              status='absent' if i == 0 else 'present',
                              module_title=title.replace('Ray', 'Dr.Ray')) for i in range(22)]
        historical += [self.row(f'renamed-{i}', day=f'2026-10-{i + 1:02}', module_title=title) for i in range(5)]
        result = self.read([self.module('legacy:7', 'M1', title)], historical=historical)
        self.assertEqual(result, {'legacy:7': {'attended': 26, 'total': 27}})

    def test_g1_alias_groups_assigned_cards_and_saved_sources_with_overlap_precedence(self):
        title = 'G1- Ray - Project Management Professional - Jan 26'
        result = self.read([self.module('legacy:7', 'OLD', title.replace('Ray', 'Dr.Ray')),
                            self.module('current:NEW', 'NEW', title)],
            historical=[self.row('old', module_title=title.replace('Ray', 'Dr.Ray')),
                        self.row('retained', day='2026-09-01', module_title=title)],
            live=[self.row('new', status='absent', module_catalogue_id='NEW')])
        self.assertEqual(result, {'legacy:7': {'attended': 1, 'total': 2},
                                  'current:NEW': {'attended': 1, 'total': 2}})

    def test_confirmed_alias_keeps_other_groups_intakes_courses_and_learners_separate(self):
        title = 'G1- Ray - Project Management Professional - Jan 26'
        others = [title.replace('G1', 'G2'), title.replace('Jan', 'Feb'), title.replace('26', '27'),
                  title.replace('Management', 'Controls'), title.replace('Ray', 'Alex')]
        historical = [self.row('variant', module_title='  G1\u2013 DR. Ray \u2013 Project  Management Professional \u2013 Jan 26  ')]
        historical += [self.row(f'other-{i}', module_title=other, status='absent') for i, other in enumerate(others)]
        self.assertEqual(self.read([self.module(title=title)], historical=historical),
                         {'current:M1': {'attended': 1, 'total': 1}})
        self.assertEqual(self.read([self.module(title=title)]), {'current:M1': None})
        # The requested rule now applies to every otherwise identical Dr variant.
        self.assertEqual(self.read([self.module(title='Alex - Leadership')],
            historical=[self.row('other-course', module_title='Dr. Alex - Leadership')]),
            {'current:M1': {'attended': 1, 'total': 1}})

    def test_dr_title_variants_group_any_course_without_losing_learner_module_boundaries(self):
        title = 'G3 - Samira - Leadership - Feb 27'
        for tutor in ('Dr.Samira', 'Dr. Samira', 'DR Samira', '\uff24\uff52\uff0eSamira'):
            with self.subTest(tutor=tutor):
                result = self.read([self.module('legacy:7', 'OLD', title.replace('Samira', tutor)),
                                    self.module('current:NEW', 'NEW', title)],
                    historical=[self.row('old', module_title=title.replace('Samira', tutor)),
                                self.row('other-group', module_title=title.replace('G3', 'G4')),
                                self.row('other-intake', module_title=title.replace('Feb', 'Mar')),
                                self.row('other-tutor', module_title=title.replace('Samira', 'Alex'))],
                    live=[self.row('new', day='2026-10-02', status='absent', module_catalogue_id='NEW')])
                self.assertEqual(result, {'legacy:7': {'attended': 1, 'total': 2},
                                          'current:NEW': {'attended': 1, 'total': 2}})

    def test_dr_inside_a_word_does_not_create_a_course_alias(self):
        for old, current in [('Drake - Leadership', 'ake - Leadership'), ('HDR Planning', 'H Planning'),
                             ('Drama - Design', 'ama - Design')]:
            with self.subTest(old=old):
                self.assertEqual(self.read([self.module(title=current)],
                    historical=[self.row('old', module_title=old)]), {'current:M1': None})

    def test_confirmed_alias_preserves_explicit_module_identity_when_one_card_is_renamed(self):
        title = 'G1- Ray - Project Management Professional - Jan 26'
        result = self.read([self.module('legacy:7', title=title), self.module(title='Renamed course')],
            historical=[self.row('old', module_title=title.replace('Ray', 'Dr.Ray'))],
            live=[self.row('new', day='2026-10-02', status='absent', module_catalogue_id='M1')])
        self.assertEqual(result, {'legacy:7': {'attended': 1, 'total': 2},
                                  'current:M1': {'attended': 1, 'total': 2}})


class OverviewProjectionTests(SimpleTestCase):
    def test_target_to_date_reuses_verified_owner_without_replacing_canonical_rule(self):
        from . import dashboard_metrics
        source = SimpleNamespace(pk=265)
        with patch.object(dashboard_metrics.canonical_learning, 'require_profile', return_value={'id': 17}) as identity, \
             patch('coach_api.selectors.otjh.learner_programme_window', return_value=('2026-01-01', '2026-12-31')), \
             patch('coach_api.views.apply_otjh_to_date_metrics', return_value={'otjhTargetAsOfToday': 40}) as target:
            result = dashboard_metrics.coach_otjh_target_to_date(source, {'actual': 12, 'planned': 100}, owner={'id': 17})
            identity.assert_not_called()
            self.assertEqual(dashboard_metrics.coach_otjh_target_to_date(source, {'actual': 12, 'planned': 100}), result)
        self.assertEqual(result, 40)
        identity.assert_called_once_with(265)
        self.assertEqual(target.call_args.args[0]['otjhPlanned'], 100)

    def test_hours_only_reader_skips_plan_subjects_ksb_lookup_and_reuses_dates(self):
        from . import overview_week
        source = SimpleNamespace(pk=265, _case_file_profile=object())
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = []
        with patch.object(overview_week, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(overview_week, '_direct_progress_records', return_value=[]), \
             patch.object(overview_week, 'rows', return_value=[]), \
             patch.object(overview_week, 'read_builder_activity_dates', return_value={}), \
             patch.object(overview_week, 'summarise_plan') as subjects:
            self.assertEqual(overview_week.read_week(source, monthly_hours_only=True), {})
        subjects.assert_not_called()
        self.assertEqual(source._dashboard_activity_dates, (set(), {}))
        self.assertNotIn('FROM curriculum.ksb_mappings', cursor.execute.call_args_list[-1].args[0])

    def test_native_and_historical_duplicate_cards_preserve_first_and_merged_completion(self):
        learning = {'activity': {'subjects': [{'id': 1, 'name': 'Legacy', 'module_id': 'M1'}],
            'activities': [
                {'group_id': 1, 'activity_id': 2, 'source_activity_id': 2, 'completed': False},
                {'group_id': 1, 'activity_id': 2, 'source_activity_id': 2, 'completed': True}],
            'activity_sources': {'C1': {'group_id': 1, 'activity_id': 2, 'module_id': 'M1'},
                                 'C2': {'group_id': 1, 'activity_id': 2, 'module_id': 'M1'}}},
            'metadata': {'builder_subjects': {'legacy:1': {'id': 'M1', 'title': 'Legacy'}}, 'activity_dates': {}, 'current_subjects': []},
            'detail': {'components': [
                {'componentId': 'C1', 'moduleId': 'M1', 'module': 'Legacy'},
                {'componentId': 'C2', 'moduleId': 'M1', 'module': 'Legacy'},
                {'componentId': 'C3', 'moduleId': 'M2', 'module': 'Native', 'sessionDate': '2026-02-31'},
                {'componentId': 'C3', 'moduleId': 'M2', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 'Q'}}],
                'componentProgress': [{'kind': 'component', 'componentId': 'C1', 'passed': True},
                                      {'kind': 'component', 'componentId': 'C3', 'passed': True}],
                'quizAttempts': []}}
        subjects = {s['id']: s for s in overview.overview_subjects(learning)}
        self.assertEqual(len(subjects['legacy:1']['activities']), 1)
        self.assertTrue(subjects['legacy:1']['activities'][0]['completed'])
        self.assertTrue(subjects['current:M2']['activities'][0]['completed'])
        self.assertEqual(subjects['current:M2']['activities'][0]['date'], '')
        learning['detail']['componentProgress'] = []
        subjects = {s['id']: s for s in overview.overview_subjects(learning)}
        self.assertFalse(subjects['legacy:1']['activities'][0]['completed'])

    def test_chart_months_preserve_log_precedence_future_fallback_and_negative_clamp(self):
        records = [
            {'reporting_month': '2026-09', 'actual_seconds': 3600, 'accepted': True},
            {'reporting_month': '2026-09', 'actual_seconds': 7200, 'accepted': False},
            {'reporting_month': '2026-10', 'actual_seconds': -3600, 'accepted': True},
            {'reporting_month': '2026-11', 'actual_seconds': 1800, 'accepted': True},
        ]
        rows = overview.hour_rows(records, {'2026-09': 10, '2026-11': 99},
            {'2026-09': {'actual': 80, 'submitted': 90, 'planned': 30},
             '2026-11': {'actual': 3, 'submitted': 2, 'planned': 8}}, ['2026-08'], '2026-10')
        self.assertEqual(rows, [
            {'key': '2026-08', 'target': None, 'submitted': 0, 'completed': 0},
            {'key': '2026-09', 'target': 10, 'submitted': 2, 'completed': 1},
            {'key': '2026-10', 'target': None, 'submitted': 0, 'completed': 0},
            {'key': '2026-11', 'target': 8, 'submitted': 2, 'completed': .5}])
        owner_rows = overview.schedule._canonical_actual_rows({'id': 17}, records)
        with patch.object(overview.schedule, '_canonical_actual_rows') as recomputed:
            reused = overview.hour_rows(records, {'2026-09': 10, '2026-11': 99},
                {'2026-09': {'actual': 80, 'submitted': 90, 'planned': 30},
                 '2026-11': {'actual': 3, 'submitted': 2, 'planned': 8}}, ['2026-08'], '2026-10',
                actual_rows=owner_rows)
        recomputed.assert_not_called()
        self.assertEqual(reused, rows)
        self.assertEqual(overview.hour_rows([], {'2099-01': 99}, {}, [], '2026-10'), [])
        self.assertEqual(overview.hour_rows([], {'2026-00': 2}, {'2026-99': {}}, [], '2026-10'), [])

    def test_review_count_uses_due_target_dedup_and_excludes_support_cancelled_future(self):
        reviews = [{'eventKey': '1', 'source': 'progress-review', 'status': 'completed', 'targetDate': '2026-10-01'},
                   {'eventKey': '1', 'source': 'progress-review', 'status': 'scheduled', 'targetDate': '2026-10-01'},
                   {'eventKey': '2', 'source': 'mcr', 'status': 'completed', 'targetDate': '2026-10-15', 'scheduledDate': '2026-11-01'},
                   {'eventKey': '3', 'source': 'mcr', 'status': 'completed', 'targetDate': '2026-11-01'},
                   {'eventKey': '4', 'source': 'student-support', 'status': 'completed', 'targetDate': '2026-10-01'},
                   {'eventKey': '5', 'source': 'mcr', 'status': 'cancelled', 'targetDate': '2026-10-01'},
                   {'eventKey': '6', 'source': 'mcr', 'status': 'completed', 'targetDate': 'invalid'}]
        self.assertEqual(overview.reviews_to_date(reviews, '2026-10-15'), {'completed': 1, 'total': 2, 'percent': 50})

    def test_compact_read_reuses_learning_progress_and_preserves_authoritative_totals(self):
        from . import dashboard_tabs, overview_week, attendance_lectures, attendance, dashboard_metrics
        from .selectors import assignments as assignment_reads
        from coach_api import bulk_register
        source = SimpleNamespace(id=265, pk=265, email='synthetic@example.test')
        profile = SimpleNamespace(pk=17, enrolment_id=265)
        owner = {'id': 17, 'start_date': date(2026, 9, 1), 'end_date': date(2026, 11, 30)}
        module = {'id': 'M1', 'title': 'Module', 'start_date': '2026-09-01', 'end_date': '2026-11-30',
                  'total_otjh': 12, 'educational_session_count': 17}
        learning = {'activity': None, 'metadata': {'current_subjects': [{'id': 'M1', 'title': 'Module'}], 'builder_subjects': {}, 'activity_dates': {}},
                    'detail': {'components': [{'componentId': 'C1', 'moduleId': 'M1', 'module': 'Module', 'type': 'reading'}],
                               'componentProgress': [{'componentId': 'C1', 'kind': 'component', 'passed': True}],
                               'quizAttempts': [], 'videoProgress': []}}
        records = [{'id': 1, 'module_ref': 'M1', 'accepted': True, 'reporting_month': '2026-10', 'actual_seconds': 3600, 'ksbs': ['K1']}]
        metrics = {'programme': {'completed': 1, 'total': 2, 'percent': 50, 'status': 'ready'},
                   'ksb': {'completed': 1, 'total': 3, 'percent': 33.33, 'points': [{'secret': 'unused'}]},
                   'otjh': {'actual': 7, 'planned': 100, 'historical': 7, 'new': 0}}
        with patch.object(overview.canonical, 'entries_for', return_value=records) as entries, \
             patch.object(overview.canonical, 'targets_for', return_value={'2026-10': 10}), \
             patch.object(overview.canonical, 'query', return_value=[]), \
             patch.object(overview.canonical, 'metrics_bulk', return_value={265: metrics}) as totals, \
             patch.object(overview, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: MagicMock())}), \
             patch.object(overview.schedule, 'plan_module_ids', return_value=(['M1'], {})), \
             patch.object(overview, 'module_rows', return_value={'M1': module}), \
             patch.object(overview.schedule, '_plan_session_rows', return_value=[]), \
             patch.object(overview.schedule, 'plan_reviews', return_value=[]), \
             patch.object(overview.schedule, 'read_dashboard') as legacy, \
             patch.object(dashboard_tabs, 'learning_projection', return_value=learning) as facts, \
             patch.object(assignment_reads, '_effective_plan_ids', return_value=['M1']), \
             patch.object(overview_week, 'read_week', return_value={}) as weekly, \
             patch.object(attendance_lectures, 'lecture_register', side_effect=AssertionError('Overview must read saved registers only')), \
             patch.object(attendance, 'kbc_attendance_rows', return_value=[
                 {'session_id': 'kbc-1', 'session_date': date(2000, 1, 1), 'attendance_status': 'present', 'module_title': 'Module'},
                 {'session_id': 'kbc-2', 'session_date': date(2000, 1, 8), 'attendance_status': 'absent', 'module_title': 'Module'}]) as old_attendance, \
             patch.object(bulk_register, 'register_rows', return_value={'17': [
                 {'session_id': 'live-1', 'session_date': date(2000, 2, 1), 'attendance_status': 'present', 'module_catalogue_id': 'M1'},
                 {'session_id': 'live-2', 'session_date': date(2000, 2, 8), 'attendance_status': 'present', 'module_catalogue_id': 'M1'}]}) as live_attendance, \
             patch.object(dashboard_metrics, 'coach_otjh_target_to_date', return_value=40), \
             patch.object(overview.timezone, 'localdate', return_value=date(2026, 10, 15)):
            result = overview.read_overview(source, 'commercial', owner, profile, RequestFactory().get('/overview/'))
        self.assertEqual(set(result), {'metrics', 'attendance', 'reviews', 'modules', 'programme', 'hours', 'programmeStartDate', 'programmeEndDate'})
        self.assertEqual(result['metrics']['otjh'], {'actual': 7, 'targetToDate': 40})
        self.assertNotIn('points', result['metrics']['ksb'])
        self.assertEqual(result['attendance'], {'present': 3, 'sessions': 4, 'attendanceRate': 75})
        self.assertEqual(result['modules'][0]['attendance'], {'attended': 3, 'total': 4})
        old_attendance.assert_called_once_with(source)
        live_attendance.assert_called_once()
        self.assertEqual(live_attendance.call_args.args[0][0].id, 17)
        self.assertIs(live_attendance.call_args.args[0][0]._caseload_source, source)
        self.assertEqual(result['modules'][0]['activities'], {'completed': 1, 'total': 1})
        self.assertEqual(result['modules'][0]['hours'], {'actual': 1, 'planned': 12})
        self.assertEqual(result['programme'][0]['percent'], 100)
        entries.assert_called_once_with(owner, training_summary=True)
        totals.assert_called_once_with([265], learner_workspace=True)
        weekly.assert_called_once_with(source, monthly_hours_only=True)
        facts.assert_called_once()
        legacy.assert_not_called()

    def test_dispatch_verifies_identity_before_overview(self):
        from . import dashboard_tabs, identity
        source = SimpleNamespace(pk=265)
        with patch.object(dashboard_tabs.canonical, 'require_profile', return_value={'id': 17}), \
             patch.object(identity, 'learner_profile_for_source', return_value=SimpleNamespace(pk=18, enrolment_id=265)), \
             patch.object(overview, 'read_overview') as read:
            from old_otjh.service import ServiceError
            with self.assertRaises(ServiceError):
                dashboard_tabs.read_tab(source, 'commercial', 'overview', object())
            read.assert_not_called()

    def test_planned_hours_reuses_resolved_plan_ids_and_keeps_authored_sum(self):
        schedule = overview.schedule
        cursor = MagicMock()
        cursor.fetchone.return_value = ('576.125',)
        cursor.__enter__.return_value = cursor
        with patch.object(schedule, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(schedule, 'plan_module_ids') as resolve:
            self.assertEqual(schedule.plan_planned_hours(object(), {'id': 17}, ids=['M1', 'M2']), 576.12)
            resolve.assert_not_called()
            sql, params = cursor.execute.call_args.args
            self.assertIn('sum(total_otjh)', sql)
            self.assertEqual(params, [['M1', 'M2']])
            cursor.execute.reset_mock()
            self.assertIsNone(schedule.plan_planned_hours(object(), {'id': 17}, ids=[]))
            cursor.execute.assert_not_called()
            resolve.assert_not_called()
