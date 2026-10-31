import json
from contextlib import nullcontext
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import learner_directory_details as details


class DirectoryActivitySummaryTests(SimpleTestCase):
    def item(self, date, completed=False, **schedule):
        return {'completed': completed, 'schedule': {'date': date, **schedule}}

    def test_future_completion_does_not_mask_overdue_work_and_each_denominator_is_independent(self):
        items = [self.item('2026-10-01', i < 6) for i in range(8)]
        items += [self.item('2026-11-01') for _ in range(12)]
        result = details.activity_summary(items, '2026-10-31')
        self.assertEqual(result['due'], {'completed': 6, 'total': 8, 'percent': 75})
        self.assertEqual(result['available'], {'completed': 6, 'total': 20, 'percent': 30})
        items.append(self.item('2026-11-01', True))
        self.assertEqual(details.activity_summary(items, '2026-10-31')['due'], result['due'])

    def test_explicit_end_of_week_deadlines_and_real_delivery_week_dates(self):
        items = [self.item('2026-10-26', True, due_timing='end of week', week_end='2026-11-01'),
                 self.item(None, False, delivery_week={'start': '2026-10-30', 'end': '2026-11-05'})]
        self.assertEqual(details.activity_summary(items, '2026-10-31')['due'], {'completed': 0, 'total': 1, 'percent': 0})

    def test_missing_or_ambiguous_dates_are_not_reported_as_a_complete_or_zero_target(self):
        for item in [self.item(None), self.item('2026-10-01', date_needs_review=True), self.item('bad')]:
            result = details.activity_summary([item], '2026-10-31')
            self.assertIsNone(result['due'])
            self.assertEqual(result['undatedActivities'], 1)
            self.assertEqual(result['available']['percent'], 0)

    def test_empty_future_and_explicitly_unscheduled_content_have_no_false_percentage(self):
        for items in [[], [self.item('2026-11-01')], [self.item(None, date_source='introduction')]]:
            self.assertEqual(details.activity_summary(items, '2026-10-31')['due'], {'completed': 0, 'total': 0, 'percent': None})

    def test_exact_module_links_include_imports_and_exclude_other_groups(self):
        source = SimpleNamespace(pk=91)
        metadata = {'current_subjects': [], 'modules': {}, 'imported_courses': {'current:M1': 'legacy:20'}, 'replacement_courses': {}}
        context = ([], [], [], {}, [], [], set(), set(), {}, metadata, [])
        cards = [{'id': 'legacy:20', '_activityItems': [self.item('2026-10-01', True)]},
                 {'id': 'current:M2', 'moduleId': 'M2', '_activityItems': [self.item('2026-10-01')]}]
        with patch('learner_api.canonical_learning.require_profile', return_value={'id': 7}), \
             patch('learner_api.my_learning.load_context', return_value=context), \
             patch('learner_api.my_learning.assemble_cards', return_value=(cards, {})):
            result = details.learner_progress(source, '7', {'M1'}, '2026-10-31')
        self.assertEqual(result['available'], {'completed': 1, 'total': 1, 'percent': 100})

    def test_optional_items_reuse_catalogue_deduplication_and_pass_rules_without_changing_default_response(self):
        from learner_api import my_learning as learning
        from learner_api.tests_my_learning_no_db import component, native, metadata
        content = native([component(), component(), component('Q1', isQuiz=True, quizMeta={'quizId': 20})])
        content['quizAttempts'] = [{'componentId': 'Q1', 'passed': False}]
        content['componentProgress'] = [{'componentId': 'C1', 'kind': 'component', 'passed': None}]
        context = metadata()
        context['activity_dates'] = {'C1': {'date': '2026-10-01', 'date_source': 'builder_session'}}
        with patch('learner_api.course_catalogue_display.read_export_placements', return_value=[]), \
             patch('learner_api.training_plan_dashboard._canonical_module_progress', return_value={}), \
             patch('learner_api.live_session_progress.supplement_module_hours', return_value={}):
            regular, _ = learning.assemble_cards(content, context['current_subjects'], [], [], set(), set(), {}, context, [], {}, [])
            enriched, _ = learning.assemble_cards(content, context['current_subjects'], [], [], set(), set(), {}, context, [], {}, [], include_activity_items=True)
        self.assertNotIn('_activityItems', regular[0])
        self.assertEqual((enriched[0]['activityCount'], enriched[0]['completedActivityCount']), (2, 1))
        self.assertEqual(enriched[0]['_activityItems'][0], {'completed': True, 'schedule': context['activity_dates']['C1']})
        self.assertFalse(enriched[0]['_activityItems'][1]['completed'])


class DirectoryDetailsEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        self.auth = self.enterContext(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')))
        self.rows = [{'id': '7', 'enrolmentId': 91, 'programme': 'Example programme'}]
        self.roster = self.enterContext(patch.object(details, 'target_rows', return_value=self.rows))
        self.enrolments = self.enterContext(patch('learner_api.models.EnrolmentUser'))
        self.profiles = self.enterContext(patch('learner_api.models.LearnerProfile'))
        self.atomic = self.enterContext(patch.object(details.transaction, 'atomic', side_effect=lambda **kwargs: nullcontext()))
        self.invalidate = self.enterContext(patch('curriculum_api.views.invalidate_curriculum_cache'))
        self.source = SimpleNamespace(pk=91, programme='Example programme', programme_status='Active', save=Mock())
        self.profile = SimpleNamespace(programme='Example programme', programme_status='Active', lifecycle_status='active', save=Mock(), learning_plan=[{'moduleId': 'M1'}])
        self.enrolments.all_learners.select_for_update.return_value.filter.return_value.first.return_value = self.source
        self.profiles.objects.using.return_value.select_for_update.return_value.filter.return_value.first.return_value = self.profile

    def post(self, **overrides):
        payload = {'scope': 'module', 'id': 'M1', 'learnerId': '7', 'action': 'remove', 'expectedStatus': 'active', 'expectedProgramme': 'Example programme', **overrides}
        return details.membership(self.factory.post('/', json.dumps(payload), content_type='application/json'))

    def test_remove_and_restore_only_status_columns_for_both_learner_types(self):
        for kind in ('apprenticeship', 'commercial'):
            self.source.learner_type = kind
            for action, before, after in [('remove', 'active', 'withdrawn'), ('restore', 'withdrawn', 'active')]:
                self.source.programme_status = self.profile.lifecycle_status = before
                response = self.post(action=action, expectedStatus=before)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.profile.lifecycle_status, after)
                self.assertEqual(self.profile.learning_plan, [{'moduleId': 'M1'}])
                self.source.save.assert_called_with(using='enrolment', update_fields=['programme_status'])
                self.profile.save.assert_called_with(using='enrolment', update_fields=['programme_status', 'lifecycle_status', 'updated_at'])
                self.profiles.objects.using.return_value.select_for_update.return_value.filter.assert_called_with(pk='7', enrolment_id=91)

    def test_stale_status_new_programme_and_unlinked_profiles_never_write(self):
        self.source.programme_status = 'Completed'
        self.assertEqual(self.post().status_code, 409)
        self.source.programme_status = 'Active'
        self.source.programme = 'Another programme'
        self.assertEqual(self.post().status_code, 409)
        self.rows[0]['enrolmentId'] = None
        self.assertEqual(self.post().status_code, 404)
        self.source.save.assert_not_called()

    def test_invalid_actions_or_unrelated_learners_never_write(self):
        for overrides in [{'learnerId': '8'}, {'action': 'delete'}, {'scope': []}, {'action': []}, {'learnerId': True}, {'expectedStatus': 'withdrawn'}, {'expectedProgramme': 'Old programme'}]:
            self.assertIn(self.post(**overrides).status_code, (400, 404, 409))
        self.source.save.assert_not_called()

    def test_database_failure_is_visible_and_does_not_invalidate_success_counts(self):
        self.source.save.side_effect = DatabaseError('private detail')
        response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private detail', response.content.decode())
        self.invalidate.assert_not_called()

    def test_staff_gate_and_http_methods_are_enforced(self):
        for role, expected in [(None, 401), ('learner', 403), ('employer', 403), ('tutor', 403)]:
            self.auth.return_value = SimpleNamespace(role=role) if role else None
            self.assertEqual(self.post().status_code, expected)
            self.assertEqual(details.progress(self.factory.get('/')).status_code, expected)
        self.assertEqual(details.membership(self.factory.get('/')).status_code, 405)

    def test_membership_requires_csrf_and_locks_the_expected_database(self):
        from django.middleware.csrf import CsrfViewMiddleware
        request = self.factory.post('/', '{}', content_type='application/json')
        response = CsrfViewMiddleware(lambda request: None).process_view(request, details.membership, (), {})
        self.assertEqual(response.status_code, 403)
        self.roster.assert_not_called()
        self.assertEqual(self.post().status_code, 200)
        self.atomic.assert_called_once_with(using='enrolment')

    def test_progress_only_reads_bounded_visible_learners_and_uses_uk_cutoff(self):
        self.enrolments.all_learners.only.return_value.filter.return_value = [self.source]
        with patch('curriculum_api.views.authoring_scope_module_rows', return_value=[{'module_catalogue_id': 'M1'}]), \
             patch.object(details, 'learner_progress', return_value={'available': {}}) as read, \
             patch.object(details.timezone, 'now', return_value=datetime(2026, 7, 1, 23, 30, tzinfo=timezone.utc)):
            response = details.progress(self.factory.get('/', {'scope': 'group', 'id': 'G1', 'learnerIds': '7'}))
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with(self.source, '7', {'M1'}, '2026-07-02')
        self.source.save.assert_not_called()

    def test_invalid_and_out_of_scope_progress_requests_do_not_read_learning_content(self):
        with patch.object(details, 'learner_progress') as read:
            for ids in ('', '8', '1,2,3,4,5,6', 'abc', '99999999999999999999'):
                response = details.progress(self.factory.get('/', {'scope': 'module', 'id': 'M1', 'learnerIds': ids}))
                self.assertIn(response.status_code, (400, 409))
            read.assert_not_called()

    def test_missing_bridge_reports_unavailable_instead_of_zero(self):
        self.rows[0]['enrolmentId'] = None
        self.enrolments.all_learners.only.return_value.filter.return_value = []
        with patch('curriculum_api.views.authoring_scope_module_rows', return_value=[]):
            response = details.progress(self.factory.get('/', {'scope': 'module', 'id': 'M1', 'learnerIds': '7'}))
        self.assertIn('error', json.loads(response.content)['learners']['7'])
