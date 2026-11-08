"""Transactional adoption and editing regressions on the isolated PG runner."""
import json
from datetime import datetime, timezone
from unittest.mock import patch

from django.db import connection

from learner_api import models
from learner_api.mappers import get_training_plan
from . import views
from .legacy_free_course_adoption import adoption_snapshot, adopt_course, adopt_learners, adopted_courses
from .legacy_free_course_migration import SOURCE_SYSTEM
from .tests import CurriculumPersistenceTransactionHarness


class LegacyFreeCourseAdoptionTests(CurriculumPersistenceTransactionHarness):
    databases = {'default', 'enrolment'}

    def setUp(self):
        super().setUp()
        views.ensure_free_programme_tables()
        # The storage bridge retains source rows when runtime fixtures are
        # removed. Give each test its own synthetic legacy catalogue as well.
        with connection.cursor() as cursor:
            for table in (views.FREE_PROGRAMME_COMPONENTS_TABLE, views.FREE_PROGRAMME_MODULES_TABLE, views.FREE_COURSES_TABLE):
                cursor.execute(f'DELETE FROM {views.authoring_table_name(table)}')
        for model in (models.LearnerTrainingPlanModule, models.LearnerTrainingPlanWeek,
                      models.LearnerTrainingPlanComponent, models.LearnerFreeCourse, models.LearnerFreeCourseProgress):
            with connection.cursor() as cursor:
                cursor.execute('SELECT to_regclass(%s)', ['"' + model._meta.db_table + '"'])
                exists = cursor.fetchone()[0]
            if not exists:
                with connection.schema_editor() as editor:
                    editor.create_model(model)
        with connection.cursor() as cursor:
            for name, kind in (('source_system', 'text'), ('source_payload', 'jsonb'), ('actual_seconds', 'bigint'),
                               ('accepted', 'boolean'), ('activity_status', 'text'), ('actual_basis', 'text')):
                cursor.execute(f'ALTER TABLE "Learner".learner_progress_entries ADD COLUMN IF NOT EXISTS {name} {kind}')
        self.course_id = 'FREECOURSE-ADOPT'
        views.free_programme_upsert(views.FREE_COURSES_TABLE, ['id'], {
            'id': self.course_id, 'course_name': 'Legacy study', 'description': 'Keep this description',
        })
        views.free_programme_upsert(views.FREE_PROGRAMME_MODULES_TABLE, ['id'], {
            'id': 'FREEWEEK-ADOPT', 'course_id': self.course_id, 'week_number': 1,
            'week_title': 'Study week', 'course_name': 'Legacy study', 'display_order': 1,
        })
        for ident, kind, hours, settings in (
            ('FREECOMP-READ', 'reading', 1.5, {'readingContent': '<p>Original</p>'}),
            ('FREECOMP-LIVE', 'live_session', 0.5, {'teamsLiveSessionId': 'LIVE-KEEP',
                'teamsOccurrenceId': 'OCC-KEEP', 'teamsMeetingUrl': 'https://example.test/meeting'}),
        ):
            views.free_programme_upsert(views.FREE_PROGRAMME_COMPONENTS_TABLE, ['id'], {
                'id': ident, 'free_module_id': 'FREEWEEK-ADOPT', 'programme_id': 'FREE-COURSES',
                'type': kind, 'title': ident, 'expected_otjh': hours, 'settings_json': json.dumps(settings),
            })

    def snapshot(self):
        return adoption_snapshot()

    def test_adoption_keeps_source_rows_and_live_identity_without_touching_teams(self):
        snapshot = self.snapshot()
        payload = snapshot['payloads'][0]
        with patch.object(views, 'link_live_session_series_to_module') as link, \
                patch.object(views, 'attach_teams_meeting_to_module_weeks') as attach:
            self.assertTrue(adopt_course(payload))
        link.assert_not_called()
        attach.assert_not_called()
        self.assertEqual(adopted_courses()[self.course_id], payload['catalogueId'])
        module = views.get_authoring_structure_payload(payload['catalogueId'])
        self.assertTrue(module['isFreeCourse'])
        self.assertEqual(float(module['totalOtjh']), 2)
        live = next(c for c in module['weekStructure'][0]['components'] if c['type'] == 'live-session')
        self.assertEqual(live['settings']['teamsLiveSessionId'], 'LIVE-KEEP')
        self.assertEqual(live['settings']['teamsOccurrenceId'], 'OCC-KEEP')
        self.assertEqual(views.get_free_programme_modules_payload('FREE-COURSES'), [])
        views.delete_free_programme_data('FREE-COURSES')
        self.assertEqual(len(views.free_programme_fetch_all(views.FREE_COURSES_TABLE)), 1)
        self.assertEqual(len(views.free_programme_fetch_all(views.FREE_PROGRAMME_COMPONENTS_TABLE)), 2)

    def test_edit_and_retry_preserve_course_identity_but_new_live_content_is_refused(self):
        payload = self.snapshot()['payloads'][0]
        adopt_course(payload)
        edited = views.save_module_authoring_structure(payload['catalogueId'], {'title': 'Edited in Module Builder'}, repair_links=False)
        self.assertEqual(edited['title'], 'Edited in Module Builder')
        self.assertFalse(adopt_course(payload))
        self.assertEqual(views.authoring_module_exists(payload['catalogueId'])['title'], 'Edited in Module Builder')
        edited['weekStructure'][0]['components'].append({'id': 'COMP-NEW-LIVE', 'type': 'live-session', 'title': 'New live'})
        with self.assertRaises(views.ModuleAuthoringValidationError):
            views.save_module_authoring_structure(payload['catalogueId'], edited, repair_links=False)
        with self.assertRaises(ValueError):
            views.save_free_programme_modules('FREE-COURSES', {'modules': [{'courseId': self.course_id}]})

    def test_assignments_for_both_types_and_history_move_once_without_retroactive_hours(self):
        at = datetime(2026, 9, 12, 10, tzinfo=timezone.utc)
        learners = []
        for index, kind in enumerate(('commercial', 'apprenticeship'), 1):
            learner = models.EnrolmentUser.all_learners.create(
                username=f'Synthetic {index}', email=f'adopt-{index}@example.invalid', learner_type=kind,
                programme='Existing programme', cohort='Existing cohort', group='Existing group',
                training_plan=[], free_courses=[{'freeCourseId': self.course_id, 'courseName': 'Legacy study'}])
            profile = models.LearnerProfile.objects.create(enrolment_id=learner.pk,
                email=learner.email, full_name=learner.username, lifecycle_status='active', learner_type=kind)
            models.LearnerFreeCourseProgress.objects.create(learner_id=learner.pk,
                component_ref='FREECOMP-READ', free_course_ref=self.course_id, completed_at=at)
            learners.append((learner, profile))
        untouched = models.EnrolmentUser.all_learners.create(username='Unassigned', email='unassigned@example.invalid',
            learner_type='commercial', training_plan=[], free_courses=[])
        snapshot = self.snapshot()
        for payload in snapshot['payloads']:
            adopt_course(payload)
        result = adopt_learners(snapshot)
        self.assertEqual(result, {'learnersUpdated': 2, 'completionsImported': 2})
        for learner, profile in learners:
            learner.refresh_from_db()
            self.assertEqual(learner.free_courses, [])
            plan = get_training_plan(learner)
            self.assertEqual([entry['moduleId'] for entry in plan], [snapshot['payloads'][0]['catalogueId']])
            self.assertTrue(plan[0]['weeks'])
            self.assertEqual((learner.programme, learner.cohort, learner.group),
                             ('Existing programme', 'Existing cohort', 'Existing group'))
            progress = models.LearnerProgressEntry.objects.get(learner=profile, component_link_source=SOURCE_SYSTEM)
            self.assertEqual(progress.submitted_at, at)
            self.assertIsNone(progress.passed)
            with connection.cursor() as cursor:
                cursor.execute('SELECT actual_seconds,accepted,activity_status FROM "Learner".learner_progress_entries WHERE id=%s', [progress.pk])
                self.assertEqual(cursor.fetchone(), (0, False, 'Completed'))
        untouched.refresh_from_db()
        self.assertEqual(untouched.training_plan, [])
        self.assertEqual(models.LearnerFreeCourseProgress.objects.count(), 2)
        self.assertEqual(adopt_learners(self.snapshot()), {'learnersUpdated': 0, 'completionsImported': 0})
