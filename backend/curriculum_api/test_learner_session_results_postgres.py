"""Canonical learner/session ownership checks on isolated PostgreSQL only.

The companion runner creates a fresh loopback-only cluster and blocks every
other database/network target before loading this module.
"""
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from django.db import connections
from learner_api.models import (
    EnrolmentUser,
    LearnerProfile,
    LearnerTrainingPlanComponent,
    LearnerTrainingPlanModule,
    LearnerTrainingPlanWeek,
    PlacementProgramme,
)

from curriculum_api.models import ModuleAuthoringComponent, ModuleAuthoringWeek

from .session_results import learner_series

TARGET_MODULE = 'MOD-TARGET'
OTHER_MODULE = 'MOD-OTHER'
FOREIGN_MODULE = 'MOD-FOREIGN'
TARGET_SERIES = 'LIVE-TARGET'
TEST_PROGRAMME = 'PROG-TEST'


class LearnerSessionOwnershipPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connections['default'].cursor() as cursor:
            cursor.execute(
                "SELECT to_regclass('Learner.learner_training_plan_modules')"
            )
            plan_table_exists = cursor.fetchone()[0]
        if not plan_table_exists:
            with connections['default'].schema_editor() as editor:
                editor.create_model(LearnerTrainingPlanModule)
                editor.create_model(LearnerTrainingPlanWeek)
                editor.create_model(LearnerTrainingPlanComponent)

        PlacementProgramme.objects.create(
            programme_id=TEST_PROGRAMME,
            name='Synthetic isolated programme',
        )
        with connections['default'].cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.modules
                (module_catalogue_id,title,status,quality_score,created_at,updated_at)
                VALUES
                (%s,'Target module','active',0,now(),now()),
                (%s,'Other module','active',0,now(),now()),
                (%s,'Foreign module','active',0,now(),now())''', [
                    TARGET_MODULE, OTHER_MODULE, FOREIGN_MODULE,
                ])
            cursor.execute('''INSERT INTO curriculum.live_sessions
                (id,module_catalogue_id,module_title,provider,organizer_email,
                 start_datetime,duration_minutes,repeat_pattern,repeat_occurrences,
                 lobby_bypass,recording,spoken_language,meeting_type,status,
                 created_at,updated_at)
                VALUES (%s,%s,'Target module','Microsoft Teams','owner@example.invalid',
                        %s,120,'weekly',12,'everyone','record','en-GB','live-session',
                        'active',now(),now())''', [
                            TARGET_SERIES, TARGET_MODULE,
                            datetime(2026, 9, 17, 11, tzinfo=UTC),
                        ])

        cls.owned_source = EnrolmentUser.all_learners.create(
            id=101,
            username='Owned synthetic learner',
            email='owned@example.invalid',
            learner_type='commercial',
            programme_id=TEST_PROGRAMME,
            # Deliberately stale: the regression was caused by this projection
            # omitting the module that exists in the normalized plan.
            learning_plan=[{'moduleId': OTHER_MODULE, 'assignmentMode': 'explicit'}],
        )
        cls.other_source = EnrolmentUser.all_learners.create(
            id=102,
            username='Other synthetic learner',
            email='other@example.invalid',
            learner_type='commercial',
            programme_id=TEST_PROGRAMME,
            learning_plan=[{'moduleId': OTHER_MODULE, 'assignmentMode': 'explicit'}],
        )
        EnrolmentUser.all_learners.create(
            id=103,
            username='Unlinked synthetic learner',
            email='unlinked@example.invalid',
            learner_type='commercial',
            programme_id=TEST_PROGRAMME,
            learning_plan=[{'moduleId': TARGET_MODULE, 'assignmentMode': 'explicit'}],
        )
        owned_profile = LearnerProfile.objects.create(
            id=248, enrolment_id=101, full_name='Owned synthetic learner',
            email='owned@example.invalid', lifecycle_status='active',
            learner_type='commercial',
        )
        other_profile = LearnerProfile.objects.create(
            id=249, enrolment_id=102, full_name='Other synthetic learner',
            email='other@example.invalid', lifecycle_status='active',
            learner_type='commercial',
        )
        owned_plan_module = LearnerTrainingPlanModule.objects.create(
            learner=owned_profile, position=1, curriculum_module_id=TARGET_MODULE,
        )
        LearnerTrainingPlanModule.objects.create(
            learner=other_profile, position=1, curriculum_module_id=OTHER_MODULE,
        )

        # Reproduce the real identity collision: URL/enrolment 285 belongs to
        # canonical learner 407, while canonical learner 285 belongs to URL 207.
        cls.url_285_source = EnrolmentUser.all_learners.create(
            id=285, username='URL 285 owner', email='url285@example.invalid',
            learner_type='commercial', programme_id=TEST_PROGRAMME,
            learning_plan=[{'moduleId': FOREIGN_MODULE, 'assignmentMode': 'explicit'}],
        )
        cls.url_207_source = EnrolmentUser.all_learners.create(
            id=207, username='Canonical 285 owner', email='url207@example.invalid',
            learner_type='commercial', programme_id=TEST_PROGRAMME,
            learning_plan=[{'moduleId': TARGET_MODULE, 'assignmentMode': 'explicit'}],
        )
        profile_407 = LearnerProfile.objects.create(
            id=407, enrolment_id=285, full_name='URL 285 owner',
            email='url285@example.invalid', lifecycle_status='active', learner_type='commercial',
        )
        profile_285 = LearnerProfile.objects.create(
            id=285, enrolment_id=207, full_name='Canonical 285 owner',
            email='url207@example.invalid', lifecycle_status='active', learner_type='commercial',
        )
        LearnerTrainingPlanModule.objects.create(
            learner=profile_407, position=1, curriculum_module_id=OTHER_MODULE,
        )
        LearnerTrainingPlanModule.objects.create(
            learner=profile_285, position=1, curriculum_module_id=FOREIGN_MODULE,
        )
        ModuleAuthoringWeek.objects.create(
            id='W-TARGET', module_catalogue_id=TARGET_MODULE, week_number=1,
            title='Owned week', display_order=1,
        )
        ModuleAuthoringComponent.objects.create(
            id='C-TARGET', week_id='W-TARGET', module_catalogue_id=TARGET_MODULE,
            type='reading', title='Owned component', display_order=1,
        )
        owned_plan_week = LearnerTrainingPlanWeek.objects.create(
            plan_module=owned_plan_module, position=1, curriculum_week_id='W-TARGET',
        )
        LearnerTrainingPlanComponent.objects.create(
            plan_week=owned_plan_week, position=1, curriculum_component_id='C-TARGET',
        )

    def test_canonical_owner_can_resolve_series_despite_stale_compatibility_plan(self):
        learner, series = learner_series('commercial', 101, TARGET_SERIES)

        self.assertEqual(learner.pk, 101)
        self.assertEqual(series['id'], TARGET_SERIES)
        self.assertEqual(series['module_catalogue_id'], TARGET_MODULE)
        self.assertEqual(learner._canonical_training_plan, [{'moduleId': TARGET_MODULE}])
        self.assertEqual(learner.learning_plan, [{'moduleId': OTHER_MODULE,
                                                  'assignmentMode': 'explicit'}])

    def test_other_learner_cannot_resolve_target_series(self):
        self.assertEqual(learner_series('commercial', 102, TARGET_SERIES), (None, None))

    def test_missing_canonical_identity_fails_closed(self):
        self.assertEqual(learner_series('commercial', 103, TARGET_SERIES), (None, None))

    def test_historical_results_keep_inactive_parent_access_but_join_does_not(self):
        with connections['default'].cursor() as cursor:
            cursor.execute("UPDATE curriculum.modules SET status='inactive' WHERE module_catalogue_id=%s",
                           [TARGET_MODULE])
        try:
            learner, series = learner_series(
                'commercial', 101, TARGET_SERIES, linked_recordings=True,
            )
            self.assertEqual((learner.pk, series['id']), (101, TARGET_SERIES))
            self.assertEqual(learner_series('commercial', 101, TARGET_SERIES), (None, None))
        finally:
            with connections['default'].cursor() as cursor:
                cursor.execute("UPDATE curriculum.modules SET status='active' WHERE module_catalogue_id=%s",
                               [TARGET_MODULE])

    def test_current_attendance_ownership_uses_complete_canonical_result_set(self):
        from learner_api.attendance_assignments import assigned_module_ids

        owned = EnrolmentUser.all_learners.get(pk=101)
        other = EnrolmentUser.all_learners.get(pk=102)
        self.assertEqual(assigned_module_ids(owned), [TARGET_MODULE])
        self.assertEqual(assigned_module_ids(other), [OTHER_MODULE])
        unlinked = EnrolmentUser.all_learners.get(pk=103)
        self.assertEqual(assigned_module_ids(unlinked), [])
        self.assertEqual(owned.learning_plan, [
            {'moduleId': OTHER_MODULE, 'assignmentMode': 'explicit'},
        ])

    def test_current_subjects_are_canonical_while_legacy_lineage_stays_historical(self):
        from learner_api.overview_week import HOME_SUBJECTS_SQL
        from learner_api.student_activity import (
            ASSIGNED_SUBJECTS_SQL,
            CURRENT_SUBJECTS_SQL,
        )

        with connections['enrolment'].cursor() as cursor:
            cursor.execute(CURRENT_SUBJECTS_SQL, [101])
            current = cursor.fetchall()
            cursor.execute(ASSIGNED_SUBJECTS_SQL, [101])
            historical = cursor.fetchall()
            cursor.execute(HOME_SUBJECTS_SQL, [101])
            home = cursor.fetchall()
            cursor.execute(CURRENT_SUBJECTS_SQL, [285])
            url_285_current = cursor.fetchall()

        self.assertEqual(current, [(TARGET_MODULE, 'Target module')])
        self.assertCountEqual(historical, [
            (OTHER_MODULE, 'Other module'),
            (TARGET_MODULE, 'Target module'),
        ])
        self.assertCountEqual(home, [
            (OTHER_MODULE, 'Other module', False),
            (TARGET_MODULE, 'Target module', True),
        ])
        self.assertEqual(url_285_current, [(OTHER_MODULE, 'Other module')])

    def test_url_285_never_resolves_canonical_learner_285(self):
        from learner_api.attendance_assignments import assigned_module_ids
        from learner_api.identity import learner_profile_for_source

        owner_285 = learner_profile_for_source(
            self.url_285_source, 285, heal=False, fields=('id', 'enrolment_id'),
        )
        owner_207 = learner_profile_for_source(
            self.url_207_source, 207, heal=False, fields=('id', 'enrolment_id'),
        )
        self.assertEqual((owner_285.pk, owner_285.enrolment_id), (407, 285))
        self.assertEqual((owner_207.pk, owner_207.enrolment_id), (285, 207))
        self.assertEqual(assigned_module_ids(self.url_285_source), [OTHER_MODULE])
        self.assertEqual(assigned_module_ids(self.url_207_source), [FOREIGN_MODULE])

    def test_feedback_membership_uses_normalized_rows_not_legacy_json(self):
        from engagement_api.module_feedback import module_memberships

        self.assertEqual(module_memberships({TARGET_MODULE, OTHER_MODULE}, learner_id=101), {
            '101': {TARGET_MODULE},
        })
        self.assertEqual(module_memberships({TARGET_MODULE, OTHER_MODULE}, learner_id=285), {
            '285': {OTHER_MODULE},
        })
        self.assertNotIn('103', module_memberships({TARGET_MODULE}))

    def test_live_activity_gate_uses_canonical_owner_and_fails_closed(self):
        from learner_api.live_session_access import access_refusal

        component = {'componentId': 'C1', 'moduleId': TARGET_MODULE, 'type': 'live_session'}
        with patch('learner_api.live_session_access._read', return_value=[{
                'type': 'live_session', 'module_catalogue_id': TARGET_MODULE,
        }]), patch('learner_api.learner_detail._resolve_from_master',
                   return_value=([], [], [component])), \
             patch('learner_api.live_session_access.annotate_access', return_value=[{
                 **component, 'liveSessionAccess': {'open': True},
             }]):
            self.assertIsNone(access_refusal(
                'commercial', 101, 'C1', source=EnrolmentUser.all_learners.get(pk=101),
            ))
            refused = access_refusal(
                'commercial', 102, 'C1', source=EnrolmentUser.all_learners.get(pk=102),
            )
            unlinked = access_refusal(
                'commercial', 103, 'C1',
                source=EnrolmentUser.all_learners.get(pk=103),
            )
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(unlinked.status_code, 403)

    def test_schedule_module_ids_install_canonical_plan_once(self):
        from learner_api.training_plan_dashboard import plan_module_ids

        source = EnrolmentUser.all_learners.get(pk=101)
        owner = {'id': 248, 'enrolment_id': 101}
        with connections['enrolment'].cursor() as cursor, \
             patch('learner_api.training_plan_dashboard.builder_subject_links', return_value={}) as links:
            first = plan_module_ids(cursor, source, owner)
            second = plan_module_ids(cursor, source, owner)
        self.assertEqual(first, ([TARGET_MODULE], {}))
        self.assertEqual(second, first)
        self.assertEqual(source._canonical_training_plan, [{'moduleId': TARGET_MODULE}])
        self.assertEqual(links.call_count, 2)

    def test_full_canonical_tree_preserves_module_week_and_component_ownership(self):
        from learner_api.learning_plan import install_canonical_training_plan_modules

        source = EnrolmentUser.all_learners.get(pk=101)
        profile = LearnerProfile.objects.get(pk=248)
        plan = install_canonical_training_plan_modules(source, profile)
        self.assertEqual(plan, [{
            'moduleId': TARGET_MODULE,
            'moduleTitle': 'Target module',
            'weeks': [{
                'weekId': 'W-TARGET',
                'weekTitle': 'Owned week',
                'components': [{'componentId': 'C-TARGET'}],
            }],
        }])


if __name__ == '__main__':
    unittest.main(verbosity=2)
