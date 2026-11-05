import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {observeRewardInterval,flushRewardObservations,clearRewardObservations} from '../rewardTracking';
import type {TimeTrackingSession} from '@/api/timeTracking';
import {synchronizeTrackingClock} from '../trackingClock';
let serial=0;
const timing=():TimeTrackingSession=>{const session:TimeTrackingSession={sessionId:'session-'+(++serial),trackingToken:'signed',startedAt:'2026-10-15T08:00:00Z',countingMode:'active_playback',rewardTracking:true};synchronizeTrackingClock(session);return session;};
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();vi.spyOn(performance,'now').mockReturnValue(0);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('sends only active intervals, preserves pause gaps and binds the server token',async()=>{
 const session=timing(),start=performance.now();
 observeRewardInterval(session,start,start+3000);observeRewardInterval(session,start+60000,start+65000);
 const calls:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return {ok:true,json:async()=>({source:'lms',eventId:body.eventId,sessionId:session.sessionId,sequence:body.sequence,status:'pending',observedMilliseconds:8000,cumulativeObservedMilliseconds:8000,duplicate:false})};}));
 await flushRewardObservations(session,'component','reading-1');
 expect(calls[0]).toMatchObject({trackingToken:'signed',activityKind:'component',activityId:'reading-1',intervals:[{startOffsetMs:0,endOffsetMs:3000},{startOffsetMs:60000,endOffsetMs:65000}]});
 await flushRewardObservations(session,'component','reading-1');expect(calls).toHaveLength(1);
});
it('ambiguous network failures retry the same event rather than duplicating time',async()=>{
 const session=timing(),start=performance.now();
 observeRewardInterval(session,start,start+4000);
 const bodies:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);if(bodies.length===1)throw new Error('offline');return {ok:true,json:async()=>({source:'lms',eventId:body.eventId,sessionId:session.sessionId,sequence:1,status:'pending',observedMilliseconds:4000,cumulativeObservedMilliseconds:4000,duplicate:true})};}));
 await expect(flushRewardObservations(session,'video','v1')).rejects.toThrow('offline');
 await flushRewardObservations(session,'video','v1');expect(bodies[0]).toEqual(bodies[1]);
});
it('disabled or preview timing makes no award observation request',async()=>{
 const session={...timing(),rewardTracking:false};vi.stubGlobal('fetch',vi.fn());
 observeRewardInterval(session,0,3600000);
 await flushRewardObservations(session,'component','preview');expect(fetch).not.toHaveBeenCalled();
});
it('malformed acknowledgement cannot clear the pending observation',async()=>{
 const session=timing(),start=performance.now();observeRewardInterval(session,start,start+1000);
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({source:'lms',observedMilliseconds:90000})})));
 await expect(flushRewardObservations(session,'quiz','4')).rejects.toThrow('did not confirm');
 expect(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)).toContain('"inFlight":{');
 clearRewardObservations(session);expect(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)).toBeNull();
});

it('resynchronizes a small clock drift and waits before retrying the identical rejected event',async()=>{
 vi.useFakeTimers();
 const session=timing();observeRewardInterval(session,0,1000);
 const observations:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  const body=JSON.parse(init.body);
  if(String(url).includes('/clock/'))return {ok:true,json:async()=>({sessionId:session.sessionId,elapsedMilliseconds:990})};
  observations.push(body);
  if(observations.length===1)return {ok:false,json:async()=>({code:'observation_ahead_of_server',error:'ahead'})};
  return {ok:true,json:async()=>({source:'lms',eventId:body.eventId,sessionId:session.sessionId,sequence:1,status:'pending',observedMilliseconds:1000,cumulativeObservedMilliseconds:1000,duplicate:false})};
 }));
 const saved=flushRewardObservations(session,'component','slides');
 await vi.advanceTimersByTimeAsync(0);
 expect(observations).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(9);
 expect(observations).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(1);await saved;
 expect(observations).toHaveLength(2);
 expect(observations[1]).toEqual(observations[0]);
 expect(observations[1].intervals).toEqual([{startOffsetMs:0,endOffsetMs:1000}]);
});

