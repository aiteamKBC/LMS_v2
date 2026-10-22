"""Synthetic catalogue scaling/parity tests; run with all DB connections denied."""
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import canonical_learning as canonical
from . import current_learning, my_learning as learning
from . import course_catalogue_display as display
from . import training_plan_dashboard as schedule
from .tests_my_learning_no_db import component, native, metadata


def large_facts(replacements=False):
    """Eight subjects / 1,596 activities; entirely synthetic identities."""
    modules = {f'M{i}':{'id':f'M{i}','title':'Repeated module title' if i<2 else f'Module {i}',
        'total_otjh':12,'educational_session_count':2} for i in range(4)}
    current = [{'id':mid,'title':row['title']} for mid,row in modules.items()]
    components = [{**component(f'C{i}',f'M{i%4}',component=f'Repeated activity {i%11}'),
        'module':modules[f'M{i%4}']['title']} for i in range(247)]
    content = native(components)
    content['modules'] = [m['title'] for m in current]
    courses = [{'id':i+1,'source_course_ref':str(50+i),'source_course_title':f'Previous {i}'} for i in range(4)]
    definitions, records, attempts = [], [], []
    done, hours, record_ids = set(), defaultdict(float), defaultdict(set)
    for i in range(1349):
        course,ref = str(50+i%4),f'material:{i+1}'
        definitions.append({'source_course_ref':course,'source_activity_id':ref,
            'source_activity_title':f'Previous activity {i%17}','source_section_title':'Week 1',
            'source_payload':{},'position':i})
        row = {'id':i+1,'learner_id':9,'module_ref':course,'accepted':i<100,
            'actual_seconds':((i%7)+1)*73.12345,'ksbs':[],
            'sources':[{'source_system':'old_lms','source_course_ref':course,'source_activity_id':ref}]}
        records.append(row)
        if row['accepted']:
            done.add((course,ref));hours[course]+=row['actual_seconds']/3600
        record_ids[(course,ref)].add(str(row['id']))
        attempts.append({'group_id':int(course),'activity_id':i+1,'completed':i<100,
            'best_percent':80 if i<100 else 40,'submitted_at':datetime(2026,1,1,tzinfo=timezone.utc)})
    records.extend({'id':2000+i,'learner_id':9,'component_ref':f'C{i}',
        'module_ref':f'M{i%4}','accepted':False,'actual_seconds':None,'ksbs':[]} for i in range(247))
    meta=metadata();meta.update(current_subjects=current,modules=modules,record_ids=record_ids)
    if replacements:
        meta['replacement_courses']={f'current:M{i}':f'legacy:{50+i}' for i in range(4)}
        meta['replacement_settings']={f'C{i}':{'legacySettings':{'sourceLessonId':i+1,'sourceMaterialKey':f'reading-{i+1}'}} for i in range(247)}
    return content,current,courses,definitions,done,set(),hours,meta,records,modules,[],attempts


