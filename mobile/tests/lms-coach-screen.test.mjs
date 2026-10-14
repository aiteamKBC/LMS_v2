import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as model from '../src/lms-coach-model.mjs';
import * as quizModel from '../src/lms-quiz-model.mjs';
import * as answers from '../src/quiz-model.mjs';
import * as fixture from './lms-coach-fixtures.mjs';
const compile=name=>ts.transpileModule(fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const code=compile('LmsCoach.tsx'),uiCode=compile('StandaloneUI.tsx');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness({component='LmsCoach',page='learners',handlers={},extra={}}={}){
 let cursor=0,dirty=false,tree;const slots=[],effects=[],events=new Set(),calls=[];
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useRef(initial){return slots[cursor++]??={current:initial};},useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((x,j)=>!Object.is(x,old.deps[j]))){old?.cleanup?.();effects[i]={fn,deps,run:true};}},useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((x,j)=>!Object.is(x,old.deps[j])))slots[i]={fn,deps};return slots[i].fn;}};
 const React={...hooks,createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
 const native={AppState:{addEventListener:(name,fn)=>{events.add(fn);return{remove:()=>events.delete(fn)};}},...Object.fromEntries(['View','Text','Pressable','TextInput','Image','ActivityIndicator'].map(x=>[x,x]))};
 const defaults={coachLearners:fixture.roster,coachLearner:fixture.detail,coachCatalogue:fixture.catalogue,coachProgress:fixture.progress,coachQuiz:fixture.quiz,coachTranscript:id=>({...fixture.envelope(id),componentId:'A-AUDIO',transcript:'Synthetic transcript'})};
 const client=new Proxy({}, {get(target,name){if(!(name in defaults))throw new Error('Unexpected client access: '+String(name));return async(...args)=>{calls.push({name,args});return(handlers[name]||defaults[name])(...args);};}});
 const modules={'react':React,'react-native':native,'./styles':{s:{},base:{green:'#143F37',pale:'#E9EFE5'}},'@expo/vector-icons':{Ionicons:'Ionicons'},'./StandaloneMedia':{StandaloneMedia:'StandaloneMedia'},'./lms-coach-model.mjs':model,'./lms-quiz-model.mjs':quizModel,'./quiz-model.mjs':answers};
 const ui={};new Function('require','exports',uiCode)(name=>modules[name],ui);modules['./StandaloneUI']=ui;
 const mod={};new Function('require','exports',code)(name=>name.endsWith('.png')?{}:modules[name],mod);
 const props={client,session:fixture.session,page,onNavigate(next){props.page=next;dirty=true;},onMessage(id){calls.push({name:'message',args:[id]});},onOpenLms(url){calls.push({name:'open',args:[url]});},...extra};
 const render=()=>{let loops=0;do{assert(++loops<60,'component settles');dirty=false;cursor=0;tree=mod[component](props);for(const effect of effects)if(effect?.run){effect.run=false;effect.cleanup=effect.fn();}}while(dirty);};
 const settle=async()=>{for(let i=0;i<50;i++){await Promise.resolve();if(dirty)render();}};
 const nodes=()=>{const out=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object'){out.push(n);if(typeof n.type==='function'&&n.type.name!=='LmsCoachPreview')walk(n.type(n.props));else walk(n.props?.children);}};walk(tree);return out;};
 const button=label=>nodes().find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);
 render();return{calls,props,handlers,nodes,button,settle,text:()=>nodes().filter(n=>n.type==='Text').flatMap(n=>n.props.children).flat(Infinity).filter(x=>typeof x==='string'||typeof x==='number').join('\n'),async press(label){const item=button(label);assert(item,'button exists: '+label);assert(!item.props.disabled,'button enabled: '+label);await item.props.onPress();await settle();},async page(next){props.page=next;dirty=true;await settle();},async update(value){Object.assign(props,value);dirty=true;await settle();},async foreground(){for(const fn of events)fn('active');await settle();},unmount(){for(const effect of effects)effect?.cleanup?.();}};
}
test('coach uses canonical selected learner across progress, materials, points and direct chat without learner writes',async()=>{
 const h=harness();try{await h.settle();await h.press('Synthetic learner 11');assert(h.text().includes('Accepted OTJ:'));assert(h.text().includes('2 h'));assert(h.text().includes('75%'));assert(!h.text().includes('999%'));
  await h.press('Message learner');assert.deepEqual(h.calls.find(x=>x.name==='message').args,['111']);
  await h.page('points');assert(h.text().includes('Synthetic alias'));assert(!h.button('Request voucher'));assert(!h.button('Join leaderboard'));
  await h.page('materials');await h.press('Week 1');await h.press('Synthetic audio');const preview=h.nodes().find(x=>x.type.name==='LmsCoachPreview');assert.equal(preview.props.profileId,'11');assert.equal(preview.props.activity.id,'A-AUDIO');
  assert(h.calls.filter(x=>x.name.startsWith('coach')).every(x=>['coachLearners','coachLearner','coachCatalogue','coachProgress'].includes(x.name)));
 }finally{h.unmount();}
});
test('late learner responses never replace a subsequently selected learner',async()=>{
 const old=deferred(),h=harness({handlers:{coachLearner:id=>id==='11'?old.promise:fixture.detail(id)}});try{await h.settle();await h.press('Synthetic learner 11');await h.press('Change learner');await h.press('Synthetic learner 12');assert(h.text().includes('7 h'));
  old.resolve(fixture.detail('11'));await h.settle();assert(h.text().includes('Synthetic learner 12'));assert(!h.text().includes('Synthetic learner 11'));assert(h.text().includes('7 h'));
 }finally{h.unmount();}
});
test('late course progress cannot appear under a different course',async()=>{
 const old=deferred(),h=harness({handlers:{coachProgress:(id,moduleId)=>moduleId==='MOD-A'?old.promise:fixture.progress(id,moduleId)}});try{await h.settle();await h.press('Synthetic learner 11');await h.press('Synthetic course B');assert(h.text().includes('Second course audio')===false);assert(h.text().includes('Synthetic course B'));
  old.resolve({...fixture.progress(),quizAttempts:[{componentId:'A-QUIZ',quizId:999,achievedScore:1,totalScore:1,passed:true}]});await h.settle();assert(!h.text().includes('Quiz 999'));assert(!h.text().includes('100%'));
 }finally{h.unmount();}
});
test('foreground rechecks assignment and a 404 clears selected materials and metrics',async()=>{
 const h=harness();try{await h.settle();await h.press('Synthetic learner 11');await h.page('materials');await h.press('Week 1');await h.press('Synthetic video');assert(h.nodes().some(x=>x.type.name==='LmsCoachPreview'));
  h.handlers.coachLearner=()=>{throw Object.assign(new Error('Learner no longer assigned.'),{status:404});};await h.foreground();assert(h.text().includes('Learner no longer assigned.'));assert(!h.nodes().some(x=>x.type.name==='LmsCoachPreview'));assert(!h.text().includes('Synthetic video'));assert(!h.text().includes('2 h'));
 }finally{h.unmount();}
});
test('an empty assigned roster and a server failure remain distinct',async()=>{
 const empty=harness({handlers:{coachLearners:()=>({...fixture.roster(),learners:[]})}});try{await empty.settle();assert(empty.text().includes('No current learners are assigned'));}finally{empty.unmount();}
 const failed=harness({handlers:{coachLearners:()=>{throw new Error('Temporary LMS outage.');}}});try{await failed.settle();assert(failed.text().includes('Temporary LMS outage.'));assert(!failed.text().includes('No current learners are assigned'));}finally{failed.unmount();}
});
test('inactive assigned learner retains valid programme hours and points when materials are unavailable',async()=>{
 const h=harness({handlers:{coachCatalogue:()=>{throw Object.assign(new Error('This learner is not currently active.'),{status:409,code:'learner_profile_inactive'});}}});try{await h.settle();await h.press('Synthetic learner 11');assert(h.text().includes('2 h'));assert(h.text().includes('Materials are unavailable:'));await h.page('points');assert(h.text().includes('Synthetic alias'));await h.page('materials');assert(h.text().includes('Materials are unavailable:'));assert(!h.button('Week 1'));assert(!h.calls.some(x=>x.name==='coachProgress'));}finally{h.unmount();}
});
test('catalogue identity refusal clears detail instead of presenting a partially authorised record',async()=>{
 for(const status of [401,403,404]){
  const h=harness({handlers:{coachCatalogue:()=>{throw Object.assign(new Error('Access no longer available.'),{status});}}});try{await h.settle();await h.press('Synthetic learner 11');assert(h.text().includes('Access no longer available.'));assert(!h.text().includes('2 h'));await h.page('points');assert(!h.text().includes('Synthetic alias'));}finally{h.unmount();}
 }
});
test('catalogue from a relinked enrolment cannot be combined with the selected learner detail',async()=>{
 const h=harness({handlers:{coachCatalogue:id=>({...fixture.catalogue(id),learner:{...fixture.learner(id),learnerId:'999'}})}});try{await h.settle();await h.press('Synthetic learner 11');assert(h.text().includes('identity changed'));assert(!h.text().includes('2 h'));await h.page('materials');assert(!h.button('Week 1'));assert(!h.calls.some(x=>x.name==='coachProgress'));}finally{h.unmount();}
});
test('a relinked course progress response removes the earlier learner details and materials',async()=>{
 const h=harness({handlers:{coachProgress:(id,moduleId)=>({...fixture.progress(id,moduleId),learner:{...fixture.learner(id),learnerKind:'commercial'}})}});try{await h.settle();await h.press('Synthetic learner 11');assert(h.text().includes('identity changed'));assert(!h.text().includes('2 h'));await h.page('materials');assert(!h.button('Week 1'));}finally{h.unmount();}
});
test('materials picker stays on materials after learner selection and paginates explicitly',async()=>{
 const h=harness({page:'materials',handlers:{coachLearners:before=>before?{...fixture.envelope(),learners:[fixture.learner('9')],nextBefore:null}:{...fixture.roster(),nextBefore:'10'}}});try{await h.settle();await h.press('Load more learners');assert(h.button('Synthetic learner 9'));await h.press('Synthetic learner 9');assert.equal(h.props.page,'materials');assert(h.text().includes('Course materials'));assert(h.calls.some(x=>x.name==='coachLearners'&&x.args[0]==='10'));}finally{h.unmount();}
});
const activity={id:'A-QUIZ',moduleId:'MOD-A',title:'Synthetic MCQ',mode:'quiz',available:true};
test('coach diagram MCQ preview accepts a sixth option locally and has no grading or timing request',async()=>{
 const h=harness({component:'LmsCoachPreview',extra:{accountId:'7',profileId:'11',activity,onBack(){}}});try{await h.settle();const option=h.button('F. Choice 6');assert(option.props.disabled);const image=h.nodes().find(n=>n.type==='Image');assert.equal(image.props.source.uri,fixture.quiz().questions[0].imageUrl);image.props.onLoad();await h.settle();await h.press('F. Choice 6');assert.equal(h.button('F. Choice 6').props.accessibilityState.checked,true);assert(!h.text().includes('Correct answers: F'));await h.press('Show correct answers');assert(h.text().includes('Correct answers: F'));assert(h.text().includes('No attempt is submitted or marked.'));assert(!h.button('Submit answers'));assert.deepEqual(h.calls.map(x=>x.name),['coachQuiz']);}finally{h.unmount();}
});
test('quiz responses must match the requested activity and old preview reads are ignored after changing learner',async()=>{
 const old=deferred(),h=harness({component:'LmsCoachPreview',handlers:{coachQuiz:id=>id==='11'?old.promise:{...fixture.quiz(id),questions:[{...fixture.quiz(id).questions[0],text:'Second learner question'}]}},extra:{accountId:'7',profileId:'11',activity,onBack(){}}});try{await h.settle();await h.update({profileId:'12'});assert(h.text().includes('Second learner question'));old.resolve(fixture.quiz());await h.settle();assert(h.text().includes('Second learner question'));assert(!h.text().includes('Select the matching labels.'));}finally{h.unmount();}
 const wrong=harness({component:'LmsCoachPreview',handlers:{coachQuiz:()=>({...fixture.quiz(),componentId:'OTHER'})},extra:{accountId:'7',profileId:'11',activity,onBack(){}}});try{await wrong.settle();assert(wrong.text().includes('different activity'));assert(!wrong.button('F. Choice 6'));}finally{wrong.unmount();}
});
test('audio preview has no learning callbacks and a revoked transcript stops the parent preview',async()=>{
 const revoked=[],h=harness({component:'LmsCoachPreview',handlers:{coachTranscript:()=>{throw Object.assign(new Error('Assignment removed.'),{status:404});}},extra:{accountId:'7',profileId:'11',activity:{...activity,id:'A-AUDIO',mode:'audio',url:fixture.catalogue().components[0].audioUrl,transcriptAvailable:true},onBack(){},onUnavailable:message=>revoked.push(message)}});try{await h.settle();const media=h.nodes().find(x=>x.type==='StandaloneMedia');for(const key of ['onSignal','onActiveChange','onInteraction','onTranscriptChange'])assert.equal(media.props[key],undefined);assert.equal(media.props.allowBackgroundAudio,false);assert.deepEqual(revoked,['Assignment removed.']);assert.deepEqual(h.calls.map(x=>x.name),['coachTranscript']);}finally{h.unmount();}
});
