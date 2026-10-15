import type { TimeTrackingSession,TrackingActivityKind } from '@/api/timeTracking';
import {newLmsObservations,readLmsObservations,appendLmsObservation,prepareLmsObservationEvent,confirmLmsObservationEvent} from './rewardObservations.mjs';
const memory=new Map<string,any>();
const key=(session:TimeTrackingSession)=>'kbc-reward-intervals:v1:'+session.sessionId;
function read(session:TimeTrackingSession){
 const saved=memory.get(key(session));
 if(saved)return saved;
 const raw=localStorage.getItem(key(session));
 const value=raw?readLmsObservations(JSON.parse(raw),session.sessionId):newLmsObservations(session.sessionId);
 memory.set(key(session),value);return value;
}
function save(session:TimeTrackingSession,value:any){
 memory.set(key(session),value);
 localStorage.setItem(key(session),JSON.stringify(value));
}
/** Called only by the activity clock while the page/player is actually active. */
export function observeRewardInterval(session:TimeTrackingSession|null,start:number,end:number){
 if(!session?.rewardTracking)return;
 const origin=Date.parse(session.startedAt);
 if(!Number.isFinite(origin)||!Number.isFinite(start)||!Number.isFinite(end))return;
 let from=Math.max(0,Math.floor(start-origin)),to=Math.floor(end-origin);
 if(to<=from||to>86400000)return;
 let value=read(session);from=Math.max(from,value.lastEndOffsetMs);
 while(from<to){const next=Math.min(from+5000,to);value=appendLmsObservation(value,{startOffsetMs:from,endOffsetMs:next});from=next;}
 save(session,value);
}
export async function flushRewardObservations(session:TimeTrackingSession,activityKind:TrackingActivityKind,activityId:string){
 if(!session.rewardTracking)return;
 let value=read(session);
 while(value.pending.length||value.inFlight||value.nextSequence===1){
  value=prepareLmsObservationEvent(value);save(session,value);
  const response=await fetch('/learner_api/time-tracking/observations/',{method:'POST',credentials:'include',
   headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
   body:JSON.stringify({trackingToken:session.trackingToken,activityKind,activityId,...value.inFlight})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Your study time could not be confirmed. Please retry.');
  value=confirmLmsObservationEvent(value,data);save(session,value);
 }
}
export function clearRewardObservations(session:TimeTrackingSession|null){
 if(!session)return;memory.delete(key(session));
 try{localStorage.removeItem(key(session));}catch{/* Already saved to LMS; do not suggest resubmitting. */}
}
