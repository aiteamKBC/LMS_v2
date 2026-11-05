import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as draftModel from '../src/lms-activity-state.mjs';
import * as quizModel from '../src/lms-quiz-model.mjs';
import * as choices from '../src/quiz-model.mjs';
import * as meetings from '../src/lms-meetings-model.mjs';
import * as observations from '../src/lms-observations.mjs';
import * as audioAlternative from '../src/audio-alternative.mjs';
const source=fs.readFileSync(new URL('../src/LmsActivity.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source+'\nexport {LmsActivityBody};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
function harness({mode='audio',savedStore=new Map(),failSave=false,failRemove=false,failRefresh=false,sharedTiming=false,failTiming=false,failPersist=false,rewardObservationsSupported=undefined,questionImage=null,alternativeYouTubeUrl=null}={}){
 let cursor=0,dirty=false,tree,now=0;const slots=[],effects=[],intervals=new Map(),calls=[],wall=Date.now();let intervalId=0;
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(slots[i],next)){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(effect,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={effect,deps,run:true};}}};
 const React={...hooks,createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
 const Activity={id:mode==='quiz'?'COMP-Q-UI':'COMP-A-UI',mode,title:'A learning activity',url:'https://kentbusinesscollege.org/verified.mp3',ksbs:['K1'],rewardObservationsSupported,alternativeYouTubeUrl};
 const session={authenticated:true,user:{id:'42',accountId:'7',learnerKind:'apprenticeship'},capabilities:{timeObservations:sharedTiming}};
 const ownerKey=draftModel.lmsActivityDraftKey(session,Activity);
 const token={componentId:Activity.id,activityId:mode==='quiz'?'123':Activity.id,activityKind:mode==='quiz'?'quiz':'component',countingMode:mode==='quiz'?'active_quiz':'active_playback',trackingToken:'signed-activity-session',sessionId:'synthetic-session',startedAt:new Date(wall).toISOString()};
 const rawQuiz={id:123,title:'A quiz',passingGrade:70,questions:[{id:11,type:'single_choice',text:'Choose one',answers:[{id:21,text:'First'},{id:22,text:'Second'}]},{id:12,type:'multiple_choice',text:'Choose several',answers:[{id:31,text:'First'},{id:32,text:'Second'},{id:33,text:'Third'}]}]};
 if(questionImage)rawQuiz.questions[0].imageUrl=questionImage;
 const submit=async(id,body)=>{calls.push({kind:'submit',id,body});if(failSave)throw Object.assign(new Error('Working time must be reviewed.'),{status:409});const record={kind:mode==='quiz'?'quiz':'component',componentId:Activity.id,quizId:123,timeTrackingSessionId:token.sessionId,submittedAt:new Date().toISOString(),verifiedSeconds:body.timeTakenSeconds};return mode==='quiz'?{attempt:record,grade:1,achievedScore:2,totalScore:2,passed:true,breakdown:[]}:{record};};
 let acknowledgedMs=0;
 const client={async startLearning(){calls.push({kind:'start'});return token;},async quiz(){return rawQuiz;},submitQuiz:submit,completeActivity:submit,async recordObservations(body){calls.push({kind:'observations',body});if(failTiming)throw new Error('The timing request needs a retry.');const ms=body.intervals.reduce((n,x)=>n+x.endOffsetMs-x.startOffsetMs,0);acknowledgedMs+=ms;return{source:'lms',eventId:body.eventId,sessionId:token.sessionId,sequence:body.sequence,status:'pending',observedMilliseconds:ms,cumulativeObservedMilliseconds:acknowledgedMs,duplicate:false};}};
 const storage={async getItem(key){return savedStore.get(key)||null;},async setItem(key,value){if(failPersist)throw new Error('storage refused');savedStore.set(key,value);calls.push({kind:'persist',key,value});},async removeItem(key){if(failRemove)throw new Error('storage refused');savedStore.delete(key);}};
 const modules={'react':React,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Platform:{OS:'web'},Linking:{openURL:async url=>{calls.push({kind:'external',url});}},Image:'Image',Pressable:'Pressable',Text:'Text',View:'View'},'@react-native-async-storage/async-storage':storage,'expo-speech-recognition':{useSpeechRecognitionEvent(){}},'./StandaloneMedia':{StandaloneMedia:'StandaloneMedia'},'./ActivityTimer':{ActivityTimer:'ActivityTimer'},'./StandaloneUI':Object.fromEntries(['Back','Btn','Busy','Card','Field','H','Notice','Txt'].map(x=>[x,x])),'./styles':{s:{}},'./voice':{stopVoice:async()=>{},requestDictation:async()=>false},'./quiz-model.mjs':choices,'./lms-quiz-model.mjs':quizModel,'./lms-activity-state.mjs':draftModel,'./lms-meetings-model.mjs':meetings,'./lms-observations.mjs':observations,'./audio-alternative.mjs':audioAlternative};
 const mod={exports:{}};
 new Function('require','exports','globalThis','setInterval','clearInterval',compiled)(name=>{if(!modules[name])throw new Error(name);return modules[name];},mod.exports,{performance:{now:()=>now},document:{hidden:false,addEventListener(){},removeEventListener(){}}},fn=>{intervals.set(++intervalId,fn);return intervalId;},id=>intervals.delete(id));
 const props={client,session,activity:Activity,ownerKey,onBack(){calls.push({kind:'back'});},onSaved(){calls.push({kind:'saved'});if(failRefresh)throw new Error('refresh failed');}};
 const render=()=>{let loop=0;do{assert(++loop<50);dirty=false;cursor=0;tree=mod.exports.LmsActivityBody(props);for(const item of effects)if(item?.run){item.run=false;item.cleanup=item.effect();}}while(dirty);};
 const settle=async()=>{for(let i=0;i<35;i++){await Promise.resolve();if(dirty)render();}};
 const all=()=>{const nodes=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object'){nodes.push(n);walk(n.props?.children);}};walk(tree);return nodes;};
 const btn=title=>all().find(n=>n.type==='Btn'&&n.props.title===title);
 render();
 return {calls,savedStore,ownerKey,settle,all,btn,async press(title){const b=btn(title);assert(b,'Button exists: '+title);assert(!b.props.disabled,'Button enabled: '+title);await b.props.onPress();await settle();},async tick(ms){now=ms;for(const fn of intervals.values())fn();await settle();},async media(ms,position,playing=true){now=ms;const player=all().find(x=>x.type==='StandaloneMedia');assert(player);player.props.onSignal({playing,buffering:false,positionSeconds:position,durationSeconds:60,playbackRate:1});await settle();},async choose(index){const option=all().filter(x=>x.type==='Pressable'&&['radio','checkbox'].includes(x.props.accessibilityRole))[index];assert(option);option.props.onPress();await settle();},async unmount(){for(const e of effects)e?.cleanup?.();await settle();}};
}
test('actual audio screen saves only measured playback and clears draft after matching confirmation',async()=>{
 const h=harness();await h.settle();await h.media(0,0);await h.media(1000,1);await h.media(2000,2);
 await h.press('I’ve finished · save to LMS');assert.equal(h.calls.find(x=>x.kind==='submit').body.timeTakenSeconds,2);assert.equal(h.calls.filter(x=>x.kind==='saved').length,1);assert(!h.savedStore.has(h.ownerKey));assert(h.btn('Back to my learning'));await h.unmount();
});
test('409 keeps measured time and the same signed draft; reopening never invents a new timer',async()=>{
 const h=harness({failSave:true});await h.settle();await h.media(0,0);await h.media(1000,1);await h.media(2000,2);await h.press('I’ve finished · save to LMS');assert(h.savedStore.has(h.ownerKey));assert.equal(h.calls.filter(x=>x.kind==='saved').length,0);assert(h.btn('Continue this activity'));await h.unmount();
 const resumed=harness({savedStore:h.savedStore});await resumed.settle();assert.equal(resumed.calls.filter(x=>x.kind==='start').length,0);assert.equal(JSON.parse(resumed.savedStore.get(resumed.ownerKey)).seconds,2);assert(resumed.btn('Check my LMS progress before retrying'));await resumed.unmount();
});
test('actual quiz screen submits canonical single and multiple IDs, not visible letters',async()=>{
 const h=harness({mode:'quiz'});await h.settle();await h.tick(0);await h.tick(1000);await h.choose(1);await h.press('Next question');await h.choose(0);await h.choose(2);await h.tick(2000);await h.press('Submit my answers');assert.deepEqual(h.calls.find(x=>x.kind==='submit').body.answers,{'11':22,'12':[31,33]});assert.equal(h.calls.filter(x=>x.kind==='saved').length,1);assert(!h.savedStore.has(h.ownerKey));await h.unmount();
});
test('a confirmed LMS save remains confirmed when local draft removal or dashboard refresh fails',async()=>{
 for(const options of [{failRemove:true},{failRefresh:true}]){const h=harness(options);await h.settle();await h.media(0,0);await h.media(1000,1);await h.press('I’ve finished · save to LMS');assert(h.btn('Back to my learning'));assert.equal(h.calls.filter(x=>x.kind==='saved').length,1);assert.equal(h.calls.filter(x=>x.kind==='submit').length,1);await h.unmount();}
});
test('enabled shared timing saves short observations before the canonical progress record',async()=>{
 const h=harness({sharedTiming:true});await h.settle();await h.media(0,0);await h.media(1000,1);await h.media(2000,2);await h.press('I’ve finished · save to LMS');
 const sent=h.calls.find(x=>x.kind==='observations');assert.equal(sent.body.intervals.reduce((n,x)=>n+x.endOffsetMs-x.startOffsetMs,0),2000);assert.equal(sent.body.mode,'audio');
 assert(h.calls.findIndex(x=>x.kind==='observations')<h.calls.findIndex(x=>x.kind==='submit'));assert(h.btn('Back to my learning'));await h.unmount();
});

test('standalone quiz route preserves canonical grading and signed time without recording unsupported reward observations',async()=>{
 const h=harness({mode:'quiz',sharedTiming:true,rewardObservationsSupported:false});await h.settle();
 await h.tick(0);await h.tick(1000);await h.choose(1);await h.press('Next question');await h.choose(0);await h.choose(2);await h.tick(2000);
 assert.equal(JSON.parse(h.savedStore.get(h.ownerKey)).observations,undefined,'No unsupported component observation queue is recorded');
 await h.press('Submit my answers');assert.equal(h.calls.filter(x=>x.kind==='observations').length,0);
 const saved=h.calls.find(x=>x.kind==='submit');assert.equal(saved.id,'COMP-Q-UI');assert.deepEqual(saved.body.answers,{'11':22,'12':[31,33]});assert.equal(saved.body.timeTakenSeconds,2);assert.equal(h.calls.filter(x=>x.kind==='saved').length,1);assert(h.btn('Back to my learning'));await h.unmount();
});
test('unconfirmed timing receipt preserves exact batch and does not submit progress twice',async()=>{
 const h=harness({sharedTiming:true,failTiming:true});await h.settle();await h.media(0,0);await h.media(1000,1);await h.press('I’ve finished · save to LMS');
 const draft=JSON.parse(h.savedStore.get(h.ownerKey));assert.equal(draft.observations.inFlight.sequence,1);assert.equal(draft.observations.inFlight.intervals.length,1);assert.equal(h.calls.filter(x=>x.kind==='submit').length,0);await h.unmount();
});
test('observation recovery exposes restart and preserves answers when the saved timing queue is damaged',async()=>{
 const h=harness({sharedTiming:true,failTiming:true});await h.settle();await h.media(0,0);await h.media(1000,1);await h.press('I’ve finished · save to LMS');await h.unmount();
 const draft=JSON.parse(h.savedStore.get(h.ownerKey));draft.observations.nextSequence=0;draft.feedback='Saved workplace reflection';h.savedStore.set(h.ownerKey,JSON.stringify(draft));
 const reopened=harness({sharedTiming:true,savedStore:h.savedStore});await reopened.settle();assert(reopened.btn('Start a new timed visit'));assert.equal(reopened.all().find(x=>x.type==='Field').props.value,'Saved workplace reflection');await reopened.press('Start a new timed visit');assert.equal(reopened.calls.filter(x=>x.kind==='start').length,1);await reopened.unmount();
});
test('failed durable draft write blocks both observation and canonical network writes',async()=>{
 const h=harness({sharedTiming:true,failPersist:true});await h.settle();await h.media(0,0);await h.media(1000,1);await h.press('I’ve finished · save to LMS');assert.equal(h.calls.filter(x=>['observations','submit'].includes(x.kind)).length,0);await h.unmount();
});

test('diagram question renders before choices, waits for the image and submits only after it is visible',async()=>{
 const uri='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG9UAAAAASUVORK5CYII=';
 const h=harness({mode:'quiz',questionImage:uri});await h.settle();
 const image=h.all().find(node=>node.type==='Image');assert(image);assert.equal(image.props.source.uri,uri);assert.equal(image.props.resizeMode,'contain');assert.equal(image.props.accessibilityLabel,'Diagram for question 1');
 const options=h.all().filter(node=>node.type==='Pressable');assert(options.every(option=>option.props.disabled));
 await h.tick(0);await h.tick(2000);assert(h.btn('Submit my answers').props.disabled);
 image.props.onLoad({nativeEvent:{source:{width:640,height:480}}});await h.settle();assert(h.all().filter(node=>node.type==='Pressable').every(option=>!option.props.disabled));
 await h.tick(3000);await h.choose(1);await h.press('Next question');await h.choose(0);await h.choose(2);await h.tick(4000);await h.press('Submit my answers');
 const saved=h.calls.find(call=>call.kind==='submit');assert(saved);assert(saved.body.timeTakenSeconds>0&&saved.body.timeTakenSeconds<=2,'Waiting for an unseen diagram is not measured study');assert.deepEqual(saved.body.answers,{'11':22,'12':[31,33]});await h.unmount();
});

test('failed diagram load is explicit, blocks grading and offers a retry',async()=>{
 const h=harness({mode:'quiz',questionImage:'https://kentbusinesscollege.org/diagram.png'});await h.settle();
 const image=h.all().find(node=>node.type==='Image');image.props.onError();await h.settle();
 assert(h.btn('Retry question image'));assert(h.btn('Open quiz in the LMS'));assert(h.btn('Submit my answers').props.disabled);assert(h.all().filter(node=>node.type==='Pressable').every(option=>option.props.disabled));
 await h.press('Retry question image');assert(!h.btn('Retry question image'));assert.notEqual(h.all().find(node=>node.type==='Image').props.key,image.props.key);assert.equal(h.calls.filter(call=>call.kind==='submit').length,0);await h.unmount();
});

test('unsupported diagram does not open a timed incomplete quiz',async()=>{
 const h=harness({mode:'quiz',questionImage:'data:image/svg+xml;base64,PHN2Zy8+'});await h.settle();
 assert.equal(h.calls.filter(call=>call.kind==='start').length,0);assert(!h.btn('Submit my answers'));assert(h.btn('Open quiz in the LMS'));await h.unmount();
});


test('YouTube alternative pauses the actual audio screen and persists measured time before leaving',async()=>{
 const h=harness({alternativeYouTubeUrl:'https://youtu.be/r9u6U1SeDxs'});await h.settle();
 await h.media(0,0);await h.media(1000,1);await h.media(2000,2);
 const player=h.all().find(node=>node.type==='StandaloneMedia');
 assert.equal(player.props.resource.url,'https://kentbusinesscollege.org/verified.mp3');
 assert.equal(player.props.resource.id,'COMP-A-UI');assert.equal(player.props.active,true);
 const before=h.calls.length;await h.press('Listen to this recording on YouTube');
 const leaving=h.calls.slice(before);assert.equal(leaving.at(-1).kind,'external');
 assert.equal(leaving.at(-1).url,'https://www.youtube.com/watch?v=r9u6U1SeDxs');
 assert(leaving.slice(0,-1).some(call=>call.kind==='persist'));
 assert.equal(h.all().find(node=>node.type==='StandaloneMedia').props.active,false);
 const saved=JSON.parse(h.savedStore.get(h.ownerKey));assert.equal(saved.seconds,2);
 assert.equal(h.calls.filter(call=>['submit','observations'].includes(call.kind)).length,0);
 await h.media(7000,7);await h.press('I’ve finished · save to LMS');
 assert.equal(h.calls.find(call=>call.kind==='submit').body.timeTakenSeconds,2,'external playback adds no LMS study time');
 await h.unmount();
});

test('failed draft persistence blocks the actual screen external handoff and retains the audiobook',async()=>{
 const h=harness({alternativeYouTubeUrl:'https://youtu.be/r9u6U1SeDxs',failPersist:true});await h.settle();
 await h.press('Listen to this recording on YouTube');
 assert.equal(h.calls.filter(call=>call.kind==='external').length,0);
 assert.equal(h.all().find(node=>node.type==='StandaloneMedia').props.resource.url,'https://kentbusinesscollege.org/verified.mp3');
 assert(h.btn('Continue this activity'));await h.unmount();
});

test('invalid or non-audio alternatives are not rendered by the actual screen',async()=>{
 for(const options of [{alternativeYouTubeUrl:'https://youtube.com.evil.test/watch?v=r9u6U1SeDxs'},{mode:'video',alternativeYouTubeUrl:'https://youtu.be/r9u6U1SeDxs'}]){
  const h=harness(options);await h.settle();assert(!h.btn('Listen to this recording on YouTube'));await h.unmount();
 }
});
