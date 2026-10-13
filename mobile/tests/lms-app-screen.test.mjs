import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as learning from '../src/lms-learning-model.mjs';
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const appCode=compile(fs.readFileSync(new URL('../src/LmsApp.tsx',import.meta.url),'utf8')+'\nexport {LmsShell};');
const uiCode=compile(fs.readFileSync(new URL('../src/StandaloneUI.tsx',import.meta.url),'utf8'));
const account=(id='42',accountId='7')=>({authenticated:true,user:{id,accountId,learnerKind:'apprenticeship',displayName:'Synthetic learner'}});
const component=(id,week,patch={})=>({componentId:id,moduleId:learning.PMP_ID,weekId:'PMP-W'+String(week).padStart(2,'0'),week:week?'Week '+week+' learning':'Welcome week',component:'Learning '+id,mobileMode:'audio',audioUrl:'https://kentbusinesscollege.org/audio.mp3',...patch});
const catalogue=(patch={})=>({source:'lms',components:[component('PMP-W00-INTRO',0),component('PMP-W01-P01-AUDIO',1),component('PMP-W01-P01-QUIZ',1,{component:'Practice your learning',mobileMode:'quiz',stage:'quiz',learningRoute:{required:true,optional:false}}),component('OTHER-W01-P01-AUDIO',1,{moduleId:'MOD-COPY-PMP',component:'Another learner course copy'})],...patch});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function harness({initialSession=account(),content=catalogue(),progress={completedHours:2,progressKsbCodes:['K1']},stored=new Map(),signOutFails=false,signOutStorageFails=false,signInError=null,placeGate=null,failCatalogue=false,failProgress=false,initialSessionFails=false}={}){
 let cursor=0,dirty=false,tree,expiryCallback,nextSession=initialSession,nextContent=content,nextProgress=progress,contentGate=null;const slots=[],effects=[],calls=[],events=new Map();
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(effect,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={effect,deps,run:true};}},useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={fn,deps};return slots[i].fn;}};
 const React={...hooks,createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
 const native={AppState:{addEventListener:(name,fn)=>{const id=Symbol(name);events.set(id,{name,fn});return {remove:()=>events.delete(id)};}},BackHandler:{addEventListener:()=>({remove(){}})},Linking:{openURL:async url=>{calls.push({kind:'link',url});}},Platform:{OS:'web'},...Object.fromEntries(['Image','Pressable','ScrollView','Text','View','TextInput','ActivityIndicator'].map(x=>[x,x]))};
 const client={async session(){calls.push({kind:'session'});if(initialSessionFails)throw Object.assign(new Error('Please sign in'),{status:401});return nextSession;},async catalogue(){calls.push({kind:'catalogue'});if(contentGate)return contentGate.promise;if(failCatalogue)throw new Error('LMS catalogue unavailable');return nextContent;},async progress(moduleId){calls.push({kind:'progress',moduleId});if(failProgress)throw new Error('LMS progress unavailable');return typeof nextProgress==='function'?nextProgress(moduleId):nextProgress;},async signIn(email,password){calls.push({kind:'signin',email,password});if(signInError)throw signInError;return nextSession;},async signOut(){calls.push({kind:'signout'});if(signOutFails)throw new Error('Network unavailable');}};
 const storage={async getItem(key){calls.push({kind:'get',key});if(placeGate&&key.startsWith('kbc:lms:place:'))return placeGate.promise;return stored.get(key)||null;},async setItem(key,value){calls.push({kind:'set',key,value});if(signOutStorageFails&&key==='kbc:lms:requires-signin')throw new Error('Phone storage unavailable');stored.set(key,value);},async removeItem(key){stored.delete(key);calls.push({kind:'remove',key});}};
 const baseModules={'react':React,'react-native':native,'./styles':{s:{},base:{green:'#123'}},'@expo/vector-icons':{Ionicons:'Ionicons'}};
 const ui={exports:{}};new Function('require','exports',uiCode)(name=>baseModules[name],ui.exports);
 const modules={...baseModules,'./LmsCommunications':{LmsCommunications:'LmsCommunications'},'./mobile-push':{useMobilePush:()=>({disconnect:async()=>{},status:'',busy:false,connect:async()=>{}})},'react-native-safe-area-context':{SafeAreaProvider:'SafeAreaProvider',SafeAreaView:'SafeAreaView'},'@react-native-async-storage/async-storage':storage,'expo-status-bar':{StatusBar:'StatusBar'},'./lms-client.mjs':{LMS_ORIGIN:'https://lms.kentbusinesscollege.org',createLmsClient:options=>{expiryCallback=options.onSessionExpired;return client;}},'./lms-learning-model.mjs':learning,'./data/pmp-lms-narration-index.json':{},'./data/pmp-lms-presentation-index.json':{},'./StandaloneUI':ui.exports,'./LmsPoints':{LmsPointsScreen:'LmsPointsScreen'},'./LmsMeetings':{LmsMeetings:'LmsMeetings',useLmsMeetings:()=>({data:null})},'./LmsHours':{LmsHours:'LmsHours'},'./LmsActivity':{__esModule:true,default:'LmsActivity'}};
 const mod={exports:{}};new Function('require','exports',appCode)(name=>name.endsWith('.png')?{}:modules[name]||(()=>{throw new Error('Unexpected import '+name);})(),mod.exports);
 const render=()=>{let loop=0;do{assert(++loop<60,'Shell settles after state changes');dirty=false;cursor=0;tree=mod.exports.LmsShell();for(const item of effects)if(item?.run){item.run=false;item.cleanup=item.effect();}}while(dirty);};
 const settle=async()=>{for(let i=0;i<45;i++){await Promise.resolve();if(dirty)render();}};
 const all=()=>{const nodes=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object'){nodes.push(n);if(typeof n.type==='function')walk(n.type(n.props));else walk(n.props?.children);}};walk(tree);return nodes;};
 const texts=()=>all().filter(n=>n.type==='Text').flatMap(n=>n.props.children).flat(Infinity).filter(x=>typeof x==='string').join('\n');
 const findButton=label=>all().find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);
 render();return {calls,stored,all,texts,settle,findButton,get activity(){return all().find(n=>n.type==='LmsActivity');},get fields(){return all().filter(n=>n.type==='TextInput');},async press(label){const node=findButton(label);assert(node,'Accessible action exists: '+label);assert(!node.props.disabled);await node.props.onPress();await settle();},async setField(label,value){const field=all().find(n=>n.type==='TextInput'&&n.props.accessibilityLabel===label);assert(field);field.props.onChangeText(value);await settle();},async expire(){expiryCallback();await settle();},async foreground(){for(const event of [...events.values()])if(event.name==='change')event.fn('active');await settle();},async refreshActivity(){assert(this.activity);await this.activity.props.onSaved({synthetic:true});await settle();},setAccount(value,newContent=content){nextSession=value;nextContent=newContent;},setProgress(value){nextProgress=value;},setContentGate(value){contentGate=value;},setContent(value){nextContent=value;},async unmount(){for(const e of effects)e?.cleanup?.();await settle();}};
}

