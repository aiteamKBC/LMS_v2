"""Type overrides, independent publications, filtered reads and immutable history."""
from copy import deepcopy
import json
import re
from uuid import uuid4
from unittest.mock import patch
from django.test import SimpleTestCase

from . import quality_review_api as api, quality_review_store as store, quality_form_api
from .quality_form_definition import default_definition, initial_state
from .quality_review_template import InvalidReview
from .quality_review_types import suggest_type, review_type, saved_type
from .test_quality_reviews import ReviewApiTests, snapshot, form
from .test_quality_form_builder import QualityDefinitionStorageTests


class QualityTypeSuggestionTests(SimpleTestCase):
    def test_title_variants_and_unknown_titles(self):
        for title, kind in [('Monthly Coaching Meeting – Test','MCM'),('Monthly Coaching Review','MCM'),
                            ('MCR catch-up','MCM'),('Test - MCM','MCM'),('Progress Review with coach','PR'),
                            ('BR - legacy spelling','PR'),('PR with coach','PR'),('inter EPA',''),
                            ('Programming workshop',''),('Monthly coaching meeting / Progress Review','PR')]:
            with self.subTest(title=title): self.assertEqual(suggest_type(title),kind)

    def test_explicit_saved_override_wins_and_invalid_types_are_rejected(self):
        self.assertEqual(saved_type({'reviewType':'PR','meeting':{'title':'MCM'}}),'PR')
        for value in ('BR','OTHER','mcm',None,True,{}):
            with self.subTest(value=value),self.assertRaises(InvalidReview):review_type(value)


