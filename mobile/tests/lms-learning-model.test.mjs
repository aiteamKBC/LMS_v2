import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseLmsCourses,normaliseLmsLearning,findLmsWeekSong,lmsCourseSession,learningMediaUrl,completedLmsActivityIds,PMP_ID} from '../src/lms-learning-model.mjs';
const weekId=PMP_ID+'-W01';
const row=(suffix,fields={})=>({moduleId:PMP_ID,componentId:PMP_ID+'-W01-'+suffix,weekId,week:'First week',component:suffix,mobileMode:'audio',audioUrl:'https://kentbusinesscollege.org/audio/example.mp3',...fields});
const plan=rows=>({source:'lms',components:rows});
test('only server-assigned master module IDs become activities; static index never grants access',()=>{
 const fake=row('P01-AUDIOBOOK');
 const index={[fake.componentId]:{weekId,teachingWeek:1,pointNumber:1,durationSeconds:40}};
 assert.equal(normaliseLmsLearning(plan([]),index).activities.length,0);
 assert.equal(normaliseLmsLearning(plan([row('COPIED',{moduleId:'MOD-OTHER'})]),index).activities.length,0);
 assert.equal(normaliseLmsLearning(plan([fake]),index).activities[0].durationSeconds,40);
});
test('duplicate IDs, mismatched narration weeks and non-LMS projections are refused',()=>{
 const item=row('P01-AUDIOBOOK');
 assert.throws(()=>normaliseLmsLearning(plan([item,item])));
 assert.throws(()=>normaliseLmsLearning(plan([item]),{[item.componentId]:{weekId:'different'}}));
 assert.throws(()=>normaliseLmsLearning({components:[item]}));
});
test('audio-video-MCQ journey preserves canonical display order and excludes live-session learning rows',()=>{
 const items=[row('CASE',{mobileMode:'video',videoUrl:'https://youtu.be/abcdefghijk',displayOrder:8}),row('P01-Q',{mobileMode:'quiz',displayOrder:6}),row('P02-AUDIOBOOK',{displayOrder:7}),row('SONG',{displayOrder:0}),row('P01-AUDIOBOOK',{displayOrder:5}),row('PODCAST',{displayOrder:2}),row('P01-VIDEO',{mobileMode:'video',videoUrl:'https://youtu.be/abcdefghijk',displayOrder:4}),row('LIVE',{mobileMode:'session',displayOrder:1})];
 const model=normaliseLmsLearning(plan(items));
 assert.deepEqual(model.weeks[0].activities.map(a=>a.title),['SONG','PODCAST','P01-VIDEO','P01-AUDIOBOOK','P01-Q','P02-AUDIOBOOK','CASE']);
 assert.deepEqual(model.weeks[0].points,[1,2]);
});

test('weekly songs use authored metadata and established labels for canonical generic component IDs',()=>{
 const rows=[row('EXPLICIT',{sourceContentType:'song'}),row('STAGED',{stage:'song'}),row('SONG-AUDIO'),
  row('GENERIC-A',{component:'Week 5 warm-up song — audio'}),row('GENERIC-B',{component:'Week 13 | Warm-up song',mobileMode:'video',videoUrl:'/media/song.mp4'}),
  row('GENERIC-C',{component:'Course Training | Week 01 Song | Learning together'}),row('GENERIC-D',{component:'A revision refrain | Risk Management Song | W02',mobileMode:'video',videoUrl:'/media/song.mp4'}),
  row('GENERIC-E',{component:'Song of the week'}),row('LESSON',{component:'How a song can communicate an idea'}),row('QUIZ-SONG',{mobileMode:'quiz',sourceContentType:'song'})];
 const model=normaliseLmsLearning(plan(rows));
 assert.deepEqual(model.activities.filter(item=>item.kind==='song').map(item=>item.id),rows.slice(0,8).map(item=>item.componentId));
 assert(model.activities.filter(item=>item.kind==='song').every(item=>!item.recommended));
 assert.equal(model.activities.at(-1).kind,'quiz');
});

test('song selection stays in the exact selected module and week and prefers playable audio',()=>{
 const model=normaliseLmsLearning(plan([
  row('VIDEO-SONG',{mobileMode:'video',videoUrl:'/media/song.mp4',displayOrder:1}),row('AUDIO-SONG',{displayOrder:2}),
  row('SECOND-SONG',{weekId:PMP_ID+'-W02',displayOrder:0}),row('FOREIGN-SONG',{moduleId:'MOD-OTHER'})]));
 assert.equal(findLmsWeekSong(model,weekId).id,row('AUDIO-SONG').componentId);
 assert.equal(findLmsWeekSong(model,PMP_ID+'-W02').id,row('SECOND-SONG').componentId);
 assert.equal(findLmsWeekSong(model,PMP_ID+'-W03'),null);
 assert.equal(findLmsWeekSong({...model,activities:[{...model.activities[0],moduleId:'MOD-OTHER'}]},weekId),null);
 model.activities.find(item=>item.id.endsWith('AUDIO-SONG')).available=false;
 assert.equal(findLmsWeekSong(model,weekId).mode,'video');
 model.activities.filter(item=>item.weekId===weekId).forEach(item=>item.available=false);
 assert.equal(findLmsWeekSong(model,weekId).available,false,'Unavailable song is explicit, never replaced by a different week');
});

