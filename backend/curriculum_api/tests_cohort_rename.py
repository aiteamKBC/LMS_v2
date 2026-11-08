"""Cohort renames change the curriculum name only; placement ids and eligibility stay.

"Learner".learners and enrolment."Created_users" keep only placement ids, and
both models read the cohort name through them, so a rename is visible to
learner readers without any learner or enrolment row being written.
"""
import json
from datetime import date
from unittest.mock import patch

from django.db import connection, transaction
from django.test import RequestFactory, TestCase

from learner_api.models import EnrolmentUser, LearnerProfile
from learner_api.programme_access import learning_access
from . import views
from .cohort_rename import CohortRenameConflict, propagate_cohort_name


class CohortRenameTests(TestCase):
    def setUp(self):
        with connection.cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.programmes
                (programme_id,name,color,created_at,updated_at)
                VALUES (%s,%s,%s,now(),now())''',
                ['INCIDENT-TEST-PROGRAMME', 'Incident test programme', '#000000'])
        self.cohort = {'cohort_id': 'INCIDENT-TEST-COHORT', 'cohort_name': 'Old name',
                       'programme_id': 'INCIDENT-TEST-PROGRAMME', 'programme_name': 'Incident test programme',
                       'start_date': date(2020, 1, 1), 'end_date': date(2030, 1, 1)}
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'], self.cohort)
        for table, key, identifier in (
            (views.GROUPS_TABLE, 'group_id', 'INCIDENT-TEST-GROUP'),
            (views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'INCIDENT-TEST-MODULE'),
        ):
            views.authoring_upsert(table, [key], {key: identifier, 'cohort_id': self.cohort['cohort_id'],
                'cohort_name': 'Old name', 'programme_id': self.cohort['programme_id'],
                'programme_name': self.cohort['programme_name'], 'group_id': 'INCIDENT-TEST-GROUP',
                'group_name': 'Synthetic group', 'title': 'Synthetic module'})
        with connection.cursor() as cursor:
            # -916101 is placed on the cohort by id; -916102 has no learner profile.
            for identifier in (-916101, -916102):
                cursor.execute('INSERT INTO enrolment."Created_users" (id) OVERRIDING SYSTEM VALUE VALUES (%s)',
                               [identifier])
            cursor.execute('''INSERT INTO "Learner".learners
                (id,full_name,email,lifecycle_status,enrolment_id,programme_id,cohort_id)
                OVERRIDING SYSTEM VALUE VALUES (%s,%s,%s,%s,%s,%s,%s)''',
                [-916101, 'Synthetic rename learner', 'cohort-rename-test@example.invalid', 'Active',
                 -916101, self.cohort['programme_id'], self.cohort['cohort_id']])

    def names(self):
        """(enrolment cohort name, profile cohort name, profile cohort id), read fresh by id."""
        enrolment = EnrolmentUser.all_learners.using('default').get(pk=-916101)
        profile = LearnerProfile.objects.using('default').get(pk=-916101)
        return enrolment.cohort, profile.cohort, profile.cohort_id

    def test_patch_renames_the_curriculum_name_and_readers_follow_the_unchanged_id(self):
        request = RequestFactory().patch('/cohorts/test', json.dumps({'name': 'New name'}), content_type='application/json')
        response = views.curriculum_cohort_detail(request, self.cohort['cohort_id'])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.names(), ('New name', 'New name', self.cohort['cohort_id']))
        parent = views.fetch_cohort_row(self.cohort['cohort_id'])
        self.assertEqual(parent['cohort_name'], 'New name')
        self.assertEqual(str(parent['start_date']), '2020-01-01')
        for table in (views.GROUPS_TABLE, views.AUTHORING_MODULES_TABLE):
            rows = views.authoring_fetch_all(table, 'cohort_id = %s', [self.cohort['cohort_id']])
            self.assertTrue(rows)
            self.assertTrue(all(row['cohort_name'] == 'New name' for row in rows))
        self.assertIsNone(EnrolmentUser.all_learners.using('default').get(pk=-916102).cohort)  # no profile, no name
        source = EnrolmentUser.all_learners.using('default').get(pk=-916101)
        self.assertEqual(learning_access(source), {'blocked': False, 'startDate': '2020-01-01'})

    def test_failed_child_write_rolls_back_and_queues_no_refresh(self):
        with patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh, \
                self.assertRaises(RuntimeError), transaction.atomic():
            with patch.object(views, 'update_authoring_rows', side_effect=RuntimeError('synthetic failure')):
                propagate_cohort_name(self.cohort, 'New name')
        refresh.assert_not_called()
        self.assertEqual(views.fetch_cohort_row(self.cohort['cohort_id'])['cohort_name'], 'Old name')
        self.assertEqual(self.names(), ('Old name', 'Old name', self.cohort['cohort_id']))

    def test_ambiguous_old_name_is_rejected(self):
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'],
                              {**self.cohort, 'cohort_id': 'INCIDENT-TEST-OTHER-COHORT'})
        with self.assertRaises(CohortRenameConflict):
            propagate_cohort_name(self.cohort, 'New name')
        self.assertEqual(self.names()[0], 'Old name')

    def test_existing_new_name_returns_conflict_without_saving_parent(self):
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'],
                              {**self.cohort, 'cohort_id': 'INCIDENT-TEST-OTHER-COHORT', 'cohort_name': 'New name'})
        request = RequestFactory().patch('/cohorts/test', json.dumps({'name': 'New name'}), content_type='application/json')
        response = views.curriculum_cohort_detail(request, self.cohort['cohort_id'])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(views.fetch_cohort_row(self.cohort['cohort_id'])['cohort_name'], 'Old name')
        self.assertEqual(self.names()[0], 'Old name')

    def test_rename_requests_fresh_learner_projection_for_learners_placed_by_id(self):
        with patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            propagate_cohort_name(self.cohort, 'New name')
        refresh.assert_called_once_with('apprenticeship', -916101, reason='cohort-rename', using='default')

    def test_a_learner_on_another_cohort_is_neither_refreshed_nor_moved(self):
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".learners SET cohort_id=%s WHERE id=-916101', ['OTHER-COHORT'])
        with patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            propagate_cohort_name(self.cohort, 'New name')
        refresh.assert_not_called()
        self.assertEqual(self.names()[2], 'OTHER-COHORT')
