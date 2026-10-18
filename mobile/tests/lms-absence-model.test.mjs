import test from 'node:test';
import assert from 'node:assert/strict';
import {absenceInstant,normaliseAbsenceOptions,absencePayload,checkedAbsenceResult} from '../src/lms-absence-model.mjs';
const now=Date.parse('2026-10-14T09:00:00Z');
const session={authenticated:true,user:{id:'42',accountId:'7',learnerKind:'apprenticeship'}};
const row=(patch={})=>({id:'teams:17-2026-10-16',sessionId:'teams:17',reportId:'17',status:'upcoming',title:'Synthetic session',sessionType:'lecture',dateIso:'2026-10-16',startTime:'10:00',endTime:'11:00',module:'Synthetic module',...patch});
const data=(rows=[],results=[],learner={id:'42',kind:'apprenticeship'})=>({learner,missedSessions:rows,results});
const options=(lectures,meetings=data())=>normaliseAbsenceOptions(lectures,meetings,session,{now});
const target=()=>options(data([row()])).groups.lecture[0];
const draft=(patch={})=>({reasonCategory:'illness',explanation:'',otherReason:'',confirmed:true,recoveryMethod:'recorded',recordingDate:'2026-10-17',recordingTime:'14:30',recordingDurationMinutes:'60',...patch});

