import {normaliseLmsPoints,LmsPointsError} from './lms-points-model.mjs';
const moduleId='MOD-KBC-PMP-M01-SMR';
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,max=180)=>typeof v==='string'&&v.length<=max;
const list=(v,max=200)=>Array.isArray(v)&&v.length<=max;
const day=v=>v===null||(text(v,40)&&Number.isFinite(Date.parse(v)));
const fail=()=>{throw new LmsPointsError('Your shared rewards could not be confirmed. Refresh to try again.');};
const statuses=['pending','approved','fulfilled','issued','rejected','cancelled','processing'];
const recordId=v=>(typeof v==='string'&&v.trim().length>0&&v.length<=180)||(Number.isSafeInteger(v)&&v>0);
export function normaliseLmsVoucherRequest(item){
 if(!item||!text(item.requestId)||!item.requestId||!recordId(item.claimId)||!integer(item.amountGbp)||!item.amountGbp||!integer(item.points)||item.points!==item.amountGbp*100||!statuses.includes(item.status)||!day(item.requestedAt)||!item.requestedAt)fail();
 return {requestId:item.requestId,claimId:String(item.claimId),amountGbp:item.amountGbp,points:item.points,status:item.status,requestedAt:item.requestedAt};
}
export function normaliseLmsRewards(payload,learnerId){
 if(payload?.source!=='lms'||payload.moduleId!==moduleId||String(payload.learnerId)!==String(learnerId))fail();
 const wallet=normaliseLmsPoints({points:payload.points,rewards:[]},learnerId),p=payload.policy,study=payload.study;
 if(!p||typeof p.enabled!=='boolean'||!text(p.version,100)||!day(p.startsAt)||p.pointsPerGbp!==100||!study||!Number.isFinite(study.acceptedStudySeconds)||study.acceptedStudySeconds<0||study.basis!=='reward_accepted_active_intervals'||study.formalOtj!==false||!integer(study.pendingSessionCount))fail();
 if(!list(payload.opportunities)||!list(payload.voucherOptions)||!list(payload.voucherRequests)||!payload.leaderboard||typeof payload.leaderboard.optedIn!=='boolean'||!text(payload.leaderboard.displayName,100)||!list(payload.leaderboard.entries))fail();
 const opportunities=payload.opportunities.map(item=>{
  if(!item||!text(item.id)||!item.id||!text(item.title,255)||!integer(item.points)||!['available','scheduled','completed','needs_dates','closed'].includes(item.status)||![item.opensOn,item.closesOn,item.verifiedAt].every(day))fail();
  return {...item};
 });
 const voucherOptions=payload.voucherOptions.map(item=>{
  if(!item||!recordId(item.rewardId)||!integer(item.amountGbp)||item.amountGbp<1||item.points!==item.amountGbp*100||!integer(item.remaining)||item.remaining<1)fail();
  return {...item,enoughPoints:wallet.balance>=item.points};
 });
 const entries=payload.leaderboard.entries.map(item=>{if(!item||!integer(item.rank)||!item.rank||!text(item.displayName,100)||!item.displayName||!integer(item.points))fail();return{rank:item.rank,displayName:item.displayName,points:item.points};});
 if(!payload.leaderboard.optedIn&&entries.length)fail();
 return {...wallet,policyConfirmed:p.enabled,policy:p,study,opportunities,voucherOptions,voucherRequests:payload.voucherRequests.map(normaliseLmsVoucherRequest),leaderboard:{...payload.leaderboard,entries}};
}
export function confirmLmsVoucherResponse(payload,learnerId,pending){
 if(payload?.source!=='lms'||payload.moduleId!==moduleId||String(payload.learnerId)!==String(learnerId)||typeof payload.duplicate!=='boolean')fail();
 const result=normaliseLmsVoucherRequest(payload.request);
 if(result.requestId!==pending.requestId||result.amountGbp!==pending.amountGbp)fail();
 return result;
}
export const voucherDraftKey=owner=>'kbc:lms:voucher-request:v1:'+owner;
export function readLmsVoucherDraft(raw,owner){
 if(!raw)return null;
 try{const value=JSON.parse(raw);if(value.owner!==owner||!text(value.requestId)||!/^[A-Za-z0-9_.:-]{1,180}$/.test(value.requestId)||!integer(value.amountGbp)||!value.amountGbp)throw new Error();return{owner,requestId:value.requestId,amountGbp:value.amountGbp};}
 catch{throw new Error('This phone has an unresolved voucher request. Check your LMS points before starting another request.');}
}
