"""Offline CPU/operation comparison against a pre-edit source snapshot.

Run from repository root: python backend/reports/benchmark_my_learning_catalogue.py
    --baseline-dir <directory containing pre-edit .py files> --repeats 3
No Django test runner, databases, servers, HTTP or external services are used.
"""
import argparse
import ast
from collections import defaultdict
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import statistics
import socket
import sys
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


class ForbiddenIO(BaseException):
    """Fail immediately even if an application fallback catches Exception."""


def old_function(path, name, module):
    scope = dict(vars(module))
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    node = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
    node.decorator_list = []
    exec(compile(ast.Module(body=[node],type_ignores=[]),str(path),'exec'),scope)
    return scope[name],scope


def median_cpu(callback, repeats, batch=1):
    samples=[]
    for _ in range(repeats):
        start=time.process_time()
        for _ in range(batch):callback()
        samples.append((time.process_time()-start)*1000/batch)
    return round(statistics.median(samples),3)


def compare(baseline, repeats):
    from learner_api import current_learning, my_learning as learning, canonical_learning as canonical
    from learner_api import course_catalogue_display as display, training_plan_dashboard as schedule, learner_detail
    from learner_api import dashboard_training, subject_store
    from learner_api import live_session_progress
    from learner_api.tests_my_learning_performance_no_db import large_facts
    from learner_api.tests_my_learning_no_db import fixture_responses
    before_attempts,_=old_function(baseline/'current_learning.py','merge_attempts',current_learning)
    before_cards,_=old_function(baseline/'my_learning.py','assemble_cards',learning)
    before_sections,_=old_function(baseline/'course_catalogue_display.py','catalogue_display_context',display)
    facts=large_facts(True)
    records,attempts=facts[8],facts[11]
    result={'baseline_sha256':{name:hashlib.sha256((baseline/name).read_bytes()).hexdigest()
        for name in ('my_learning.py','current_learning.py','course_catalogue_display.py','canonical_learning.py','learner_detail.py')},
        'fixture':{'native_activities':247,'legacy_activities':1349,'records':len(records),'attempts':len(attempts)}}
    assert before_attempts(records,attempts)==current_learning.merge_attempts(records,attempts)
    result['attempt_merge_cpu_ms']={label:median_cpu(lambda:fn(records,attempts),repeats,100 if label=='after' else 1)
        for label,fn in [('before',before_attempts),('after',current_learning.merge_attempts)]}
    result['attempt_source_resolutions']={}
    for label,fn in [('before',before_attempts),('after',current_learning.merge_attempts)]:
        scope=fn.__globals__
        count=[0]
        original=current_learning.source_reference
        def counted(record):
            count[0]+=1
            return original(record)
        with patch.dict(scope,source_reference=counted):
            fn(records,attempts)
            result['attempt_source_resolutions'][label]=count[0]

    with patch.object(display,'read_export_placements',return_value=[]):
        old=before_cards(*deepcopy(facts[:11]));new=learning.assemble_cards(*deepcopy(facts[:11]))
        assert old==new
        result['replacement_card_cpu_ms']={label:median_cpu(lambda:fn(*deepcopy(facts[:11])),repeats)
            for label,fn in [('before',before_cards),('after',learning.assemble_cards)]}
        result['replacement_attribution']={}
        for label,fn in [('before',before_cards),('after',learning.assemble_cards)]:
            with patch.object(schedule,'module_record_index',wraps=schedule.module_record_index) as index:
                fn(*deepcopy(facts[:11]))
            result['replacement_attribution'][label]={'index_builds':index.call_count,
                'input_record_visits':sum(len(call.args[0]) for call in index.call_args_list)}
    exports=[{'course_id':50,'section_id':'s1','section_order':'1','section_title':'Week 1',
        'component_id':str(i+1),'component_kind':'lesson'} for i in range(1349)]
    definitions=[{'source_course_ref':'50','source_activity_id':f'material:{i+1}',
        'source_activity_title':'Lesson','source_section_ref':'s1'} for i in range(1349)]
    assert before_sections(definitions,exports)==display.catalogue_display_context(definitions,exports)
    result['section_context_cpu_ms']={label:median_cpu(lambda:fn(definitions,exports),repeats)
        for label,fn in [('before',before_sections),('after',display.catalogue_display_context)]}
    result['section_schedule_parses']={}
    for label,fn in [('before',before_sections),('after',display.catalogue_display_context)]:
        with patch.dict(fn.__globals__,section_schedule=MagicMock(wraps=display.section_schedule)):
            fn(definitions,exports)
            result['section_schedule_parses'][label]=fn.__globals__['section_schedule'].call_count

    before_ledger,_=old_function(baseline/'canonical_learning.py','entries_for',canonical)
    result['ledger_projection']={}
    for label,fn,options in [('before',before_ledger,{'dashboard_metadata':True}),('after',canonical.entries_for,{'catalogue_summary':True})]:
        with patch.dict(fn.__globals__,query=MagicMock(return_value=[]),current_records=lambda owner,rows:rows,
                        _ksb_not_excluded=MagicMock(return_value='1=1')):
            fn({'id':9},lineage_only=True,monthly_summary=True,**options)
            sql=fn.__globals__['query'].call_args.args[0]
            result['ledger_projection'][label]={'ledger_selects':fn.__globals__['query'].call_count,
                'ksb_registry_checks':fn.__globals__['_ksb_not_excluded'].call_count,
                'full_segment_json':'to_jsonb(s)' in sql,'full_historical_json':'to_jsonb(h)' in sql}

    def quiz_cursor():
        cur=MagicMock()
        def execute(sql,params):
            cur.fetchall.return_value=[('M1','Module','P','Programme')] if 'FROM curriculum.modules' in sql else []
        cur.execute.side_effect=execute
        conn=MagicMock();conn.cursor.return_value.__enter__.return_value=cur
        return cur,{'enrolment':conn}
    before_quizzes,_=old_function(baseline/'learner_detail.py','_append_week_quizzes',learner_detail)
    result['published_quiz_queries']={}
    weeks=[{'moduleId':'M1','module':'Module','weekId':'W1','week':'Week 1'}]
    for label,fn,options in [('before',before_quizzes,{}),('after',learner_detail._append_week_quizzes,
        {'resolved_metadata':{'quiz_modules':{'M1':{'module':'Module','programmeId':'P','programme':'Programme'}}}})]:
        cur,connections=quiz_cursor()
        with patch.dict(fn.__globals__,connections=connections):
            assert fn(weeks,[],assigned_modules=[{'moduleId':'M1'}],native_week_ids=True,strict=True,**options)==(weeks,[])
        result['published_quiz_queries'][label]=cur.execute.call_count

    before_native,_=old_function(baseline/'learner_detail.py','_resolve_from_master',learner_detail)
    result['native_identity_queries']={}
    for label,fn in [('before',before_native),('after',learner_detail._resolve_from_master)]:
        cur=MagicMock()
        def native_execute(sql,params):
            cur.fetchall.return_value=[('L1','W1','M1','live_session','Lecture','',
                {'teamsLiveSessionId':'S1','teamsSessionNumber':'1','sessionDate':'2026-01-01'},None,0,None,False,None,False)] if 'settings_json' in sql else []
        cur.execute.side_effect=native_execute
        conn=MagicMock();conn.cursor.return_value.__enter__.return_value=cur
        resolved={'module_titles':{'M1':'Module'},'weeks':[('W1','M1','Week 1',1,0)],'live_credit_components':[]}
        with patch.dict(fn.__globals__,connections={'enrolment':conn}):
            fn([],[],[],assigned_modules=[{'moduleId':'M1'}],compact=True,identities_only=True,
                catalogue_facts=True,live_session_ids=False,resolved_metadata=resolved,strict=True)
        result['native_identity_queries'][label]={'selects':cur.execute.call_count,
            'live_component_re_read_needed':not bool(resolved['live_credit_components'])}
        credit_cur=MagicMock();credit_cur.fetchall.return_value=[('L1','M1','Lecture',None,'S1','1','2026-01-01')]
        credit_conn=MagicMock();credit_conn.cursor.return_value.__enter__.return_value=credit_cur
        with patch.object(live_session_progress,'connections',{'enrolment':credit_conn}):
            options={'module_ids':['M1']} if label=='before' else {'components':resolved['live_credit_components']}
            assert live_session_progress.read_live_credits(SimpleNamespace(),register=[],**options)==[]
        result['native_identity_queries'][label]['live_credit_component_selects']=credit_cur.execute.call_count

    before_modules,_=old_function(baseline/'dashboard_training.py','module_rows',dashboard_training)
    result['module_card_metadata']={}
    for label,fn in [('before',before_modules),('after',learning.catalogue_module_rows)]:
        cur=MagicMock()
        def module_execute(sql,params):
            found=([{'id':f'M{i}','module_catalogue_id':f'M{i}','title':f'Module {i}',
                'cover_image_url':None,'start_date':None,'end_date':None,'tutor_name':'Tutor',
                'total_otjh':12,'sessions_number':2,'weeks_number':2} for i in range(8)]
                if 'WITH live_counts' not in sql else [{'id':f'W{i}','module_catalogue_id':f'M{i}',
                    'week_number':1,'title':'Week 1','display_order':1,'live_session_count':2,
                    'learning_outcomes':[],'holiday_note_enabled':False,'holiday_note':''} for i in range(8)])
            keys=list(found[0]);cur.description=[(key,) for key in keys]
            cur.fetchall.return_value=[tuple(row[key] for key in keys) for row in found]
        cur.execute.side_effect=module_execute
        with patch.object(schedule,'attach_curriculum_slots') as slots:
            fn(cur,[f'M{i}' for i in range(8)],identity_metadata={})
        result['module_card_metadata'][label]={'selects':cur.execute.call_count,'timetable_builder_calls':slots.call_count}

    # Whole catalogue parity over both existing shared and large fixtures.
    before_catalogue,old_scope=old_function(baseline/'my_learning.py','read_catalogue',learning)
    old_scope['assemble_cards']=before_cards
    for replacement in (False,True):
        rows=large_facts(replacement)
        content,current,courses,definitions,done,started,hours,meta,records,modules,credits=rows[:11]
        context=([],[],records,content,courses,definitions,done,started,hours,meta,credits)
        source=SimpleNamespace(pk=7,cohort='',group='')
        owner={'id':9,'name':'Synthetic learner','programme':'Programme','programme_planned_hours':48}
        with ExitStack() as stack:
            stack.enter_context(patch.dict(old_scope,load_context=lambda *args:deepcopy(context),journal_enabled=lambda:True))
            stack.enter_context(patch.object(learning,'load_context',side_effect=lambda *args:deepcopy(context)))
            stack.enter_context(patch.object(learning,'journal_enabled',return_value=True))
            stack.enter_context(patch.object(display,'read_export_placements',return_value=[]))
            stack.enter_context(patch.object(subject_store,'covers_for',return_value={}))
            stack.enter_context(patch.object(canonical,'query',return_value=[]))
            assert before_catalogue(source,'commercial',owner)==learning.read_catalogue(source,'commercial',owner)
    checked=Path('frontend/src/test/myLearningFixtures.json')
    assert fixture_responses()==json.loads(checked.read_text(encoding='utf-8'))
    result['json_parity']='PASS: checked-in contracts and complete large mixed/replacement catalogues'
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-dir',type=Path,required=True)
    parser.add_argument('--repeats',type=int,default=3)
    args=parser.parse_args()
    if not 1<=args.repeats<=10:parser.error('repeats must be between 1 and 10')
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    os.environ['DJANGO_SETTINGS_MODULE']='config.settings_sqlite_test'
    os.environ['DJANGO_USE_SQLITE']='true'
    os.environ['CURRICULUM_WARM']='0'
    from django.conf import settings
    assert all(db['ENGINE']=='django.db.backends.sqlite3' for db in settings.DATABASES.values())
    from django.db.backends.base.base import BaseDatabaseWrapper
    with patch.object(BaseDatabaseWrapper,'ensure_connection',side_effect=ForbiddenIO('Database access prohibited')):
        import django
        django.setup()
        with patch.object(socket.socket,'connect',side_effect=ForbiddenIO('Network access prohibited')):
            print(json.dumps(compare(args.baseline_dir,args.repeats),indent=2))


if __name__=='__main__':main()