class CataloguePerformanceTests(SimpleTestCase):
    def test_multi_placement_records_compute_completion_and_hours_once(self):
        definitions=[{'source_course_ref':'50','source_activity_id':kind+':7'} for kind in ('material','quiz')]
        record={'id':1,'accepted':True,'actual_seconds':3600,'sources':[
            {'source_system':'old_lms','source_course_ref':'50','source_activity_id':kind+':7'} for kind in ('material','quiz')]}
        with patch.object(canonical,'query',return_value=definitions),patch.object(canonical,'counts_as_completed',wraps=canonical.counts_as_completed) as completion,patch.object(canonical,'counts_as_actual',wraps=canonical.counts_as_actual) as actual:
            _,done,_,hours,_=learning.course_facts({'id':9},[record],[{'id':3,'source_course_ref':'50'}])
        self.assertEqual(done,{('50','material:7'),('50','quiz:7')})
        self.assertEqual(hours['50'],1)
        self.assertEqual(completion.call_count,1);self.assertEqual(actual.call_count,1)

    def test_large_mixed_and_replacement_counts_and_one_attribution_index(self):
        for replacements in (False,True):
            facts=large_facts(replacements)
            with patch.object(display,'read_export_placements',return_value=[]),patch.object(schedule,'module_record_index',wraps=schedule.module_record_index) as index:
                cards,summary=learning.assemble_cards(*facts[:11])
            self.assertEqual(index.call_count,1)
            self.assertEqual(summary['current']['subjects'],0 if replacements else 4)
            self.assertEqual(summary['current']['total'],0 if replacements else 247)
            self.assertEqual(summary['previous']['total'],1349)
            self.assertEqual(summary['previous']['completed'],100)
            self.assertEqual(len(cards),4 if replacements else 8)
            self.assertEqual(summary['current']['completed'],0)
            self.assertAlmostEqual(sum(c['actualHours'] or 0 for c in cards),
                sum(round(hours,6) for hours in facts[6].values()),places=6)

    def test_attempt_routes_are_indexed_once_and_input_rows_remain_unchanged(self):
        *_,records,modules,credits,attempts=large_facts()
        saved=deepcopy(records)
        with patch.object(current_learning,'source_reference',wraps=current_learning.source_reference) as resolve:
            merged=current_learning.merge_attempts(records,attempts)
        self.assertEqual(resolve.call_count,len(records))
        self.assertEqual(len(merged),len(records))
        self.assertEqual(sum(r.get('completed',False) for r in merged),100)
        self.assertEqual(records,saved)
        self.assertEqual([r['actual_seconds'] for r in merged],[r['actual_seconds'] for r in records])

    def test_attempt_index_preserves_duplicate_links_typed_ids_and_synthetic_retry(self):
        rows=[{'id':1,'accepted':False,'actual_seconds':None,'total_score':10,'achieved_score':9,
            'sources':[{'source_system':'old_lms','source_course_ref':'50','source_activity_id':'material:7'}],
            'historical_components':[{'source_system':'old_lms','source_course_ref':50,'source_activity_id':'material:7'}]},
            {'id':2,'accepted':False,'source_payload':{'original_source_ref':'la:50:7'}},
            {'id':3,'accepted':False,'sources':[{'source_system':'old_lms','source_course_ref':50,'source_activity_id':'quiz:7'}]},
            {'id':4,'accepted':False,'source_payload':{'original_source_ref':['invalid']}}]
        attempt={'group_id':50,'activity_id':7,'completed':True,'best_percent':80,'submitted_at':datetime(2026,1,1,tzinfo=timezone.utc)}
        merged=current_learning.merge_attempts(rows,[attempt,{**attempt,'group_id':60},{**attempt,'group_id':60,'completed':False}])
        self.assertEqual(len(merged),5)
        self.assertTrue(merged[0]['completed']);self.assertEqual(merged[0]['achieved_score'],90)
        self.assertTrue(merged[1]['completed']);self.assertNotIn('completed',merged[2])
        self.assertTrue(merged[4]['completed']);self.assertFalse(merged[4]['accepted'])

    def test_catalogue_ledger_skips_ksb_registry_and_wide_history_but_keeps_source_gates(self):
        with patch.object(canonical,'query',return_value=[]) as query,patch.object(canonical,'current_records',return_value=[]),patch.object(canonical,'_ksb_not_excluded',side_effect=AssertionError('Unused KSB lookup')):
            self.assertEqual(canonical.entries_for({'id':9},lineage_only=True,monthly_summary=True,catalogue_summary=True),[])
        self.assertEqual(query.call_count,1)
        sql,params=query.call_args.args
        self.assertEqual(params,[9])
        self.assertNotIn('learner_progress_ksbs',sql)
        self.assertNotIn('to_jsonb(s)',sql);self.assertNotIn('to_jsonb(h)',sql)
        self.assertNotIn("jsonb_build_object('id',s.id)",sql)
        self.assertIn("'[{}]'::jsonb AS payload",sql)
        self.assertIn("'source_activity_id',h.source_activity_id",sql)
        self.assertIn('s.learner_id=p.learner_id',sql)
        self.assertIn('progress.deleted_at IS NULL',sql)

    def test_card_metadata_does_not_plan_holidays_or_read_group_settings(self):
        cur=MagicMock()
        cur.description=[(key,) for key in ('id','title','cover_image_url','start_date','end_date','tutor_name','programme_id','programme_name','cohort_name','group_name','total_otjh','sessions_number','source_type','source_id')]
        module_row=('M1','Module','https://assets.example.test/cover.png',date(2026,1,1),date(2026,12,31),'Tutor','P','Programme','C','G',12,2,'mba-legacy','00050')
        def execute(sql,params):
            if 'WITH live_counts' in sql:
                cur.description=[(key,) for key in ('id','module_catalogue_id','week_number','title','display_order','live_session_count')]
                cur.fetchall.return_value=[('W1','M1',1,'Week 1',1,2),('W0','M1',0,'Introduction',0,5)]
            else:cur.fetchall.return_value=[module_row]
        cur.execute.side_effect=execute
        resolved={}
        with patch.object(schedule,'attach_curriculum_slots',side_effect=AssertionError('Unused timetable')):
            modules=learning.catalogue_module_rows(cur,['M1'],identity_metadata=resolved)
        self.assertEqual(cur.execute.call_count,2)
        self.assertEqual(modules['M1']['educational_session_count'],2)
        self.assertEqual(modules['M1']['start_date'],'2026-01-01')
        self.assertEqual(resolved['quiz_modules']['M1']['programmeId'],'P')
        self.assertEqual(resolved['live_credit_components'],[])
        self.assertEqual(resolved['imported_courses'],{'current:M1':'legacy:50'})
        self.assertNotIn('curriculumSlots',modules['M1'])
        self.assertTrue(all('curriculum.groups' not in call.args[0] for call in cur.execute.call_args_list))

    def test_native_identity_read_reuses_raw_live_credit_keys_and_skips_empty_quiz_lookup(self):
        from . import learner_detail
        cur=MagicMock()
        cur.fetchall.return_value=[('L1','W1','M1','live_session','Lecture','',{
            'teamsLiveSessionId':'SERIES','teamsOccurrenceId':'OCC','teamsSessionNumber':2,
            'sessionDate':'2026-01-01','extraTeamsMeetingUrl':'https://example.test/extra',
            'extraTeamsLiveSessionId':'EXTRA'},None,0,None,False,None,False)]
        conn=MagicMock();conn.cursor.return_value.__enter__.return_value=cur
        resolved={'module_titles':{'M1':'Module'},'weeks':[('W1','M1','Week 1',1,0)],'live_credit_components':[]}
        with patch.object(learner_detail,'connections',{'enrolment':conn}):
            _,_,components=learner_detail._resolve_from_master([],[],[],assigned_modules=[{'moduleId':'M1'}],
                compact=True,identities_only=True,catalogue_facts=True,live_session_ids=False,resolved_metadata=resolved,strict=True)
        self.assertEqual(cur.execute.call_count,1)
        self.assertEqual(components[0]['teamsLiveSessionId'],'EXTRA')
        self.assertEqual(resolved['live_credit_components'],[{'componentId':'L1','moduleId':'M1','title':'Lecture',
            'type':'live_session','teamsOccurrenceId':'OCC','teamsLiveSessionId':'SERIES','teamsSessionNumber':'2','sessionDate':'2026-01-01'}])

    def test_quiz_scope_metadata_reuse_keeps_assignment_filters(self):
        from . import learner_detail
        cur=MagicMock();cur.fetchall.return_value=[]
        conn=MagicMock();conn.cursor.return_value.__enter__.return_value=cur
        weeks=[{'moduleId':'M1','module':'Module','weekId':'W1','week':'Week 1'}]
        resolved={'quiz_modules':{'M1':{'module':'Module','programmeId':'P','programme':'Programme'},
                                  'FOREIGN':{'module':'Foreign','programmeId':'Other','programme':'Other'}}}
        with patch.object(learner_detail,'connections',{'enrolment':conn}):
            self.assertEqual(learner_detail._append_week_quizzes(weeks,[],assigned_modules=[{'moduleId':'M1'}],
                native_week_ids=True,resolved_metadata=resolved,strict=True),(weeks,[]))
        self.assertEqual(cur.execute.call_count,3)
        self.assertFalse(any('FROM curriculum.modules' in call.args[0] for call in cur.execute.call_args_list))
        self.assertNotIn('FOREIGN',str(cur.execute.call_args_list))

    def test_section_dates_are_parsed_once_per_section_not_once_per_activity(self):
        exports=[{'course_id':50,'section_id':'s1','section_order':'1','section_title':'Week 1',
            'component_id':str(i+1),'component_kind':'lesson'} for i in range(1349)]
        definitions=[{'source_course_ref':'50','source_activity_id':f'material:{i+1}',
            'source_activity_title':'Lesson','source_section_ref':'s1'} for i in range(1349)]
        with patch.object(display,'section_schedule',wraps=display.section_schedule) as parse:
            result=display.catalogue_display_context(definitions,exports)
        self.assertEqual(parse.call_count,1)
        self.assertEqual(len(result),1349)

    def test_upcoming_preview_is_chronological_and_bounded_for_large_assignment_sets(self):
        content=native([component(f'A{i}',type='assignment') for i in range(300)])
        meta=metadata();meta['activity_dates']={f'A{i}':{'due_timing':'End of week','week_end':f'2099-02-{i%28+1:02}'} for i in range(300)}
        with patch.object(canonical,'query',return_value=[]):
            links=learning.upcoming_links(type('Source',(),{'pk':7})(),'commercial',['M1'],content,meta,{'current:M1'},limit=4)
            all_links=learning.upcoming_links(type('Source',(),{'pk':7})(),'commercial',['M1'],content,meta,{'current:M1'})
        self.assertEqual(links,all_links[:4])
        self.assertEqual(len(links),4)
