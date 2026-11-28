"""Review-specific radar, captured scales and respondent isolation."""
from copy import deepcopy
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase, RequestFactory
from django.utils import timezone

from . import migrated_skills_radar as radar, views
from .migrated_skills_radar import read_source as read_source_query, read_programme_source as read_programme_query
from .migrated_reviews import all_fields, render_sections, validate_answers
from .migrated_templates import snapshot_for, validate_managed_definition
from .migrated_template_sync import merge_snapshot, snapshot_fingerprint, synchronize_locked
from .migrated_summary_binding import answer_version, record_answer_edit
from .migrated_respondents import merge_party_answers


def source_fields(maximum=5):
    return [{'label': 'Example standard', 'value': json.dumps({
        'competency': {'id': 12, 'name': 'Example apprenticeship standard'},
        'characteristics': [{'id': 34, 'name': 'B1: Complete work professionally',
            'levels': [{'level': n, 'characteristicsLevelId': 100+n,
                        'description': f'Competence description {n}'} for n in range(1, maximum+1)],
            'assessments': [{'assessmentType': 'User', 'characteristicsLevelId': 102,
                             'completedDate': '2026-01-01T10:00:00Z'},
                            {'assessmentType': 'Admin', 'characteristicsLevelId': 104,
                             'completedDate': '2026-02-01T10:00:00Z'}]}]})}]


def template():
    return SimpleNamespace(pk=22, scope='GLOBAL', programme_key='', review_family='PR_SKILLS_RADAR',
        name='PR + Skills Radar', definition_json={'sections': [radar.marker_section()]})


def frozen_snapshot():
    result = snapshot_for(template())
    result['sections'] = [radar.build_section(source_fields(), '2026-03-01T10:00:00Z')]
    return result


PREFIX = radar.SECTION_KEY + ':12:34:'


class ProgrammeRadarSourceTests(SimpleTestCase):
    def resolve(self, rows, profile_rows=(), resolved=None):
        connection=MagicMock()
        cursor=connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect=[rows,list(profile_rows)]
        with patch.object(radar,'connections',{'default':connection}), \
             patch('learner_api.ksb_sources.resolve_source',return_value=resolved) as resolver:
            result=read_programme_query(701)
        return result,cursor,resolver

    def test_exact_programme_name_is_profile_scoped_and_uses_its_applied_source(self):
        expected=SimpleNamespace(items=[{'code':'K1'}])
        result,cursor,resolver=self.resolve([('PROG-1','Example','standard:st0001-v1-0')],resolved=expected)
        self.assertIs(result,expected)
        resolver.assert_called_once_with('standard:st0001-v1-0',using='default')
        self.assertEqual(cursor.execute.call_args_list[0].args[1],[701])
        self.assertNotIn('email',cursor.execute.call_args_list[0].args[0].lower())

    def test_aptem_programme_ids_are_never_compared_with_curriculum_ids(self):
        expected=SimpleNamespace(items=[{'code':'K1'}])
        result,cursor,resolver=self.resolve([('PROG-1','Example','standard:st0001-v1-0')],resolved=expected)
        self.assertIs(result,expected)
        resolver.assert_called_once_with('standard:st0001-v1-0',using='default')
        self.assertNotIn('l.programme_id',cursor.execute.call_args.args[0])

    def test_ambiguous_programme_names_are_refused_instead_of_guessing(self):
        with self.assertRaisesRegex(ValueError,'more than one'):
            self.resolve([('PROG-1','Example','standard:one'),('PROG-2','Example','standard:two')])

    def test_unmapped_profile_never_uses_another_programme_source(self):
        result,_,resolver=self.resolve([])
        self.assertIsNone(result);resolver.assert_not_called()

    def test_explicit_profile_source_is_retained_even_when_archived(self):
        expected=SimpleNamespace(items=[{'code':'K1'}],active=False)
        result,_,resolver=self.resolve([('PROG-1','Example','profile:KSBP-1')],resolved=expected)
        self.assertIs(result,expected)
        resolver.assert_called_once_with('profile:KSBP-1',using='default')

    def test_profile_discovery_requires_one_explicit_programme_association(self):
        expected=SimpleNamespace(items=[{'code':'K1'}])
        result,cursor,resolver=self.resolve([('PROG-1','Example','')],[('KSBP-1',)],expected)
        self.assertIs(result,expected)
        self.assertEqual(cursor.execute.call_args_list[1].args[1],['PROG-1','Example'])
        resolver.assert_called_once_with('KSBP-1',using='default')
        with self.assertRaisesRegex(ValueError,'more than one'):
            self.resolve([('PROG-1','Example','')],[('KSBP-1',),('KSBP-2',)],expected)

    def test_missing_applied_definitions_remain_explicitly_unavailable(self):
        result,_,_=self.resolve([('PROG-1','Example','standard:missing')],resolved=SimpleNamespace(items=[]))
        self.assertIsNone(result)


