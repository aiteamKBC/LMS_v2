"""Feedback library, independent review identities and opaque evidence; isolated SQLite."""
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from PIL import Image
from pypdf import PdfReader

from . import quality_form_api, quality_review_api as api, quality_review_store as store
from .quality_feedback_catalog import defaults
from .quality_form_definition import default_definition, clean_answers, clean_definition, initial_state
from .quality_review_pdf import _render
from .quality_review_template import InvalidReview
from .test_quality_form_builder import QualityDefinitionStorageTests
from .test_quality_reviews import ReviewApiTests, REAL_CONTEXT, snapshot


def answers(definition):
    return {'header': {'employer':'Synthetic employer','programme':'Synthetic programme','activityDate':'2026-10-26'},
        'criteria': {q['id']:{'rating':'green','evidence':'Observed evidence at 12:30.'} for s in definition['sections'] for q in s['criteria'] if q['type']=='rating'},
        'answers': {q['id']:'Synthetic session context.' for s in definition['sections'] for q in s['criteria'] if q['type']=='textarea'},
        'actions': [], 'images': {}, 'sources':['recording'], 'attachments':{}}


class FeedbackDefinitionTests(SimpleTestCase):
    def test_all_fourteen_forms_preserve_their_criteria_and_full_reference_descriptions(self):
        self.assertEqual(len(defaults()),14)
        total=0
        for row in defaults():
            definition=default_definition(row['reviewType'])
            fields=definition['sections'][1]['criteria'];total+=len(fields)
            self.assertEqual(definition['title'],row['title'])
            for field in fields:
                self.assertEqual(set(field['descriptors']),{'gold','green','amber','red'})
                self.assertTrue(all(len(text)>50 for text in field['descriptors'].values()))
            clean_answers(answers(definition),'completed',definition)
        self.assertEqual(total,91)
        gateway=default_definition('FORM_GATEWAY')['sections'][1]['criteria']
        self.assertEqual(len(gateway),11)
        self.assertIn('Learner knowledge of EPA assessment methods',[q['text'] for q in gateway])
        teaching=default_definition('FORM_TEACHING')['sections'][1]['criteria']
        self.assertEqual(sum(q['text']=='Assessment for learning and feedback' for q in teaching),1)
        self.assertEqual(default_definition('FORM_TARGET_SETTING')['sections'][1]['criteria'][0]['text'],'Target Setting')

    def test_na_availability_and_required_file_fields_are_enforced_on_the_server(self):
        definition=default_definition('FORM_MONTHLY_COACHING');value=answers(definition)
        value['criteria']['criterion-1']['rating']='na'
        with self.assertRaises(InvalidReview):clean_answers(value,'completed',definition)
        value=answers(definition);value['criteria']['criterion-12']={'rating':'na','evidence':''}
        clean_answers(value,'completed',definition)
        definition['sections'][1]['criteria'].append({'id':'evidence-file','text':'Attach supporting evidence','type':'file','required':True})
        definition=clean_definition(definition)
        with self.assertRaises(InvalidReview):clean_answers(value,'completed',definition)
        value['attachments']={'evidence-file':[str(uuid4())]}
        clean_answers(value,'completed',definition)

    def test_every_form_generates_a_branded_pdf_with_its_own_text_and_selected_reference_criteria(self):
        for row in defaults():
            with self.subTest(form=row['reviewType']):
                definition=default_definition(row['reviewType'])
                review={**snapshot(),'id':str(uuid4()),'version':1,'status':'completed','definition':definition,
                    'reviewType':row['reviewType'],'form':answers(definition),'updatedAt':'2026-10-26T12:00:00Z',
                    'reviewer':{'id':'staff:1','name':'Synthetic Reviewer'}}
                pdf=PdfReader(BytesIO(_render(review,{})))
                text=' '.join(' '.join(page.extract_text() for page in pdf.pages).split())
                self.assertIn(definition['title'],text)
                for q in definition['sections'][1]['criteria']:
                    self.assertIn(' '.join(q['text'].split()),text)
                    self.assertIn(' '.join(q['descriptors']['green'].split()),text)
                self.assertTrue(pdf.pages[0].images)


