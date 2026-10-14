import {normaliseLmsCourses,normaliseLmsLearning} from './lms-learning-model.mjs';
import {normaliseLmsHours} from './lms-hours-model.mjs';
import {normaliseLmsPoints} from './lms-points-model.mjs';
import {normaliseLmsQuiz} from './lms-quiz-model.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const identity=v=>(typeof v==='string'&&/^[1-9][0-9]*$/.test(v))||(Number.isSafeInteger(v)&&v>0);
const text=(v,max=1000)=>typeof v==='string'&&v.length<=max;
function invalid(message='The LMS coach record could not be confirmed. Refresh to try again.',code='INVALID_COACH_RESPONSE') {throw Object.assign(new Error(message),{code});}
const metric=v=>{if(v===undefined||v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0)invalid();return v;};
const label=v=>v===undefined||v===null?'':text(v)?v:invalid();
export function coachAccount(session){
 if(session?.authenticated!==true||session?.communications?.role!=='coach'||!identity(session.user?.accountId)||String(session.communications.accountId)!==String(session.user.accountId))invalid('Please sign in to your coach account again.');
 return String(session.user.accountId);
}
export function normaliseCoachLearner(value){
 if(!object(value)||!identity(value.profileId)||!identity(value.learnerId)||!['apprenticeship','commercial'].includes(value.learnerKind)||!text(value.displayName)||!value.displayName.trim())invalid();
 return {profileId:String(value.profileId),learnerId:String(value.learnerId),learnerKind:value.learnerKind,displayName:value.displayName,programme:label(value.programme),cohort:label(value.cohort),status:label(value.status)};
}
export function checkedCoachPayload(value,accountId,profileId,expectedLearner){
 if(!object(value)||value.source!=='lms'||value.readOnly!==true||!identity(accountId)||String(value.coachAccountId)!==String(accountId))invalid('The coach account changed. Refresh before opening a learner record.','COACH_IDENTITY_CHANGED');
 if(profileId!==undefined){const learner=normaliseCoachLearner(value.learner);if(learner.profileId!==String(profileId)||expectedLearner&&['profileId','learnerId','learnerKind'].some(key=>learner[key]!==String(expectedLearner[key])))invalid('The learner’s LMS identity changed. Choose the learner again.','COACH_IDENTITY_CHANGED');}
 return value;
}
function hours(value){
 if(!object(value))return {acceptedOtjhHours:null,plannedOtjhHours:null,recordedLearningHours:null};
 return {acceptedOtjhHours:metric(value.acceptedOtjhHours),plannedOtjhHours:metric(value.plannedOtjhHours),recordedLearningHours:metric(value.recordedLearningHours)};
}
export function normaliseCoachRoster(raw,accountId){
 checkedCoachPayload(raw,accountId);if(!Array.isArray(raw.learners)||raw.learners.length>100||raw.nextBefore!==null&&!identity(raw.nextBefore))invalid();
 const seen=new Set(),learners=raw.learners.map(row=>{const learner=normaliseCoachLearner(row);if(seen.has(learner.profileId))invalid();seen.add(learner.profileId);return {...learner,hours:hours(row.hours)};});
 return {learners,nextBefore:raw.nextBefore===null?null:String(raw.nextBefore)};
}
export function mergeCoachRoster(previous,next){
 const rows=new Map(previous.learners.map(row=>[row.profileId,row]));for(const row of next.learners)rows.set(row.profileId,row);
 return {learners:[...rows.values()],nextBefore:next.nextBefore};
}
export function normaliseCoachDetail(raw,accountId,profileId,expectedLearner){
 checkedCoachPayload(raw,accountId,profileId,expectedLearner);const learner=normaliseCoachLearner(raw.learner),performance=raw.performance;
 if(!object(performance)||performance.scope!=='programme-records'||performance.basis!=='canonical_recorded_activities'||!Array.isArray(performance.quizAttempts))invalid();
 const result={...learner,hours:hours(raw.hours),performance:{completedActivities:metric(performance.completedActivities),totalActivities:metric(performance.totalActivities),completionPercent:metric(performance.completionPercent),quizAttempts:performance.quizAttempts.length},points:null,leaderboard:null};
 if(result.performance.completionPercent!==null&&result.performance.completionPercent>100)invalid();
 if(raw.points!==null&&raw.points!==undefined)result.points=normaliseLmsPoints({points:raw.points,rewards:[]},learner.learnerId);
 if(raw.sharedRewards!==null&&raw.sharedRewards!==undefined){
  const board=raw.sharedRewards.leaderboard;
  if(!object(board)||typeof board.optedIn!=='boolean'||!Array.isArray(board.entries)||board.entries.length>200||(!board.optedIn&&board.entries.length))invalid();
  result.leaderboard={optedIn:board.optedIn,entries:board.entries.map(row=>{
   if(!Number.isSafeInteger(row.rank)||row.rank<1||!text(row.displayName,100)||!row.displayName.trim()||!Number.isSafeInteger(row.points)||row.points<0)invalid();
   return {rank:row.rank,displayName:row.displayName,points:row.points};
  })};
 }
 return result;
}
export function normaliseCoachCatalogue(raw,accountId,profileId,expectedLearner){
 checkedCoachPayload(raw,accountId,profileId,expectedLearner);if(!Array.isArray(raw.courses))invalid();
 return normaliseLmsCourses(raw).map(course=>normaliseLmsLearning(raw,{}, {},course));
}
export function normaliseCoachProgress(raw,accountId,profileId,moduleId,expectedLearner){
 checkedCoachPayload(raw,accountId,profileId,expectedLearner);if(raw.moduleId!==moduleId||!Array.isArray(raw.completedComponentIds)||raw.completedComponentIds.some(id=>!text(id,180))||!Array.isArray(raw.quizAttempts))invalid('The LMS returned progress for another course or an incomplete record. Refresh to try again.');
 return {completedIds:new Set(raw.completedComponentIds),hours:normaliseLmsHours(raw.mobileMeasuredTime,moduleId),quizAttempts:raw.quizAttempts.map(row=>{
  if(!object(row))invalid();
  // Legacy grade values use different scales. Only canonical achieved/total scores
  // have a defined percentage; absent scores remain unavailable.
  const achieved=metric(row.achievedScore),total=metric(row.totalScore),score=achieved!==null&&total!==null&&total>0&&achieved<=total?achieved/total:null;
  return {componentId:label(row.componentId),quizId:label(row.quizId===undefined?undefined:String(row.quizId)),score,passed:typeof row.passed==='boolean'?row.passed:null};
 })};
}
export const formatCoachHours=value=>value===null||value===undefined?'Unavailable':value.toLocaleString('en-GB',{maximumFractionDigits:2})+' h';

export function normaliseCoachQuiz(raw,accountId,profileId,activity,expectedLearner){
 checkedCoachPayload(raw,accountId,profileId,expectedLearner);
 if(raw.componentId!==activity.id||raw.moduleId!==activity.moduleId)invalid('The LMS returned a different activity. Reopen this preview.');
 const quiz=normaliseLmsQuiz(raw,{componentId:activity.id});
 return {...quiz,questions:quiz.questions.map(question=>{
  const source=raw.questions.find(row=>String(row.id)===question.id);
  const keys=source.answers.every(answer=>typeof answer.isCorrect==='boolean')?question.options.filter(option=>source.answers.some(answer=>Number(answer.id)===option.lmsAnswerId&&answer.isCorrect===true)).map(option=>option.id):[];
  const correctOptionIds=keys.length&&(question.selectionMode==='multiple'||keys.length===1)?keys:null;
  return {...question,correctOptionIds,explanation:text(source.explanation,20000)?source.explanation:''};
 })};
}
