"""Opt-in regressions against a verified disposable PostgreSQL database.

The runner must provision the canonical schema plus migration 0089 first.
Every test rolls back its synthetic content and learner/quiz references.
"""
import os
import json
from copy import deepcopy
from importlib import import_module
from unittest import skipUnless

from django.db import connection, transaction
from django.test import SimpleTestCase, override_settings

from curriculum_api.catalogue.api import free_course_authoring as documents
from curriculum_api.catalogue.api import free_course_mutations as mutations
from curriculum_api.catalogue.infrastructure import free_course_rows as catalogue
from curriculum_api.catalogue.api.free_course_quiz_views import _owned_component
from learner_api.free_courses_view import _course_detail, _scoped_rows


@skipUnless(os.environ.get('FREE_COURSE_AUTHORING_WRITE_POSTGRES_TESTS') == '1',
            'requires a verified disposable PostgreSQL database')
@override_settings(FREE_COURSE_AUTHORING_WRITE_MODE='canonical')
class FreeCourseSoftDeletePostgresTests(SimpleTestCase):
    databases = {'default'}

    def setUp(self):
        self.atomic = transaction.atomic()
        self.atomic.__enter__()
        self.addCleanup(self.rollback)
        self.document = mutations.create_course({
            'expectedRevision': documents.catalogue_document(read_snapshot=False)['revision'],
            'clientId': 'course:archive',
            'course': {'courseName': 'Synthetic archival course'},
            'weeks': [
                {'clientId': 'week:one', 'title': 'First', 'components': [
                    {'clientId': 'video:one', 'title': 'Same name', 'type': 'video', 'expectedOtjh': '1',
                     'settings': {'videoUrl': 'https://example.test/original'}},
                    {'clientId': 'reading:one', 'title': 'Keep', 'type': 'reading', 'expectedOtjh': '2'},
                ]},
                {'clientId': 'week:two', 'title': 'Second', 'components': [
                    {'clientId': 'quiz:one', 'title': 'Quiz', 'type': 'quiz', 'expectedOtjh': '3'},
                ]},
            ],
        }, staff_id=999999, idempotency_key='soft-delete:test:0001')['body']
        self.course_id = self.document['course']['courseId']
        self.week = self.document['weeks'][0]
        self.video = self.week['components'][0]
        self.second = self.document['weeks'][1]

    def rollback(self):
        transaction.set_rollback(True)
        self.atomic.__exit__(None, None, None)

    def query(self, sql, params=()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall() if cursor.description else None

    def save(self, **changes):
        result = mutations.update_course(self.course_id, {
            'expectedRevision': self.document['revision'], **changes,
        })
        # Exercise deferred order constraints before rolling back the test.
        self.query('SET CONSTRAINTS ALL IMMEDIATE')
        self.query('SET CONSTRAINTS ALL DEFERRED')
        self.document = result
        return result

    def add_history(self):
        # The fixture runner provides a synthetic learner with this id.
        self.query('INSERT INTO "Learner".learner_free_courses (learner_id,free_course_ref) VALUES (999999,%s)', [self.course_id])
        self.query('''INSERT INTO "Learner".learner_free_course_progress
            (learner_id,free_course_ref,component_ref,status) VALUES (999999,%s,%s,'active')''',
            [self.course_id, self.video['id']])

    def link_quiz(self):
        week_id = self.second['freeCourseWeekId']
        quiz_id = self.query('''INSERT INTO curriculum.quizzes (title,free_course_week_id,status,week_id)
            VALUES ('Synthetic quiz',%s,'published','') RETURNING id''', [week_id])[0][0]
        self.query('''INSERT INTO curriculum.quiz_course_links (quiz_id,free_course_id,free_course_week_id)
            VALUES (%s,%s,%s)''', [quiz_id, self.course_id, week_id])
        self.query('''UPDATE curriculum.free_programme_components
            SET settings_json=jsonb_build_object('linkedQuizId',%s::text) WHERE id=%s''',
            [str(quiz_id), self.second['components'][0]['id']])
        self.document = documents.course_document(self.course_id, read_snapshot=False)
        return quiz_id

    def replace_video(self):
        week = deepcopy(self.week)
        week['components'][0] = {
            'clientId': 'replacement:video', 'title': 'Same name', 'type': 'video',
            'displayOrder': 0, 'expectedOtjh': '0.5', 'settings': {'videoUrl': 'https://example.test/replacement'},
        }
        return self.save(deletedComponentIds=[self.video['id']], weeks=[week])

    def test_replace_assigned_completed_component_preserves_history_and_uses_new_identity(self):
        self.add_history()
        before = self.query('SELECT * FROM "Learner".learner_free_course_progress')
        assignments = self.query('SELECT * FROM "Learner".learner_free_courses')
        result = self.replace_video()
        replacement = result['weeks'][0]['components'][0]
        self.assertNotEqual(replacement['id'], self.video['id'])
        self.assertEqual(replacement['title'], self.video['title'])
        archived = self.query('SELECT deleted_at,settings_json,display_order FROM curriculum.free_programme_components WHERE id=%s', [self.video['id']])[0]
        self.assertIsNotNone(archived[0])
        archived_settings = json.loads(archived[1]) if isinstance(archived[1], str) else archived[1]
        self.assertEqual(archived_settings['videoUrl'], 'https://example.test/original')
        self.assertEqual(archived[2], 0)
        self.assertEqual(before, self.query('SELECT * FROM "Learner".learner_free_course_progress'))
        self.assertEqual(assignments, self.query('SELECT * FROM "Learner".learner_free_courses'))
        self.assertEqual(self.query('SELECT week_count,component_count,total_otjh FROM curriculum.free_courses WHERE id=%s', [self.course_id])[0], (2, 3, 5.5))
        self.assertEqual(documents.course_document(self.course_id, read_snapshot=False)['revision'], result['revision'])
        courses, weeks, components = _scoped_rows([self.course_id])
        detail = _course_detail(self.course_id, courses[self.course_id], weeks, components, {(self.course_id, self.video['id'])})
        activities = [a for w in detail['weeks'] for a in w['activities']]
        self.assertNotIn(self.video['id'], [a['componentId'] for a in activities])
        self.assertFalse(next(a for a in activities if a['componentId'] == replacement['id'])['completed'])
        self.assertTrue(result['policies']['assignedContentDeletionAllowed'])

    def test_archive_quiz_week_keeps_links_and_subsequent_saves_work(self):
        quiz_id = self.link_quiz()
        before = self.query('SELECT * FROM curriculum.quiz_course_links WHERE quiz_id=%s', [quiz_id])
        result = self.save(deletedWeekIds=[self.second['freeCourseWeekId']],
                           deletedComponentIds=[self.second['components'][0]['id']])
        self.assertEqual(len(result['weeks']), 1)
        self.assertEqual(result['integrity']['status'], 'ok')
        self.assertEqual(before, self.query('SELECT * FROM curriculum.quiz_course_links WHERE quiz_id=%s', [quiz_id]))
        self.assertEqual(self.query('SELECT free_course_week_id FROM curriculum.quizzes WHERE id=%s', [quiz_id])[0][0], self.second['freeCourseWeekId'])
        self.assertEqual(documents.course_documents(catalogue.courses(course_ids=[self.course_id]))[0]['revision'], result['revision'])
        self.save(course={'courseName': 'Still editable'})
        with self.assertRaises(mutations.MutationError):
            _owned_component(self.course_id, self.second['freeCourseWeekId'], self.second['components'][0]['id'])
        with self.assertRaises(mutations.MutationError) as caught:
            mutations.delete_course(self.course_id, {'expectedRevision': self.document['revision']})
        self.assertEqual(caught.exception.code, 'dependent_records')

    def test_archived_week_position_can_be_reused_without_resurrecting_history(self):
        self.link_quiz()
        replacement = {'clientId': 'replacement:week', 'title': 'Second', 'displayOrder': 1,
                       'components': [{'clientId': 'replacement:reading', 'title': 'New', 'type': 'reading'}]}
        result = self.save(deletedWeekIds=[self.second['freeCourseWeekId']],
                           deletedComponentIds=[self.second['components'][0]['id']], weeks=[replacement])
        self.assertEqual(len(result['weeks']), 2)
        self.assertNotEqual(result['weeks'][1]['freeCourseWeekId'], self.second['freeCourseWeekId'])
        self.assertEqual(len(_scoped_rows([self.course_id])[1]), 2)
        self.assertEqual(len(mutations.storage._tree(self.course_id, include_deleted=True)[1]), 3)

    def test_edit_existing_component_keeps_identity_and_history(self):
        self.add_history()
        week = deepcopy(self.week)
        week['components'][0]['title'] = 'Renamed'
        result = self.save(weeks=[week])
        self.assertEqual(result['weeks'][0]['components'][0]['id'], self.video['id'])
        self.assertEqual(self.query('SELECT component_ref FROM "Learner".learner_free_course_progress'), [(self.video['id'],)])

    def test_stale_save_and_foreign_ids_cannot_archive_content(self):
        old_revision = self.document['revision']
        self.save(course={'courseName': 'Newer revision'})
        with self.assertRaises(mutations.MutationError) as caught:
            mutations.update_course(self.course_id, {'expectedRevision': old_revision, 'deletedComponentIds': [self.video['id']]})
        self.assertEqual(caught.exception.status, 409)
        with self.assertRaises(mutations.MutationError) as caught:
            self.save(deletedComponentIds=['FREECOMP-FOREIGN'])
        self.assertEqual(caught.exception.code, 'cross_course_id')
        self.assertIsNone(self.query('SELECT deleted_at FROM curriculum.free_programme_components WHERE id=%s', [self.video['id']])[0][0])

    def test_invalid_empty_course_rolls_back_archival(self):
        with self.assertRaises(mutations.MutationError):
            self.save(deletedWeekIds=[w['freeCourseWeekId'] for w in self.document['weeks']],
                      deletedComponentIds=[c['id'] for w in self.document['weeks'] for c in w['components']])
        self.assertEqual(documents.course_document(self.course_id, read_snapshot=False)['revision'], self.document['revision'])
        self.assertEqual(self.query('SELECT count(*) FROM curriculum.free_programme_components WHERE deleted_at IS NOT NULL')[0][0], 0)

    def test_archived_id_cannot_be_updated_or_implicitly_restored(self):
        self.replace_video()
        with self.assertRaises(mutations.MutationError) as caught:
            self.save(weeks=[self.week])
        self.assertEqual(caught.exception.code, 'cross_course_id')

    def test_permanent_course_delete_checks_archived_legacy_quiz_references(self):
        quiz_id = self.query("INSERT INTO curriculum.quizzes (title,status,week_id) VALUES ('Legacy quiz','published','NORMAL-WEEK') RETURNING id")[0][0]
        self.query("UPDATE curriculum.free_programme_components SET settings_json=jsonb_build_object('linkedQuizId',%s::text) WHERE id=%s",
                   [str(quiz_id), self.second['components'][0]['id']])
        self.document = documents.course_document(self.course_id, read_snapshot=False)
        self.save(deletedWeekIds=[self.second['freeCourseWeekId']],
                  deletedComponentIds=[self.second['components'][0]['id']])
        with self.assertRaises(mutations.MutationError) as caught:
            mutations.delete_course(self.course_id, {'expectedRevision': self.document['revision']})
        self.assertEqual(caught.exception.code, 'dependent_records')
        self.assertEqual(caught.exception.details['dependencies']['linkedComponents'], [self.second['components'][0]['id']])

    def test_course_without_dependencies_can_be_deleted_including_archived_content(self):
        self.replace_video()
        result = mutations.delete_course(self.course_id, {'expectedRevision': self.document['revision']})
        self.assertTrue(result['deleted'])
        self.assertEqual(self.query('SELECT id FROM curriculum.free_programme_components WHERE id=%s', [self.video['id']]), [])

    def test_order_swaps_remain_deferred_and_schema_upgrade_is_repeatable(self):
        self.replace_video()
        migration = import_module('curriculum_api.migrations.0089_free_course_content_soft_delete')
        with connection.schema_editor() as editor:
            migration.install(None, editor)
        week = deepcopy(self.document['weeks'][0])
        week['components'][0]['displayOrder'] = 1
        week['components'][1]['displayOrder'] = 0
        result = self.save(weeks=[week])
        self.assertEqual(result['weeks'][0]['components'][0]['title'], 'Keep')
        duplicate = deepcopy(result['weeks'][0])
        duplicate['components'][0]['displayOrder'] = 1
        with self.assertRaises(mutations.MutationError) as caught:
            self.save(weeks=[duplicate])
        self.assertEqual(caught.exception.code, 'duplicate_display_order')