class FeedbackStorageTests(SimpleTestCase):
    setUp=QualityDefinitionStorageTests.setUp

    def prepare_files(self):
        sql=(Path(__file__).parent/'sql'/'coaching_quality_v3.sql').read_text()
        self.db.executescript(sql.replace('lms_quality.',''))

    def test_catalog_has_fourteen_lightweight_cards_and_custom_drafts_require_publication(self):
        catalog=store.form_catalog()
        self.assertEqual(len(catalog),14)
        self.assertFalse(any('sections' in card for card in catalog))
        kind='FORM_CUSTOM_'+uuid4().hex.upper()
        from .quality_feedback_catalog import new_definition
        definition=clean_definition(new_definition(kind,'Custom observation'))
        saved=store.save_template(definition,expected=0,request_id=str(uuid4()),actor='staff:1')
        self.assertFalse(any(card['reviewType']==kind for card in store.form_catalog()))
        self.assertTrue(any(card['reviewType']==kind and not card['published'] for card in store.form_catalog(editing=True)))
        with self.assertRaises(InvalidReview):api.selected_definition(None,kind)
        store.save_template(definition,expected=saved['revision'],request_id=str(uuid4()),actor='staff:1',publish=True)
        self.assertTrue(any(card['reviewType']==kind and card['published'] for card in store.form_catalog()))
        self.assertEqual(api.selected_definition(None,kind)['title'],'Custom observation')

    def test_builtin_draft_preserves_original_published_questions_until_publish(self):
        definition=default_definition('FORM_SAFEGUARDING');original=deepcopy(definition)
        definition['sections'][1]['criteria'][0]['text']='Edited safeguarding criterion'
        saved=store.save_template(definition,expected=0,request_id=str(uuid4()),actor='staff:1')
        self.assertEqual(saved['published'],original)
        self.assertEqual(store.read_template('FORM_SAFEGUARDING')['published'],original)

    def test_two_forms_for_one_learner_and_meeting_have_separate_reviews_and_history(self):
        first={**snapshot(),'reviewType':'FORM_MONTHLY_COACHING','identity':'a'*64}
        second={**snapshot(),'reviewType':'FORM_SAFEGUARDING','identity':'b'*64}
        one=store.save_review(first,expected=0,request_id=str(uuid4()),actor='staff:1')
        two=store.save_review(second,expected=0,request_id=str(uuid4()),actor='staff:1')
        self.assertNotEqual(one['id'],two['id'])
        store.save_review(first,expected=1,request_id=str(uuid4()),actor='staff:1')
        self.assertEqual(store.read_review(review_id=two['id'])['version'],1)
        self.assertEqual(store.read_revision(one['id'],1)['reviewType'],'FORM_MONTHLY_COACHING')

    def test_evidence_bytes_retry_ownership_and_old_version_references_are_preserved(self):
        self.prepare_files()
        one=store.save_review(snapshot(),expected=0,request_id=str(uuid4()),actor='staff:1')
        other={**snapshot(),'identity':'b'*64}
        two=store.save_review(other,expected=0,request_id=str(uuid4()),actor='staff:1')
        metadata=store.save_evidence(one['id'],'evidence','evidence.xlsx',b'opaque original bytes','application/octet-stream')
        self.assertEqual(metadata,store.save_evidence(one['id'],'evidence','renamed.xlsx',b'opaque original bytes','application/octet-stream'))
        file=metadata['id']
        changed={**snapshot(),'form':{**snapshot()['form'],'attachments':{'evidence':[file]}}}
        saved=store.save_review(changed,expected=1,request_id=str(uuid4()),actor='staff:1')
        self.assertEqual(saved['evidenceFiles'][0]['filename'],'evidence.xlsx')
        self.assertEqual(bytes(store.evidence_file(one['id'],file)['content']),b'opaque original bytes')
        pdf_metadata=store.read_evidence(one['id'],{'evidence':[file]})
        self.assertNotIn('content',pdf_metadata[0])
        self.assertIn('preview',pdf_metadata[0])
        self.assertIsNone(store.evidence_file(two['id'],file))
        foreign={**other,'form':changed['form']}
        with self.assertRaises(store.ReviewConflict):store.save_review(foreign,expected=1,request_id=str(uuid4()),actor='staff:1')
        store.save_review({**snapshot(),'form':{**snapshot()['form'],'attachments':{}}},expected=2,request_id=str(uuid4()),actor='staff:1')
        self.assertEqual(store.read_revision(one['id'],2)['form']['attachments']['evidence'],[file])


