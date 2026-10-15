import {validDate,londonDateTimeISO} from './meetings-policy.mjs';

export const ABSENCE_REASONS = Object.freeze([
 {value:'illness',label:'Illness or medical appointment'},
 {value:'emergency',label:'Family or personal emergency'},
 {value:'travel',label:'Travel disruption'},
 {value:'technical',label:'Technical issue'},
 {value:'other',label:'Other reason'},
]);
export const ABSENCE_TYPES = Object.freeze([
 {value:'lecture',label:'Next session',action:'Report session absence'},
 {value:'mcr',label:'Next monthly coaching meeting',action:'Report coaching absence'},
 {value:'progress-review',label:'Next progress review',action:'Report progress review absence'},
]);
const identity=value=>/^[1-9][0-9]*$/.test(String(value||''));
const text=value=>typeof value==='string'?value.trim():'';
const clock=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const statuses={pending:'Pending approval',approved:'Approved',declined:'Declined','catch-up complete':'Catch-up complete'};
export const absenceStatusLabel=status=>statuses[status]||'Check LMS status';
export function absenceInstant(date,time){
 if(!validDate(date)||!clock(time))return null;
 const instant=londonDateTimeISO(date,time);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`===date&&`${parts.hour}:${parts.minute}`===time?instant:null;
}
/** Read only the canonical absence register, not calendar titles or guessed event IDs. */
export function normaliseAbsenceOptions(lectures,meetings,session,{now=Date.now()}={}){
 const user=session?.user;
 if(!session?.authenticated||!identity(user?.id)||!['commercial','apprenticeship'].includes(user?.learnerKind))throw new Error('Sign in to your learner account to report an absence.');
 const groups={lecture:[],mcr:[],'progress-review':[]},reports=new Map();
 for(const [scope,payload] of [['lectures',lectures],['meetings',meetings]]){
  if(!payload||String(payload.learner?.id)!==String(user.id)||payload.learner?.kind!==user.learnerKind||!Array.isArray(payload.missedSessions)||!Array.isArray(payload.results))throw new Error('The absence list did not match your learner account. Refresh to try again.');
  const reported=new Set(payload.results.map(report=>text(report.attendanceId)).filter(Boolean));
  for(const report of payload.results)if(identity(report?.id))reports.set(String(report.id),report);
  const seen=new Set();
  for(const row of payload.missedSessions){
   if(!row||typeof row!=='object')continue;
   const id=text(row.id),sessionId=text(row.sessionId),reportId=text(row.reportId);
   const type=scope==='lectures'?'lecture':row.sessionType;
   if(!id||!sessionId||!reportId||seen.has(id)||!text(row.title)||!Object.hasOwn(groups,type))continue;
   seen.add(id);
   if((scope==='meetings')!==sessionId.startsWith('meeting:')||reported.has(reportId))continue;
   if(!['upcoming','unmarked','pending'].includes(row.status))continue;
   const startsAt=absenceInstant(row.dateIso,row.startTime);
   if(!startsAt||Date.parse(startsAt)<now)continue;
   groups[type].push({...row,id,sessionId,reportId,title:text(row.title),type,scope,startsAt,alternativeSessions:(Array.isArray(row.alternativeSessions)?row.alternativeSessions:[]).filter(alt=>text(alt?.id)&&text(alt?.title)&&absenceInstant(alt.dateIso,alt.startTime)&&Date.parse(absenceInstant(alt.dateIso,alt.startTime))>=now)});
  }
 }
 for(const rows of Object.values(groups))rows.sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id));
 return {groups,reports:[...reports.values()].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0))};
}

/** Only source-owned session details and learner-entered fields can be submitted. */
export function absencePayload(target,draft,{now=Date.now()}={}){
 if(!target||!['lecture','mcr','progress-review'].includes(target.type)||!text(target.sessionId)||!text(target.title)||!validDate(target.dateIso)||!absenceInstant(target.dateIso,target.startTime))throw new Error('Refresh and select a confirmed upcoming session.');
 if(Date.parse(absenceInstant(target.dateIso,target.startTime))<now)throw new Error('This session has started. Refresh your next sessions or report it in the LMS.');
 if(!ABSENCE_REASONS.some(row=>row.value===draft.reasonCategory))throw new Error('Choose the reason you cannot attend.');
 const otherReason=text(draft.otherReason),explanation=text(draft.explanation);
 if(draft.reasonCategory==='other'&&!otherReason)throw new Error('Please describe the other reason.');
 if(otherReason.length>120||explanation.length>600)throw new Error('Please shorten your explanation to the displayed limit.');
 if(draft.confirmed!==true)throw new Error('Confirm that the information is correct before submitting.');
 const payload={scope:target.type==='lecture'?'lectures':'meetings',sessionId:target.sessionId,sessionTitle:target.title,sessionDate:target.dateIso,sessionTime:target.startTime,reasonCategory:draft.reasonCategory,otherReason:draft.reasonCategory==='other'?otherReason:'',explanation};
 if(target.type==='lecture'){
  if(draft.recoveryMethod==='recorded'){
   const recordingStart=absenceInstant(draft.recordingDate,draft.recordingTime),duration=Number(draft.recordingDurationMinutes);
   if(!recordingStart||draft.recordingDate<target.dateIso||Date.parse(recordingStart)<=now)throw new Error('Choose a future UK date and time on or after the session date for watching the recording.');
   if(!Number.isInteger(duration)||duration<15||duration>480)throw new Error('Recording time must be between 15 and 480 minutes.');
   Object.assign(payload,{recoveryMethod:'recorded',recordingDate:draft.recordingDate,recordingTime:draft.recordingTime,recordingDurationMinutes:String(duration)});
  }else if(draft.recoveryMethod==='alternative'){
   const alternative=target.alternativeSessions?.find(row=>row.id===draft.targetOccurrenceId);
   if(!alternative||!absenceInstant(alternative.dateIso,alternative.startTime)||Date.parse(absenceInstant(alternative.dateIso,alternative.startTime))<now)throw new Error('Choose one of the available alternative sessions.');
   Object.assign(payload,{recoveryMethod:'alternative',targetOccurrenceId:alternative.id});
  }else throw new Error('Choose how you will catch up, or arrange a coach catch-up in the LMS.');
 }
 return payload;
}

export function checkedAbsenceResult(value,target){
 if(!value||!identity(value.id)||String(value.attendanceId)!==target.reportId||value.sessionDate!==target.dateIso||value.sessionTitle!==target.title||!Object.hasOwn(statuses,value.status)||!/^AR-[0-9]+$/.test(value.reference||''))throw new Error('The LMS did not confirm this absence report. Refresh your reports before trying again.');
 return {...value,statusLabel:statuses[value.status]};
}