test('assigned courses use canonical IDs even when titles match and include a course with no mobile materials',()=>{
 const courses=[{moduleId:'MOD-A',title:'Project controls',availableActivityCount:1},{moduleId:'MOD-B',title:'Project controls',availableActivityCount:0}];
 const raw={...plan([row('A',{moduleId:'MOD-A'})]),courses};
 assert.deepEqual(normaliseLmsCourses(raw),courses);
 assert.equal(normaliseLmsLearning(raw,{}, {},courses[0]).activities[0].moduleId,'MOD-A');
 assert.equal(normaliseLmsLearning(raw,{}, {},courses[1]).activities.length,0);
 assert.throws(()=>normaliseLmsLearning(raw,{}, {},{moduleId:'MOD-C',title:'Project controls'}),/no longer assigned/);
 assert.throws(()=>normaliseLmsCourses({...raw,courses:[courses[0],courses[0]]}),/invalid course identity/);
 assert.throws(()=>normaliseLmsCourses({...raw,courses:[{moduleId:'../other',title:'Invalid'}]}),/invalid course identity/);
});

test('course-specific normalization never imports another course or reading, document or session row',()=>{
 const course={moduleId:'MOD-RISK',title:'Risk Management'};
 const raw={courses:[course],...plan(['audio','video','quiz','reading','document','session','assignment'].map((mode,i)=>row('RESOURCE-'+i,{moduleId:course.moduleId,mobileMode:mode,videoUrl:'/media/lesson.mp4'})).concat(row('OTHER')))};
 const model=normaliseLmsLearning(raw,{}, {},course);
 assert.deepEqual(model.activities.map(a=>a.mode),['audio','video','quiz']);
 assert(model.activities.every(a=>a.moduleId===course.moduleId));
 assert.equal(model.activities[1].url,'https://lms.kentbusinesscollege.org/media/lesson.mp4');
});

test('shared PMP reward capabilities do not extend to a different selected course',()=>{
 const session={authenticated:true,capabilities:{customPointsPolicy:true,timeObservations:true},rewardModuleIds:[PMP_ID]};
 assert.equal(lmsCourseSession(session,PMP_ID).capabilities.customPointsPolicy,true);
 const other=lmsCourseSession(session,'MOD-RISK');
 assert.equal(other.capabilities.customPointsPolicy,false);assert.equal(other.capabilities.timeObservations,false);
 assert.equal(session.capabilities.customPointsPolicy,true,'The authenticated session is unchanged');
 assert.equal(lmsCourseSession({...session,rewardModuleIds:[]},PMP_ID).capabilities.customPointsPolicy,false);
});

test('server observation support flag remains distinct from canonical quiz completion availability',()=>{
 const model=normaliseLmsLearning(plan([row('STANDALONE-QUIZ',{mobileMode:'quiz',rewardObservationsSupported:false}),row('COMPONENT-QUIZ',{mobileMode:'quiz',rewardObservationsSupported:true})]));
 assert.equal(model.activities[0].rewardObservationsSupported,false);assert.equal(model.activities[0].available,true);
 assert.equal(model.activities[1].rewardObservationsSupported,true);assert.equal(model.activities[1].available,true);
});

test('published college video works alongside YouTube without admitting foreign media origins',()=>{
 assert.equal(learningMediaUrl('/media/lesson.mp4','video'),'https://lms.kentbusinesscollege.org/media/lesson.mp4');
 assert.equal(learningMediaUrl('https://kentbusinesscollege.org/media/lesson.mp4','video'),'https://kentbusinesscollege.org/media/lesson.mp4');
 assert.equal(learningMediaUrl('https://foreign.example/lesson.mp4','video'),null);
 assert.equal(learningMediaUrl('https://kbcmaterials.blob.core.windows.net/curriculum/lesson.mp4?sv=fixture&sig=fixture','video'),'https://kbcmaterials.blob.core.windows.net/curriculum/lesson.mp4?sv=fixture&sig=fixture');
 for(const url of ['https://kbcmaterials.blob.core.windows.net.attacker.test/a.mp4','https://user:password@kbcmaterials.blob.core.windows.net/a.mp4','http://kbcmaterials.blob.core.windows.net/a.mp4','//attacker.test/a.mp4','not-a-media-url'])assert.equal(learningMediaUrl(url,'video'),null);
});

