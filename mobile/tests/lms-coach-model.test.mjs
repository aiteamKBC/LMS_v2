import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/lms-coach-model.mjs';
import * as fixture from './lms-coach-fixtures.mjs';

test('coach payloads require the authenticated coach and exact selected profile',()=>{
 assert.equal(model.coachAccount(fixture.session),'7');
 for(const session of [{},{...fixture.session,communications:{role:'learner',accountId:'7'}},{...fixture.session,communications:{role:'coach',accountId:'8'}}])assert.throws(()=>model.coachAccount(session));
 for(const patch of [{coachAccountId:'8'},{source:'local'},{readOnly:false},{learner:fixture.learner('12')}])assert.throws(()=>model.normaliseCoachDetail({...fixture.detail(),...patch},'7','11'));
});
test('roster preserves zero versus missing hours and merges pages using canonical profile IDs',()=>{
 const first=model.normaliseCoachRoster({...fixture.roster(),nextBefore:'10'},'7');
 assert.equal(first.learners[0].hours.acceptedOtjhHours,0);assert.equal(first.learners[1].hours.acceptedOtjhHours,null);
 assert.equal(model.formatCoachHours(null),'Unavailable');assert.equal(model.formatCoachHours(0),'0 h');
 const second=model.normaliseCoachRoster({...fixture.envelope(),learners:[fixture.learner('11'),fixture.learner('9')],nextBefore:null},'7');
 assert.deepEqual(model.mergeCoachRoster(first,second).learners.map(x=>x.profileId),['11','12','9']);
 assert.throws(()=>model.normaliseCoachRoster({...fixture.roster(),learners:[fixture.learner(),fixture.learner()]},'7'));
 assert.throws(()=>model.normaliseCoachRoster({...fixture.roster(),nextBefore:'11&accountId=8'},'7'));
});
test('recorded programme performance and canonical points retain their own scope and identity',()=>{
 const value=model.normaliseCoachDetail(fixture.detail(),'7','11');assert.equal(value.performance.quizAttempts,1);assert.equal(value.points.balance,80);assert.equal(value.hours.recordedLearningHours,3.5);
 assert.throws(()=>model.normaliseCoachDetail({...fixture.detail(),performance:{...fixture.detail().performance,scope:'all-assigned-curriculum'}},'7','11'));
 assert.throws(()=>model.normaliseCoachDetail({...fixture.detail(),points:{...fixture.detail().points,learnerId:'112'}},'7','11'));
 assert.throws(()=>model.normaliseCoachDetail({...fixture.detail(),points:{...fixture.detail().points,balance:999}},'7','11'));
 const missing=model.normaliseCoachDetail({...fixture.detail(),hours:null,points:null,sharedRewards:null},'7','11');assert.equal(missing.points,null);assert.equal(missing.hours.acceptedOtjhHours,null);
});
test('coach leaderboard cannot reveal entries for a learner who has not opted in',()=>{
 const raw=fixture.detail();raw.sharedRewards.leaderboard.optedIn=false;assert.throws(()=>model.normaliseCoachDetail(raw,'7','11'));
 raw.sharedRewards.leaderboard.entries=[];assert.deepEqual(model.normaliseCoachDetail(raw,'7','11').leaderboard,{optedIn:false,entries:[]});
});
test('coach catalogue preserves all assigned course IDs and safe media filtering',()=>{
 const value=model.normaliseCoachCatalogue(fixture.catalogue(),'7','11');assert.deepEqual(value.map(x=>x.moduleId),['MOD-A','MOD-B']);assert.equal(value[0].activities.length,3);assert.equal(value[0].activities[0].url,fixture.catalogue().components[0].audioUrl);
 const raw=fixture.catalogue();raw.components[0].audioUrl='javascript:alert(1)';assert.equal(model.normaliseCoachCatalogue(raw,'7','11')[0].activities[0].available,false);
 assert.throws(()=>model.normaliseCoachCatalogue(fixture.catalogue('12'),'7','11'));
});
test('course results reject a different course and calculate scores only from canonical achieved and total',()=>{
 const value=model.normaliseCoachProgress(fixture.progress(),'7','11','MOD-A');assert.equal(value.quizAttempts[0].score,0.75);assert.equal(value.hours.moduleSubmittedSeconds,3600);
 assert.throws(()=>model.normaliseCoachProgress(fixture.progress(),'7','11','MOD-B'));
 const raw=fixture.progress();delete raw.quizAttempts[0].achievedScore;assert.equal(model.normaliseCoachProgress(raw,'7','11','MOD-A').quizAttempts[0].score,null);
 raw.mobileMeasuredTime.moduleId='MOD-B';assert.equal(model.normaliseCoachProgress(raw,'7','11','MOD-A').hours,null);
});
test('coach-only answer key maps canonical IDs to current labels without changing learner quiz behavior',()=>{
 const raw=fixture.quiz();raw.questions[0].explanation='Synthetic explanation.';
 const activity={id:'A-QUIZ',moduleId:'MOD-A'},value=model.normaliseCoachQuiz(raw,'7','11',activity);
 assert.deepEqual(value.questions[0].correctOptionIds,['F']);assert.equal(value.questions[0].explanation,'Synthetic explanation.');
 delete raw.questions[0].answers[0].isCorrect;assert.equal(model.normaliseCoachQuiz(raw,'7','11',activity).questions[0].correctOptionIds,null);
 assert.throws(()=>model.normaliseCoachQuiz(raw,'8','11',activity));assert.throws(()=>model.normaliseCoachQuiz(raw,'7','12',activity));
});
test('profile relinking cannot mix enrolment or learner kind across coach responses',()=>{
 const expected=fixture.learner();
 for(const patch of [{learnerId:'999'},{learnerKind:'commercial'}]){
  const changed=value=>({...value,learner:{...value.learner,...patch}});
  assert.throws(()=>model.normaliseCoachDetail(changed(fixture.detail()),'7','11',expected),/identity changed/);
  assert.throws(()=>model.normaliseCoachCatalogue(changed(fixture.catalogue()),'7','11',expected),/identity changed/);
  assert.throws(()=>model.normaliseCoachProgress(changed(fixture.progress()),'7','11','MOD-A',expected),/identity changed/);
  assert.throws(()=>model.normaliseCoachQuiz(changed(fixture.quiz()),'7','11',{id:'A-QUIZ',moduleId:'MOD-A'},expected),/identity changed/);
  assert.throws(()=>model.checkedCoachPayload(changed({...fixture.envelope(),transcript:'Foreign transcript'}),'7','11',expected),/identity changed/);
 }
});
