"""Home summary P1: module progress reuses the attendance register Home built.

Database and network are prohibited. The register builder, identity and
native-plan reads are mocked; the real canonical_module_progress ->
read_live_credits -> project_live_credits chain runs on synthetic rows. This
proves call wiring and parity on fixtures, not PostgreSQL timing or real data.
"""
from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import module_progress
from .home_progress import read_home_progress

ENROLMENT = 101
PROFILE_ID = 70
ENDED = datetime(2026, 10, 1, 11, tzinfo=timezone.utc)


def live(component_id, module_id, occurrence):
    return {'componentId': component_id, 'moduleId': module_id, 'type': 'live_session',
            'title': component_id, 'teamsOccurrenceId': occurrence}


def teams_row(module_id, occurrence, *, learner_id=ENROLMENT, seconds=3600):
    return {'source': 'microsoft-teams', 'learner_id': learner_id, 'module_catalogue_id': module_id,
            'occurrence_id': occurrence, 'session_id': occurrence, 'attendance_status': 'present',
            'raw_attendance_status': 'present', 'attendance_report_id': f'R-{occurrence}',
            'attended_seconds': seconds, 'session_date': date(2026, 10, 1),
            'scheduled_start': ENDED - timedelta(hours=2), 'scheduled_end': ENDED}


def schedule_only(module_id, occurrence):
    # Scheduled occurrences without evidence carry no learner_id.
    return {'source': 'kbc-schedule', 'module_catalogue_id': module_id, 'session_id': occurrence,
            'attendance_status': 'unmarked', 'session_date': date(2026, 10, 1)}


COMPONENTS = [live('C1', 'M1', 'OCC1'), live('C2', 'M2', 'OCC2'),
              {'componentId': 'R1', 'moduleId': 'M1', 'type': 'reading'}]
REGISTER = [teams_row('M1', 'OCC1'), teams_row('M2', 'OCC2'), schedule_only('M1', 'OCC9')]


def source(kind='commercial', aptem=None):
    return SimpleNamespace(pk=ENROLMENT, id=ENROLMENT, learner_type=kind, aptem_id=aptem,
                           email='learner@example.test', _canonical_profile={'id': PROFILE_ID})


class Harness:
    """Runs the real canonical_module_progress with only its readers mocked."""

    def __init__(self, built=REGISTER, components=COMPONENTS):
        self.built, self.components = built, components

    def __enter__(self):
        self.stack = stack = ExitStack()
        stack.enter_context(patch('learner_api.canonical_learning.require_profile',
                                  return_value={'id': PROFILE_ID}))
        stack.enter_context(patch('learner_api.student_activity_access.student_activity_available',
                                  return_value=False))
        stack.enter_context(patch.object(module_progress, 'read_native_progress', return_value=(
            {'components': list(self.components)}, [], [], {})))
        self.aggregate = stack.enter_context(patch.object(
            module_progress, '_module_progress_facts',
            side_effect=lambda activity, detail, current, progress, titles: {
                'modules': list(progress), 'nativeComponents': [],
                'historicalComponents': 0, 'retainedComponents': 0,
            }))
        self.build = stack.enter_context(patch('learner_api.attendance_lectures.lecture_register',
                                               return_value=list(self.built)))
        self.manual = stack.enter_context(patch('learner_api.live_session_progress.read_manual_live_credits',
                                                return_value=({}, [])))
        return self

    def __exit__(self, *exc):
        return self.stack.__exit__(*exc)

    def run(self, src=None, **options):
        src = src or source()
        profile = SimpleNamespace(pk=PROFILE_ID, enrolment_id=ENROLMENT)
        return module_progress.canonical_module_progress(src, profile, **options)


def credited(progress):
    return sorted(row['component_ref'] for row in progress)


class ParityTests(SimpleTestCase):
    def test_reused_register_gives_the_same_credits_and_counters_as_an_independent_build(self):
        for kind, aptem in (('commercial', None), ('apprenticeship', '4321')):
            with self.subTest(kind=kind):
                with Harness() as h:
                    independent = h.run(source(kind, aptem))
                    self.assertEqual(h.build.call_count, 1)
                    h.build.assert_called_once_with(h.build.call_args.args[0], module_ids=['M1', 'M2'],
                                                    credit_projection=True)
                with Harness() as h:
                    reused = h.run(source(kind, aptem), register=list(REGISTER),
                                   register_module_ids=['M1', 'M2', 'M3'])
                    h.build.assert_not_called()          # no duplicate attendance build
                self.assertEqual(reused, independent)
                self.assertEqual(credited(reused), ['C1', 'C2'])

    def test_the_exact_register_object_reaches_the_credit_projection(self):
        register = list(REGISTER)
        with Harness() as h, patch('learner_api.live_session_progress.project_live_credits',
                                   return_value=[]) as project:
            h.run(register=register, register_module_ids=['M1', 'M2'])
        self.assertIs(project.call_args.args[1], register)

    def test_staff_manual_decisions_still_apply_to_a_reused_register(self):
        manual = [{'componentId': 'C2', 'moduleId': 'M2', 'hours': 2.5, 'submittedAt': ENDED.isoformat(),
                   'title': 'C2', 'timeTrackingSource': 'manual_attendance'}]
        results = []
        for options in ({}, {'register': list(REGISTER), 'register_module_ids': ['M1', 'M2']}):
            with Harness() as h:
                h.manual.return_value = ({('C2', 'M2'): 'present'}, manual)
                results.append(h.run(**options))
        self.assertEqual(results[0], results[1])


