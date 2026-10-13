import {initialState,recordInterval} from './domain.mjs';
import {automaticTimingDecision} from './timing-policy.mjs';

export const LMS_TIMING_MAX_AGE=24*3600000-60000;
const positiveId=value=>(typeof value==='number'||typeof value==='string')&&/^[1-9][0-9]*$/.test(String(value));
const validComponent=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value);
export function lmsActivityDraftKey(session,activity){
 const user=session?.user;
 if(session?.authenticated!==true||!positiveId(user?.accountId)||!positiveId(user?.id)||!['apprenticeship','commercial'].includes(user?.learnerKind)||!validComponent(activity?.id))throw new Error('Sign in to your LMS account to save this activity.');
 return 'kbc:lms:activity:v1:'+user.accountId+':'+user.learnerKind+':'+user.id+':'+encodeURIComponent(activity.id);
}
export function validLmsTimingSession(value,activity,now=Date.now()){
 if(!value||value.componentId!==activity.id||typeof value.trackingToken!=='string'||value.trackingToken.length<8||value.trackingToken.length>12000||typeof value.sessionId!=='string'||!value.sessionId||value.sessionId.length>200)return false;
 const expected=activity.mode==='quiz'?'quiz':activity.mode==='video'?'video':'component';
 if(value.activityKind!==expected||value.countingMode!==(activity.mode==='quiz'?'active_quiz':'active_playback'))return false;
 if(expected!=='quiz'&&value.activityId!==activity.id)return false;
 const age=now-Date.parse(value.startedAt);
 return Number.isFinite(age)&&age>=-60000&&age<LMS_TIMING_MAX_AGE;
}
export function readLmsActivityDraft(raw,key,activity){
 if(!raw||typeof raw!=='string'||raw.length>8000000)return null;
 try{
  const value=JSON.parse(raw);
  if(value.version!==1||value.ownerKey!==key||value.componentId!==activity.id||value.mode!==activity.mode||!value.timing||typeof value.timing!=='object'||typeof value.seconds!=='number'||!Number.isFinite(value.seconds)||value.seconds<0||value.seconds>86400||typeof value.feedback!=='string'||value.feedback.length>12000)return null;
  return value;
 }catch{return null;}
}
export function createLmsActivityMeter(baseSeconds=0,clockId='lms-clock'){
 if(!Number.isFinite(baseSeconds)||baseSeconds<0)throw new Error('Invalid measured duration.');
 return {state:initialState(),baseSeconds,seconds:baseSeconds,clockId};
}
export function observeLmsActivity(meter,{activity,timing,nowMs,wallNow=Date.now(),lastInteractionMs,visible=true,paused=false,permissionPending=false,contentReady=true,signal={}}){
 const decision=automaticTimingDecision({activity:{id:activity.id,kind:activity.mode},surface:'activity',nowMs,lastInteractionMs,visible,manualPausedActivityId:paused?activity.id:null,permissionPending,contentReady:contentReady&&validLmsTimingSession(timing,activity,wallNow),playing:signal.playing===true,buffering:signal.buffering===true,mediaPositionSeconds:signal.positionSeconds,allowBackgroundPlayback:activity.mode==='audio'});
 const result=recordInterval(meter.state,{activityId:activity.id,sessionId:timing?.sessionId||'awaiting-session',clockId:meter.clockId,monotonicMs:nowMs,kind:decision.kind,active:decision.active,visible,playing:signal.playing===true,buffering:signal.buffering===true,mediaPositionSeconds:signal.positionSeconds,playbackRate:Number.isFinite(signal.playbackRate)&&signal.playbackRate>0?signal.playbackRate:1});
 // Anchor offsets once per running clock. Device wall-clock changes must not
 // stretch learning intervals or bridge time while the app was suspended.
 const anchor=meter.observationAnchor?.sessionId===timing?.sessionId?meter.observationAnchor:{sessionId:timing?.sessionId,monotonicMs:nowMs,offsetMs:wallNow-Date.parse(timing?.startedAt)};
 const endOffsetMs=Math.floor(anchor.offsetMs+nowMs-anchor.monotonicMs);
 const durationMs=Math.floor(result.creditedSeconds*1000);
 const measuredInterval=durationMs>0&&durationMs<=5000&&endOffsetMs>=durationMs&&endOffsetMs<=86400000?{startOffsetMs:endOffsetMs-durationMs,endOffsetMs}:null;
 return {state:result.state,baseSeconds:meter.baseSeconds,clockId:meter.clockId,seconds:meter.baseSeconds+(result.state.activity[activity.id]?.seconds||0),decision,observationAnchor:anchor,measuredInterval};
}
/** A 200 alone is not proof that this signed activity was saved. */
export function confirmedLmsActivityResult(response,activity,timing,{quizId=null,submittedSeconds=0}={}){
 const record=activity.mode==='quiz'?response?.attempt:response?.record;
 const kind=activity.mode==='quiz'?'quiz':activity.mode==='video'?'video':'component';
 if(!record||record.kind!==kind||record.timeTrackingSessionId!==timing.sessionId||!Number.isFinite(Date.parse(record.submittedAt))||!Number.isFinite(record.verifiedSeconds)||record.verifiedSeconds<0||record.verifiedSeconds>submittedSeconds+1)throw new Error('The LMS did not confirm this saved activity. Your draft is kept; check your LMS progress before retrying.');
 if(kind==='quiz'?String(record.quizId)!==String(quizId):record.componentId!==activity.id)throw new Error('The saved result did not match this activity. Your draft is kept.');
 if(kind==='quiz'&&(!Number.isFinite(response.grade)||response.grade<0||response.grade>1||!Number.isSafeInteger(response.totalScore)||response.totalScore<1||!Number.isSafeInteger(response.achievedScore)||response.achievedScore<0||response.achievedScore>response.totalScore||typeof response.passed!=='boolean'))throw new Error('The LMS quiz result is incomplete. Your answers are kept; check your LMS progress.');
 const breakdown=kind==='quiz'&&Array.isArray(response.breakdown)?response.breakdown.slice(0,250).filter(item=>item&&typeof item.questionText==='string'&&typeof item.correct==='boolean'&&typeof item.correctAnswer==='string').map(item=>({questionText:item.questionText,correct:item.correct,chosenAnswer:typeof item.chosenAnswer==='string'?item.chosenAnswer:null,correctAnswer:item.correctAnswer})):[];
 return {verifiedSeconds:record.verifiedSeconds,awaitingCoachValidation:response.awaitingCoachValidation===true,grade:kind==='quiz'?response.grade:null,correct:kind==='quiz'?response.achievedScore:null,total:kind==='quiz'?response.totalScore:null,passed:kind==='quiz'?response.passed:null,breakdown};
}
