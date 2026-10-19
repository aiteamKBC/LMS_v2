import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMeetingNotificationPlan as plan,meetingNotificationDiff as diff,ownsMeetingNotification,londonNine,nextLondonReminder} from '../src/meeting-notification-plan.mjs';
const now=Date.parse('2026-10-01T08:00:00Z');
const reminder=(patch={})=>({id:'coaching:2026-10',type:'coaching',status:'upcoming',dueAt:'2026-10-21T08:00:00Z',...patch});
const make=(reminders,other={})=>plan({userId:'learner-a',reminders,now,...other});
test('uses server eligibility and preserves stable user-scoped identifiers',()=>{
 const reminders=[reminder()];assert.deepEqual(make(reminders),make(reminders));assert.equal(make(reminders).length,1);
 const a=make(reminders)[0],b=make(reminders,{userId:'learner-b'})[0];assert.notEqual(a.identifier,b.identifier);
 assert(ownsMeetingNotification(a,'learner-a'));assert(!ownsMeetingNotification(b,'learner-a'));
 assert.equal(make([reminder({status:'closed'})]).length,0);
 assert.equal(make([reminder({dueAt:'bad'})]).length,0);
 assert.equal(make([reminder({type:'safeguarding'})]).length,0);
});
test('reconciliation cancels only this learners obsolete meeting notifications',()=>{
 const old=make([reminder()])[0],other=make([reminder()],{userId:'learner-b'})[0];
 assert.deepEqual(diff([old,other,{identifier:'other-feature-notification'}],[],'learner-a'),{cancel:[old.identifier],schedule:[]});
 assert.deepEqual(diff([old],[old],'learner-a'),{cancel:[],schedule:[]});
 const moved=make([reminder({dueAt:'2026-10-22T08:00:00Z'})])[0];const result=diff([old],[moved],'learner-a');assert.deepEqual(result.cancel,[old.identifier]);assert.deepEqual(result.schedule,[moved]);
});
test('recording reminders are bounded and stop at exactly twenty percent',()=>{
 const recording=reminder({id:'recording:event-1',type:'recording',eventId:'event-1',recording:{watchedFraction:.199}});
 const result=make([recording]);assert.equal(result.length,4);
 assert.deepEqual(result.map(x=>x.date),['2026-10-21T08:00:00.000Z','2026-10-23T08:00:00.000Z','2026-10-26T09:00:00.000Z','2026-10-29T09:00:00.000Z']);
 assert.equal(make([{...recording,recording:{watchedFraction:.2}}]).length,0);
 assert.equal(make([{...recording,recording:{closed:true}}]).length,0);
});
test('past due booking reminders use next London nine instead of immediate retroactive spam',()=>{
 const result=make([reminder({status:'active',dueAt:'2026-10-01T08:00:00Z'})]);assert.equal(result[0].date,'2026-10-02T08:00:00.000Z');
 assert.equal(make([reminder({status:'active',dueAt:'2026-09-21T08:00:00Z'})]).length,0);
 assert.equal(make([reminder({type:'catchup',dueAt:'2026-09-21T08:00:00Z'})]).length,1);
 assert.equal(make([reminder({type:'appointment',dueAt:'2026-09-30T08:00:00Z'})]).length,0);
 assert.equal(nextLondonReminder(Date.parse('2026-10-25T08:00:00Z')).toISOString(),'2026-10-25T09:00:00.000Z');
});
test('London scheduling handles daylight saving in both directions',()=>{
 assert.equal(londonNine(2026,3,28).toISOString(),'2026-03-28T09:00:00.000Z');
 assert.equal(londonNine(2026,3,29).toISOString(),'2026-03-29T08:00:00.000Z');
 assert.equal(londonNine(2026,10,25).toISOString(),'2026-10-25T09:00:00.000Z');
});
test('lock screen content never includes personal, sensitive or server-supplied text',()=>{
 const r=make([reminder({title:'Safeguarding appointment for Student Name',body:'Private complaint details',eventId:'event-2'})])[0];
 assert.equal(r.title,'KBC Learn');assert(!/safeguarding|complaint|Student Name|Private/i.test(r.body));assert.equal(r.data.eventId,'event-2');assert.equal(r.data.screen,'meetings');
});
test('notifications are deduplicated, bounded and stop at the future horizon',()=>{
 assert.equal(make([reminder(),reminder()]).length,1);
 const many=Array.from({length:100},(_,i)=>reminder({id:'r-'+i}));assert.equal(make(many).length,48);
 assert.equal(make([reminder({dueAt:'2027-10-21T08:00:00Z'})]).length,0);
 assert.equal(plan({userId:null,reminders:[reminder()],now}).length,0);
});