class QualityTypeStorageTests(SimpleTestCase):
    def setUp(self):
        QualityDefinitionStorageTests.setUp(self)
        self.db.create_function('regexp',2,lambda pattern,value: bool(re.search(pattern.replace('\\y','\\b'),value or '',re.I)))
        self.db.create_function('jsonb_array_length',1,lambda value:len(json.loads(value)))

    def publish(self, definition, expected=0):
        return store.save_template(definition,expected=expected,request_id=str(uuid4()),actor='staff:1',publish=True)

    def test_mcm_and_pr_publish_independently_and_preserve_original_default_questions(self):
        for kind in ('MCM','PR'):
            sections=store.read_template(kind)['published']['sections']
            self.assertEqual(sum(len(row['criteria']) for row in sections),15 if kind=='MCM' else 14)
            self.assertIn('monthly' if kind=='MCM' else 'progress',[row['id'] for row in sections])
            self.assertNotIn('progress' if kind=='MCM' else 'monthly',[row['id'] for row in sections])
        mcm=default_definition('MCM');mcm['sections'][0]['criteria'][0]['text']='MCM only criterion'
        pr=default_definition('PR');pr['sections'][0]['criteria'][0]['text']='PR only criterion'
        self.publish(mcm);self.publish(pr)
        self.assertEqual(store.read_template('MCM')['published']['sections'][0]['criteria'][0]['text'],'MCM only criterion')
        self.assertEqual(store.read_template('PR')['published']['sections'][0]['criteria'][0]['text'],'PR only criterion')
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM form_template').fetchone()['n'],2)
        self.assertEqual(store.read_template()['revision'],0)

    def test_typed_defaults_inherit_legacy_customisation_without_rewriting_legacy_definition(self):
        legacy=default_definition();legacy['sections'][2]['criteria'][0]['text']='Existing shared custom question'
        original=self.publish(legacy)
        for kind in ('MCM','PR'):
            state=store.read_template(kind)
            self.assertEqual(state['revision'],0)
            common=next(row for row in state['published']['sections'] if row['id']=='reflections')
            self.assertEqual(common['criteria'][0]['text'],'Existing shared custom question')
            self.assertEqual(state['published']['reviewType'],kind)
        self.assertEqual(store.read_template(),original)

    def test_a_legacy_form_with_only_the_other_type_does_not_leave_an_empty_editor(self):
        legacy=default_definition();legacy['sections']=legacy['sections'][:1]
        original=self.publish(legacy)
        mcm=store.read_template('MCM')['published']
        pr=store.read_template('PR')['published']
        self.assertEqual(sum(len(row['criteria']) for row in mcm['sections']),15)
        self.assertEqual([row['id'] for row in pr['sections']],['progress'])
        self.assertEqual(store.read_template(),original)

    def test_reclassification_keeps_one_review_and_immutable_previous_pdf(self):
        value=snapshot();value.update(reviewType='MCM',definition=default_definition('MCM'),status='completed',form=form(True))
        first=store.save_review(value,expected=0,request_id=str(uuid4()),actor='staff:1')
        store.save_document(first,b'%PDF-original-completed-version')
        changed={**value,'reviewType':'PR','definition':default_definition('PR'),'status':'draft','form':form()}
        second=store.save_review(changed,expected=1,request_id=str(uuid4()),actor='staff:1')
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(store.read_revision(first['id'],1)['reviewType'],'MCM')
        self.assertEqual(store.read_revision(first['id'],2)['reviewType'],'PR')
        self.assertEqual(bytes(store.read_document(first['id'],1)['content']),b'%PDF-original-completed-version')
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM review').fetchone()['n'],1)

    def test_each_typed_pdf_contains_its_own_section_and_the_common_criteria(self):
        from io import BytesIO
        from pypdf import PdfReader
        from .quality_review_pdf import stored_review_pdf
        for index,kind in enumerate(('MCM','PR'),1):
            definition=default_definition(kind)
            allowed={q['id'] for section in definition['sections'] for q in section['criteria']}
            answers=form(True);answers['criteria']={key:answer for key,answer in answers['criteria'].items() if key in allowed}
            value=snapshot();value.update(identity=str(index)*64,reviewType=kind,definition=definition,status='completed',form=answers,
                                          reviewer={'id':'staff:1','name':'Synthetic Reviewer'})
            saved=store.save_review(value,expected=0,request_id=str(uuid4()),actor='staff:1')
            reader=PdfReader(BytesIO(stored_review_pdf(saved)))
            text='\n'.join(page.extract_text() for page in reader.pages)
            self.assertIn('Quality review type',text);self.assertIn(kind,text);self.assertTrue(reader.pages[0].images)
            self.assertIn('Monthly Coaching Meetings' if kind=='MCM' else 'Progress reviews',text)
            self.assertNotIn('Progress reviews' if kind=='MCM' else 'Monthly Coaching Meetings',text)
            self.assertIn('Safeguarding Awareness',text)

    def test_filters_include_legacy_titles_and_explicit_overrides_and_pdf_history(self):
        for index,title,kind in [(1,'Monthly Coaching Review',''),(2,'Progress Review',''),(3,'MCM with a corrected quality type','PR')]:
            value=snapshot();value['identity']=str(index)*64;value['meeting']['id']='a'*32;value['meeting']['title']=title
            if kind:value['reviewType']=kind
            value.update(status='completed',form=form(True))
            saved=store.save_review(value,expected=0,request_id=str(uuid4()),actor='staff:1')
            if index==3:store.save_document(saved,b'%PDF-saved')
        start,end='2026-10-01','2026-11-01'
        self.assertEqual(len(store.list_reviews(start,end,review_type='MCM')[0]),1)
        pr=store.list_reviews(start,end,review_type='PR')[0]
        self.assertEqual(len(pr),2);self.assertTrue(all(row['review_type']=='PR' for row in pr))
        self.assertEqual(len(store.list_reviews(start,end,pdf='available')[0]),1)
        self.assertEqual(len(store.list_reviews(start,end,pdf='missing')[0]),2)
        rows,_=store.reviews_for_meeting('a'*32)
        self.assertEqual({row['review_type'] for row in rows},{'MCM','PR'})
        self.assertNotIn('form',rows[0]);self.assertNotIn('content',rows[0])


