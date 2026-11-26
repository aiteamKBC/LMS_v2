import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLmsMeetings as normalize,lmsMeetingJoinUrl as join,LMS_MEETING_LINKS} from '../src/lms-meetings-model.mjs';
import {buildMeetingNotificationPlan} from '../src/meeting-notification-plan.mjs';
const session={authenticated:true,user:{id:'42',accountId:'7',learnerKind:'apprenticeship'}};
const now=Date.parse('2026-10-05T12:00:00Z');
const event=(patch={})=>({eventKey:'live:one',title:'Stakeholder Management and Reporting',source:'live-session',type:'live-session',status:'scheduled',scheduledDate:'2026-10-06',scheduledTime:'18:30',durationMinutes:120,meetingLink:'https://teams.microsoft.com/l/meetup-join/example',...patch});
const run=(events,other={})=>normalize({learner:{id:42,kind:'apprenticeship'},events},session,{now,...other});

test('calendar identity must match the active LMS learner, including kind',()=>{
 assert.throws(()=>normalize({learner:{id:43,kind:'apprenticeship'},events:[]},session),/match/);
 assert.throws(()=>normalize({learner:{id:42,kind:'commercial'},events:[]},session),/match/);
 assert.throws(()=>normalize({learner:{id:42,kind:'apprenticeship'}},session),/match/);
 assert.throws(()=>normalize({},null),/Sign in/);
});
test('LMS appointments retain canonical identity, London time and duration',()=>{
 const a=run([event()]);assert.equal(a.events[0].id,'live:one');assert.equal(a.nextEvent.startsAt,'2026-10-06T17:30:00.000Z');assert.equal(a.nextEvent.endsAt,'2026-10-06T19:30:00.000Z');
 assert.equal(a.reminders[0].dueAt,'2026-10-06T17:15:00.000Z');assert.equal(a.events[0].status,'confirmed');
});
test('unbooked target dates and estimated times never become scheduled sessions',()=>{
 const a=run([event({status:'not-scheduled',scheduledDate:null,scheduledTime:null,date:'2026-10-20',targetDate:'2026-10-20'}),event({eventKey:'estimated',isTimeEstimated:true})]);
 assert.equal(a.upcoming.length,0);assert.equal(a.reminders.length,0);assert.equal(a.nextEvent,null);assert.equal(a.pending.length,2);assert.equal(a.events[0].joinUrl,null);
});
test('future meetings with missing or malformed actual duration remain pending',()=>{
 for(const patch of [{durationMinutes:null},{durationMinutes:-1},{durationMinutes:Infinity},{scheduledDate:'2026-02-30'},{scheduledTime:'25:30'}]){const a=run([event(patch)]);assert.equal(a.nextEvent,null);assert.equal(a.events[0].status,'pending');}
});
test('London timezone observes DST and refuses nonexistent spring clock time',()=>{
 assert.equal(run([event({scheduledDate:'2026-10-26'})]).nextEvent.startsAt,'2026-10-26T18:30:00.000Z');
 const gap=run([event({scheduledDate:'2027-03-28',scheduledTime:'01:30'})]);assert.equal(gap.nextEvent,null);assert.equal(gap.events[0].startsAt,null);
});
test('known Teams links and exact first-party protected joins are allowed; deceptive URLs are not',()=>{
 assert(join('https://teams.microsoft.com/l/meetup-join/example'));
 assert(join('/learner_api/session-results/apprenticeship/42/series-1/sessions/1/join/'));
 for(const bad of ['javascript:alert(1)','http://teams.microsoft.com/a','https://teams.microsoft.com.evil.invalid/a','https://user:password@teams.microsoft.com/a','https://teams.microsoft.com:8443/a','https://elsewhere.invalid/a','https://lms.kentbusinesscollege.org/login',' https://teams.microsoft.com/a'])assert.equal(join(bad),null,bad);
});
test('LMS cancellations and actual outcomes override scheduled status and revoke joining',()=>{
 const a=run([event({eventKey:'cancel',status:'cancelled'}),event({eventKey:'done',meetingOutcome:'completed'}),event({eventKey:'ended',meetingOutcome:'ended'}),event({eventKey:'old',scheduledDate:'2026-10-01'})]);
 assert.equal(a.upcoming.length,0);assert.equal(a.reminders.length,0);assert.equal(a.past.length,4);assert(a.events.every(e=>e.joinUrl===null));
 assert.equal(a.events.find(e=>e.id==='done').status,'completed');
});
test('calendar sync warnings survive but raw diagnostic/private fields never reach the display projection',()=>{
 const raw=event({syncState:'failed',syncError:'provider diagnostic',coachEmail:'private@example.test',notes:'private notes',reviewResponses:{sensitive:'x'}});
 const a=run([raw]);assert.match(a.events[0].warning,/invitation needs attention/);assert(!JSON.stringify(a).includes('private'));assert(!JSON.stringify(a).includes('provider diagnostic'));
});
test('future support appointments do not displace next class or appear on lock-screen reminders',()=>{
 const a=run([event({eventKey:'support',source:'student-support',scheduledDate:'2026-10-05',scheduledTime:'15:00'}),event()]);
 assert.equal(a.nextEvent.id,'live:one');assert.equal(a.reminders.length,1);assert.equal(a.upcoming.length,2);
});
test('canonical module scoping preserves coaching and never guesses from display title',()=>{
 const a=run([event({eventKey:'correct',moduleId:'MOD-KBC-PMP-M01-SMR'}),event({eventKey:'other',moduleId:'MOD-OTHER'}),event({eventKey:'no-id',module:'A different title'}),event({eventKey:'coach',source:'mcr'})],{moduleId:'MOD-KBC-PMP-M01-SMR'});
 assert.deepEqual(new Set(a.events.map(x=>x.id)),new Set(['correct','no-id','coach']));
});
test('stable event IDs deduplicate results and notification plan refresh cancels rescheduled times',()=>{
 const a=run([event(),event()]);assert.equal(a.events.length,1);
 const plan=buildMeetingNotificationPlan({userId:'lms:7:apprenticeship:42',reminders:a.reminders,now});assert.equal(plan.length,1);assert(!plan[0].body.includes('Stakeholder'));
 const later=run([event({scheduledDate:'2026-10-07'})]);const next=buildMeetingNotificationPlan({userId:'lms:7:apprenticeship:42',reminders:later.reminders,now});assert.notEqual(plan[0].identifier,next[0].identifier);
});
test('missed reminder time does not invent a new one or infer watching/attendance',()=>{
 const a=run([event({scheduledDate:'2026-10-05',scheduledTime:'13:05'})]);assert.equal(a.nextEvent.id,'live:one');assert.equal(a.reminders.length,0);assert.equal(a.events[0].watchedRecording,false);
 assert.equal(a.events[0].recordingUrl,LMS_MEETING_LINKS.recordings);
});
test('a review awaiting signature cannot be offered as a new booking or a meeting to join',()=>{
 const a=run([event({source:'review',status:'awaiting-signature'}),event({eventKey:'other',status:'provider-new-state'})]);
 assert.equal(a.pending.length,0);assert.equal(a.nextEvent,null);assert.equal(a.attention.length,2);assert.equal(a.events[0].joinUrl,null);
 assert.equal(a.events.find(e=>e.id==='live:one').status,'awaiting-signature');
});