test('root shell exposes only the canonical assigned course and an accessible week-point-activity path',async()=>{
 const h=harness();await h.settle();assert(h.texts().includes('Stakeholder Management and Reporting'));await h.press('Choose a week');assert(!h.texts().includes('Another learner course copy'));
 await h.press('Week 1 learning');await h.press('Point 1');assert(h.findButton('Begin next activity'));await h.press('Show the steps');assert(h.findButton('Learning PMP-W01-P01-AUDIO'));assert(h.findButton('Practice your learning'));
 await h.press('Practice your learning');assert.equal(h.activity.props.activity.id,'PMP-W01-P01-QUIZ');assert.equal(h.activity.props.activity.moduleId,learning.PMP_ID);assert(h.activity.props.onBack);await h.unmount();
});
test('confirmed quiz save refreshes LMS totals without replacing the activity result screen',async()=>{
 const h=harness();await h.settle();await h.press('Choose a week');await h.press('Week 1 learning');await h.press('Point 1');await h.press('Show the steps');await h.press('Practice your learning');const before=h.activity.props.key;
 h.setProgress({completedHours:3});await h.refreshActivity();assert(h.activity,'Quiz result component remains mounted');assert.equal(h.activity.props.key,before);assert.equal(h.activity.props.activity.id,'PMP-W01-P01-QUIZ');assert(h.calls.filter(x=>x.kind==='progress').length>=2);await h.unmount();
});
test('place restoration waits for storage before writing and restores the correct saved week',async()=>{
 const gate=deferred(),h=harness({placeGate:gate});await h.settle();assert.equal(h.calls.filter(x=>x.kind==='set'&&x.key.startsWith('kbc:lms:place:')).length,0);
 gate.resolve(JSON.stringify({weekId:'PMP-W01'}));await h.settle();const places=h.calls.filter(x=>x.kind==='set'&&x.key.startsWith('kbc:lms:place:'));assert(places.length>0);assert(places.every(x=>JSON.parse(x.value).weekId==='PMP-W01'));await h.press('This week, point by point');assert(h.texts().includes('Week 1 learning'));await h.unmount();
});
test('network catalogue errors are not displayed as no course assignment',async()=>{
 const h=harness({failCatalogue:true});await h.settle();assert(h.texts().includes('LMS catalogue unavailable'));assert(!h.texts().includes('is not currently assigned'));assert(h.findButton('Try again'));await h.unmount();
 const empty=harness({content:catalogue({components:[]})});await empty.settle();assert(empty.texts().includes('is not currently assigned'));assert(!empty.texts().includes('LMS catalogue unavailable'));await empty.unmount();
});
test('unavailable LMS totals remain unavailable rather than appearing as zero hours',async()=>{
 const h=harness({failProgress:true});await h.settle();await h.press('Progress');assert(h.texts().includes('LMS progress unavailable'));assert(h.texts().includes('Unavailable'));await h.unmount();
});
test('failed server sign-out immediately clears personal content and prevents silent cookie re-entry',async()=>{
 const h=harness({signOutFails:true});await h.settle();await h.press('Continue learning');assert(h.activity);await h.activity.props.onBack();await h.settle();await h.press('Settings');await h.press('Sign out');
 assert(!h.activity);assert(h.findButton('Sign in'));assert(!h.findButton('Settings'));assert(!h.texts().includes('Learning PMP-W00-INTRO'));assert.equal(h.stored.get('kbc:lms:requires-signin'),'true');
 const sessionCalls=h.calls.filter(x=>x.kind==='session').length;await h.press('Check connection again');assert.equal(h.calls.filter(x=>x.kind==='session').length,sessionCalls);assert(!h.activity);await h.unmount();
});
test('session expiry clears account data and a late foreground response cannot restore it',async()=>{
 const h=harness();await h.settle();const gate=deferred();h.setContentGate(gate);await h.foreground();await h.expire();assert(h.findButton('Sign in'));
 gate.resolve(catalogue());await h.settle();assert(h.findButton('Sign in'));assert(!h.findButton('Settings'));assert(!h.findButton('Continue learning'));await h.unmount();
});
test('fresh sign-in clears password input and keeps course place isolated from previous account',async()=>{
 const stored=new Map([['kbc:lms:place:7:apprenticeship:42:'+learning.PMP_ID,JSON.stringify({weekId:'PMP-W01'})]]),h=harness({stored});await h.settle();await h.expire();h.setAccount(account('43','8'));
 await h.setField('LMS email','synthetic@example.test');await h.setField('LMS password','synthetic-test-password');await h.press('Sign in');assert(!h.fields.some(f=>f.props.value==='synthetic-test-password'));
 await h.press('This week, point by point');assert(h.texts().includes('Welcome week'));assert.equal(JSON.parse(stored.get('kbc:lms:place:7:apprenticeship:42:'+learning.PMP_ID)).weekId,'PMP-W01');assert.equal(JSON.parse(stored.get('kbc:lms:place:8:apprenticeship:43:'+learning.PMP_ID)).weekId,'PMP-W00');await h.unmount();
});
test('phone storage failure cannot skip server logout or silently reopen the cleared account',async()=>{
 const h=harness({signOutFails:true,signOutStorageFails:true});await h.settle();await h.press('Settings');await h.press('Sign out');
 assert(h.findButton('Sign in'));assert.equal(h.calls.filter(x=>x.kind==='signout').length,1,'Server logout is still attempted after a local storage error');
 const previous=h.calls.filter(x=>x.kind==='session').length;await h.press('Check connection again');assert.equal(h.calls.filter(x=>x.kind==='session').length,previous,'Explicit logout remains in force in memory even if persistence failed');assert(!h.findButton('Settings'));await h.unmount();
});
test('a failed request from an expired account cannot put its error into the next learner screen',async()=>{
 const h=harness();await h.settle();const gate=deferred();h.setContentGate(gate);await h.foreground();await h.expire();h.setContentGate(null);h.setAccount(account('43','8'));
 await h.setField('LMS email','second-synthetic@example.test');await h.setField('LMS password','synthetic-test-password');await h.press('Sign in');assert(h.findButton('Settings'));
 gate.reject(new Error('Old account request failed'));await h.settle();assert(!h.texts().includes('Old account request failed'),'A previous learner request must be ignored after account switch');await h.unmount();
});

