"""Conversion preserves identities/history and uses ordinary module membership."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.http import JsonResponse
from django.test import RequestFactory, Client
from django.utils import timezone

from learner_api.models import EnrolmentUser, LearnerProfile, LearnerProgressEntry
from learner_api.learning_plan import _effective_plan_ids
from . import views as v, free_course_conversion as conversion
from .legacy_free_course_adoption import adopted_courses, adopt_course
from .legacy_free_course_migration import adopted_id
from .tests import CurriculumPersistenceTransactionHarness, staff_directory, staff_user_row


class FreeCourseConversionTests(CurriculumPersistenceTransactionHarness):
    databases = {'default', 'enrolment'}

    def setUp(self):
        super().setUp()
        self.enterContext(patch.object(v, 'fetch_staff_users_by_access', side_effect=staff_directory(
            staff_user_row('Tutor One', row_id=10),
            staff_user_row('Tutor Move', email='move@example.invalid', row_id=11),
            staff_user_row('Tutor Other', row_id=12),
            staff_user_row('Archived Tutor', row_id=13, status='archived'),
            staff_user_row('Coach Only', row_id=14, access='coach'),
        )))
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        self.target = {'programmeId': 'PROG-DATA', 'cohortId': 'COHORT-DATA-1', 'groupId': 'GROUP-DATA-1',
                       'tutor': 'tutor-uuid-11'}
        self.module_id = 'MOD-FREE-MOVE'
        v.save_module_authoring_structure(self.module_id, {
            'isFreeCourse': True, 'title': 'Independent study', 'totalOtjh': 7,
            'weekStructure': [{'id': 'WEEK-FREE-MOVE', 'title': 'Study', 'components': [
                {'id': 'COMP-FREE-MOVE', 'type': 'reading', 'title': 'Read', 'expectedOtjh': 7,
                 'settings': {'readingContent': '<p>Keep this content</p>'}},
            ]}],
        }, repair_links=False)
        self.auth = self.enterContext(patch('login.permissions.authenticate_request',
            return_value=SimpleNamespace(role='staff', pk=100)))
        self.enterContext(patch.object(conversion, 'check_structure_save', return_value=None))
        self.enterContext(patch.object(conversion, 'announce_saved'))

    def convert(self, payload=None, module_id=None):
        request = RequestFactory().post('/', json.dumps(self.target if payload is None else payload),
                                        content_type='application/json')
        return conversion.convert_free_course(request, module_id or self.module_id)

    def test_price_survives_conversion_and_ordinary_module_edits(self):
        v.save_module_authoring_structure(self.module_id, {
            'title': 'Independent study', 'isForSale': True, 'price': '149.95', 'currency': 'GBP',
        }, repair_links=False)
        response = self.convert()
        self.assertEqual(response.status_code, 200, response.content)
        saved = v.save_module_authoring_structure(self.module_id, {
            'title': 'Placed course',
        }, repair_links=False)
        self.assertFalse(saved['isFreeCourse'])
        self.assertTrue(saved['isForSale'])
        self.assertEqual(saved['price'], '149.95')
        self.assertEqual(saved['currency'], 'GBP')
        self.assertEqual(saved['totalOtjh'], 7)

    def test_move_keeps_content_hours_and_other_modules_and_can_be_retried(self):
        before = v.module_structure_source_rows(self.module_id)
        other = v.authoring_module_exists('MOD-DATA-1')
        with patch.object(v, 'link_live_session_series_to_module') as link, \
                patch.object(v, 'attach_teams_meeting_to_module_weeks') as attach:
            response = self.convert()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(json.loads(response.content)['converted'])
        link.assert_not_called(); attach.assert_not_called()
        saved = v.authoring_module_exists(self.module_id)
        self.assertEqual(saved['source_type'], 'module_authoring')
        self.assertEqual(saved['learner_roster_mode'], 'inherited')
        self.assertEqual(saved['group_id'], self.target['groupId'])
        self.assertEqual(saved['tutor_name'], 'Tutor Move')
        self.assertEqual(saved['tutor_email'], 'move@example.invalid')
        self.assertEqual(json.loads(response.content)['tutor'], 'Tutor Move')
        self.assertEqual(float(saved['total_otjh']), 7)
        after = v.module_structure_source_rows(self.module_id)
        for table, rows in before.items():
            if table != v.AUTHORING_MODULES_TABLE:
                self.assertEqual(after[table], rows, table)
        self.assertEqual(v.authoring_module_exists('MOD-DATA-1'), other)
        self.assertFalse(v.get_authoring_structure_payload(self.module_id)['isFreeCourse'])
        group = v.resolve_group_row(self.target['groupId'])
        self.assertIn('MOD-DATA-1', v.parse_json_value(group['module_ids'], []))
        self.assertEqual(v.parse_json_value(group['module_ids'], []).count(self.module_id), 1)
        self.assertFalse(json.loads(self.convert().content)['converted'])
        self.assertEqual(v.authoring_module_exists(self.module_id), saved)

    def test_tutor_is_required_and_must_be_an_active_tutor(self):
        before = v.authoring_module_exists(self.module_id)
        group = v.resolve_group_row(self.target['groupId'])
        cases = [{key: value for key, value in self.target.items() if key != 'tutor'}]
        cases += [{**self.target, 'tutor': value} for value in (
            '', '   ', 'Unassigned', None, [], 11, 'missing-tutor', 'tutor-uuid-13', 'coach-uuid-14')]
        for payload in cases:
            with self.subTest(tutor=payload.get('tutor')):
                response = self.convert(payload)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(json.loads(response.content)['fields'], ['tutor'])
        self.assertEqual(v.authoring_module_exists(self.module_id), before)
        self.assertEqual(v.resolve_group_row(self.target['groupId']), group)

    def test_email_is_derived_from_directory_and_retries_cannot_reassign_tutor(self):
        self.assertEqual(self.convert({**self.target, 'tutorEmail': 'untrusted@example.invalid'}).status_code, 200)
        saved = v.authoring_module_exists(self.module_id)
        self.assertEqual(saved['tutor_email'], 'move@example.invalid')
        response = self.convert({**self.target, 'tutor': 'tutor-uuid-12'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(v.authoring_module_exists(self.module_id), saved)

    def test_conversion_respects_tutor_edit_reservations(self):
        with patch.object(conversion, 'check_structure_save', return_value=JsonResponse({'error': 'Reserved'}, status=409)) as guard:
            self.assertEqual(self.convert().status_code, 409)
        self.assertEqual(guard.call_args.args[3]['tutor'], 'Tutor Move')
        self.assertEqual(v.authoring_module_exists(self.module_id)['source_type'], 'free_course')

    def test_tutor_clash_rejects_the_whole_conversion(self):
        v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [self.module_id], {
            'start_date': '2026-09-02', 'sessions_number': 2, 'session_week_day': 'Wednesday',
            'session_start_time': '10:00', 'session_end_time': '12:00',
        })
        before = v.authoring_module_exists(self.module_id)
        group = v.resolve_group_row(self.target['groupId'])
        response = self.convert({**self.target, 'tutor': 'tutor-uuid-10'})
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(json.loads(response.content)['tutorConflicts'][0]['moduleCatalogueId'], 'MOD-DATA-1')
        self.assertEqual(v.authoring_module_exists(self.module_id), before)
        self.assertEqual(v.resolve_group_row(self.target['groupId']), group)

    def test_group_with_clock_but_no_delivery_day_rejects_tutor_assignment(self):
        v.update_group_fields(self.target['groupId'], {'session_week_day': '', 'schedule': ''})
        before = v.authoring_module_exists(self.module_id)
        response = self.convert()
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(json.loads(response.content)['code'], 'missing_delivery_day')
        self.assertEqual(v.authoring_module_exists(self.module_id), before)

    def test_existing_commercial_and_apprenticeship_history_and_assignments_stay_unchanged(self):
        original = []
        for index, kind in enumerate(('commercial', 'apprenticeship')):
            plan = [{'moduleId': self.module_id, 'assignmentMode': 'explicit', 'hours': 7}]
            learner = EnrolmentUser.all_learners.create(username=kind, email=f'{kind}@example.invalid',
                learner_type=kind, programme='Other programme', cohort='Other cohort', group='Other group',
                training_plan=plan if kind == 'commercial' else None, learning_plan=plan if kind == 'apprenticeship' else None)
            profile = LearnerProfile.objects.create(enrolment_id=learner.pk, email=learner.email,
                full_name=kind, learner_type=kind, lifecycle_status='active', learning_plan=plan)
            progress = LearnerProgressEntry.objects.create(learner=profile, entry_order=index, kind='component',
                module_ref=self.module_id, week_ref='WEEK-FREE-MOVE', component_ref='COMP-FREE-MOVE',
                expected_otjh=1.5, verified_seconds=900, submitted_at=timezone.now(), passed=True)
            original.append((learner, LearnerProgressEntry.objects.filter(pk=progress.pk).values().get(),
                             learner.training_plan, learner.learning_plan))
        self.assertEqual(self.convert().status_code, 200)
        for learner, progress, training, learning in original:
            learner.refresh_from_db()
            self.assertEqual(learner.training_plan, training)
            self.assertEqual(learner.learning_plan, learning)
            self.assertEqual((learner.programme, learner.cohort, learner.group), ('Other programme', 'Other cohort', 'Other group'))
            self.assertIn(self.module_id, _effective_plan_ids(learner, {}))
            self.assertEqual(LearnerProgressEntry.objects.filter(pk=progress['id']).values().get(), progress)

    def test_group_members_inherit_using_normal_plan_rules_and_other_groups_do_not(self):
        learners = [EnrolmentUser.all_learners.create(username=kind, email=f'group-{kind}@example.invalid',
            learner_type=kind, programme='Data Analyst', cohort='September 2026', group='Group A',
            training_plan=None, learning_plan=None) for kind in ('commercial', 'apprenticeship')]
        other = EnrolmentUser.all_learners.create(username='Other', email='other@example.invalid',
            learner_type='commercial', programme='Data Analyst', cohort='September 2026', group='Other group')
        explicit = EnrolmentUser.all_learners.create(username='Explicit', email='explicit@example.invalid',
            learner_type='commercial', programme='Data Analyst', cohort='September 2026', group='Group A',
            training_plan=[{'moduleId': 'MOD-DATA-1', 'assignmentMode': 'explicit'}])
        self.assertEqual(self.convert().status_code, 200)
        for learner in learners:
            self.assertIn(self.module_id, _effective_plan_ids(learner, {}))
        self.assertNotIn(self.module_id, _effective_plan_ids(other, {}))
        self.assertNotIn(self.module_id, _effective_plan_ids(explicit, {}))

    def test_bad_or_mismatched_destination_never_writes(self):
        before = v.authoring_module_exists(self.module_id)
        for change in ({'programmeId': ''}, {'groupId': 'MISSING'}, {'cohortId': 'MISSING'}):
            response = self.convert({**self.target, **change})
            self.assertEqual(response.status_code, 400, response.content)
        v.update_group_fields(self.target['groupId'], {'cohort_id': 'OTHER-COHORT'})
        self.assertEqual(self.convert().status_code, 400)
        self.assertEqual(v.authoring_module_exists(self.module_id), before)

    def test_archived_destination_and_archived_source_are_rejected(self):
        v.update_group_fields(self.target['groupId'], {'deleted_at': timezone.now()})
        self.assertEqual(self.convert().status_code, 400)
        v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                [self.module_id], {'deleted_at': timezone.now()})
        self.assertEqual(self.convert().status_code, 404)

    def test_partial_failure_rolls_back_module_and_group(self):
        before = v.authoring_module_exists(self.module_id)
        group = v.resolve_group_row(self.target['groupId'])
        with patch.object(v, 'update_group_fields', side_effect=RuntimeError('Synthetic failure')):
            self.assertEqual(self.convert().status_code, 500)
        self.assertEqual(v.authoring_module_exists(self.module_id), before)
        self.assertEqual(v.resolve_group_row(self.target['groupId']), group)

    def test_active_edit_reservation_blocks_conversion(self):
        with patch.object(conversion, 'check_structure_save', return_value=JsonResponse({'error': 'Reserved'}, status=409)):
            self.assertEqual(self.convert().status_code, 409)
        self.assertEqual(v.authoring_module_exists(self.module_id)['source_type'], 'free_course')

    def test_only_staff_and_admin_can_convert(self):
        for role in (None, 'learner', 'coach', 'tutor', 'employer'):
            self.auth.return_value = SimpleNamespace(role=role, pk=101) if role else None
            self.assertEqual(self.convert().status_code, 403 if role else 401)
        self.auth.return_value = SimpleNamespace(role='admin', pk=100)
        self.assertEqual(self.convert().status_code, 200)

    def test_route_requires_csrf_for_cookie_authenticated_write(self):
        response = Client(enforce_csrf_checks=True).post(
            f'/curriculum_api/curriculum/modules/{self.module_id}/convert-free-course/',
            json.dumps(self.target), content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(v.authoring_module_exists(self.module_id)['source_type'], 'free_course')

    def test_converted_legacy_course_stays_adopted_and_preserves_live_identity(self):
        legacy_id = 'FREECOURSE-MOVE-LEGACY'
        module_id = adopted_id('MOD', legacy_id, legacy_id)
        v.ensure_free_programme_tables()
        def remove_legacy_fixture():
            # The new bridge persists source children; respect their owner FKs.
            v.free_programme_delete(v.FREE_PROGRAMME_COMPONENTS_TABLE,
                'free_module_id IN (SELECT id FROM curriculum.free_course_weeks WHERE course_id = %s)', [legacy_id])
            v.free_programme_delete(v.FREE_PROGRAMME_MODULES_TABLE, 'course_id = %s', [legacy_id])
            v.free_programme_delete(v.FREE_COURSES_TABLE, 'id = %s', [legacy_id])
        self.addCleanup(remove_legacy_fixture)
        v.free_programme_upsert(v.FREE_COURSES_TABLE, ['id'], {'id': legacy_id, 'course_name': 'Legacy'})
        settings = {'teamsLiveSessionId': 'LIVE-KEEP', 'teamsOccurrenceId': 'OCC-KEEP', 'teamsMeetingUrl': 'https://example.invalid/join'}
        payload = {'isFreeCourse': True, 'sourceId': legacy_id, 'catalogueId': module_id, 'title': 'Legacy',
            'weekStructure': [{'id': 'WEEK-LEGACY-MOVE', 'title': 'Legacy week', 'components': [{'id': 'COMP-LEGACY-MOVE',
                'type': 'live-session', 'title': 'Retained live session', 'expectedOtjh': 2, 'settings': settings}]}]}
        self.assertEqual(v.validate_module_authoring_payload(payload), [])
        v.save_module_authoring_structure(module_id, payload, repair_links=False, _legacy_live_ids={'COMP-LEGACY-MOVE'})
        before = v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_id])
        with patch.object(v, 'link_live_session_series_to_module') as link:
            self.assertEqual(self.convert(module_id=module_id).status_code, 200)
        link.assert_not_called()
        self.assertEqual(v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_id]), before)
        self.assertEqual(adopted_courses()[legacy_id], module_id)
        self.assertFalse(adopt_course(payload))
        self.assertFalse(v.get_authoring_structure_payload(module_id)['isFreeCourse'])

    def test_regular_content_editor_accepts_new_live_content_after_conversion(self):
        self.assertEqual(self.convert().status_code, 200)
        payload = v.get_authoring_structure_payload(self.module_id)
        payload['weekStructure'][0]['components'].append({'id': 'COMP-NEW-LIVE', 'type': 'live-session',
            'title': 'New live session', 'expectedOtjh': 1, 'settings': {}})
        saved = v.save_module_authoring_structure(self.module_id, payload, repair_links=False)
        self.assertIn('COMP-NEW-LIVE', [item['id'] for item in saved['weekStructure'][0]['components']])
        self.assertEqual(float(v.authoring_module_exists(self.module_id)['total_otjh']), 8)
