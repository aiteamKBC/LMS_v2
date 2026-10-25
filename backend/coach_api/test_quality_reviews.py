"""Local SQLite transaction tests and mocked authenticated endpoint contracts."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime,timezone
import json
from pathlib import Path
import re
import sqlite3
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import patch
from django.test import SimpleTestCase,RequestFactory,Client
from django.db import connections
from django.middleware.csrf import get_token
from coach_api import quality_review_store as store,quality_review_api as api
from coach_api.quality_review_template import CRITERIA,validate_form,InvalidReview
from login import permissions
REAL_CONTEXT=api.context


def form(complete=False):
    return {'header':{'employer':'Synthetic employer','programme':'Synthetic programme','activityDate':'2026-10-20','startDate':'','endDate':''},
      'criteria':{key:{'rating':'green' if complete else '', 'evidence':'Synthetic observed evidence' if complete else ''} for key in CRITERIA},
      'actions':[],'images':{},'sources':['recording']}


def snapshot():
    return {'identity':'a'*64,'templateId':'portfolio-sampling-v1','coach':{'email':'coach@example.invalid','name':'Synthetic Coach'},
      'learner':{'id':'1','name':'Synthetic Learner'},'meeting':{'eventId':'event-one','startsAt':'2026-10-20T09:00:00+00:00',
      'endsAt':'2026-10-20T10:00:00+00:00','title':'Synthetic meeting'},'form':form(),'status':'draft','reviewer':{'id':'staff:1'}}


class SQLiteAdapter:
    def __init__(self,connection): self.connection=connection
    def execute(self,sql,params=()):
        sql = sql.replace('lms_quality.','').replace(' FOR UPDATE','')
        params = list(params)
        if 'ANY(%s::uuid[])' in sql:
            values = params.pop()
            sql = sql.replace('=ANY(%s::uuid[])',' IN ('+','.join('%s' for _ in values)+')')
            params.extend(values)
        values = [json.dumps(value.obj) if hasattr(value,'obj') else value for value in params]
        return self.connection.execute(sql.replace('%s','?'),values)


class ReviewStorageTests(SimpleTestCase):
    def setUp(self):
        assert all(value['ENGINE']=='django.db.backends.sqlite3' for value in connections.databases.values())
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory=lambda cursor,row:dict(zip([column[0] for column in cursor.description],row))
        self.db.create_function('octet_length',1,len)
        sql = (Path(__file__).parent/'sql'/'coaching_quality_v1.sql').read_text()
        sql = re.sub(r'CREATE SCHEMA[^;]+;','',sql)
        sql = re.sub(r'COMMENT ON SCHEMA[^;]+;','',sql)
        self.db.executescript(sql.replace('lms_quality.',''))
        @contextmanager
        def connect(**kwargs):
            with self.db:
                yield SQLiteAdapter(self.db)
        self.enterContext(patch.object(store,'connect',side_effect=connect))
        self.addCleanup(self.db.close)
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))

    def save(self,value=None,expected=0,request_id=None,actor='staff:1'):
        return store.save_review(value or snapshot(),expected=expected,request_id=request_id or str(uuid4()),actor=actor)

    def test_save_retry_is_one_record_one_revision_and_same_result(self):
        key=str(uuid4())
        first=self.save(request_id=key)
        self.assertEqual(self.save(request_id=key),first)
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM review').fetchone()['n'],1)
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM revision').fetchone()['n'],1)
        self.assertEqual(store.read_review(review_id=first['id']),first)

    def test_stale_writer_cannot_overwrite_and_history_preserves_previous_evidence(self):
        first=self.save()
        second=snapshot();second['form']['criteria']['progress-1']['evidence']='A later saved observation'
        newer=self.save(second,expected=1)
        with self.assertRaises(store.ReviewConflict):self.save(expected=1)
        self.assertEqual(store.read_review(review_id=first['id']),newer)
        old=store._payload(self.db.execute('SELECT payload FROM revision WHERE version=1').fetchone())
        self.assertEqual(old['form'],first['form'])

    def test_retry_key_cannot_be_reused_for_another_change_or_reviewer(self):
        key=str(uuid4());self.save(request_id=key)
        changed=snapshot();changed['status']='completed'
        with self.assertRaises(store.ReviewConflict):self.save(changed,request_id=key)
        with self.assertRaises(store.ReviewConflict):self.save(request_id=key,actor='staff:2')

    def test_first_save_is_unique_per_occurrence_and_learner(self):
        first=self.save()
        with self.assertRaises(store.ReviewConflict):self.save()
        other=snapshot();other['identity']='b'*64;other['learner']['id']='2'
        separate=self.save(other)
        self.assertNotEqual(first['id'],separate['id'])
        self.assertEqual(store.read_review(review_id=first['id'])['learner']['id'],'1')

    def test_foreign_screenshot_is_rejected_without_losing_the_saved_version(self):
        first=self.save()
        other=snapshot();other['identity']='b'*64
        foreign=self.save(other)
        image=store.save_image(foreign['id'],'progress','screenshot.jpg',b'JPEG fixture')
        changed=snapshot();changed['form']['images']={'progress':[image]}
        with self.assertRaises(store.ReviewConflict):self.save(changed,expected=1)
        self.assertEqual(store.read_review(review_id=first['id'])['version'],1)
        self.assertIsNone(store.read_image(first['id'],image))

    def test_image_retry_reuses_one_immutable_image(self):
        saved=self.save()
        image=store.save_image(saved['id'],'progress','screenshot.jpg',b'JPEG fixture')
        self.assertEqual(image,store.save_image(saved['id'],'progress','screenshot.jpg',b'JPEG fixture'))
        self.assertEqual(bytes(store.read_image(saved['id'],image)['content']),b'JPEG fixture')


class ReviewFormTests(SimpleTestCase):
    def test_template_does_not_inherit_the_two_sample_checked_ratings(self):
        cleaned=validate_form(form(),'draft')
        self.assertEqual(len(cleaned['criteria']),17)
        self.assertTrue(all(not row['rating'] for row in cleaned['criteria'].values()))

    def test_completion_requires_ratings_and_observed_evidence(self):
        with self.assertRaises(InvalidReview):validate_form(form(),'completed')
        complete=form(True)
        self.assertEqual(validate_form(complete,'completed')['criteria'],complete['criteria'])
        complete['criteria']['progress-1']={'rating':'na','evidence':''}
        validate_form(complete,'completed')

    def test_rejects_unknown_criteria_dates_and_incomplete_smart_action(self):
        for change in ({'criteria':{'unknown':{}}},{'header':{'activityDate':'bad'}},
                       {'actions':[{'action':'Do this'}]},{'sources':['invented']}):
            value=form(True);value.update(change)
            with self.assertRaises(InvalidReview):validate_form(value,'completed')


class ReviewApiTests(SimpleTestCase):
    def setUp(self):
        self.factory=RequestFactory()
        self.staff=SimpleNamespace(id=1,email='reviewer@example.invalid',username='Reviewer',access='curriculum',access_extra='')
        self.enterContext(patch.object(api,'_staff',return_value=self.staff))
        def auth(request):request.login_account=SimpleNamespace(subject_id=1,subject_type='staff',role='staff');return request.login_account
        self.enterContext(patch.object(permissions,'authenticate_request',side_effect=auth))
        self.enterContext(patch.object(permissions,'_accesses_of',return_value=frozenset({'curriculum'})))
        self.reader=self.enterContext(patch.object(store,'read_review',return_value=None))
        self.saver=self.enterContext(patch.object(store,'save_review',side_effect=lambda value,**kwargs:{**value,'id':str(uuid4()),'version':1}))
        self.ctx=self.enterContext(patch.object(api,'context',return_value=({'snapshot':{key:value for key,value in snapshot().items() if key not in ('form','status','reviewer')},'learners':[{'id':'1','name':'Synthetic Learner'}]},None)))
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))

    def request(self,method='post',**changes):
        value={'learnerId':'1','expectedVersion':0,'requestId':str(uuid4()),'status':'draft','form':form()};value.update(changes)
        request=getattr(self.factory,method)('/quality',data=json.dumps(value),content_type='application/json')
        request._dont_enforce_csrf_checks=True
        return request

    def test_curriculum_can_save_and_identity_is_server_owned(self):
        response=api.reviews(self.request())
        self.assertEqual(response.status_code,201)
        self.assertEqual(self.saver.call_args.args[0]['coach']['email'],'coach@example.invalid')
        self.assertEqual(self.saver.call_args.args[0]['reviewer']['id'],'staff:1')
        self.staff.access='coach';self.staff.access_extra='curriculum'
        self.assertEqual(api.reviews(self.request()).status_code,201)

    def test_coach_or_revoked_curriculum_cannot_save_even_if_cached_gate_claims_allowed(self):
        self.staff.access='coach'
        self.assertEqual(api.reviews(self.request()).status_code,403)
        self.saver.assert_not_called()

    def test_unsigned_actor_override_and_invalid_body_are_rejected(self):
        request=self.request(reviewer={'id':'staff:other'})
        self.assertEqual(api.reviews(request).status_code,400)
        self.saver.assert_not_called()
        self.assertEqual(api.reviews(self.request(requestId=123)).status_code,400)

    def test_missing_csrf_is_rejected_before_any_write(self):
        request=self.request();request._dont_enforce_csrf_checks=False
        self.assertEqual(api.reviews(request).status_code,403)
        self.saver.assert_not_called()

    def test_conflict_and_storage_failure_are_visible_without_success(self):
        for error,status in ((store.ReviewConflict('Reload the saved version.'),409),(store.ReviewUnavailable(),503)):
            self.saver.side_effect=error
            self.assertEqual(api.reviews(self.request()).status_code,status)

    def test_saved_context_cannot_be_reassigned_to_a_different_learner(self):
        self.reader.return_value={**snapshot(),'id':str(uuid4()),'version':1}
        response=api.review_detail(self.request('put',learnerId='2',expectedVersion=1),uuid4())
        self.assertEqual(response.status_code,400)
        self.saver.assert_not_called()

    def test_pdf_checks_fresh_access_and_version_before_rendering(self):
        saved={**snapshot(),'id':str(uuid4()),'version':2,'status':'completed','form':form(True)}
        self.reader.return_value=saved
        from . import quality_review_pdf as pdf
        with patch.object(pdf,'review_pdf',return_value=b'%PDF-synthetic') as render:
            self.assertEqual(api.review_document(self.factory.get('/quality?version=1'),saved['id']).status_code,409)
            render.assert_not_called()
            self.assertEqual(api.review_document(self.factory.get('/quality?version=2'),saved['id']).status_code,200)
            self.staff.access='coach'
            self.assertEqual(api.review_document(self.factory.get('/quality?version=2'),saved['id']).status_code,403)
            self.assertEqual(render.call_count,1)

    def test_list_is_bounded_summary_only_and_uses_calendar_day_boundaries(self):
        with patch.object(store,'list_reviews',return_value=([],None)) as listing,patch.object(api,'_coaches',return_value=[]):
            response=api.reviews(self.factory.get('/quality?start=2026-10-25&end=2026-10-25&timeZone=Europe/London&search=Synthetic&status=completed'))
            self.assertEqual(response.status_code,200)
            self.assertEqual(json.loads(response.content),{'reviews':[],'nextOffset':None,'coaches':[]})
            start,end,*rest=listing.call_args.args
            self.assertEqual((end-start).total_seconds(),25*3600)
            self.assertEqual(rest[-1],'Synthetic')
            response=api.reviews(self.factory.get('/quality?start=2026-01-01&end=2028-01-01'))
            self.assertEqual(response.status_code,400)
            self.assertEqual(listing.call_count,1)

    def test_context_uses_verified_occurrence_and_caseload_not_browser_identity(self):
        from .recordings_calendar_media import calendar_context,calendar_record
        record=calendar_record(calendar_context('coach@example.invalid','event-one',
          '2026-10-20T09:00:00Z','2026-10-20T10:00:00Z'))
        learners=[{'id':1,'full_name':'Synthetic Learner','email':'Learner@Example.invalid'}]
        with patch.object(api,'_authorised_record',return_value=(record,None)),patch.object(api,'_coaches',return_value=[]),\
             patch.object(api,'_learners',return_value=learners),patch.object(api,'source_details',return_value=None):
            value,failure=REAL_CONTEXT(self.factory.get('/quality'), '1')
            self.assertIsNone(failure)
            self.assertEqual(value['snapshot']['learner']['email'],'learner@example.invalid')
            self.assertEqual(value['snapshot']['meeting']['eventId'],'event-one')
            self.assertEqual(value['snapshot']['coach']['email'],'coach@example.invalid')
            value,failure=REAL_CONTEXT(self.factory.get('/quality'), 'foreign-learner')
            self.assertIsNone(value)
            self.assertEqual(failure.status_code,404)

    def test_image_upload_normalizes_content_and_rejects_unsupported_files(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image
        from io import BytesIO
        data=BytesIO();Image.new('RGB',(32,32),'white').save(data,format='PNG')
        request=self.factory.post('/quality',{'section':'progress','image':SimpleUploadedFile('capture.png',data.getvalue(),content_type='image/png')})
        request._dont_enforce_csrf_checks=True
        with patch.object(store,'save_image',return_value=str(uuid4())) as save:
            self.assertEqual(api.review_image(request,str(uuid4())).status_code,201)
            actual=Image.open(BytesIO(save.call_args.args[-1]));self.assertEqual(actual.format,'JPEG')
            self.assertEqual(actual.size,(32,32))
        request=self.factory.post('/quality',{'section':'progress','image':SimpleUploadedFile('bad.svg',b'<svg/>',content_type='image/svg+xml')})
        request._dont_enforce_csrf_checks=True
        self.assertEqual(api.review_image(request,str(uuid4())).status_code,400)


class ReviewPdfTests(SimpleTestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))
        self.review={**snapshot(),'id':str(uuid4()),'version':1,'status':'completed','form':form(True),
          'updatedAt':'2026-10-20T12:00:00Z','reviewer':{'id':'staff:1','name':'Synthetic Reviewer'}}

    def test_completed_pdf_contains_every_rating_evidence_and_action(self):
        from .quality_review_pdf import review_pdf
        from pypdf import PdfReader
        from io import BytesIO
        for index,key in enumerate(CRITERIA):
            self.review['form']['criteria'][key]={'rating':('gold','green','amber','red','na')[index%5],
              'evidence':f'Original observation {index} with <literal> markup.'}
        self.review['form']['actions']=[{'action':'Synthetic follow-up action','outcome':'Learner impact','supportedBy':'Reviewer','dueDate':'2026-11-10'}]
        before=deepcopy(self.review)
        content=review_pdf(self.review)
        pdf=PdfReader(BytesIO(content));text='\n'.join(page.extract_text() for page in pdf.pages)
        for index in range(17):self.assertIn(f'Original observation {index} with <literal> markup.',text)
        for expected in ('Gold','Green','Amber','Red','N/A','Synthetic follow-up action','Synthetic Reviewer','SMART action plan'):
            self.assertIn(expected,text)
        self.assertEqual(self.review,before)
        self.assertGreaterEqual(len(pdf.pages),4)

    def test_preview_download_reuse_bytes_but_new_version_renders_once(self):
        from . import quality_review_pdf as pdf
        with patch.object(pdf,'_render',return_value=b'%PDF-test') as render:
            self.assertEqual(pdf.review_pdf(self.review),pdf.review_pdf(self.review))
            self.assertEqual(render.call_count,1)
            self.review['version']=2;pdf.review_pdf(self.review)
            self.assertEqual(render.call_count,2)

    def test_drafts_cannot_be_exported(self):
        from .quality_review_pdf import review_pdf
        self.review['status']='draft'
        with self.assertRaises(store.ReviewConflict):review_pdf(self.review)

    def test_long_evidence_and_referenced_image_are_retained(self):
        from .quality_review_pdf import review_pdf
        from pypdf import PdfReader
        from io import BytesIO
        from PIL import Image
        content=BytesIO();Image.new('RGB',(100,60),'purple').save(content,format='JPEG')
        identity=str(uuid4());self.review['form']['images']={'progress':[identity]}
        self.review['form']['criteria']['progress-1']['evidence']='Retained observation. '*200+'FINAL EVIDENCE WORDS'
        with patch.object(store,'read_images',return_value={identity:{'content':content.getvalue(),'section':'progress'}}):
            pdf=PdfReader(BytesIO(review_pdf(self.review)))
        self.assertIn('FINAL EVIDENCE WORDS','\n'.join(page.extract_text() for page in pdf.pages))
        self.assertTrue(any(len(page.images) for page in pdf.pages))