class IsolationTests(SimpleTestCase):
    def assert_rebuilt(self, **options):
        with Harness() as h:
            result = h.run(**options)
            h.build.assert_called_once()                  # fell back to the default build
        with Harness() as h:
            self.assertEqual(result, h.run())             # identical to the default path

    def test_a_group_inherited_module_outside_the_home_scope_rebuilds(self):
        self.assert_rebuilt(register=[teams_row('M1', 'OCC1')], register_module_ids=['M1'])

    def test_another_learners_rows_are_never_reused(self):
        self.assert_rebuilt(register=[teams_row('M1', 'OCC1', learner_id=ENROLMENT + 1), teams_row('M2', 'OCC2')],
                            register_module_ids=['M1', 'M2'])

    def test_missing_register_or_scope_rebuilds(self):
        self.assert_rebuilt(register=None, register_module_ids=['M1', 'M2'])
        self.assert_rebuilt(register=list(REGISTER), register_module_ids=None)

    def test_an_empty_register_for_a_covering_scope_is_reused_and_credits_nothing(self):
        with Harness(built=[]) as h:
            expected = h.run()
        with Harness() as h:
            result = h.run(register=[], register_module_ids=['M1', 'M2'])
            h.build.assert_not_called()
        self.assertEqual(result, expected)
        self.assertEqual(result, [])

    def test_schedule_rows_without_a_learner_id_do_not_block_reuse(self):
        with Harness() as h:
            h.run(register=[schedule_only('M1', 'OCC9'), teams_row('M2', 'OCC2')],
                  register_module_ids=['M1', 'M2'])
            h.build.assert_not_called()

    def test_identity_check_still_refuses_a_mismatched_profile(self):
        from old_otjh.service import ServiceError
        with Harness() as h, self.assertRaises(ServiceError):
            module_progress.canonical_module_progress(
                source(), SimpleNamespace(pk=PROFILE_ID + 1, enrolment_id=ENROLMENT),
                register=list(REGISTER), register_module_ids=['M1', 'M2'])

    def test_the_guard_is_pure(self):
        register = list(REGISTER)
        snapshot = [dict(row) for row in register]
        self.assertIs(module_progress._reusable_register(source(), COMPONENTS, register, ['M1', 'M2']), register)
        self.assertEqual(register, snapshot)