test('rejected LMS account validation leaves a clean sign-in form without requesting course data',async()=>{
 const mismatch=Object.assign(new Error('The learner session changed. Please sign in again.'),{status:409,code:'SESSION_CHANGED'});
 const h=harness({initialSessionFails:true,signInError:mismatch});await h.settle();
 await h.setField('LMS email','synthetic@example.test');await h.setField('LMS password','synthetic-test-password');await h.press('Sign in');
 assert(h.findButton('Sign in'));assert(!h.findButton('Settings'));assert(h.texts().includes(mismatch.message));
 assert(!h.fields.some(f=>f.props.value==='synthetic-test-password'),'A rejected login must not retain the password in the form');
 assert.equal(h.calls.filter(x=>['catalogue','progress'].includes(x.kind)).length,0,'The LMS must confirm the account before loading learner content');await h.unmount();
});

test('failed required quiz remains the next learning activity until the LMS confirms completion',async()=>{
 const h=harness({progress:{completedComponentIds:['PMP-W00-INTRO','PMP-W01-P01-AUDIO'],submittedComponentIds:['PMP-W01-P01-QUIZ'],pendingReviewComponentIds:[],quizAttempts:[{quizId:'PMP-W01-P01-QUIZ',submitted:true,passed:false,grade:0.5}]}});await h.settle();
 await h.press('Continue learning');assert.equal(h.activity.props.activity.id,'PMP-W01-P01-QUIZ','An attempted failed quiz is not completed by inference');await h.unmount();
});