test('assigned Google Drive audio and video use the existing LMS range proxy for supported file links',()=>{
 const id='Synthetic_Drive-file123',proxy='https://lms.kentbusinesscollege.org/learner_api/media/google-drive/'+id+'/';
 const links=[`https://drive.google.com/file/d/${id}`,`https://drive.google.com/file/d/${id}/view?usp=sharing`,`https://drive.google.com/file/d/${id}/preview`,
  `https://drive.google.com/uc?export=download&id=${id}`,`https://drive.google.com/uc?id=${id}&export=download`,`https://drive.google.com/open?id=${id}`];
 for(const url of links)for(const mode of ['audio','video'])assert.equal(learningMediaUrl(url,mode),proxy);
 const model=normaliseLmsLearning(plan([row('DRIVE-AUDIO',{audioUrl:links[1]}),row('DRIVE-VIDEO',{mobileMode:'video',videoUrl:links[3]})]));
 assert.equal(model.activities.length,2);assert(model.activities.every(activity=>activity.available&&activity.url===proxy));
 assert.deepEqual(model.activities.map(activity=>activity.id),[row('DRIVE-AUDIO').componentId,row('DRIVE-VIDEO').componentId],'Playback conversion never changes canonical progress identities');
});

test('Google Drive parsing rejects spoofed hosts, ambiguous IDs, malformed IDs and non-file routes',()=>{
 const id='Synthetic_Drive-file123';
 const invalid=[`https://drive.google.com.attacker.test/file/d/${id}/view`,`https://attacker.test/drive.google.com/file/d/${id}/view`,
  `http://drive.google.com/file/d/${id}/view`,`https://user:password@drive.google.com/file/d/${id}/view`,`https://drive.google.com:8443/file/d/${id}/view`,
  `https://drive.google.com/drive/folders/${id}`,`https://drive.google.com/drive/u/0/my-drive`,`https://drive.google.com/file/d/short/view`,
  `https://drive.google.com/file/d/${id}/unexpected`,`https://drive.google.com/file/d/${id}/view?id=OtherSyntheticId`,
  `https://drive.google.com/uc?id=${id}&id=OtherSyntheticId`,`https://drive.google.com/open?id=bad%2Fslash`,`https://drive.google.com/open?notid=${id}`,
  `https://drive.google.com/open?id=${id}%26redirect%3Dattacker`,`https://docs.google.com/file/d/${id}/view`];
 for(const url of invalid)assert.equal(learningMediaUrl(url,'video'),null,url);
 assert.equal(learningMediaUrl(`https://drive.google.com/file/d/${id}/view`,'document'),null);
 for(const url of ['https://open.spotify.com/episode/synthetic','https://tenant.sharepoint.com/:v:/synthetic','https://www.veed.io/view/synthetic'])assert.equal(learningMediaUrl(url,'video'),null,'External tool pages must not be treated as observable video playback');
});
test('authoritative completion IDs do not infer success from a submitted or failed quiz row',()=>{
 assert.deepEqual([...completedLmsActivityIds({completedComponentIds:['COMP-1'],quizAttempts:[{componentId:'COMP-2',submittedAt:'today',passed:false}]})],['COMP-1']);
 assert.equal(completedLmsActivityIds({componentProgress:[{componentId:'COMP-1',submittedAt:'today'}]}).size,0);
});
test('fresh assigned requirement metadata wins over an old presentation snapshot',()=>{
 const item=row('P01-Q',{mobileMode:'quiz',learningRoute:{required:true,optional:false}});
 const index={[item.componentId]:{moduleId:PMP_ID,weekId,requirement:'optional',pointNumber:1,stage:'point'}};
 const current=normaliseLmsLearning(plan([item]),{},index).activities[0];assert.equal(current.requirement,'required');assert.equal(current.recommended,true);
 item.learningRoute={required:false,optional:true};assert.equal(normaliseLmsLearning(plan([item]),{},index).activities[0].recommended,false);
});
test('media destinations reject foreign audio, cleartext, passwords, ports and spoofed YouTube',()=>{
 for(const value of ['http://kentbusinesscollege.org/x','https://kentbusinesscollege.org.attacker.test/x','https://user:pass@kentbusinesscollege.org/x','https://kentbusinesscollege.org:8443/x','javascript:alert(1)'])assert.equal(learningMediaUrl(value,'audio'),null);
 assert.equal(learningMediaUrl('https://youtube.com.attacker.test/watch?v=abcdefghijk','video'),null);
 assert.ok(learningMediaUrl('https://www.youtube.com/watch?v=abcdefghijk','video'));
});
test('transcripts remain opt-in metadata and unavailable media is never a fake playable activity',()=>{
 const model=normaliseLmsLearning(plan([row('P01-AUDIOBOOK',{transcript:'should not be bundled',transcriptAvailable:true}),row('P02-AUDIOBOOK',{audioUrl:''}),row('DOC',{mobileMode:'document'})]));
 assert.equal(model.activities.length,2);assert.equal(model.activities[0].transcript,undefined);assert.equal(model.activities[0].transcriptAvailable,true);assert.equal(model.activities[1].available,false);
});