class HomeCallerTests(SimpleTestCase):
    """read_home_progress: one register per home-summary; defaults unchanged."""

    def read(self, *, reuse, attendance_module_ids=('M1', 'M2')):
        src = source()
        metrics = {'otjh': {'actual': 3.0, 'planned': 175.0},
                   'programme': {'completed': 0, 'total': 0, 'status': 'ready'}}
        # Home's own Actual top-up (unchanged by P1) finds no live components here.
        top_up = MagicMock()
        top_up.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with Harness() as h, \
                patch('learner_api.home_progress.connections', {'enrolment': MagicMock()}), \
                patch('learner_api.live_session_progress.connections', {'enrolment': top_up}), \
                patch('learner_api.home_progress.rows', return_value=[]), \
                patch('learner_api.home_progress._group_dates',
                      return_value=(date(2026, 9, 1), date(2027, 9, 1), 'learner')), \
                patch('learner_api.home_progress.lecture_register', return_value=list(REGISTER)) as home_build, \
                patch.object(module_progress, '_module_progress_facts', return_value={
                    'modules': [{'completed': 1, 'total': 2}, {'completed': 2, 'total': 2}],
                    'nativeComponents': [], 'historicalComponents': 0, 'retainedComponents': 0,
                }), \
                patch('learner_api.home_progress.canonical_learning.entries_for', return_value=[]):
            result = read_home_progress(
                src, 'commercial', [], [], [], [('M1', 'One'), ('M2', 'Two')], date(2026, 10, 4),
                attendance_module_ids=list(attendance_module_ids) if attendance_module_ids is not None else None,
                canonical_metrics=metrics, reuse_attendance_register=reuse)
            builds = home_build.call_count + h.build.call_count
        return result, builds

    def test_home_summary_builds_the_register_once_and_the_card_is_unchanged(self):
        reused, reused_builds = self.read(reuse=True)
        default, default_builds = self.read(reuse=False)
        self.assertEqual((reused_builds, default_builds), (1, 2))
        self.assertEqual(reused, default)
        for key in ('actual', 'planned', 'percent', 'submitted', 'missingPlannedActivities'):
            self.assertEqual(reused['otjh'][key], default['otjh'][key], key)
        for key in ('activities', 'assignments', 'lectures', 'modules', 'period', 'undatedActivities'):
            self.assertEqual(reused[key], default[key], key)
        self.assertEqual(reused['activities'], {'completed': 3, 'total': 4})
        self.assertEqual(reused['modules'], {'completed': 1, 'total': 2})

    def test_without_an_attendance_scope_home_keeps_the_default_build(self):
        _, builds = self.read(reuse=True, attendance_module_ids=None)
        self.assertEqual(builds, 2)

    def test_a_failed_home_register_is_not_reused(self):
        from django.db import DatabaseError
        src = source()
        metrics = {'otjh': {'actual': 0, 'planned': 10}, 'programme': {'completed': 0, 'total': 0, 'status': 'ready'}}
        with patch('learner_api.home_progress.connections', {'enrolment': MagicMock()}), \
                patch('learner_api.home_progress.rows', return_value=[]), \
                patch('learner_api.home_progress._group_dates', return_value=(None, None, 'learner')), \
                patch('learner_api.home_progress.lecture_register', side_effect=DatabaseError('offline')), \
                patch('learner_api.module_progress.canonical_module_progress', return_value=[]) as progress:
            result = read_home_progress(src, 'commercial', [], [], [], [], date(2026, 10, 4),
                                        attendance_module_ids=['M1'], canonical_metrics=metrics,
                                        reuse_attendance_register=True)
        self.assertEqual(progress.call_args.kwargs, {})          # default call shape
        self.assertIsNone(result['lectures'])

    def test_other_callers_keep_the_exact_default_call(self):
        with patch('learner_api.home_progress.connections', {'enrolment': MagicMock()}), \
                patch('learner_api.home_progress.rows', return_value=[]), \
                patch('learner_api.home_progress._group_dates', return_value=(None, None, 'learner')), \
                patch('learner_api.home_progress.lecture_register', return_value=[]), \
                patch('learner_api.module_progress.canonical_module_progress', return_value=[]) as progress:
            read_home_progress(source(), 'commercial', [], [], [], [], date(2026, 10, 4),
                               attendance_module_ids=['M1'],
                               canonical_metrics={'otjh': {'actual': 0, 'planned': 1},
                                                  'programme': {'status': 'ready'}})
        self.assertEqual(progress.call_args.kwargs, {})


class GateTests(SimpleTestCase):
    """Staff preview and the learner reach the same home-summary read; the gate is unchanged."""

    def call(self, account, pk=ENROLMENT):
        from django.test import RequestFactory
        from . import overview_week as week
        model = type('Model', (), {'all_learners': MagicMock(), 'DoesNotExist': LookupError})
        model.all_learners.only.return_value.get.return_value = source()
        request = RequestFactory().get(f'/learner_api/overview-week/commercial/{pk}/', {'section': 'home-summary'})
        with patch.dict(week.SOURCE_MODELS, {'commercial': model}), \
                patch('login.permissions._auth_gate_enabled', return_value=True), \
                patch('login.permissions.session_unreadable', return_value=False), \
                patch('login.permissions.authenticate_request', return_value=account), \
                patch.object(week, 'read_week', return_value={'weekStart': 'x'}) as read:
            response = week.overview_week(request, kind='commercial', pk=pk)
        return response, read

    def test_learner_and_staff_preview_read_the_same_home_summary(self):
        learner = SimpleNamespace(role='learner', subject_id=ENROLMENT, subject_type='learner', is_active=True)
        staff = SimpleNamespace(role='staff', subject_id=900, subject_type='staff', is_active=True)
        for account in (learner, staff):
            with self.subTest(role=account.role):
                response, read = self.call(account)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(read.call_args.kwargs, {'home_kind': 'commercial', 'home_summary': True})

    def test_gate_still_refuses_other_learners_and_anonymous_callers(self):
        other = SimpleNamespace(role='learner', subject_id=ENROLMENT + 1, subject_type='learner', is_active=True)
        for account, status in ((other, 404), (None, 401)):
            with self.subTest(status=status):
                response, read = self.call(account)
                self.assertEqual(response.status_code, status)
                read.assert_not_called()
