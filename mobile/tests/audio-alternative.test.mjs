import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioAlternativeUrl,openAudioAlternative} from '../src/audio-alternative.mjs';
import {normaliseLmsLearning} from '../src/lms-learning-model.mjs';

test('only exact HTTPS YouTube URLs are admitted and tracking query is removed',()=>{
 assert.equal(audioAlternativeUrl('https://youtu.be/abcdefghijk?t=5'),'https://www.youtube.com/watch?v=abcdefghijk');
 for(const value of [null,true,{},'javascript:alert(1)','http://youtu.be/abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','https://u@youtu.be/abcdefghijk','https://youtu.be:444/abcdefghijk','https://youtube.com/watch?v=abcdefghijk&v=zyxwvutsrqp','https://youtu.be/short','https://college.test/a.mp3','https://youtu.be/abcdefghijk\n'])assert.equal(audioAlternativeUrl(value),null,String(value));
});
test('opening an alternative pauses and persists before external navigation, never completes',async()=>{
 const calls=[];await openAudioAlternative('https://youtu.be/abcdefghijk',{pause:()=>calls.push('pause'),persist:async()=>calls.push('persist'),open:async url=>calls.push(url)});
 assert.deepEqual(calls,['pause','persist','https://www.youtube.com/watch?v=abcdefghijk']);
});
test('failed persistence and invalid links do not open outside the LMS',async()=>{
 const calls=[];await assert.rejects(openAudioAlternative('https://youtu.be/abcdefghijk',{pause:()=>calls.push('pause'),persist:async()=>{throw Error('disk');},open:()=>calls.push('open')}));
 assert.deepEqual(calls,['pause']);
 assert.equal(await openAudioAlternative('https://evil.test/',{pause:()=>assert.fail(),persist:()=>assert.fail(),open:()=>assert.fail()}),false);
});
test('normalization preserves native audio identity, primary URL, point order and quiz; no alternative grants availability',()=>{
 const audio='https://kentbusinesscollege.org/a.mp3',course={moduleId:'AI-MODULE',title:'AI'};
 const raw={source:'lms',courses:[course],components:[
  {moduleId:course.moduleId,componentId:'AUDIO-1',weekId:'WEEK-1',pointNumber:1,mobileMode:'audio',audioUrl:audio,alternativeYouTubeUrl:'https://youtu.be/abcdefghijk'},
  {moduleId:course.moduleId,componentId:'QUIZ-1',weekId:'WEEK-1',pointNumber:1,mobileMode:'quiz',alternativeYouTubeUrl:'https://youtu.be/abcdefghijk'},
  {moduleId:course.moduleId,componentId:'EMPTY',weekId:'WEEK-1',pointNumber:2,mobileMode:'audio',alternativeYouTubeUrl:'https://youtu.be/abcdefghijk'},
 ]};
 const model=normaliseLmsLearning(raw,{}, {},course);
 assert.deepEqual(model.activities.map(a=>a.id),['AUDIO-1','QUIZ-1','EMPTY']);
 assert.equal(model.activities[0].url,audio);assert.equal(model.activities[0].mode,'audio');
 assert.equal(model.activities[0].alternativeYouTubeUrl,'https://www.youtube.com/watch?v=abcdefghijk');
 assert.equal(model.activities[1].alternativeYouTubeUrl,null);assert.equal(model.activities[2].available,false);assert.equal(model.activities[2].alternativeYouTubeUrl,null);
});