test('submitted work awaiting review is skipped in the next step but remains available without a completion tick',async()=>{
 const content=catalogue();content.components.push(component('PMP-W01-P02-AUDIO',1));
 const h=harness({content,progress:{completedComponentIds:['PMP-W00-INTRO','PMP-W01-P01-AUDIO'],submittedComponentIds:['PMP-W01-P01-QUIZ'],pendingReviewComponentIds:['PMP-W01-P01-QUIZ']}});await h.settle();
 await h.press('Continue learning');assert.equal(h.activity.props.activity.id,'PMP-W01-P02-AUDIO','Work awaiting review should not demand immediate repetition');
 await h.activity.props.onBack();await h.settle();await h.press('Back to the week');await h.press('Point 1');await h.press('Show the steps');
 const pending=h.all().find(n=>typeof n.type==='function'&&n.type.name==='Row'&&n.props.title==='Practice your learning');assert(pending);assert.equal(pending.props.done,false,'Submission is not accepted completion');
 assert(h.findButton('Practice your learning').props.accessibilityHint.startsWith('Submitted · '));await h.press('Practice your learning');assert.equal(h.activity.props.activity.id,'PMP-W01-P01-QUIZ','The learner can still revisit a submitted activity');await h.unmount();
});

const assignedCatalogue=()=>({source:'lms',schemaVersion:2,catalogueScope:'assigned',courses:[
 {moduleId:learning.PMP_ID,title:learning.PMP_TITLE,availableActivityCount:3},
 {moduleId:'MOD-RISK-DELIVERY',title:'Risk Management',availableActivityCount:2},
 {moduleId:'MOD-EMPTY',title:'Course awaiting materials',availableActivityCount:0}
],components:[...catalogue().components.filter(row=>row.moduleId===learning.PMP_ID),
 component('RISK-W02-P01-AUDIO',2,{moduleId:'MOD-RISK-DELIVERY',weekId:'RISK-W02',week:'Risk week two',component:'Risk audio'}),
 component('RISK-W02-P01-QUIZ',2,{moduleId:'MOD-RISK-DELIVERY',weekId:'RISK-W02',week:'Risk week two',component:'Risk MCQ',mobileMode:'quiz'})]});