test('next absence choices use exact canonical IDs and separate all three session types',()=>{
 const model=options(data([row({id:'later',sessionId:'teams:20',reportId:'20',dateIso:'2026-10-20'}),row()]),data([
  row({id:'coaching',sessionId:'meeting:42:mcr:10',reportId:'-100',sessionType:'mcr'}),
  row({id:'review',sessionId:'meeting:42:progress-review:11',reportId:'-101',sessionType:'progress-review'}),
  row({id:'unsupported',sessionId:'meeting:support:12',reportId:'-102',sessionType:'student-support'})]));
 assert.equal(model.groups.lecture[0].sessionId,'teams:17');assert.equal(model.groups.mcr[0].sessionId,'meeting:42:mcr:10');assert.equal(model.groups['progress-review'][0].reportId,'-101');assert.equal(model.groups.mcr.length,1);
});
test('register mismatches, unsigned-in accounts and staff accounts are rejected',()=>{
 for(const kind of ['commercial','coach'])assert.throws(()=>options(data([] ,[],{id:'42',kind})),/match/);
 assert.throws(()=>options(data([],[],{id:'43',kind:'apprenticeship'})),/match/);
 assert.throws(()=>normaliseAbsenceOptions(data(),data(),{...session,authenticated:false}),/Sign in/);
 assert.throws(()=>normaliseAbsenceOptions(data(),data(),{authenticated:true,user:{id:'42',learnerKind:'coach'}}),/Sign in/);
});
test('commercial learner register works without merging apprenticeship identity',()=>{
 const commercial={authenticated:true,user:{id:42,learnerKind:'commercial'}};
 assert.equal(normaliseAbsenceOptions(data([row()],[],{id:'42',kind:'commercial'}),data([],[],{id:'42',kind:'commercial'}),commercial,{now}).groups.lecture.length,1);
});
test('past, cancelled, attended, undated, already reported and guessed scope rows are not next sessions',()=>{
 const rows=[row({id:'past',dateIso:'2026-10-13'}),row({id:'cancelled',status:'cancelled'}),row({id:'attended',status:'present'}),row({id:'missing-clock',startTime:''}),row({id:'wrong-scope',sessionId:'meeting:x',reportId:'44'}),row()];
 assert.equal(options(data(rows,[{id:1,attendanceId:'17'}])).groups.lecture.length,0);
 assert.equal(options(data(),data([row({sessionType:'mcr'})])).groups.mcr.length,0);
});
test('London summer/winter instants are preserved and nonexistent DST time is refused',()=>{
 assert.equal(absenceInstant('2026-10-16','10:00'),'2026-10-16T09:00:00.000Z');
 assert.equal(absenceInstant('2026-11-16','10:00'),'2026-11-16T10:00:00.000Z');
 assert.equal(absenceInstant('2026-03-29','01:30'),null);assert.equal(absenceInstant('2026-02-30','10:00'),null);
});
test('recording request contains only canonical session fields and learner choice',()=>{
 const payload=absencePayload(target(),draft({status:'approved',learnerId:99}),{now});
 assert.deepEqual(payload,{scope:'lectures',sessionId:'teams:17',sessionTitle:'Synthetic session',sessionDate:'2026-10-16',sessionTime:'10:00',reasonCategory:'illness',otherReason:'',explanation:'',recoveryMethod:'recorded',recordingDate:'2026-10-17',recordingTime:'14:30',recordingDurationMinutes:'60'});
});
test('authored title whitespace is normalised like the canonical save handler',()=>{
 const selected=options(data([row({title:'  Synthetic session  '})])).groups.lecture[0];
 assert.equal(selected.title,'Synthetic session');
 assert.equal(absencePayload(selected,draft(),{now}).sessionTitle,'Synthetic session');
 assert.equal(checkedAbsenceResult({id:2,reference:'AR-0002',attendanceId:'17',sessionDate:'2026-10-16',sessionTitle:'Synthetic session',status:'pending'},selected).statusLabel,'Pending approval');
});
test('meeting requests omit all recovery fields and never autoapprove',()=>{
 const meeting=options(data(),data([row({sessionId:'meeting:42:mcr:10',sessionType:'mcr'})])).groups.mcr[0];
 const payload=absencePayload(meeting,draft(),{now});assert.equal(payload.scope,'meetings');assert(!('recoveryMethod'in payload));assert(!('recordingDate'in payload));assert(!('status'in payload));
});
test('confirmation, valid reason and bounded explanation are required',()=>{
 for(const patch of [{confirmed:false},{reasonCategory:'made-up'},{reasonCategory:'other'},{otherReason:'a'.repeat(121)},{explanation:'a'.repeat(601)}])assert.throws(()=>absencePayload(target(),draft(patch),{now}));
 assert.equal(absencePayload(target(),draft({reasonCategory:'other',otherReason:' Family responsibility '}),{now}).otherReason,'Family responsibility');
});
test('recording plans need an actual future time on or after the lesson with bounded minutes',()=>{
 for(const patch of [{recordingDate:'2026-10-15'},{recordingTime:'25:10'},{recordingDurationMinutes:'14'},{recordingDurationMinutes:'481'},{recordingDurationMinutes:'15.5'},{recordingDate:'invalid'}])assert.throws(()=>absencePayload(target(),draft(patch),{now}));
 assert.throws(()=>absencePayload(target(),draft(),{now:Date.parse('2026-10-17T20:00Z')}),/started/);
});
test('alternatives must be current choices returned for that exact session',()=>{
 const selected={...target(),alternativeSessions:[{id:'eligible-2',title:'Alternative',dateIso:'2026-10-18',startTime:'11:00'}]};
 assert.equal(absencePayload(selected,draft({recoveryMethod:'alternative',targetOccurrenceId:'eligible-2'}),{now}).targetOccurrenceId,'eligible-2');
 assert.throws(()=>absencePayload(selected,draft({recoveryMethod:'alternative',targetOccurrenceId:'another-learner-event'}),{now}),/available/);
 assert.throws(()=>absencePayload(selected,draft({recoveryMethod:'catch-up',catchupPending:'1'}),{now}),/LMS/);
});
test('saved report must match canonical attendance, date and title before showing status',()=>{
 const result={id:2,reference:'AR-0002',attendanceId:'17',sessionDate:'2026-10-16',sessionTitle:'Synthetic session',status:'pending'};
 assert.equal(checkedAbsenceResult(result,target()).statusLabel,'Pending approval');
 assert.equal(checkedAbsenceResult({...result,status:'approved'},target()).statusLabel,'Approved');
 for(const patch of [{attendanceId:'18'},{sessionDate:'2026-10-17'},{sessionTitle:'Other session'},{status:'success'},{reference:'not-an-LMS-report'}])assert.throws(()=>checkedAbsenceResult({...result,...patch},target()),/did not confirm/);
});