class QualityTypeApiTests(SimpleTestCase):
    def setUp(self):
        ReviewApiTests.setUp(self)
        self.template=self.enterContext(patch.object(store,'read_template',side_effect=lambda kind='':initial_state(kind)))

    def test_manual_context_switch_uses_selected_template_and_does_not_write(self):
        value=deepcopy(self.ctx.return_value[0]);value['snapshot']['reviewType']='MCM';self.ctx.return_value=(value,None)
        self.reader.return_value={**snapshot(),'reviewType':'MCM','definition':default_definition('MCM')}
        response=api.review_context(self.factory.get('/quality/context?reviewType=PR&learnerId=1'))
        data=json.loads(response.content)
        self.assertEqual(response.status_code,200)
        self.assertEqual(data['template']['reviewType'],'PR');self.assertEqual(data['snapshot']['reviewType'],'PR')
        self.assertEqual(data['review']['reviewType'],'MCM');self.saver.assert_not_called()

    def test_saved_manual_selection_is_not_replaced_by_title_hint(self):
        self.reader.return_value={**snapshot(),'reviewType':'PR','definition':default_definition('PR')}
        response=api.review_context(self.factory.get('/quality/context?titleType=MCM&learnerId=1'))
        self.assertEqual(json.loads(response.content)['snapshot']['reviewType'],'PR')
        self.assertEqual(json.loads(response.content)['template']['reviewType'],'PR')

    def test_type_switch_save_keeps_server_identity_and_rejects_invalid_type(self):
        saved={**snapshot(),'reviewType':'MCM','definition':default_definition('MCM'),'id':str(uuid4()),'version':1}
        self.reader.return_value=saved
        request=ReviewApiTests.request(self,'put',reviewType='PR',expectedVersion=1,templateVersion=1)
        payload=json.loads(request.body)
        allowed={q['id'] for row in default_definition('PR')['sections'] for q in row['criteria']}
        payload['form']['criteria']={key:answer for key,answer in payload['form']['criteria'].items() if key in allowed}
        request=self.factory.put('/quality',data=json.dumps(payload),content_type='application/json');request._dont_enforce_csrf_checks=True
        response=api.review_detail(request,saved['id'])
        self.assertEqual(response.status_code,200)
        outgoing=self.saver.call_args.args[0]
        self.assertEqual(outgoing['reviewType'],'PR');self.assertEqual(outgoing['definition']['reviewType'],'PR')
        self.assertEqual(outgoing['identity'],saved['identity']);self.assertEqual(outgoing['meeting'],saved['meeting'])
        self.saver.reset_mock()
        self.assertEqual(api.reviews(ReviewApiTests.request(self,reviewType='OTHER')).status_code,400)
        self.saver.assert_not_called()

    def test_definition_endpoint_scopes_type_and_rejects_cross_type_publish(self):
        response=quality_form_api.quality_form(self.factory.get('/quality/form?reviewType=PR'))
        self.assertEqual(json.loads(response.content)['template']['reviewType'],'PR')
        request=self.factory.put('/quality/form?reviewType=PR',data=json.dumps({'definition':default_definition('MCM'),
            'expectedRevision':0,'requestId':str(uuid4()),'publish':True}),content_type='application/json')
        request._dont_enforce_csrf_checks=True
        with patch.object(store,'save_template') as write:
            self.assertEqual(quality_form_api.quality_form(request).status_code,400);write.assert_not_called()

    def test_list_type_and_pdf_filters_are_validated_and_passed_to_the_store(self):
        with patch.object(store,'list_reviews',return_value=([],None)) as read,patch.object(api,'_coaches',return_value=[]):
            response=api.reviews(self.factory.get('/quality?start=2026-10-01&end=2026-10-25&reviewType=PR&pdf=available'))
            self.assertEqual(response.status_code,200)
            self.assertEqual(read.call_args.kwargs,{'review_type':'PR','pdf':'available'})
            for suffix in ('reviewType=OTHER','pdf=bad'):
                self.assertEqual(api.reviews(self.factory.get('/quality?start=2026-10-01&end=2026-10-25&'+suffix)).status_code,400)