it('preserves a historical draft too far ahead rather than rewriting it or waiting indefinitely',async()=>{
 const session=timing();observeRewardInterval(session,3600000,3601000);
 const observations:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(String(url).includes('/clock/'))return {ok:true,json:async()=>({sessionId:session.sessionId,elapsedMilliseconds:1000})};
  observations.push(JSON.parse(init.body));
  return {ok:false,json:async()=>({code:'observation_ahead_of_server',error:'ahead'})};
 }));
 await expect(flushRewardObservations(session,'video','v1')).rejects.toThrow('draft are kept');
 expect(observations).toHaveLength(1);
 const stored=JSON.parse(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)!);
 expect(stored.inFlight.intervals).toEqual(observations[0].intervals);
 expect(stored.inFlight.eventId).toBe(observations[0].eventId);
 expect(stored.acknowledgedMilliseconds).toBe(0);
});

it('does not bypass a second refusal after calibration',async()=>{
 const session=timing();observeRewardInterval(session,0,1000);
 const observations:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(String(url).includes('/clock/'))return {ok:true,json:async()=>({sessionId:session.sessionId,elapsedMilliseconds:1000})};
  observations.push(JSON.parse(init.body));
  return {ok:false,json:async()=>({code:'observation_ahead_of_server',error:'still ahead'})};
 }));
 await expect(flushRewardObservations(session,'quiz','1')).rejects.toThrow('still ahead');
 expect(observations).toHaveLength(2);
 expect(observations[1]).toEqual(observations[0]);
 expect(JSON.parse(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)!).inFlight).not.toBeNull();
});

it.each(['csrf','invalid_interval','service_unavailable'])('does not retry or bypass a non-clock refusal: %s',async(code)=>{
 const session=timing();observeRewardInterval(session,0,1000);
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({code,error:'refused'})})));
 await expect(flushRewardObservations(session,'component','reading')).rejects.toThrow('refused');
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(JSON.parse(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)!).inFlight).not.toBeNull();
});

it('keeps newly measured intervals while a periodic upload is in flight and serializes Finish',async()=>{
 const session=timing();observeRewardInterval(session,0,2000);
 let release!:()=>void;
 const bodies:any[]=[];let cumulative=0;
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  const body=JSON.parse(init.body);bodies.push(body);
  if(bodies.length===1)await new Promise<void>(resolve=>{release=resolve;});
  const amount=body.intervals.reduce((sum:number,item:any)=>sum+item.endOffsetMs-item.startOffsetMs,0);
  cumulative+=amount;
  return {ok:true,json:async()=>({source:'lms',eventId:body.eventId,sessionId:session.sessionId,
   sequence:body.sequence,status:'pending',observedMilliseconds:amount,cumulativeObservedMilliseconds:cumulative,duplicate:false})};
 }));
 const heartbeat=flushRewardObservations(session,'component','reading');
 observeRewardInterval(session,2000,5000);
 const finish=flushRewardObservations(session,'component','reading');
 release();await Promise.all([heartbeat,finish]);
 expect(cumulative).toBe(5000);
 expect(bodies.map(x=>x.sequence)).toEqual([1,2]);
 expect(JSON.parse(localStorage.getItem('kbc-reward-intervals:v1:'+session.sessionId)!).pending).toEqual([]);
});

it('preserves multi-day offsets for a renewed session and can confirm an empty final batch',async()=>{
 const session={...timing(),persistent:true};synchronizeTrackingClock(session,172800000);
 observeRewardInterval(session,0,2000);
 let total=0;const bodies:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  const body=JSON.parse(init.body);bodies.push(body);
  const amount=body.intervals.reduce((sum:number,item:any)=>sum+item.endOffsetMs-item.startOffsetMs,0);total+=amount;
  return {ok:true,json:async()=>({source:'lms',eventId:body.eventId,sessionId:session.sessionId,
   sequence:body.sequence,status:'pending',observedMilliseconds:amount,cumulativeObservedMilliseconds:total,duplicate:false})};
 }));
 await flushRewardObservations(session,'component','reading');
 await flushRewardObservations(session,'component','reading',true);
 expect(bodies[0].intervals).toEqual([{startOffsetMs:172800000,endOffsetMs:172802000}]);
 expect(bodies[1].intervals).toEqual([]);
 expect(total).toBe(2000);
});