test('a learner can select every currently assigned course with isolated progress and saved week',async()=>{
 const h=harness({content:assignedCatalogue(),progress:moduleId=>({moduleId,completedComponentIds:[]})});await h.settle();
 await h.press('Choose a week');await h.press('Week 1 learning');await h.press('Settings');await h.press('Choose a course');
 assert(h.findButton('Risk Management'));assert(h.findButton('Course awaiting materials'));
 await h.press('Risk Management');assert(h.texts().includes('Risk Management'));assert(!h.texts().includes('Learning PMP-W01-P01-AUDIO'));
 assert.equal(h.calls.filter(call=>call.kind==='progress').at(-1).moduleId,'MOD-RISK-DELIVERY');
 await h.press('Continue learning');assert.equal(h.activity.props.activity.id,'RISK-W02-P01-AUDIO');assert.equal(h.activity.props.activity.moduleId,'MOD-RISK-DELIVERY');
 assert.equal(h.activity.props.session.capabilities.timeObservations,false,'PMP reward observation policy is not expanded');
 await h.activity.props.onBack();await h.settle();await h.press('Settings');await h.press('Choose a course');await h.press(learning.PMP_TITLE);
 await h.press('This week, point by point');assert(h.texts().includes('Week 1 learning'),'Returning course restores its own chosen week');
 assert.equal(JSON.parse(h.stored.get('kbc:lms:place:7:apprenticeship:42:MOD-RISK-DELIVERY')).weekId,'RISK-W02');
 assert.equal(JSON.parse(h.stored.get('kbc:lms:place:7:apprenticeship:42:'+learning.PMP_ID)).weekId,'PMP-W01');await h.unmount();
});

test('an assigned empty course remains selectable and never masquerades as missing enrolment',async()=>{
 const h=harness({content:assignedCatalogue()});await h.settle();await h.press('Choose a course');await h.press('Course awaiting materials');
 assert(h.texts().includes('No audio, video or MCQ materials are currently published'));
 assert(!h.texts().includes('not currently assigned'));assert(!h.findButton('Continue learning'));
 await h.press('Choose a course');await h.press('Risk Management');assert(h.findButton('Continue learning'));await h.unmount();
});

