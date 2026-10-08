"""Deterministic synthetic transport measurement; no database or network reads."""
import json
from datetime import date, datetime, timezone
from .attendance_projection import project_register
from .learning_plan_projection import project_journey, journey_response


def measure_payloads():
    from learner_api.attendance import _summarize_attendance
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    register = [{'session_id':f'S{i}', 'session_date':date(2026,10,i % 28 + 1),
        'attendance_status':'absent' if i % 2 else 'present', 'session_title':f'Synthetic lesson {i}',
        'absence_reason':None,'minutes_late':0,'catchup_completed':False,'updated_at':None,
        'learner_email':'learner@example.test','learner_id':201,'learner_name':'Synthetic Learner',
        'session_type':'lecture','module_title':'Synthetic Module','coach_name':'Synthetic Coach'} for i in range(46)]
    old_attendance = {'attendance':_summarize_attendance(register, now=now)}
    new_attendance = project_register(register, {}, now=now)
    detail = {'modules':[], 'week':[], 'components':[], 'quizAttempts':[], 'videoProgress':[], 'componentProgress':[]}
    metadata = {'current_subjects':[]}
    for i in range(18):
        mid, title = f'M{i:02}', f'Module {i:02}'
        detail['modules'].append(title)
        metadata['current_subjects'].append({'id':mid,'title':title})
        for w in range(6):
            detail['week'].append({'moduleId':mid,'module':title,'weekId':f'{mid}-W{w}','week':f'Week {w+1}'})
    for i in range(1473):
        week = detail['week'][i % len(detail['week'])]
        detail['components'].append({**week, 'componentId':f'C{i}', 'component':f'Reading {i}',
            'type':'reading','expectedOtjh':None,'description':None,
            'ksbMappings':[{'code':'K1','weight':1},{'code':'S1','weight':1}],
            'ksbWeightTotal':2,'ksbMappingCount':2,'videoUrl':None,'resourceUrl':None,'contentHtml':None})
    summaries = project_journey(detail, None, metadata, False)
    timeline = {'periodStart':'2026-10','periodEnd':'2027-09','modules':[
        {'id':row['id'],'title':row['title'],'progressPercent':0,'startDate':'2026-10-01',
         'endDate':'2027-09-30','status':'not-started','weekAnchor':'2026-10-02','notes':[]} for row in summaries], 'reviews':[]}
    new_plan = {'timeline':timeline,'journey':journey_response(summaries)}
    subjects = [{'id':row['id'],'title':row['title'],'total':row['componentCount'],'completed':0,
                 'dates':[],'sessionTitles':[],'activityCounts':{'reading':row['componentCount']},'monthlyActivities':{}}
                for row in summaries]
    old_plan = {'detail':detail,'activity':None,'covers':{},'schedule':{'months':{},'actual':[],
        'moduleProgress':{},'modules':[{'id':s['id'],'title':s['title'],'curriculumSlots':[]} for s in summaries],
        'moduleLinks':{},'sessions':[],'reviews':[],'coach':{'name':'Synthetic Coach'},'generatedAt':'2026-10-01T00:00:00Z'},
        'week':{'planSubjects':subjects,'monthlyActivities':{},'deadlines':[]},'hours':{'months':[]}}
    def size(value):
        return len(json.dumps(value, separators=(',',':'),ensure_ascii=False).encode())
    def comparison(before, after):
        old, new = size(before), size(after)
        return {'oldBytes':old,'newBytes':new,'reductionPercent':round((1-new/old)*100,2)}
    selected = project_journey(detail,None,metadata,False,summaries[0]['id'],detail['week'][0]['weekId'])
    return {'attendance':comparison(old_attendance,new_attendance), 'learningPlan':comparison(old_plan,new_plan),
        'moduleBytes':size(journey_response(selected,summaries[0]['id'])),
        'weekBytes':size(journey_response(selected,summaries[0]['id'],detail['week'][0]['weekId']))}
