"""Real canonical Quiz ORM/HTTP and rollback checks on the disposable runner only."""
import json
import os
from pathlib import Path
import socket
from types import SimpleNamespace
from unittest.mock import patch
from django.db import connection, connections, transaction, DatabaseError
from django.test import RequestFactory, SimpleTestCase, override_settings
from quiz_api.models import QuizPackage, QuizQuestion, QuizAnswer
from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING
from curriculum_api.catalogue.api import free_course_quiz_views as api
from curriculum_api.catalogue.infrastructure import free_course_quizzes as storage

REVISION='fcv1:'+'a'*64


class FreeCourseQuizWorkflowPostgreSQL(SimpleTestCase):
    databases={'default'}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        assert os.environ.get('FREE_COURSE_AUTHORING_WRITE_POSTGRES_TESTS')=='1'
        assert [name for _,name in socket.if_nameindex()]==['lo']
        assert len(Path('/proc/net/route').read_text().splitlines())==1
        assert set(connections)=={'default','enrolment','audit','audit_clone','kbc_attendance','assistant_conversations'}
        for alias in connections:
            cfg=connections[alias].settings_dict
            assert cfg['HOST']=='127.0.0.1' and cfg['NAME']=='phase1f'
        scope = transaction.atomic()
        scope.__enter__()
        def restore_fixture():
            transaction.set_rollback(True)
            scope.__exit__(None, None, None)
        cls.addClassCleanup(restore_fixture)
        # Extend only this disposable fixture to match the real unmanaged ORM.
        for model in (QuizPackage, QuizQuestion, QuizAnswer):
            table=model._meta.db_table.replace('"','')
            schema, relation=table.split('.')
            with connection.cursor() as cursor:
                cursor.execute('select column_name from information_schema.columns where table_schema=%s and table_name=%s',[schema,relation])
                columns={row[0] for row in cursor.fetchall()}
            with connection.schema_editor() as editor:
                if not columns: editor.create_model(model)
                else:
                    for field in model._meta.local_fields:
                        if field.column not in columns: editor.add_field(model,field)

    def setUp(self):
        super().setUp()
        scope=transaction.atomic();scope.__enter__()
        def rollback():
            transaction.set_rollback(True);scope.__exit__(None,None,None)
        self.addCleanup(rollback)
        self.enterContext(override_settings(FREE_COURSE_AUTHORING_WRITE_MODE='canonical'))
        self.enterContext(patch.object(api,'_document',return_value={'revision':REVISION}))
        self.enterContext(patch.object(api,'_quiz_preview_payload',side_effect=lambda quiz,**kw:{'id':quiz.id,'title':quiz.title,'status':quiz.status}))
        self.enterContext(patch('login.permissions.authenticate_request',return_value=SimpleNamespace(role='staff',subject_type='staff',subject_id=9)))
        self.enterContext(patch('login.permissions._accesses_of',return_value=frozenset({ACCESS_CURRICULUM,ACCESS_FREE_COURSE_AUTHORING})))
        with connection.cursor() as cursor:
            cursor.execute("insert into curriculum.free_courses(id,course_name,display_order) values ('WF-FC','Synthetic course',0)")
            cursor.execute("insert into curriculum.free_course_weeks(id,course_id,title,display_order,week_number) values ('WF-W','WF-FC','Synthetic week',0,1)")
            cursor.execute("insert into curriculum.free_programme_components(id,free_module_id,type,title,display_order,settings_json) values ('WF-C','WF-W','quiz','Synthetic quiz',0,'{\"keep\":true}')")

    def call(self,method,payload=None,quiz_id=None,course_id='WF-FC'):
        request=RequestFactory().generic(method,'/',json.dumps(payload or {}),content_type='application/json')
        request._dont_enforce_csrf_checks=True
        return api.collection(request,course_id) if quiz_id is None else api.detail(request,course_id,quiz_id)

    def create(self):
        response=self.call('POST',{'expectedRevision':REVISION,'freeCourseWeekId':'WF-W','componentId':'WF-C','title':'Created'})
        self.assertEqual(response.status_code,201,response.content)
        return json.loads(response.content)['quiz']['id']

    def settings(self):
        with connection.cursor() as cursor:
            cursor.execute("select settings_json from curriculum.free_programme_components where id='WF-C'")
            value = cursor.fetchone()[0]
            return json.loads(value) if isinstance(value, str) else value

    def test_create_real_orm_canonical_link_and_get(self):
        ident=self.create();quiz=QuizPackage.objects.get(pk=ident)
        self.assertEqual((quiz.free_course_week_id,quiz.week_id,quiz.status),('WF-W','','draft'))
        self.assertEqual(self.settings(),{'keep':True,'linkedQuizId':str(ident)})
        self.assertEqual(self.call('GET',quiz_id=ident).status_code,200)
        with connection.cursor() as cursor:
            cursor.execute('select free_course_id,free_course_week_id from curriculum.quiz_course_links where quiz_id=%s',[ident])
            self.assertEqual(cursor.fetchall(),[('WF-FC','WF-W')])

    def test_question_rejection_rolls_back_question_writer_changes(self):
        ident=self.create()
        def refused(request,quiz_id):
            self.assertTrue(request._canonical_free_course_quiz)
            QuizPackage.objects.filter(pk=quiz_id).update(title='Must roll back')
            from django.http import JsonResponse
            return JsonResponse({'error':'Rejected'},status=400)
        with patch.object(api,'_quiz_questions_locked',side_effect=refused):
            response=self.call('PATCH',{'expectedRevision':REVISION,'componentId':'WF-C','questions':[]},ident)
        self.assertEqual(response.status_code,400)
        self.assertEqual(QuizPackage.objects.get(pk=ident).title,'Created')

    def test_unlink_preserves_quiz_and_unrelated_settings(self):
        ident=self.create()
        response=self.call('DELETE',{'expectedRevision':REVISION,'componentId':'WF-C'},ident)
        self.assertEqual(response.status_code,200,response.content)
        self.assertTrue(QuizPackage.objects.filter(pk=ident).exists())
        self.assertEqual(self.settings(),{'keep':True})
        with connection.cursor() as cursor:
            cursor.execute('select count(*) from curriculum.quiz_course_links where quiz_id=%s',[ident])
            self.assertEqual(cursor.fetchone()[0],0)

    def test_history_blocks_unlink_and_published_edits(self):
        ident=self.create()
        with connection.cursor() as cursor:
            cursor.execute('insert into "Learner".learner_free_course_progress(learner_id,free_course_ref,component_ref,status) values (9001,\'WF-FC\',\'WF-C\',\'completed\')')
        self.assertEqual(self.call('DELETE',{'expectedRevision':REVISION,'componentId':'WF-C'},ident).status_code,409)
        QuizPackage.objects.filter(pk=ident).update(status='published')
        self.assertEqual(self.call('PATCH',{'expectedRevision':REVISION,'componentId':'WF-C','title':'Blocked'},ident).status_code,409)
        self.assertEqual(QuizPackage.objects.get(pk=ident).title,'Created')

    def test_wrong_course_is_rejected(self):
        ident=self.create()
        self.assertEqual(self.call('GET',quiz_id=ident,course_id='OTHER').status_code,409)

    def test_late_sql_failure_rolls_back_created_quiz_and_link(self):
        before=QuizPackage.objects.count()
        with patch.object(storage,'_set_component_quiz',side_effect=DatabaseError('Synthetic failure')):
            response=self.call('POST',{'expectedRevision':REVISION,'freeCourseWeekId':'WF-W','componentId':'WF-C'})
        self.assertEqual(response.status_code,503)
        self.assertEqual(QuizPackage.objects.count(),before)
        self.assertEqual(self.settings(),{'keep':True})

    def test_outer_transaction_can_roll_back_success(self):
        before=QuizPackage.objects.count()
        with transaction.atomic():
            self.create()
            transaction.set_rollback(True)
        self.assertEqual(QuizPackage.objects.count(),before)
        self.assertEqual(self.settings(),{'keep':True})

    def test_partial_patch_persists_only_supplied_metadata(self):
        ident=self.create()
        response=self.call('PATCH',{'expectedRevision':REVISION,'componentId':'WF-C','title':'Edited','duration':12,'randomizeAnswers':True},ident)
        self.assertEqual(response.status_code,200,response.content)
        quiz=QuizPackage.objects.get(pk=ident)
        self.assertEqual((quiz.title,quiz.duration,quiz.randomize_answers,quiz.free_course_week_id),('Edited',12,True,'WF-W'))

