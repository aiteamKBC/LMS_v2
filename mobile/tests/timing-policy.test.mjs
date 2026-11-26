import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticTimingDecision as decide, transitionAutomaticTiming as transition, buildOtjReviewRecords, IDLE_TIMEOUT_MS } from '../src/timing-policy.mjs';
import { initialState, recordInterval } from '../src/domain.mjs';
const reading = { id:'p1:msp_reading', kind:'reading', journeyKind:'msp_reading', title:'MSP reading', ksbs:['K1','S1'], sourceId:'component-1', weekId:'week-01', pointId:'p1', timeCategory:'learning', released:true };
const options = { activity:reading, surface:'activity', visible:true, nowMs:1_000, lastInteractionMs:0 };
const decision = patch => decide({...options,...patch});

test('all local learning surfaces start automatically without a manual start flag',()=>{
  for (const [kind,surface] of [['msp_reading','activity'],['extended_reading','activity'],['project_controls_reading','activity'],['case_reading','activity'],['poster','activity'],['reading','lesson'],['quiz','quiz'],['practice_quiz','quiz'],['reflection','reflect'],['assignment','assignment']]) {
    assert.equal(decision({activity:{...reading,kind,journeyKind:undefined},surface}).active,true,kind);
  }
  assert.equal(decision({surface:'today'}).active,false);
  assert.equal(decision({contentReady:false}).reason,'content-not-ready');
  assert.equal(decision({activity:{...reading,released:false}}).active,false);
});

test('idle threshold pauses automatically and actual interaction or return to visibility resumes',()=>{
  assert.equal(decision({nowMs:IDLE_TIMEOUT_MS-1}).active,true);
  assert.equal(decision({nowMs:IDLE_TIMEOUT_MS}).reason,'idle');
  let state=transition({}, {type:'activity',activityId:reading.id,nowMs:0});
  state=transition(state,{type:'visibility',visible:true,nowMs:200_000});
  assert.equal(decision({...state,nowMs:200_001}).active,true);
  state=transition(state,{type:'interaction',nowMs:400_000});
  assert.equal(decision({...state,nowMs:400_001}).active,true);
});

test('an explicit pause survives interaction, permission dismissal and visibility until resume or activity change',()=>{
  let state=transition({}, {type:'activity',activityId:reading.id,nowMs:0});
  state=transition(state,{type:'pause'});
  for (const event of [{type:'interaction',nowMs:100},{type:'visibility',visible:true,nowMs:100},{type:'permission',pending:false,nowMs:100}]) {
    state=transition(state,event);
    assert.equal(decision({...state}).reason,'manually-paused');
  }
  state=transition(state,{type:'resume',nowMs:500});
  assert.equal(decision({...state}).active,true);
  state=transition(state,{type:'pause'});
  state=transition(state,{type:'activity',activityId:'p2:reading',nowMs:700});
  state=transition(state,{type:'activity',activityId:reading.id,nowMs:900});
  assert.equal(state.manualPausedActivityId,null);
  assert.equal(decision({...state}).active,true);
});

test('official quizzes, live-session handoffs and portals do not count a waiting screen',()=>{
  for (const kind of ['msp_quiz','extended_quiz','case_quiz','live_session','official_quiz','external']) {
    const result=decision({activity:{...reading,kind:'reading',journeyKind:kind},playing:true,mediaPositionSeconds:8,isTTS:true});
    assert.equal(result.active,false);assert.equal(result.source,'lms');
  }
  assert.equal(decision({surface:'portal'}).source,'lms');
});

test('media counts confirmed playback only; hidden playback requires an explicit audio allowance',()=>{
  const activity={...reading,kind:'listening',journeyKind:'cartoon'};
  const playing={activity,playing:true,mediaPositionSeconds:8,nowMs:500_000};
  assert.equal(decision(playing).active,true);
  assert.equal(decision({...playing,buffering:true}).active,false);
  assert.equal(decision({...playing,playing:false}).active,false);
  assert.equal(decision({...playing,mediaPositionSeconds:undefined}).active,false);
  assert.equal(decision({...playing,visible:false}).active,false);
  assert.equal(decision({...playing,visible:false,allowBackgroundPlayback:true}).active,true);
});

test('confirmed read-aloud and microphone capture avoid idle timeout but never count permission waiting',()=>{
  assert.equal(decision({isTTS:true,nowMs:500_000}).active,true);
  assert.equal(decision({isDictating:true,nowMs:500_000}).active,true);
  for (const patch of [{isTTS:true},{isDictating:true},{playing:true,mediaPositionSeconds:8,activity:{...reading,kind:'listening',journeyKind:undefined}}]) {
    assert.equal(decision({...patch,permissionPending:true}).reason,'permission-pending');
    assert.equal(decision({...patch,visible:false}).active,false);
  }
});

test('unknown activities, invalid clocks and missing interaction timestamps do not start',()=>{
  assert.equal(decision({activity:{id:'new',kind:'unknown'}}).active,false);
  assert.equal(decision({activity:undefined}).source,'none');
  assert.equal(decision({nowMs:NaN}).active,false);
  assert.equal(decision({lastInteractionMs:undefined}).active,false);
  assert.equal(decision({lastInteractionMs:2000}).active,false);
});

