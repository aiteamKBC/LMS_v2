import test from 'node:test';
import assert from 'node:assert/strict';
import {lmsActivityDraftKey,validLmsTimingSession,readLmsActivityDraft,createLmsActivityMeter,observeLmsActivity,confirmedLmsActivityResult,LMS_TIMING_MAX_AGE} from '../src/lms-activity-state.mjs';
const now=Date.parse('2026-10-05T10:00:00Z');
const session={authenticated:true,user:{id:'42',accountId:'7',learnerKind:'apprenticeship'}};
const audio={id:'COMP-1',mode:'audio'},quiz={id:'COMP-Q',mode:'quiz'};
const timing=(activity=audio,patch={})=>({componentId:activity.id,activityId:activity.mode==='quiz'?'12':activity.id,activityKind:activity.mode==='quiz'?'quiz':activity.mode==='video'?'video':'component',countingMode:activity.mode==='quiz'?'active_quiz':'active_playback',trackingToken:'signed-learning-token',sessionId:'session-1',startedAt:new Date(now).toISOString(),...patch});
const observe=(meter,ms,patch={})=>observeLmsActivity(meter,{activity:audio,timing:timing(),nowMs:ms,wallNow:now+ms,lastInteractionMs:0,signal:{playing:true,buffering:false,positionSeconds:ms/1000,playbackRate:1},...patch});
test('drafts are isolated by LMS account, learner kind, learner ID and component',()=>{
 const base=lmsActivityDraftKey(session,audio);for(const user of [{...session.user,accountId:'8'},{...session.user,id:'43'},{...session.user,learnerKind:'commercial'}])assert.notEqual(lmsActivityDraftKey({...session,user},audio),base);
 assert.notEqual(lmsActivityDraftKey(session,quiz),base);assert.throws(()=>lmsActivityDraftKey({authenticated:false},audio));
});
test('signed timer must belong to the exact component and activity mode and be unexpired',()=>{
 assert(validLmsTimingSession(timing(),audio,now));
 for(const patch of [{componentId:'OTHER'},{activityId:'OTHER'},{activityKind:'video'},{countingMode:'visible_page'},{trackingToken:''},{sessionId:''},{startedAt:'bad'},{startedAt:new Date(now+120000).toISOString()}])assert.equal(validLmsTimingSession(timing(audio,patch),audio,now),false);
 assert.equal(validLmsTimingSession(timing(),audio,now+LMS_TIMING_MAX_AGE),false);
});
test('draft restoration keeps selected data only in the matching identity and rejects corrupt durations',()=>{
 const key=lmsActivityDraftKey(session,audio),value={version:1,ownerKey:key,componentId:audio.id,mode:'audio',timing:timing(),seconds:30,feedback:'A useful idea'};
 assert.equal(readLmsActivityDraft(JSON.stringify(value),key,audio).seconds,30);
 for(const patch of [{ownerKey:'different'},{componentId:'OTHER'},{mode:'quiz'},{seconds:-1},{seconds:'30'},{seconds:86401},{timing:null}])assert.equal(readLmsActivityDraft(JSON.stringify({...value,...patch}),key,audio),null);
});
test('only actual continuous audio playback accumulates; hidden audio is allowed and double observations do not count',()=>{
 let m=createLmsActivityMeter();m=observe(m,0);m=observe(m,1000,{visible:false});assert.equal(m.seconds,1);m=observe(m,1000);assert.equal(m.seconds,1);m=observe(m,2000);assert.equal(m.seconds,2);
 assert.equal(m.state.ledger&&Object.keys(m.state.ledger).length,0);assert.equal(m.state.activity[audio.id].completed,false);
});
test('buffering, pause, seek and long suspended gaps earn no time',()=>{
 let m=observe(createLmsActivityMeter(),0);m=observe(m,1000);assert.equal(m.seconds,1);
 m=observe(m,2000,{signal:{playing:true,buffering:true,positionSeconds:1}});m=observe(m,3000);assert.equal(m.seconds,1);
 m=observe(m,4000,{signal:{playing:true,buffering:false,positionSeconds:50}});assert.equal(m.seconds,1);
 m=observe(m,100000,{signal:{playing:true,buffering:false,positionSeconds:146}});assert.equal(m.seconds,1);
 m=observe(m,101000,{paused:true,signal:{playing:true,buffering:false,positionSeconds:147}});assert.equal(m.seconds,1);
});
test('playback-rate changes do not inflate measured wall time',()=>{
 let m=observe(createLmsActivityMeter(),0,{signal:{playing:true,positionSeconds:0,playbackRate:2}});
 m=observe(m,1000,{signal:{playing:true,positionSeconds:2,playbackRate:2}});assert.equal(m.seconds,1);
 m=observe(m,2000,{signal:{playing:true,positionSeconds:3,playbackRate:1}});assert.equal(m.seconds,1);
});
test('short observed offsets follow the monotonic clock without wall-clock jump inflation',()=>{
 let m=observe(createLmsActivityMeter(),0);assert.equal(m.measuredInterval,null);
 m=observe(m,1000);assert.deepEqual(m.measuredInterval,{startOffsetMs:0,endOffsetMs:1000});
 m=observe(m,2000,{wallNow:now+120000});assert.deepEqual(m.measuredInterval,{startOffsetMs:1000,endOffsetMs:2000});
 m=observe(m,3000,{paused:true});assert.equal(m.measuredInterval,null);
 m=observe(m,4000);assert.equal(m.measuredInterval,null);m=observe(m,5000);assert.deepEqual(m.measuredInterval,{startOffsetMs:4000,endOffsetMs:5000});
});
test('video pauses in background while quiz pauses for idle, permission or leaving screen',()=>{
 const video={...audio,mode:'video'};let m=createLmsActivityMeter();m=observe(m,0,{activity:video,timing:timing(video)});m=observe(m,1000,{activity:video,timing:timing(video),visible:false});assert.equal(m.seconds,0);
 const tick=(state,ms,patch={})=>observeLmsActivity(state,{activity:quiz,timing:timing(quiz),nowMs:ms,wallNow:now+ms,lastInteractionMs:0,visible:true,...patch});
 m=tick(createLmsActivityMeter(),0);m=tick(m,1000);assert.equal(m.seconds,1);
 m=tick(m,2000,{permissionPending:true});m=tick(m,3000);m=tick(m,4000,{visible:false});m=tick(m,180001);assert.equal(m.seconds,1);assert.equal(m.decision.reason,'idle');
});
test('restored duration survives without bridging closed-app elapsed time',()=>{
 let m=observe(createLmsActivityMeter(50),0);assert.equal(m.seconds,50);m=observe(m,1000);assert.equal(m.seconds,51);
 m=observe(m,100000);assert.equal(m.seconds,51);
});
test('no activity time accrues after signed session expiry',()=>{
 let m=observe(createLmsActivityMeter(),0);m=observe(m,1000,{wallNow:now+LMS_TIMING_MAX_AGE});assert.equal(m.seconds,0);assert.equal(m.decision.reason,'content-not-ready');
});
const mediaResult=(patch={})=>({record:{kind:'component',componentId:'COMP-1',timeTrackingSessionId:'session-1',submittedAt:new Date(now+60000).toISOString(),verifiedSeconds:30,...patch}});
test('completion confirmation requires actual matching LMS record, session and duration',()=>{
 const result=confirmedLmsActivityResult(mediaResult(),audio,timing(),{submittedSeconds:30});assert.equal(result.verifiedSeconds,30);
 for(const patch of [{componentId:'OTHER'},{timeTrackingSessionId:'another'},{kind:'video'},{verifiedSeconds:60},{submittedAt:null}])assert.throws(()=>confirmedLmsActivityResult(mediaResult(patch),audio,timing(),{submittedSeconds:30}));
 assert.throws(()=>confirmedLmsActivityResult({ok:true},audio,timing(),{submittedSeconds:30}));
});
test('coach validation is preserved instead of reporting final accepted completion',()=>{
 assert.equal(confirmedLmsActivityResult({...mediaResult(),awaitingCoachValidation:true},audio,timing(),{submittedSeconds:30}).awaitingCoachValidation,true);
});
test('quiz confirmation uses server grade and canonical quiz ID, never native answer positions',()=>{
 const response={attempt:{kind:'quiz',quizId:12,timeTrackingSessionId:'session-1',submittedAt:new Date(now+60000).toISOString(),verifiedSeconds:30},grade:.8,achievedScore:4,totalScore:5,passed:true,breakdown:[]};
 assert.equal(confirmedLmsActivityResult(response,quiz,timing(quiz),{quizId:12,submittedSeconds:30}).grade,.8);
 assert.throws(()=>confirmedLmsActivityResult(response,quiz,timing(quiz),{quizId:13,submittedSeconds:30}));
 assert.throws(()=>confirmedLmsActivityResult({...response,grade:80},quiz,timing(quiz),{quizId:12,submittedSeconds:30}));
});
