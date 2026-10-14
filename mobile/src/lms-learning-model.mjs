import {parseYouTubeVideoId} from './youtube-player.mjs';
export const PMP_ID='MOD-KBC-PMP-M01-SMR';
export const PMP_TITLE='Stakeholder Management and Reporting';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value);
/** Course identities come from the learner's live LMS catalogue, never titles or local indexes. */
export function normaliseLmsCourses(raw){
 if(raw?.source!=='lms'||!Array.isArray(raw.components))throw new Error('The LMS did not return your assigned learning plan.');
 if(raw.courses===undefined)return raw.components.some(row=>row.moduleId===PMP_ID)?[{moduleId:PMP_ID,title:PMP_TITLE}]:[];
 if(!Array.isArray(raw.courses))throw new Error('The LMS did not confirm your assigned courses.');
 const seen=new Set();
 return raw.courses.map(course=>{
  if(!validId(course?.moduleId)||seen.has(course.moduleId)||typeof course.title!=='string'||!course.title.trim())throw new Error('The LMS returned an invalid course identity.');
  seen.add(course.moduleId);return {moduleId:course.moduleId,title:course.title.trim(),availableActivityCount:course.availableActivityCount};
 });
}
export function lmsCourseSession(session,moduleId){
 const enabled=moduleId===PMP_ID&&(Array.isArray(session?.rewardModuleIds)?session.rewardModuleIds.includes(moduleId):session?.capabilities?.customPointsPolicy===true);
 return {...session,capabilities:{...session?.capabilities,customPointsPolicy:enabled&&session?.capabilities?.customPointsPolicy===true,timeObservations:enabled&&session?.capabilities?.timeObservations===true}};
}
function googleDriveMediaUrl(url){
 const path=url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/(?:view|preview))?\/?$/);
 const queryIds=url.searchParams.getAll('id');
 const id=path?path[1]:/^\/(?:uc|open)\/?$/.test(url.pathname)&&queryIds.length===1?queryIds[0]:null;
 if(!id||!/^[A-Za-z0-9_-]{10,200}$/.test(id)||queryIds.length>1||(path&&queryIds.length&&queryIds[0]!==id))return null;
 // The maintained LMS proxy supplies the same-origin, range-capable media stream.
 // Only the validated file ID crosses this boundary; no authored redirect/query is forwarded.
 return 'https://lms.kentbusinesscollege.org/learner_api/media/google-drive/'+id+'/';
}
export function learningMediaUrl(value,mode){
 try{if(typeof value!=='string'||!value.trim()||!(/^(https:\/\/|\/(?!\/))/.test(value)))return null;const url=new URL(value,'https://lms.kentbusinesscollege.org');if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
 if(url.hostname==='drive.google.com')return ['audio','video'].includes(mode)?googleDriveMediaUrl(url):null;
 if(mode==='video'&&parseYouTubeVideoId(url.href))return url.href;
 const college=['kentbusinesscollege.org','www.kentbusinesscollege.org','kentbusinesscollege.com','www.kentbusinesscollege.com','lms.kentbusinesscollege.org'].includes(url.hostname);
 const azure=/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname);
 return college||azure?url.href:null;
 }catch{return null;}
}
function isWeeklySong(row,mode,stage){
 if(!['audio','video'].includes(mode))return false;
 if(row.sourceContentType==='song'||stage==='song'||/-SONG(?:-AUDIO|-VIDEO)?$/i.test(row.componentId))return true;
 // Older authored songs have generic component IDs and no content-type metadata.
 // Match their explicit song labels, never a general mention of music in a lesson.
 const title=typeof row.component==='string'?row.component.trim():'';
 return /\bwarm[\s-]*up song\b|\bsong of the week\b|\bweek\s+\d+\s+song\b/i.test(title)
  || /\|\s*[^|]+\bsong\s*\|\s*W\d{1,2}\s*$/i.test(title);
}
/** Stay within the selected course and week, preferring playable audio when both formats exist. */
export function findLmsWeekSong(model,weekId){
 if(!validId(model?.moduleId)||!validId(weekId)||!Array.isArray(model.activities))return null;
 const songs=model.activities.filter(item=>item.moduleId===model.moduleId&&item.weekId===weekId&&item.kind==='song'&&['audio','video'].includes(item.mode)).sort((a,b)=>a.order-b.order);
 return songs.find(item=>item.available&&item.mode==='audio')||songs.find(item=>item.available)||songs[0]||null;
}
/** Only assigned server components can become activities. The static index annotates; it cannot grant access. */
export function normaliseLmsLearning(raw,narrationIndex={},presentationIndex={},course={moduleId:PMP_ID,title:PMP_TITLE}){
 if(raw?.source!=='lms'||!Array.isArray(raw.components))throw new Error('The LMS did not return your assigned learning plan.');
 const moduleId=course.moduleId;
 if(!validId(moduleId))throw new Error('Choose one of your assigned courses.');
 if(raw.courses!==undefined&&!normaliseLmsCourses(raw).some(row=>row.moduleId===moduleId))throw new Error('This course is no longer assigned. Refresh your courses.');
 const seen=new Set(),activities=[];
 for(const [position,row] of raw.components.entries()){
  if(row.moduleId!==moduleId)continue;
  if(!validId(row.componentId)||seen.has(row.componentId))throw new Error('The LMS returned an invalid activity identity.');
  seen.add(row.componentId);
  if(!validId(row.weekId))continue;
  const annotation=narrationIndex[row.componentId];
  const savedPresentation=presentationIndex[row.componentId];
  const presentation=savedPresentation?.moduleId===moduleId&&savedPresentation.weekId===row.weekId?savedPresentation:{};
  if(annotation&&annotation.weekId!==row.weekId)throw new Error('The narration and assigned week no longer match. Refresh your course.');
  const mode=row.mobileMode,resource=learningMediaUrl(mode==='audio'?row.audioUrl:row.videoUrl,mode);
  if(!['audio','video','quiz'].includes(mode))continue;
  const weekMatch=row.weekId.match(/-W(\d{2})$/),pointMatch=row.componentId.match(/-W\d{2}-P(\d{2})(?:-|$)/);
  const weekNumber=Number.isInteger(row.teachingWeek)?row.teachingWeek:presentation.teachingWeek??annotation?.teachingWeek??(weekMatch?Number(weekMatch[1]):Number.isInteger(row.weekNumber)?row.weekNumber:null);
  const pointNumber=Number.isInteger(row.pointNumber)?row.pointNumber:presentation.pointNumber??annotation?.pointNumber??(pointMatch?Number(pointMatch[1]):null);
  const stage=typeof row.stage==='string'?row.stage:presentation.stage||'unknown';
  const route=row.learningRoute;
  const requirement=route?.required===true?'required':route?.optional===true?'optional':route&&('required' in route||'optional' in route)?'unknown':presentation.requirement||'unknown';
  const song=isWeeklySong(row,mode,stage),narration=mode==='audio'&&(!!row.bookNarrationAssetId||!!annotation||/-AUDIOBOOK$/.test(row.componentId));
  activities.push({id:row.componentId,moduleId,weekId:row.weekId,weekNumber,weekTitle:row.week||'Learning week',
   pointNumber,title:row.component||'Learning activity',mode,kind:song?'song':narration?'narration':mode,stage,requirement,
   recommended:!song&&!['assignment','practice'].includes(stage)&&(mode!=='quiz'||requirement!=='optional'),
   url:resource,available:mode==='quiz'||!!resource,order:Number.isFinite(row.displayOrder)?row.displayOrder:presentation.displayOrder??position,
   transcriptAvailable:row.transcriptAvailable===true,
   rewardObservationsSupported:row.rewardObservationsSupported!==false,
   joinUrl:typeof row.liveSessionUrl==='string'?row.liveSessionUrl:null,
   reflectionRequired:row.reflectionRequired===true,reflectionPrompt:row.reflectionPrompt||row.reflectionQuestion||'What will you apply at work?',
   ksbs:(Array.isArray(row.ksbMappings)?row.ksbMappings:[]).filter(k=>typeof k?.code==='string').map(k=>k.code),
   durationSeconds:annotation?.durationSeconds??(Number.isFinite(row.durationMinutes)?row.durationMinutes*60:null)});
 }
 const weeks=[...new Set(activities.map(a=>a.weekId))].map(id=>{
  const members=activities.filter(a=>a.weekId===id);
  members.sort((a,b)=>a.order-b.order);
  return{id,title:members[0].weekTitle,number:members[0].weekNumber,activities:members,
   points:[...new Set(members.map(a=>a.pointNumber).filter(n=>n!=null))].sort((a,b)=>a-b)};
 }).sort((a,b)=>(a.number??999)-(b.number??999));
 return{moduleId,title:course.title,weeks,activities,learningAccess:raw.learningAccess,accessGate:raw.accessGate};
}
export function completedLmsActivityIds(raw){
 return new Set((Array.isArray(raw?.completedComponentIds)?raw.completedComponentIds:[]).filter(validId));
}
export function submittedLmsActivityIds(raw){
 return new Set((Array.isArray(raw?.submittedComponentIds)?raw.submittedComponentIds:[]).filter(validId));
}
export function pendingReviewLmsActivityIds(raw){
 return new Set((Array.isArray(raw?.pendingReviewComponentIds)?raw.pendingReviewComponentIds:[]).filter(validId));
}
export function activityClock(seconds){
 const total=Math.max(0,Math.floor(Number(seconds)||0));
 return Math.floor(total/60)+':'+String(total%60).padStart(2,'0');
}
