import {beforeEach,it,expect,vi} from 'vitest';
import {observeRewardInterval,flushRewardObservations,clearRewardObservations} from '../rewardTracking';
import type {TimeTrackingSession} from '@/api/timeTracking';
let serial=0;
const timing=():TimeTrackingSession=>({sessionId:'session-'+(++serial),trackingToken:'signed',startedAt:'2026-10-15T08:00:00Z',countingMode:'active_playback',rewardTracking:true});
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
it('sends only active intervals, preserves pause gaps and binds the server token',async()=>{
 const session=timing(),start=Date.parse(session.startedAt);
 observeRewardInterval(session,start,start+3000);observeRewardInterval(session,start+60000,start+65000);
 const calls:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return {ok:true,json:async()=>({source:'lms',eventId:body.eventId,sessionId:session.sessionId,sequence:body.sequence,status:'pending',observedMilliseconds:8000,cumulativeObservedMilliseconds:8000,duplicate:false})};}));
 await flushRewardObservations(session,'component','reading-1');
 expect(calls[0]).toMatchObject({trackingToken:'signed',activityKind:'component',activityId:'reading-1',intervals:[{startOffsetMs:0,endOffsetMs:3000},{startOffsetMs:60000,endOffsetMs:65000}]});
 await flushRewardObservations(session,'component','reading-1');expect(calls).toHaveLength(1);
});
it('ambiguous network failures retry the same event rather than duplicating time',async()=>{
 const session=timing(),start=Date.parse(session.startedAt);
 observeRewardInterval(session,start,start+4000);
 const bodies:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);if(bodies.length===1)throw new Error('offline');return {ok:true,json:async()=>({source:'lms',eventId:body.eventId,sessionId:session.sessionId,sequence:1,status:'pending',observedMilliseconds:4000,cumulativeObservedMilliseconds:4000,duplicate:true})};}));
 await expect(flushRewardObservations(session,'video','v1')).rejects.toThrow('offline');
 await flushRewardObservations(session,'video','v1');expect(bodies[0]).toEqual(bodies[1]);
});
it('disabled or preview timing makes no award observation request',async()=>{
 const session={...timing(),rewardTracking:false};vi.stubGlobal('fetch',vi.fn());
 observeRewardInterval(session,Date.parse(session.startedAt),Date.parse(session.startedAt)+3600000);
 await flushRewardObservations(session,'component','preview');expect(fetch).not.toHaveBeenCalled();
});
it('malformed acknowledgement cannot clear the pending observation',async()=>{
 const session=timing(),start=Date.parse(session.startedAt);observeRewardInterval(session,start,start+1000);
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({source:'lms',observedMilliseconds:90000})})));
 await expect(flushRewardObservations(session,'quiz','4')).rejects.toThrow('did not confirm');
 expect(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)).toContain('"inFlight":{');
 clearRewardObservations(session);expect(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)).toBeNull();
});
