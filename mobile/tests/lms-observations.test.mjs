import test from 'node:test';
import assert from 'node:assert/strict';
import {newLmsObservations,readLmsObservations,appendLmsObservation,prepareLmsObservationEvent,confirmLmsObservationEvent} from '../src/lms-observations.mjs';
const chunk=(start,end)=>({startOffsetMs:start,endOffsetMs:end});
const receipt=(state,patch={})=>({source:'lms',eventId:state.inFlight.eventId,sessionId:state.sessionId,sequence:state.nextSequence,status:'pending',observedMilliseconds:state.inFlight.intervals.reduce((n,x)=>n+x.endOffsetMs-x.startOffsetMs,0),cumulativeObservedMilliseconds:state.acknowledgedMilliseconds+state.inFlight.intervals.reduce((n,x)=>n+x.endOffsetMs-x.startOffsetMs,0),duplicate:false,...patch});
test('short intervals merge only across contiguous actual activity and never paused gaps',()=>{
 let state=newLmsObservations('session-1');for(const i of [chunk(0,1000),chunk(1000,3000),chunk(8000,10000)])state=appendLmsObservation(state,i);
 assert.deepEqual(state.pending,[chunk(0,3000),chunk(8000,10000)]);
 for(const bad of [chunk(2000,4000),chunk(10000,20000),chunk(-1,200),chunk(11000.5,11500)])assert.equal(appendLmsObservation(state,bad),state);
});
test('ambiguous retries preserve the exact frozen payload while new activity stays queued',()=>{
 let state=prepareLmsObservationEvent(appendLmsObservation(newLmsObservations('s-1'),chunk(0,1000)));
 const body=JSON.stringify(state.inFlight);state=appendLmsObservation(state,chunk(1000,2000));state=readLmsObservations(JSON.parse(JSON.stringify(state)),'s-1');
 assert.equal(JSON.stringify(prepareLmsObservationEvent(state).inFlight),body);
 state=confirmLmsObservationEvent(state,receipt(state,{duplicate:true}));assert.equal(state.acknowledgedMilliseconds,1000);assert.equal(state.nextSequence,2);assert.deepEqual(state.pending,[chunk(1000,2000)]);
});
test('wrong-account, session, event or cumulative receipt cannot clear the local queue',()=>{
 const state=prepareLmsObservationEvent(appendLmsObservation(newLmsObservations('s-1'),chunk(0,1000)));
 for(const patch of [{source:'demo'},{sessionId:'other'},{eventId:'other'},{sequence:2},{status:'accepted'},{observedMilliseconds:999},{cumulativeObservedMilliseconds:2000},{duplicate:null}])assert.throws(()=>confirmLmsObservationEvent(state,receipt(state,patch)));
 assert.throws(()=>readLmsObservations(state,'other'));
});
test('bounded batches register zero-duration sessions once and retain all subsequent intervals',()=>{
 let state=newLmsObservations('s-1');state=prepareLmsObservationEvent(state);assert.deepEqual(state.inFlight.intervals,[]);state=confirmLmsObservationEvent(state,receipt(state));assert.equal(prepareLmsObservationEvent(state).inFlight,null);
 for(let i=0;i<130;i++)state=appendLmsObservation(state,chunk(10000*i,10000*i+1000));
 state=prepareLmsObservationEvent(state);assert.equal(state.inFlight.intervals.length,120);assert.equal(state.pending.length,10);state=confirmLmsObservationEvent(state,receipt(state));state=prepareLmsObservationEvent(state);assert.equal(state.inFlight.intervals.length,10);
});
test('corrupt overlapping/restored intervals are rejected without fabricating past observations',()=>{
 const state=appendLmsObservation(newLmsObservations('s-1'),chunk(0,1000));assert.deepEqual(readLmsObservations(undefined,'s-1').pending,[]);
 for(const patch of [{nextSequence:0},{lastEndOffsetMs:500},{pending:[chunk(0,1000),chunk(500,1500)]},{acknowledgedMilliseconds:NaN}])assert.throws(()=>readLmsObservations({...state,...patch},'s-1'));
});