test('saved inactive observations prevent auto-resume bridging a short pause or hidden interval',()=>{
  let state=initialState();
  const tick=(nowMs,patch={})=>{
    const choice=decision({nowMs,...patch});
    const result=recordInterval(state,{...choice,activityId:reading.id,sessionId:'s1',clockId:'c1',monotonicMs:nowMs,visible:patch.visible??true});
    state=result.state; return result.creditedSeconds;
  };
  assert.equal(tick(0),0);
  assert.equal(tick(1000),1);
  assert.equal(tick(2000,{visible:false}),0);
  assert.equal(tick(3000),0);
  assert.equal(tick(4000),1);
  assert.equal(state.activity[reading.id].seconds,2);
});

const session = {activityId:reading.id,kind:'reading',startedAt:'2026-09-30T09:00:00.000Z',lastObservedAt:'2026-09-30T09:01:30.000Z',seconds:60.25};
const exportRows = (sessions={one:session},activities=[reading]) => buildOtjReviewRecords({sessions,activities,moduleId:'module-local',nativeModuleId:'module-native'});

test('OTJ review export preserves measured seconds, dated sessions and all supplied mapping without approving hours',()=>{
  const [row]=exportRows();
  assert.equal(row.actualSeconds,60.25);
  assert.equal(row.startedAt,session.startedAt);assert.equal(row.lastObservedAt,session.lastObservedAt);
  assert.equal(row.localStartDate,'2026-09-30');assert.equal(row.localEndDate,'2026-09-30');
  assert.deepEqual(row.ksbs,['K1','S1']);assert.equal(row.sourceComponentId,'component-1');
  assert.equal(row.moduleId,'module-local');assert.equal(row.nativeModuleId,'module-native');
  assert.equal(row.timeCategory,'learning');assert.equal(row.readyForReview,true);
  assert.equal(row.approvedEligibleSeconds,null);assert.equal(row.official,false);assert.equal(row.competent,false);
  assert.equal(row.mappingProvenance,'current-catalogue');
  assert.equal(exportRows().length,1); // Not one duplicate time row for each KSB.
});

test('unknown sessions preserve evidence but remain unmapped, and corrupt or zero seconds are omitted',()=>{
  const rows=exportRows({unknown:{...session,activityId:'unmapped'},zero:{...session,seconds:0},bad:{...session,seconds:NaN},negative:{...session,seconds:-1}});
  assert.equal(rows.length,1);
  assert.equal(rows[0].actualSeconds,60.25);
  assert.equal(rows[0].activityMapped,false);assert.equal(rows[0].mappingComplete,false);assert.equal(rows[0].readyForReview,false);
  assert.deepEqual(rows[0].ksbs,[]);assert.equal(rows[0].sourceComponentId,null);assert.equal(rows[0].timeCategory,'unknown');
});

test('assessment time remains separate from learning and planned time never replaces observed seconds',()=>{
  const assignment={...reading,id:'assignment:1',kind:'assignment',journeyKind:undefined,timeCategory:undefined,plannedMinutes:180,ksbs:['S1']};
  const [row]=exportRows({one:{...session,activityId:assignment.id}},[assignment]);
  assert.equal(row.timeCategory,'assessment');assert.equal(row.actualSeconds,60.25);assert.equal(row.approvedEligibleSeconds,null);
  const quiz={...assignment,kind:'quiz'};
  assert.equal(exportRows({one:{...session,activityId:quiz.id}},[quiz])[0].timeCategory,'assessment');
});

test('session snapshots preserve historical mapping and never fall back after an invalid snapshot identity',()=>{
  const snapshot={...reading,moduleId:'original',sourceId:'original-source',ksbs:['K2']};
  const [row]=exportRows({one:{...session,activityMetadata:snapshot}},[{...reading,ksbs:['K99'],sourceId:'changed'}]);
  assert.equal(row.moduleId,'original');assert.equal(row.sourceComponentId,'original-source');assert.deepEqual(row.ksbs,['K2']);
  assert.equal(row.mappingProvenance,'session-snapshot');
  const [invalid]=exportRows({one:{...session,activityMetadata:{...snapshot,id:'another-activity'}}});
  assert.equal(invalid.activityMapped,false);assert.equal(invalid.readyForReview,false);assert.deepEqual(invalid.ksbs,[]);
});

test('invalid or implausible date spans retain measured rows but cannot be marked ready for review',()=>{
  for (const patch of [{startedAt:'not-a-date'},{lastObservedAt:'2026-09-30T08:00:00Z'},{seconds:3600}]) {
    const [row]=exportRows({one:{...session,...patch}});
    assert.equal(row.readyForReview,false);assert.equal(row.approvedEligibleSeconds,null);
  }
  const [overnight]=exportRows({one:{...session,startedAt:'2026-09-30T22:59:30Z',lastObservedAt:'2026-09-30T23:01:00Z'}});
  assert.equal(overnight.localStartDate,'2026-09-30');assert.equal(overnight.localEndDate,'2026-10-01');
});

test('policy and export helpers leave supplied state, activity and sessions unchanged',()=>{
  const state={activityId:reading.id,lastInteractionMs:0},sessions={one:{...session,activityMetadata:{...reading}}};
  const before=JSON.stringify({state,reading,sessions});
  transition(state,{type:'pause'});decision({activity:reading});exportRows(sessions);
  assert.equal(JSON.stringify({state,reading,sessions}),before);
});
