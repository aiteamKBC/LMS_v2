"""Monthly-assignment flag and learner-facing titles, without a database or writes."""
import json
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import components
from .assignment_settings import flagged_monthly, learner_title, monthly_assignment_required
from .learner_detail import _resolve_from_master
from .time_tracking import issue_tracking_session

MODULE = {'moduleId': 'MOD-1', 'moduleTitle': 'Module'}


class AssignmentSettingTests(SimpleTestCase):
    def test_learner_title_is_trimmed_and_optional(self):
        self.assertEqual(learner_title({'learnerTitle': '  Month 2 \n Coach Led Assignment '}), 'Month 2 Coach Led Assignment')
        self.assertEqual(learner_title(json.dumps({'learnerTitle': 'From JSON'})), 'From JSON')
        for settings in ({}, {'learnerTitle': '   '}, None, '[]', 'not json'):
            with self.subTest(settings=settings):
                self.assertEqual(learner_title(settings), '')

    def test_only_an_explicit_true_flags_the_monthly_assignment(self):
        self.assertTrue(flagged_monthly({'isMonthlyAssignment': True}))
        self.assertTrue(flagged_monthly({'isMonthlyAssignment': 'true'}))
        for value in (False, 'false', '', 1, None):
            with self.subTest(value=value):
                self.assertFalse(flagged_monthly({'isMonthlyAssignment': value}))


class MonthlyAssignmentRequiredTests(SimpleTestCase):
    def required(self, own_settings, flagged_elsewhere, plan=(MODULE,)):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [(own_settings,), (1,) if flagged_elsewhere else None]
        with patch('learner_api.assignment_settings.connections', {'enrolment': connection}), \
                patch('learner_api.selectors.assignments.effective_training_plan', return_value=list(plan)):
            return monthly_assignment_required('COMP-1', SimpleNamespace(pk=1)), cursor

    def test_every_assignment_is_monthly_until_one_is_flagged(self):
        required, cursor = self.required({}, flagged_elsewhere=False)
        self.assertTrue(required)
        sql, params = cursor.execute.call_args.args
        self.assertIn("isMonthlyAssignment", sql)
        self.assertEqual(params, [['MOD-1']])

    def test_once_any_assignment_is_flagged_only_flagged_ones_are_monthly(self):
        self.assertFalse(self.required({}, flagged_elsewhere=True)[0])
        self.assertTrue(self.required({'isMonthlyAssignment': True}, flagged_elsewhere=True)[0])

    def test_a_plan_without_module_ids_and_a_failed_read_keep_the_original_requirement(self):
        self.assertTrue(self.required({}, flagged_elsewhere=True, plan=[{'moduleTitle': 'Legacy'}])[0])
        with patch('learner_api.selectors.assignments.effective_training_plan', side_effect=DatabaseError):
            self.assertTrue(monthly_assignment_required('COMP-1', SimpleNamespace(pk=1)))


class LearnerPayloadTests(SimpleTestCase):
    def resolve(self, settings):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [
            [('MOD-1', 'Module')],
            [('W-1', 'MOD-1', 'Week 1', 1, 0)],
            [('C-1', 'W-1', 'MOD-1', 'assignment', 'Imported legacy title', '', settings,
              '', 0, [{'code': 'K1', 'weight': 1}], False, None, True)],
            [],
            [],  # current KSB-description projection for the selected component
        ]
        with patch('learner_api.learner_detail.connections', {'enrolment': connection}):
            return _resolve_from_master([], [], [], assigned_modules=[MODULE])[2][0]

    def test_learner_title_replaces_the_curriculum_title_and_the_flag_is_exposed(self):
        component = self.resolve({'assignmentBrief': 'Question', 'learnerTitle': 'Month 1 assignment', 'isMonthlyAssignment': True})
        self.assertEqual(component['component'], 'Assignment · Month 1 assignment')
        self.assertIs(component['monthlyAssignment'], True)

    def test_curriculum_title_and_unflagged_state_are_kept_by_default(self):
        component = self.resolve({'assignmentBrief': 'Question'})
        self.assertEqual(component['component'], 'Assignment · Imported legacy title')
        self.assertIs(component['monthlyAssignment'], False)


class AssignmentCompletionTests(SimpleTestCase):
    def submit(self, *, monthly, form_ready=True):
        now = datetime(2026, 1, 15, 12, tzinfo=timezone.utc)
        session = issue_tracking_session(
            activity_kind='component', activity_id='COMP-A', learner_kind='apprenticeship',
            learner_id='19', counting_mode='visible_page', issued_at=now - timedelta(seconds=600),
        )
        request = RequestFactory().post(
            '/learner_api/components/COMP-A/complete/?kind=apprenticeship&learnerId=19',
            data=json.dumps({'trackingToken': session['trackingToken'], 'timeTakenSeconds': 600,
                             'timeEntrySource': 'input', 'componentType': 'assignment',
                             'componentTitle': 'Month 1 assignment'}),
            content_type='application/json',
        )
        view = components.submit_component_progress
        while hasattr(view, '__wrapped__'):
            view = view.__wrapped__
        model = Mock()
        model.objects.defer.return_value.get.return_value = SimpleNamespace(
            id=19, username='Learner', programme='Programme',
        )
        with ExitStack() as stack:
            def mock(target, **kwargs):
                return stack.enter_context(patch(target, **kwargs))
            mock('learner_api.components.SOURCE_MODELS', new={'apprenticeship': model})
            mock('learner_api.components.learner_profile_for_source', return_value=SimpleNamespace(training_plan_progress=[]))
            mock('learner_api.components.component_ksb_codes', return_value=['K1'])
            mock('learner_api.components.tracking_session_already_used', return_value=False)
            mock('learner_api.components._component_meta', return_value=('assignment', 'Imported legacy title'))
            mock('learner_api.components._completion_criteria', return_value=(True, None))
            mock('learner_api.components.requires_tutor_validation', return_value=True)
            mock('learner_api.assignment_settings.monthly_assignment_required', return_value=monthly)
            ready = mock('learner_api.components._assignment_form_ready', return_value=form_ready)
            complete = mock('learner_api.monthly_assignment.complete_saved_assignment')
            save = mock('learner_api.components.save_progress_record')
            queue = mock('learner_api.components.queue_for_marking')
            mock('learner_api.components.timezone.now', return_value=now)
            mock('learner_api.working_rules.learner_holiday_details', return_value={})
            response = view(request, 'COMP-A')
        return response, ready, complete, save, queue

    def test_an_assignment_that_is_not_monthly_completes_like_any_activity(self):
        response, ready, complete, save, queue = self.submit(monthly=False, form_ready=False)
        self.assertEqual(response.status_code, 200, response.content)
        ready.assert_not_called()
        complete.assert_not_called()
        save.assert_called_once()
        context = queue.call_args.kwargs['context']
        self.assertEqual(context['activityType'], 'activity')
        self.assertEqual(context['activityTitle'], 'Month 1 assignment')

    def test_the_monthly_assignment_still_requires_the_eight_step_submission(self):
        response, ready, complete, save, queue = self.submit(monthly=True, form_ready=False)
        self.assertEqual(response.status_code, 409)
        ready.assert_called_once()
        save.assert_not_called()
        queue.assert_not_called()
        response, _ready, complete, save, queue = self.submit(monthly=True)
        self.assertEqual(response.status_code, 200, response.content)
        complete.assert_called_once()
        self.assertEqual(queue.call_args.kwargs['context']['activityType'], 'assignment')
