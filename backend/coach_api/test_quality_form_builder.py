"""Isolated form versioning, typed answers, authorization and document store."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import json
import re
import sqlite3
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory
from login import permissions
from . import quality_review_store as store, quality_review_api, quality_form_api
from .quality_form_definition import default_definition, clean_definition, clean_answers, definition_for
from .quality_review_template import InvalidReview
from .test_quality_reviews import SQLiteAdapter, snapshot, form


class QualityDefinitionTests(SimpleTestCase):
    def test_default_has_all_original_criteria_and_image_sections(self):
        value=default_definition()
        self.assertEqual(len(value['sections']),9)
        self.assertEqual(sum(len(s['criteria']) for s in value['sections']),17)
        self.assertEqual(sum(s['screenshots'] for s in value['sections']),5)
        self.assertTrue(all(q['type']=='rating' for s in value['sections'] for q in s['criteria']))

    def test_rejects_duplicate_ids_invalid_types_options_and_excessive_questions(self):
        base=default_definition()
        for edit in ('duplicate','kind','options','missing'):
            value=deepcopy(base);item=value['sections'][0]['criteria'][0]
            if edit=='duplicate':item['id']=value['sections'][0]['id']
            elif edit=='kind':item['type']='script'
            elif edit=='options':item.update(type='checklist',options=['duplicate','duplicate'])
            else:item['text']=''
            with self.assertRaises(InvalidReview):clean_definition(value)

    def typed_definition(self):
        value=default_definition();value['sections']=value['sections'][:1]
        value['sections'][0]['criteria']=[{'id':kind,'text':kind,'type':kind,'required':True,
          'options':['First','Second'] if kind in ('single_choice','checklist') else []}
          for kind in ('text','textarea','boolean','single_choice','checklist','date','number','image')]
        return clean_definition(value)

    def test_all_question_types_validate_and_false_zero_are_valid_required_answers(self):
        definition=self.typed_definition();value=form()
        value['criteria']={};value['answers']={'text':'Short','textarea':'Long','boolean':False,
          'single_choice':'First','checklist':['First','Second'],'date':'2026-10-25','number':0}
        value['images']={'image':[str(uuid4())]}
        result=clean_answers(value,'completed',definition)
        self.assertIs(result['answers']['boolean'],False);self.assertEqual(result['answers']['number'],0)
        for key in ('checklist','date','boolean','number'):
            wrong=deepcopy(value);wrong['answers'][key]={'checklist':['Unknown'],'date':'bad','boolean':'yes','number':True}[key]
            with self.assertRaises(InvalidReview):clean_answers(wrong,'completed',definition)

    def test_required_image_and_unknown_answers_are_rejected(self):
        definition=self.typed_definition();value=form();value['criteria']={}
        with self.assertRaises(InvalidReview):clean_answers(value,'completed',definition)
        value['answers']={'forged':'answer'}
        with self.assertRaises(InvalidReview):clean_answers(value,'draft',definition)

    def test_legacy_reviews_keep_the_original_definition(self):
        legacy=snapshot()
        self.assertEqual(definition_for(legacy)['sections'][0]['criteria'][0]['text'],default_definition()['sections'][0]['criteria'][0]['text'])


class QualityDefinitionStorageTests(SimpleTestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.db.row_factory=lambda cursor,row:dict(zip([c[0] for c in cursor.description],row))
        self.db.create_function('octet_length',1,len)
        for name in ('coaching_quality_v1.sql','coaching_quality_v2.sql'):
            sql=(Path(__file__).parent/'sql'/name).read_text()
            sql=re.sub(r'CREATE SCHEMA[^;]+;|COMMENT ON SCHEMA[^;]+;','',sql)
            self.db.executescript(sql.replace('lms_quality.',''))
        @contextmanager
        def connect(**kwargs):
            with self.db:yield SQLiteAdapter(self.db)
        self.enterContext(patch.object(store,'connect',side_effect=connect));self.addCleanup(self.db.close)
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))

    def save(self,definition=None,expected=0,request_id=None,publish=False):
        return store.save_template(definition or default_definition(),expected=expected,
          request_id=request_id or str(uuid4()),actor='staff:1',publish=publish)

    def test_draft_does_not_change_live_form_and_publish_creates_new_version(self):
        definition=default_definition();old=definition['sections'][0]['criteria'][0]['text']
        definition['sections'][0]['criteria'][0]['text']='A new criterion'
        saved=self.save(definition)
        self.assertEqual(saved['draft']['sections'][0]['criteria'][0]['text'],'A new criterion')
        self.assertEqual(saved['published']['sections'][0]['criteria'][0]['text'],old)
        published=self.save(definition,expected=1,publish=True)
        self.assertEqual(published['published']['version'],2)
        self.assertEqual(store.read_template(),published)
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM form_revision').fetchone()['n'],2)

    def test_retry_reuses_revision_but_stale_or_changed_retry_is_rejected(self):
        key=str(uuid4());first=self.save(request_id=key,publish=True)
        self.assertEqual(first,self.save(request_id=key,publish=True))
        with self.assertRaises(store.ReviewConflict):self.save(expected=0)
        with self.assertRaises(store.ReviewConflict):self.save(request_id=key,publish=False)
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM form_revision').fetchone()['n'],1)

    def test_saved_review_keeps_definition_after_template_changes(self):
        value=snapshot();value['definition']=default_definition()
        saved=store.save_review(value,expected=0,request_id=str(uuid4()),actor='staff:1')
        changed=default_definition();changed['sections'][0]['criteria'][0]['text']='Changed later'
        self.save(changed,publish=True)
        self.assertNotEqual(definition_for(store.read_review(review_id=saved['id']))['sections'][0]['criteria'][0]['text'],'Changed later')

    def test_document_is_persisted_once_and_old_pdf_survives_a_later_draft(self):
        value=snapshot();value.update(status='completed',form=form(True))
        first=store.save_review(value,expected=0,request_id=str(uuid4()),actor='staff:1')
        one=store.save_document(first,b'%PDF-first')
        two=store.save_document(first,b'%PDF-second-render')
        self.assertEqual(bytes(one['content']),bytes(two['content']))
        value['status']='draft';store.save_review(value,expected=1,request_id=str(uuid4()),actor='staff:1')
        self.assertEqual(bytes(store.read_document(first['id'],1)['content']),b'%PDF-first')
        self.assertEqual(store.read_revision(first['id'],1)['status'],'completed')

    def test_document_rejects_drafts_foreign_snapshot_and_invalid_bytes(self):
        draft=store.save_review(snapshot(),expected=0,request_id=str(uuid4()),actor='staff:1')
        with self.assertRaises(store.ReviewConflict):store.save_document(draft,b'%PDF-test')
        forged={**draft,'status':'completed'}
        with self.assertRaises(store.ReviewConflict):store.save_document(forged,b'%PDF-test')
        with self.assertRaises(store.ReviewUnavailable):store.save_document(draft,b'<html>')

    def test_real_branded_pdf_is_retained_after_cache_clear_and_template_publish(self):
        from .quality_review_pdf import stored_review_pdf
        from pypdf import PdfReader
        from io import BytesIO
        from django.core.cache import cache
        definition=default_definition();definition['sections']=definition['sections'][:1]
        definition['sections'][0]['criteria']=[{'id':'custom-text','text':'Frozen custom question','type':'text','required':True},
          {'id':'custom-check','text':'Observed checklist','type':'checklist','required':True,'options':['First','Second']}]
        definition=clean_definition(definition)
        value=snapshot();value.update(status='completed',definition=definition,form={**form(), 'criteria':{},'answers':{'custom-text':'A saved answer','custom-check':['Second']}},reviewer={'id':'staff:1','name':'Synthetic Reviewer'})
        saved=store.save_review(value,expected=0,request_id=str(uuid4()),actor='staff:1')
        first=stored_review_pdf(saved)
        reader=PdfReader(BytesIO(first));text='\n'.join(page.extract_text() for page in reader.pages)
        for expected in ('Frozen custom question','A saved answer','Observed checklist','Second','Synthetic Reviewer'):
            self.assertIn(expected,text)
        self.assertTrue(reader.pages[0].images)
        cache.clear();self.save(publish=True)
        with patch('coach_api.quality_review_pdf._render',side_effect=AssertionError('A saved PDF must not regenerate')):
            self.assertEqual(stored_review_pdf(saved),first)

    def test_pdf_failure_keeps_completed_review_and_reports_partial_state(self):
        value=snapshot();value.update(status='completed',form=form(True))
        saved=store.save_review(value,expected=0,request_id=str(uuid4()),actor='staff:1')
        with patch('coach_api.quality_review_pdf.stored_review_pdf',side_effect=store.ReviewUnavailable('Unavailable')):
            result=quality_review_api.document_state(saved)
        self.assertEqual(result['state'],'failed')
        self.assertEqual(store.read_review(review_id=saved['id'])['status'],'completed')


class QualityDefinitionApiTests(SimpleTestCase):
    def setUp(self):
        self.factory=RequestFactory()
        self.staff=SimpleNamespace(id=1,email='reviewer@example.invalid',username='Reviewer',access='curriculum',access_extra='')
        self.enterContext(patch.object(quality_review_api,'_staff',return_value=self.staff))
        def auth(request):
            request.login_account=SimpleNamespace(subject_id=1,subject_type='staff',role='staff');return request.login_account
        self.enterContext(patch.object(permissions,'authenticate_request',side_effect=auth))
        self.enterContext(patch.object(permissions,'_accesses_of',return_value=frozenset({'curriculum'})))
        self.saver=self.enterContext(patch.object(store,'save_template',return_value={'revision':1}))
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))

    def request(self):
        request=self.factory.put('/quality/form',data=json.dumps({'definition':default_definition(),'expectedRevision':0,
          'requestId':str(uuid4()),'publish':True}),content_type='application/json')
        request._dont_enforce_csrf_checks=True;return request

    def test_current_curriculum_grant_is_required_for_definition_writes(self):
        self.assertEqual(quality_form_api.quality_form(self.request()).status_code,200)
        self.assertEqual(self.saver.call_args.kwargs['actor'],'staff:1')
        self.staff.access='coach'
        self.assertEqual(quality_form_api.quality_form(self.request()).status_code,403)
        self.assertEqual(self.saver.call_count,1)

    def test_missing_csrf_is_rejected_before_template_write(self):
        request=self.request();request._dont_enforce_csrf_checks=False
        self.assertEqual(quality_form_api.quality_form(request).status_code,403)
        self.saver.assert_not_called()


class QualityMeetingFormApiTests(SimpleTestCase):
    def setUp(self):
        self.factory=RequestFactory()
        self.staff=SimpleNamespace(id=1,email='reviewer@example.invalid',username='Reviewer',access='curriculum',access_extra='')
        self.enterContext(patch.object(quality_review_api,'_staff',return_value=self.staff))
        def auth(request):
            request.login_account=SimpleNamespace(subject_id=1,subject_type='staff',role='staff');return request.login_account
        self.enterContext(patch.object(permissions,'authenticate_request',side_effect=auth))
        self.enterContext(patch.object(permissions,'_accesses_of',return_value=frozenset({'curriculum'})))
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))

    def test_future_meeting_accepts_a_valid_coach_caseload_learner(self):
        from .recordings_calendar_media import calendar_context,calendar_record
        record=calendar_record(calendar_context('coach@example.invalid','event-future','2030-01-01T09:00:00Z','2030-01-01T10:00:00Z'))
        with patch.object(quality_review_api,'_authorised_record',return_value=(record,None)),patch.object(quality_review_api,'_coaches',return_value=[]),\
             patch.object(quality_review_api,'_learners',return_value=[{'id':1,'full_name':'Test learner'}]),patch.object(quality_review_api,'source_details',return_value=None):
            result,failure=quality_review_api.context(self.factory.get('/quality'), '1')
        self.assertIsNone(failure);self.assertEqual(result['snapshot']['learner']['id'],'1')
        self.assertRegex(result['snapshot']['meeting']['id'],r'^[a-f0-9]{32}$')

    def test_meeting_filter_is_summary_only_and_does_not_scan_calendar(self):
        from datetime import datetime,timezone
        row={'id':str(uuid4()),'learner_id':'1','learner_name':'Test learner','status':'completed','version':2,'pdf_version':2,'updated_at':datetime.now(timezone.utc)}
        with patch.object(store,'reviews_for_meeting',return_value=([row],None)) as lookup,patch.object(quality_review_api,'_authorised_record') as calendar:
            response=quality_review_api.reviews(self.factory.get('/quality?meetingId='+'a'*32))
            self.assertEqual(response.status_code,200);calendar.assert_not_called();lookup.assert_called_once_with('a'*32,0)
            data=json.loads(response.content)['reviews'][0]
            self.assertEqual(data['pdfVersion'],2);self.assertNotIn('form',data)
            self.assertEqual(quality_review_api.reviews(self.factory.get('/quality?meetingId=bad')).status_code,400)

    def test_new_form_version_conflict_does_not_discard_answers(self):
        from .quality_form_definition import initial_state
        value={'learnerId':'1','expectedVersion':0,'requestId':str(uuid4()),'status':'draft','form':form(),'templateVersion':99}
        request=self.factory.post('/quality',data=json.dumps(value),content_type='application/json');request._dont_enforce_csrf_checks=True
        data={'snapshot':{key:value for key,value in snapshot().items() if key not in ('form','status','reviewer')},'learners':[]}
        with patch.object(quality_review_api,'context',return_value=(data,None)),patch.object(store,'read_review',return_value=None),\
             patch.object(store,'read_template',return_value=initial_state()),patch.object(store,'save_review') as save:
            self.assertEqual(quality_review_api.reviews(request).status_code,409);save.assert_not_called()

    def test_historical_pdf_uses_immutable_revision_and_current_access(self):
        saved={**snapshot(),'id':str(uuid4()),'version':1,'status':'completed'}
        with patch.object(store,'read_revision',return_value=saved) as read,\
             patch('coach_api.quality_review_pdf.stored_review_pdf',return_value=b'%PDF-saved') as pdf:
            response=quality_review_api.review_attachment(self.factory.get('/document'),saved['id'],1)
            self.assertEqual(response.status_code,200);self.assertEqual(response.content,b'%PDF-saved')
            read.assert_called_once_with(saved['id'],1)
            self.staff.access='coach'
            self.assertEqual(quality_review_api.review_attachment(self.factory.get('/document'),saved['id'],1).status_code,403)
            self.assertEqual(pdf.call_count,1)

    def test_custom_image_question_uses_the_saved_definition_allowlist(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image
        from io import BytesIO
        definition=default_definition()
        definition['sections'][0]['criteria'].append({'id':'custom-picture','text':'Supporting image','type':'image','required':True})
        saved={**snapshot(),'definition':clean_definition(definition)}
        image=BytesIO();Image.new('RGB',(24,24),'white').save(image,format='PNG')
        with patch.object(store,'read_review',return_value=saved),patch.object(store,'save_image',return_value=str(uuid4())) as save:
            for key,status in [('custom-picture',201),('unpublished-picture',400)]:
                request=self.factory.post('/quality',{'section':key,'image':SimpleUploadedFile('evidence.png',image.getvalue(),content_type='image/png')})
                request._dont_enforce_csrf_checks=True
                self.assertEqual(quality_review_api.review_image(request,str(uuid4())).status_code,status)
            self.assertEqual(save.call_count,1)
            self.assertEqual(save.call_args.args[1],'custom-picture')
            self.assertEqual(Image.open(BytesIO(save.call_args.args[-1])).format,'JPEG')