class FeedbackApiTests(SimpleTestCase):
    setUp=ReviewApiTests.setUp

    def test_identity_varies_only_by_selected_form_not_its_editable_title(self):
        from .recordings_calendar_media import calendar_context,calendar_record
        record=calendar_record(calendar_context('coach@example.invalid','event-one','2026-10-20T09:00:00Z','2026-10-20T10:00:00Z'))
        with patch.object(api,'_authorised_record',return_value=(record,None)),patch.object(api,'_coaches',return_value=[]), \
                patch.object(api,'_learners',return_value=[{'id':1,'full_name':'Synthetic Learner'}]),patch.object(api,'source_details',return_value=None):
            first,_=REAL_CONTEXT(self.factory.get('/quality'),'1','FORM_MONTHLY_COACHING')
            second,_=REAL_CONTEXT(self.factory.get('/quality'),'1','FORM_SAFEGUARDING')
            self.assertNotEqual(first['snapshot']['identity'],second['snapshot']['identity'])
            self.assertEqual(first['snapshot']['meeting'],second['snapshot']['meeting'])
            empty,_=REAL_CONTEXT(self.factory.get('/quality'),'1')
            self.assertEqual(empty['snapshot']['reviewType'],'')

    def test_all_formats_are_opaque_downloads_and_only_decoded_images_get_previews(self):
        self.reader.return_value=snapshot()
        for name,content in [('capture.svg',b'<svg onload="alert(1)"/>'),('evidence.docx',b'original document'),('recording.mp4',b'original video')]:
            request=self.factory.post('/quality',{'section':'evidence','file':SimpleUploadedFile(name,content)})
            request._dont_enforce_csrf_checks=True
            with patch.object(store,'save_evidence',return_value={'id':str(uuid4())}) as save:
                response=api.review_evidence_file(request,uuid4())
                self.assertEqual(response.status_code,201)
                self.assertIsNone(save.call_args.args[-1]);self.assertEqual(save.call_args.args[3],content)
        image=BytesIO();Image.new('RGB',(25,25),'purple').save(image,format='PNG')
        request=self.factory.post('/quality',{'file':SimpleUploadedFile('capture.png',image.getvalue())});request._dont_enforce_csrf_checks=True
        with patch.object(store,'save_evidence',return_value={'id':str(uuid4())}) as save:
            self.assertEqual(api.review_evidence_file(request,uuid4()).status_code,201)
            self.assertTrue(save.call_args.args[-1].startswith(b'\xff\xd8'))
        with patch.object(store,'evidence_file',return_value={'filename':'capture.svg','content':b'<svg/>','preview':None}):
            response=api.review_evidence_file(self.factory.get('/quality'),uuid4(),uuid4())
            self.assertEqual(response['Content-Type'],'application/octet-stream')
            self.assertTrue(response['Content-Disposition'].startswith('attachment;'))
            self.assertEqual(response['X-Content-Type-Options'],'nosniff')

    def test_file_upload_requires_curriculum_csrf_valid_section_and_nonempty_content(self):
        self.reader.return_value=snapshot()
        request=self.factory.post('/quality',{'file':SimpleUploadedFile('empty.txt',b'')});request._dont_enforce_csrf_checks=True
        with patch.object(store,'save_evidence') as write:
            self.assertEqual(api.review_evidence_file(request,uuid4()).status_code,400);write.assert_not_called()
        request=self.factory.post('/quality',{'file':SimpleUploadedFile('evidence.txt',b'evidence')})
        self.assertEqual(api.review_evidence_file(request,uuid4()).status_code,403)
        self.staff.access='coach';request._dont_enforce_csrf_checks=True
        self.assertEqual(api.review_evidence_file(request,uuid4()).status_code,403)

    def test_custom_form_creation_is_a_draft_with_stable_retry_identity(self):
        request_id=str(uuid4())
        request=self.factory.post('/quality/forms',data=json.dumps({'title':'Custom form','requestId':request_id}),content_type='application/json');request._dont_enforce_csrf_checks=True
        with patch.object(store,'save_template',side_effect=lambda value,**kwargs:{**initial_state('FORM_SAFEGUARDING'),'draft':value}) as write:
            response=quality_form_api.quality_forms(request)
            self.assertEqual(response.status_code,201)
            self.assertEqual(write.call_args.args[0]['reviewType'],'FORM_CUSTOM_'+request_id.replace('-','').upper())
            self.assertFalse(write.call_args.kwargs['publish'])