class ProgrammeRadarDefinitionTests(SimpleTestCase):
    def source(self):
        return SimpleNamespace(source_value='standard:st0001-v1-0',label='Example programme standard',items=[
            {'code':'K1','description':'Example knowledge'},
            {'code':'S1','description':'Example skill'},
            {'code':'B1','description':'Example behaviour'}])

    def levels(self,maximum=5):
        return [{'value':str(n),'label':f'Example level {n}'} for n in range(1,maximum+1)]

    def test_all_programme_ksbs_have_separate_learner_coach_and_goal_fields(self):
        source=self.source();before=deepcopy(vars(source))
        section=radar.build_programme_section(source,self.levels())
        self.assertEqual(len(section['fields']),9)
        self.assertEqual(len({f['key'] for f in section['fields']}),9)
        self.assertEqual(section['fields'][0]['title'],'K1: Example knowledge — Learner assessment')
        self.assertTrue(section['fields'][0]['key'].startswith('lms-skills-radar:programme:standard:'))
        self.assertEqual(section['fields'][0]['respondentRoles'],['participant'])
        self.assertEqual(section['fields'][2]['respondentRoles'],[])
        self.assertEqual(section['fields'][0]['skillsRadar']['origin'],'programme_ksb')
        self.assertEqual(vars(source),before)

    def test_definitions_do_not_import_enrolment_ratings_or_fake_aptem_reference_history(self):
        source=self.source();source.items[0].update(score=5,assessment=4,goal=5)
        section=radar.build_programme_section(source,self.levels())
        for field in section['fields']:
            self.assertNotIn('answer',field)
            self.assertNotIn('baseline',field['skillsRadar'])
        snapshot=snapshot_for(template());snapshot['sections']=[section]
        validate_answers(snapshot,{section['fields'][1]['key']:'4'})
        with self.assertRaises(ValueError):validate_answers(snapshot,{section['fields'][1]['key']:'6'})

    def test_frozen_questions_and_scale_are_independent_of_future_programme_changes(self):
        source=self.source();levels=self.levels()
        section=radar.build_programme_section(source,levels)
        before=deepcopy(section)
        source.items[0]['description']='Changed title';levels[0]['label']='Changed scale'
        self.assertEqual(section,before)

    def test_missing_duplicate_and_incomplete_ksbs_are_refused(self):
        for kind in ('missing','duplicate','incomplete'):
            source=self.source()
            if kind=='missing':source.items=[]
            elif kind=='duplicate':source.items.append(deepcopy(source.items[0]))
            else:source.items[0]['description']=''
            with self.subTest(kind=kind),self.assertRaises(ValueError):
                radar.build_programme_section(source,self.levels())

    def test_programme_source_and_aptem_characteristic_ids_have_distinct_namespaces(self):
        source=self.source();source.source_value='12'
        section=radar.build_programme_section(source,self.levels())
        imported={f['key'] for f in frozen_snapshot()['sections'][0]['fields']}
        self.assertFalse(imported & {f['key'] for f in section['fields']})

    def test_missing_aptem_uses_the_verified_programme_questions_and_agreed_five_point_scale(self):
        snapshot=snapshot_for(template())
        with patch.object(radar,'read_source',return_value=([],None)), \
             patch.object(radar,'read_programme_source',return_value=self.source()) as programme:
            expanded=radar.expand_snapshot(snapshot,701)
        programme.assert_called_once_with(701)
        fields=expanded['sections'][0]['fields']
        self.assertEqual(len(fields),9)
        self.assertEqual(fields[0]['options'],['1','2','3','4','5'])
        self.assertEqual(fields[0]['skillsRadar']['levels'],radar.PROGRAMME_KNOWLEDGE_LEVELS)
        self.assertEqual(snapshot_fingerprint(snapshot),snapshot_fingerprint(expanded))

    def test_aptem_questions_and_eight_point_scale_take_priority_without_programme_queries(self):
        with patch.object(radar,'read_source',return_value=(source_fields(8),None)), \
             patch.object(radar,'read_programme_source',side_effect=AssertionError('Unneeded programme lookup')):
            expanded=radar.expand_snapshot(snapshot_for(template()),701)
        self.assertEqual(expanded['sections'][0]['fields'][0]['options'][-1],'8')
        self.assertNotIn('origin',expanded['sections'][0]['fields'][0]['skillsRadar'])

    def test_existing_programme_questions_never_change_when_aptem_or_programme_changes(self):
        snapshot=snapshot_for(template());snapshot['sections']=[radar.build_programme_section(self.source(),self.levels())]
        with patch.object(radar,'read_source',side_effect=AssertionError('Frozen definition changed')), \
             patch.object(radar,'read_programme_source',side_effect=AssertionError('Frozen programme changed')):
            self.assertIs(radar.expand_snapshot(snapshot,701),snapshot)

    def test_unmapped_programme_is_visible_and_retried_when_mapping_becomes_available(self):
        with patch.object(radar,'read_source',return_value=([],None)), \
             patch.object(radar,'read_programme_source',return_value=None):
            missing=radar.expand_snapshot(snapshot_for(template()),701)
        self.assertIn('No imported questions or mapped programme',missing['sections'][0]['fields'][0]['description'])
        with patch.object(radar,'read_source',return_value=([],None)), \
             patch.object(radar,'read_programme_source',return_value=self.source()):
            expanded=radar.expand_snapshot(missing,701)
        self.assertEqual(len(expanded['sections'][0]['fields']),9)

    def test_programme_identity_conflict_is_visible_without_fabricating_questions(self):
        with patch.object(radar,'read_source',return_value=([],None)), \
             patch.object(radar,'read_programme_source',side_effect=ValueError('Ambiguous programme')):
            result=radar.expand_snapshot(snapshot_for(template()),701)
        self.assertIn('Ambiguous programme',result['sections'][0]['fields'][0]['description'])
        self.assertEqual(len(result['sections'][0]['fields']),1)

    def test_default_labels_and_goals_follow_the_question_kind_without_changing_scores(self):
        section=radar.build_programme_section(self.source())
        for index,code in enumerate(('K1','S1','B1')):
            expected=radar.PROGRAMME_KNOWLEDGE_LEVELS if code.startswith('K') else radar.PROGRAMME_LEVELS
            for field in section['fields'][index*3:index*3+3]:
                self.assertEqual(field['skillsRadar']['levels'],expected)
                self.assertEqual(field['options'],['1','2','3','4','5'])
        self.assertIn('Significant understanding',section['fields'][0]['skillsRadar']['levels'][-1]['label'])
        self.assertIn('Always',section['fields'][3]['skillsRadar']['levels'][-1]['label'])

    def test_unanswered_legacy_knowledge_labels_refresh_once_without_live_source_reads(self):
        snapshot=snapshot_for(template())
        snapshot['sections']=[radar.build_programme_section(self.source(),radar.PROGRAMME_LEVELS)]
        before=deepcopy(snapshot)
        with patch.object(radar,'read_source',side_effect=AssertionError('Read imported source')), \
             patch.object(radar,'read_programme_source',side_effect=AssertionError('Read programme source')):
            corrected=radar.expand_snapshot(snapshot,701,answers={})
            self.assertIs(radar.expand_snapshot(corrected,701,answers={}),corrected)
        self.assertEqual(snapshot,before)
        self.assertEqual(corrected['sections'][0]['fields'][0]['skillsRadar']['levels'],radar.PROGRAMME_KNOWLEDGE_LEVELS)
        self.assertEqual(corrected['sections'][0]['fields'][3:],before['sections'][0]['fields'][3:])
        self.assertEqual(snapshot_fingerprint(corrected),snapshot_fingerprint(before))
        self.assertEqual([f['key'] for f in corrected['sections'][0]['fields']],
                         [f['key'] for f in before['sections'][0]['fields']])

    def test_saved_or_cleared_assessments_keep_the_entire_original_question_scale(self):
        snapshot=snapshot_for(template());snapshot['sections']=[radar.build_programme_section(self.source(),radar.PROGRAMME_LEVELS)]
        for field in snapshot['sections'][0]['fields'][:3]:
            for saved,audit in [({field['key']:'3'},{}),({field['key']:''},{field['key']:{'history':[{'value':'3'}]}})]:
                with self.subTest(kind=field['skillsRadar']['kind'],saved=saved):
                    self.assertIs(radar.expand_snapshot(snapshot,701,answers=saved,answer_audit=audit),snapshot)

    def test_imported_custom_scales_and_read_only_definitions_are_never_relabelled(self):
        custom=snapshot_for(template());custom['sections']=[radar.build_programme_section(self.source(),self.levels())]
        self.assertIs(radar.expand_snapshot(custom,701,answers={}),custom)
        imported=frozen_snapshot()
        self.assertIs(radar.expand_snapshot(imported,701,answers={}),imported)
        legacy=snapshot_for(template());legacy['sections']=[radar.build_programme_section(self.source(),radar.PROGRAMME_LEVELS)]
        self.assertIs(radar.expand_snapshot(legacy,701),legacy)