test('a late previous-course progress response cannot replace the newly selected course or its hours',async()=>{
 const h=harness({content:assignedCatalogue(),progress:moduleId=>({moduleId,completedHours:1})});await h.settle();
 const delayed=deferred();h.setProgress(moduleId=>moduleId===learning.PMP_ID?delayed.promise:{moduleId,completedHours:2});await h.foreground();
 await h.press('Choose a course');await h.press('Risk Management');
 delayed.resolve({moduleId:learning.PMP_ID,completedHours:999});await h.settle();
 await h.press('Progress');assert(h.texts().includes('2 h'));assert(!h.texts().includes('999 h'));assert(h.texts().includes('Risk Management'));await h.unmount();
});

test('refresh removes a revoked course and its activity before showing the remaining course',async()=>{
 const h=harness({content:assignedCatalogue()});await h.settle();await h.press('Continue learning');assert(h.activity);
 const remaining=assignedCatalogue();remaining.courses=remaining.courses.filter(c=>c.moduleId==='MOD-RISK-DELIVERY');remaining.components=remaining.components.filter(c=>c.moduleId==='MOD-RISK-DELIVERY');h.setContent(remaining);
 await h.refreshActivity();assert(!h.activity);assert(h.texts().includes('Risk Management'));
 await h.press('Choose a course');assert(!h.findButton(learning.PMP_TITLE));assert(h.findButton('Risk Management'));await h.unmount();
});

test('course selection is isolated between learner accounts and ignores saved revoked choices',async()=>{
 const stored=new Map([['kbc:lms:course:7:apprenticeship:42','MOD-RISK-DELIVERY'],['kbc:lms:course:8:apprenticeship:43','REVOKED']]);
 const h=harness({content:assignedCatalogue(),stored});await h.settle();assert(h.texts().includes('Risk Management'));
 await h.expire();h.setAccount(account('43','8'),assignedCatalogue());await h.setField('LMS email','other@example.test');await h.setField('LMS password','fixture-only');await h.press('Sign in');
 assert(h.texts().includes(learning.PMP_TITLE));assert.equal(stored.get('kbc:lms:course:7:apprenticeship:42'),'MOD-RISK-DELIVERY');assert.equal(stored.get('kbc:lms:course:8:apprenticeship:43'),learning.PMP_ID);await h.unmount();
});

test('wrong-course progress is rejected without hiding the selected course materials',async()=>{
 const stored=new Map([['kbc:lms:course:7:apprenticeship:42','MOD-RISK-DELIVERY']]);
 const h=harness({content:assignedCatalogue(),stored,progress:{moduleId:learning.PMP_ID,completedHours:999}});await h.settle();
 assert(h.texts().includes('Risk Management'));await h.press('Progress');assert(h.texts().includes('progress for another course'));assert(!h.texts().includes('999 h'));await h.unmount();
});

test('multi-course responses without a module identity never become confirmed progress',async()=>{
 const h=harness({content:assignedCatalogue(),progress:{completedHours:999}});await h.settle();
 await h.press('Progress');assert(h.texts().includes('progress for another course'));assert(h.texts().includes('Unavailable'));assert(!h.texts().includes('999 h'));await h.unmount();
});

test('changing learner kind does not restore the previous profile course selection',async()=>{
 const stored=new Map([['kbc:lms:course:7:apprenticeship:42','MOD-RISK-DELIVERY']]),h=harness({content:assignedCatalogue(),stored});await h.settle();assert(h.texts().includes('Risk Management'));
 await h.expire();const commercial=account();commercial.user.learnerKind='commercial';h.setAccount(commercial,assignedCatalogue());
 await h.setField('LMS email','commercial@example.test');await h.setField('LMS password','fixture');await h.press('Sign in');
 assert(h.texts().includes(learning.PMP_TITLE));assert.equal(stored.get('kbc:lms:course:7:apprenticeship:42'),'MOD-RISK-DELIVERY');assert.equal(stored.get('kbc:lms:course:7:commercial:42'),learning.PMP_ID);await h.unmount();
});