class RadarDefinitionTests(SimpleTestCase):
    def test_family_adds_section_without_editing_master_and_other_families_stay_unchanged(self):
        master=template();master.definition_json={'sections':[{'key':'existing','title':'Review','order':1,'fields':[]}]}
        before=deepcopy(master.definition_json)
        snapshot=snapshot_for(master)
        self.assertEqual(len(snapshot['sections']),2)
        self.assertEqual(snapshot['sections'][1]['title'],'Skills Radar')
        self.assertEqual(master.definition_json,before)
        master.review_family='PR'
        self.assertEqual(snapshot_for(master)['sections'],before['sections'])

    def test_marker_is_scoped_to_dedicated_pr_skills_radar_section(self):
        validate_managed_definition(template().definition_json, family='PR_SKILLS_RADAR')
        for family in ('PR', 'MCM', 'PSP', None):
            with self.subTest(family=family), self.assertRaises(ValueError):
                validate_managed_definition(template().definition_json, family=family)

    def test_source_has_exact_ids_scale_descriptions_and_no_copied_review_answers(self):
        section = radar.build_section(source_fields(), '2026-03-01T10:00:00Z')
        fields = section['fields']
        self.assertEqual([f['key'] for f in fields], [PREFIX+k for k in ('learner','coach','goal')])
        self.assertEqual(fields[0]['respondentRoles'], ['participant'])
        self.assertEqual(fields[2]['respondentRoles'], [])
        self.assertEqual(fields[0]['options'], ['1','2','3','4','5'])
        self.assertNotIn('answer', fields[0])
        self.assertEqual(len(fields[1]['skillsRadar']['baseline']), 2)
        self.assertEqual(fields[0]['skillsRadar']['baselineScope'], 'current_learner_competency_report')

    def test_eight_point_scale_is_preserved_without_five_point_clamping(self):
        section = radar.build_section(source_fields(8), None)
        self.assertEqual(section['fields'][0]['options'][-1], '8')
        self.assertEqual(section['fields'][0]['skillsRadar']['levels'][-1]['label'], 'Competence description 8')

    def test_imported_knowledge_skill_and_behaviour_keep_their_own_answer_and_goal_wording(self):
        payload=json.loads(source_fields()[0]['value']);base=payload['characteristics'][0]
        payload['characteristics']=[]
        for index,kind in enumerate(('K','S','B')):
            item=deepcopy(base);item.update(id=34+index,name=f'{kind}1: Example question')
            for level in item['levels']:level['description']=f'{kind} source wording {level["level"]}'
            payload['characteristics'].append(item)
        fields=radar.build_section([{'value':payload}],None)['fields']
        for index,kind in enumerate(('K','S','B')):
            for field in fields[index*3:index*3+3]:
                self.assertEqual(field['skillsRadar']['levels'][-1]['label'],f'{kind} source wording 5')

    def test_equal_above_below_and_unassessed_status(self):
        for coach,goal,expected in [('4','4','Achieved'),('5','4','Achieved'),
                                     ('3','4','Working Toward'),('','4','Not assessed'),('4','','Not assessed')]:
            self.assertEqual(radar.rating_status(coach,goal), expected)

    def test_invalid_duplicate_or_missing_characteristic_identity_is_refused(self):
        payload = json.loads(source_fields()[0]['value'])
        for mutation in ('missing','duplicate'):
            data = deepcopy(payload)
            if mutation == 'missing': data['characteristics'][0]['id'] = None
            else: data['characteristics'] *= 2
            with self.assertRaises(ValueError):radar.build_section([{'value':data}],None)

    def test_empty_source_is_explicitly_unavailable_without_fabricated_questions(self):
        section = radar.build_section([], None)
        self.assertEqual(len(section['fields']),1)
        self.assertIn('No verified',section['fields'][0]['description'])
        self.assertEqual(section['fields'][0]['aptemType'],11)

    def test_invalid_source_is_visible_and_retryable_without_breaking_other_review_sections(self):
        fields=source_fields();payload=json.loads(fields[0]['value'])
        payload['characteristics'][0]['competenceId']=999
        fields[0]['value']=payload
        snapshot=snapshot_for(template())
        with patch.object(radar,'read_source',return_value=(fields,None)):
            result=radar.expand_snapshot(snapshot,701)
        self.assertIn('different standard',result['sections'][0]['fields'][0]['description'])
        with patch.object(radar,'read_source',return_value=(source_fields(),None)):
            retried=radar.expand_snapshot(result,701)
        self.assertEqual(len(retried['sections'][0]['fields']),3)

    def test_source_lookup_is_scoped_to_the_profile_namespace(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchone.return_value = None
        with patch.object(radar,'connections',{'default':connection}):
            self.assertEqual(read_source_query(701),([],None))
        query,args=connection.cursor.return_value.__enter__.return_value.execute.call_args.args
        self.assertIn('r.learner_id=%s',query)
        self.assertEqual(args,[701])

    def test_other_families_and_already_frozen_radar_never_load_live_definitions(self):
        for snapshot in (snapshot_for(SimpleNamespace(**{**vars(template()),'review_family':'PR'})), frozen_snapshot()):
            with patch.object(radar,'read_source',side_effect=AssertionError('Unexpected source lookup')):
                self.assertIs(radar.expand_snapshot(snapshot,701),snapshot)

    def test_expansion_never_changes_managed_template_or_other_answers(self):
        snapshot = snapshot_for(template());before=deepcopy(snapshot)
        with patch.object(radar,'read_source',return_value=(source_fields(),None)):
            expanded=radar.expand_snapshot(snapshot,701)
        self.assertEqual(snapshot,before)
        self.assertEqual(len(expanded['sections'][0]['fields']),3)
        self.assertEqual(snapshot_fingerprint(expanded),snapshot_fingerprint(snapshot))

    def test_unrelated_template_sync_preserves_frozen_source_and_saved_values(self):
        previous=frozen_snapshot()
        answers={PREFIX+'learner':'2',PREFIX+'coach':'4',PREFIX+'goal':'5'}
        current=template();current.name='Updated title'
        with patch.object(radar,'read_source',side_effect=AssertionError('Frozen source changed')):
            result=merge_snapshot(previous,answers,current,'PR_SKILLS_RADAR')
        self.assertEqual(result['sections'],previous['sections'])
        validate_answers(result,answers)

    def test_out_of_scale_boolean_numeric_and_foreign_answers_are_rejected(self):
        for key,value in ((PREFIX+'coach','6'),(PREFIX+'goal',5),(PREFIX+'learner',True),('foreign','3')):
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_answers(frozen_snapshot(),{key:value})

    def test_rendered_controls_carry_metadata_and_server_history(self):
        sections,_=render_sections(frozen_snapshot(),{PREFIX+'coach':'4'},answer_audit={PREFIX+'coach':{
            'history':[{'value':'3','role':'advisor','at':'2026-01-01'}]}})
        field=sections[0]['fields'][1]
        self.assertEqual(field['configuration']['skillsRadar']['kind'],'coach')
        self.assertEqual(field['configuration']['skillsRadar']['history'][0]['value'],'3')


class RadarPermissionTests(SimpleTestCase):
    def overlay(self):
        return SimpleNamespace(status='in-progress',template_snapshot=frozen_snapshot(),
            answers={PREFIX+'learner':'2',PREFIX+'coach':'4',PREFIX+'goal':'5'},meeting_intelligence={})

    def test_coach_can_change_own_rating_and_goal_but_not_learner_rating_or_clear_it_by_omission(self):
        overlay=self.overlay()
        radar.check_role_edits(overlay.template_snapshot,overlay.answers,
                              {**overlay.answers,PREFIX+'coach':'5',PREFIX+'goal':'4'},'advisor')
        for change in ({**overlay.answers,PREFIX+'learner':'3'}, {PREFIX+'coach':'5',PREFIX+'goal':'5'}):
            with self.assertRaises(ValueError):radar.check_role_edits(overlay.template_snapshot,overlay.answers,change,'advisor')

    def test_learner_can_only_change_their_rating(self):
        overlay=self.overlay()
        merged=merge_party_answers(overlay,{PREFIX+'learner':'3'},'participant')
        self.assertEqual(merged[PREFIX+'coach'],'4');self.assertEqual(merged[PREFIX+'goal'],'5')
        for key in ('coach','goal'):
            with self.assertRaises(PermissionError):merge_party_answers(overlay,{PREFIX+key:'3'},'participant')

    def test_employer_cannot_change_any_radar_answer(self):
        for kind in ('learner','coach','goal'):
            with self.assertRaises(PermissionError):merge_party_answers(self.overlay(),{PREFIX+kind:'3'},'employer')

    def test_signature_stage_and_completed_reviews_are_locked(self):
        for status in ('awaiting-signature','completed'):
            overlay=self.overlay();overlay.status=status
            with self.assertRaises(ValueError):merge_party_answers(overlay,{PREFIX+'learner':'3'},'participant')

    def test_changed_ratings_keep_history_and_unchanged_ratings_do_not_duplicate_it(self):
        overlay=self.overlay()
        for value in ('5','3','3'):
            incoming={**overlay.answers,PREFIX+'coach':value}
            record_answer_edit(overlay,incoming,actor='coach@example.test')
            overlay.answers=incoming
        entries=overlay.meeting_intelligence['answerEdits'][PREFIX+'coach']['history']
        self.assertEqual([row['value'] for row in entries],['5','3'])

    def test_frozen_metadata_and_answers_do_not_change_on_read_or_render(self):
        overlay=self.overlay();before=deepcopy(vars(overlay))
        render_sections(overlay.template_snapshot,overlay.answers)
        self.assertEqual(vars(overlay),before)

    def test_clearing_own_goal_by_omission_is_recorded_in_history(self):
        overlay=self.overlay();incoming={k:v for k,v in overlay.answers.items() if k != PREFIX+'goal'}
        record_answer_edit(overlay,incoming,actor='coach@example.test')
        self.assertIsNone(overlay.meeting_intelligence['answerEdits'][PREFIX+'goal']['history'][0]['value'])

    def test_pdf_uses_frozen_answers_and_coach_goal_comparison_without_source_lookup(self):
        from .migrated_review_pdf import review_pdf_data,render_migrated_pdf
        overlay=self.overlay();overlay.completed_at=None
        context={'learner_name':'Example learner','learner_email':'learner@example.test',
                 'programme':'Example programme','scheduled_date':'2026-03-01','coach_name':'Example coach'}
        before=deepcopy(vars(overlay))
        with patch.object(radar,'read_source',side_effect=AssertionError('Frozen PDF read live source')):
            definition,_=review_pdf_data(overlay,{},**context)
            pdf=render_migrated_pdf(overlay,{},**context)
        self.assertIn('Working Toward',definition['sections'][0]['fields'][1]['title'])
        self.assertEqual(definition['sections'][0]['fields'][2]['answer'],'5')
        self.assertTrue(pdf.startswith(b'%PDF'))
        self.assertEqual(vars(overlay),before)


class RadarPersistenceTests(TestCase):
    def setUp(self):
        from .models import MigratedReviewTemplate,ImportedReviewInstance
        self.master=MigratedReviewTemplate.objects.create(scope='GLOBAL',programme_key='',
            review_family='PR_SKILLS_RADAR',name='PR + Skills Radar',definition_json=template().definition_json,is_active=True)
        snapshot=snapshot_for(self.master);snapshot['sections']=[radar.build_section(source_fields(),None)]
        self.overlay=ImportedReviewInstance.objects.create(event_key='imported-review:radar-fixture',
            owner_email='coach@example.test',learner_id=701,source_review_id=9001,migrated_template=self.master,
            template_snapshot=snapshot,status='in-progress',answers={PREFIX+'learner':'2',PREFIX+'coach':'4',PREFIX+'goal':'5'})
        self.definition={'migratedForm':True,'migratedProgrammeKey':'','readOnly':False,
            'instance':{'id':self.overlay.event_key,'learnerId':701},
            'historicalReview':{'id':'9001','type':'Progress Review (+ Skills Radar)'}}

    def post(self,answers,version=None):
        request=RequestFactory().post('/',json.dumps({'answers':answers,'answerVersion':version or answer_version(self.overlay)}),content_type='application/json')
        with patch.object(views,'authenticated_coach_email',return_value=self.overlay.owner_email), \
             patch.object(views,'_imported_review_definition',return_value=self.definition):
            result=unwrap(views.coach_review_instance_answers)(request,self.overlay.event_key)
        self.overlay.refresh_from_db()
        return result

    def test_save_does_not_change_source_identity_other_answers_or_progress(self):
        before=(self.overlay.source_review_id,self.overlay.learner_id,self.overlay.progress_snapshot)
        result=self.post({**self.overlay.answers,PREFIX+'coach':'5'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.overlay.answers[PREFIX+'coach'],'5')
        self.assertEqual(self.overlay.answers[PREFIX+'learner'],'2')
        self.assertEqual((self.overlay.source_review_id,self.overlay.learner_id,self.overlay.progress_snapshot),before)

    def test_malicious_coach_write_and_stale_save_leave_persisted_answers_unchanged(self):
        before=deepcopy(self.overlay.answers)
        self.assertEqual(self.post({**before,PREFIX+'learner':'5'}).status_code,400)
        self.assertEqual(self.overlay.answers,before)
        self.assertEqual(self.post({**before,PREFIX+'coach':'5'},version='stale').status_code,409)
        self.assertEqual(self.overlay.answers,before)

    def test_template_update_keeps_frozen_scale_and_other_values(self):
        old=deepcopy(self.overlay.template_snapshot['sections'])
        self.master.name='Updated PR title';self.master.save(update_fields=['name','updated_at'])
        with patch.object(radar,'read_source',side_effect=AssertionError('Source changed')):
            self.assertTrue(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.template_snapshot['sections'],old)
        self.assertEqual(self.overlay.answers[PREFIX+'learner'],'2')

    def test_working_overlay_gains_radar_without_changing_master_or_existing_work(self):
        ordinary={'key':'existing','title':'Review','order':0,'fields':[
            {'key':'existing-answer','title':'Existing answer','aptemType':1,'mandatory':False,'order':0}]}
        self.master.definition_json={'sections':[ordinary]};self.master.save(update_fields=['definition_json'])
        old=snapshot_for(self.master);old['sections']=[deepcopy(ordinary)]
        self.overlay.template_snapshot=old;self.overlay.answers={'existing-answer':'Keep this answer'}
        self.overlay.save(update_fields=['template_snapshot','answers'])
        with patch.object(radar,'read_source',return_value=(source_fields(),None)):
            self.assertTrue(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
        self.overlay.refresh_from_db();self.master.refresh_from_db()
        self.assertEqual(self.master.definition_json,{'sections':[ordinary]})
        self.assertEqual(self.overlay.template_snapshot['sections'][0],ordinary)
        self.assertEqual(self.overlay.answers,{'existing-answer':'Keep this answer'})
        self.assertEqual(self.overlay.template_snapshot['sections'][1]['fields'][0]['key'],PREFIX+'learner')

    def test_programme_fallback_persists_and_uses_the_same_coach_learner_permissions(self):
        source=SimpleNamespace(source_value='standard:st0001-v1-0',label='Example standard',
            items=[{'code':'K1','description':'Example knowledge'}])
        self.overlay.template_snapshot=snapshot_for(self.master);self.overlay.answers={}
        self.overlay.save(update_fields=['template_snapshot','answers'])
        with patch.object(radar,'read_source',return_value=([],None)), \
             patch.object(radar,'read_programme_source',return_value=source):
            self.assertTrue(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers,{})
        prefix='lms-skills-radar:programme:standard:st0001-v1-0:K1:'
        self.assertEqual(self.post({prefix+'coach':'5',prefix+'goal':'4'}).status_code,200)
        self.assertEqual(self.post({**self.overlay.answers,prefix+'learner':'5'}).status_code,400)
        merged=merge_party_answers(self.overlay,{prefix+'learner':'2'},'participant')
        self.assertEqual(merged[prefix+'goal'],'4')
        self.assertEqual(merged[prefix+'coach'],'5')
        self.assertEqual(merged[prefix+'learner'],'2')
        self.master.name='Changed title';self.master.save(update_fields=['name','updated_at'])
        previous=deepcopy(self.overlay.template_snapshot['sections'])
        with patch.object(radar,'read_programme_source',side_effect=AssertionError('Frozen KSB source changed')):
            self.assertTrue(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.template_snapshot['sections'],previous)

    def test_editable_unanswered_knowledge_labels_refresh_without_changing_answers(self):
        source=SimpleNamespace(source_value='standard:st0001-v1-0',label='Example standard',items=[{'code':'K1','description':'Example knowledge'}])
        snapshot=snapshot_for(self.master);snapshot['sections']=[radar.build_programme_section(source,radar.PROGRAMME_LEVELS)]
        self.overlay.template_snapshot=snapshot;self.overlay.answers={}
        self.overlay.save(update_fields=['template_snapshot','answers'])
        before=deepcopy(snapshot);version=answer_version(self.overlay)
        self.assertTrue(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers,{})
        self.assertNotEqual(answer_version(self.overlay),version)
        fields=self.overlay.template_snapshot['sections'][0]['fields']
        self.assertEqual(fields[0]['skillsRadar']['levels'],radar.PROGRAMME_KNOWLEDGE_LEVELS)
        self.assertEqual([f['key'] for f in fields],[f['key'] for f in before['sections'][0]['fields']])
        self.assertFalse(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
        for status in ('awaiting-signature','completed'):
            self.overlay.template_snapshot=deepcopy(before);self.overlay.status=status
            self.overlay.save(update_fields=['template_snapshot','status'])
            with patch.object(radar,'_refresh_unanswered_knowledge_labels',side_effect=AssertionError('Signed scale modified')):
                self.assertFalse(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
            self.overlay.refresh_from_db()
            self.assertEqual(self.overlay.template_snapshot,before)

    def test_other_coach_or_conflicting_review_identity_cannot_change_answers(self):
        original=deepcopy(self.overlay.answers)
        request=RequestFactory().post('/',json.dumps({'answers':{**original,PREFIX+'coach':'5'},
            'answerVersion':answer_version(self.overlay)}),content_type='application/json')
        for owner,learner in [('other-coach@example.test',701),('coach@example.test',702)]:
            definition=deepcopy(self.definition);definition['instance']['learnerId']=learner
            with patch.object(views,'authenticated_coach_email',return_value=owner), \
                 patch.object(views,'_imported_review_definition',return_value=definition):
                result=unwrap(views.coach_review_instance_answers)(request,self.overlay.event_key)
            self.assertEqual(result.status_code,409)  # Existing association mismatch contract.
            self.overlay.refresh_from_db();self.assertEqual(self.overlay.answers,original)

    def test_submitted_reviews_do_not_sync_or_load_radar_source(self):
        # A historical snapshot without this section must stay that way.
        self.overlay.template_snapshot['sections']=[{'key':'historical','title':'Historical review','fields':[
            {'key':'old','title':'Existing answer','aptemType':1,'order':0}]}]
        self.overlay.save(update_fields=['template_snapshot'])
        for status in ('awaiting-signature','completed'):
            self.overlay.status=status;self.overlay.save(update_fields=['status'])
            before=deepcopy(self.overlay.template_snapshot)
            with patch.object(radar,'read_source',side_effect=AssertionError('Frozen review expanded')):
                self.assertFalse(synchronize_locked(self.overlay,'PR_SKILLS_RADAR',''))
            self.overlay.refresh_from_db();self.assertEqual(self.overlay.template_snapshot,before)
