import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as model from '../src/comms-model.mjs';
const compile=name=>ts.transpileModule(fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
function harness({role='learner',failSend=false,initialPage='messages',groups,initialRecipientId,overrides={}}={}){
 let cursor=0,dirty=false,tree,fail=failSend;const slots=[],effects=[],calls=[],sent=[];
 const hooks={useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useRef(value){return slots[cursor++]??={current:value};},useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){old?.cleanup?.();effects[i]={fn,deps,run:true};}}};
 const React={...hooks,createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
 const native={Platform:{OS:'android'},AppState:{currentState:'active'},...Object.fromEntries(['View','Text','Pressable','TextInput','Switch','KeyboardAvoidingView','ActivityIndicator'].map(x=>[x,x]))};
 const prefs=Object.fromEntries(model.notificationCategories.map(([key])=>[key,{inApp:true,push:false}]));
 const client={async comms(path,method='GET',body){calls.push({path,method,body});
  if(overrides[method+':'+path])return overrides[method+':'+path](body);
  if(path==='directory/')return {people:[{id:'102',name:'Synthetic peer'}],coach:{id:'201',name:'Synthetic coach'},...(groups===undefined?{}:{groups})};
  if(path==='threads/')return method==='POST'?{id:'one',name:body.kind==='cohort'?'My cohort':'Synthetic conversation'}:{threads:[]};
  if(path.includes('/messages/')){
   if(method==='POST'){sent.push(body);if(fail){fail=false;throw new Error('Connection lost. Retry your message.');}return {id:7,body:body.body,isMine:true,createdAt:'2026-10-13T09:00:00Z'};}
   return {messages:[],before:null};
  }
  if(path==='preferences/')return {categories:body?.categories||prefs};
  if(path==='notifications/')return {notifications:[{id:9,body:'Your meeting is tomorrow.',target:{screen:'meetings'},read:false}]};
  return {ok:true};
 }};
 const modules={'react':React,'react-native':native,'./styles':{s:{},base:{green:'#143F37'}},'@expo/vector-icons':{Ionicons:'Ionicons'},'./comms-model.mjs':model};
 const ui={};new Function('require','exports',compile('StandaloneUI.tsx'))(n=>modules[n],ui);modules['./StandaloneUI']=ui;
 const mod={};new Function('require','exports',compile('LmsCommunications.tsx'))(n=>modules[n],mod);
 const props={client,session:{communications:{role,cohortId:'c1'}},push:{busy:false,status:'',connect(){calls.push({connect:true});}},initialPage,initialRecipientId,onMeeting(){calls.push({meeting:true});},onWork(){calls.push({work:true});}};
 const render=()=>{let loops=0;do{assert(++loops<40);dirty=false;cursor=0;tree=mod.LmsCommunications(props);for(const e of effects)if(e?.run){e.run=false;e.cleanup=e.fn();}}while(dirty);};
 const settle=async()=>{for(let i=0;i<30;i++){await Promise.resolve();if(dirty)render();}};
 const nodes=()=>{const out=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object'){out.push(n);walk(typeof n.type==='function'?n.type(n.props):n.props?.children);}};walk(tree);return out;};
 const button=label=>nodes().find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);
 render();return {calls,sent,settle,nodes,button,async press(label){const b=button(label);assert(b,label);assert(!b.props.disabled);await b.props.onPress();await settle();},async type(text){nodes().find(n=>n.type==='TextInput').props.onChangeText(text);await settle();},unmount(){for(const e of effects)e?.cleanup?.();}};
}
test('learner can open cohort, private peer and assigned coach conversations',async()=>{
 const h=harness();try{await h.settle();await h.press('Open my cohort group');await h.press('Back to messages');await h.press('Synthetic peer');await h.press('Back to messages');await h.press('Chat with Synthetic coach');assert.deepEqual(h.calls.filter(x=>x.path==='threads/'&&x.method==='POST').map(x=>x.body),[{kind:'cohort'},{kind:'peer',recipientId:'102'},{kind:'coach'}]);}finally{h.unmount();}
});
test('retry preserves message id and clears draft only after confirmed save',async()=>{
 const h=harness({failSend:true});try{await h.settle();await h.press('Open my cohort group');await h.type('My synthetic question');await h.press('Send message');assert.equal(h.nodes().find(n=>n.type==='TextInput').props.value,'My synthetic question');await h.press('Send message');assert.equal(h.sent[0].clientId,h.sent[1].clientId);assert.equal(h.nodes().find(n=>n.type==='TextInput').props.value,'');}finally{h.unmount();}
});
test('coach contacts open learner-coach threads and have no learner cohort action',async()=>{
 const h=harness({role:'coach'});try{await h.settle();assert(!h.button('Open my cohort group'));await h.press('Synthetic peer');assert.deepEqual(h.calls.find(x=>x.method==='POST').body,{kind:'coach',recipientId:'102'});}finally{h.unmount();}
});
test('notification preferences keep in-app and push choices independent',async()=>{
 const h=harness({initialPage:'preferences'});try{await h.settle();const switches=h.nodes().filter(x=>x.type==='Switch');assert.equal(switches.length,12);await switches[1].props.onValueChange(true);await h.settle();const saved=h.calls.find(x=>x.path==='preferences/'&&x.method==='POST').body.categories;assert.deepEqual(saved.cohort_messages,{inApp:true,push:true});assert.deepEqual(saved.private_messages,{inApp:true,push:false});}finally{h.unmount();}
});
test('meeting reminder marks only its notification read then opens meeting screen',async()=>{
 const h=harness({initialPage:'notifications'});try{await h.settle();await h.press('Your meeting is tomorrow.');assert(h.calls.some(x=>x.path==='notifications/9/read/'&&x.method==='POST'));assert(h.calls.some(x=>x.meeting));}finally{h.unmount();}
});
test('coach class groups send only the exact server-listed class identity and keep assigned private chats',async()=>{
 const h=harness({role:'coach',groups:[{id:'COHORT-1',name:'Synthetic whole class'}]});try{await h.settle();assert(!h.button('Open my cohort group'));await h.press('Open class: Synthetic whole class');await h.press('Back to messages');await h.press('Synthetic peer');assert.deepEqual(h.calls.filter(x=>x.path==='threads/'&&x.method==='POST').map(x=>x.body),[{kind:'cohort',cohortId:'COHORT-1'},{kind:'coach',recipientId:'102'}]);}finally{h.unmount();}
});
test('an explicit empty group directory does not offer a guessed learner class',async()=>{
 const h=harness({groups:[]});try{await h.settle();assert(!h.button('Open my cohort group'));assert(!h.calls.some(x=>x.method==='POST'));}finally{h.unmount();}
});
test('selected coach learner opens one private conversation using the enrolment identity',async()=>{
 const h=harness({role:'coach',initialRecipientId:'112'});try{await h.settle();assert(h.button('Back to messages'));assert.deepEqual(h.calls.filter(x=>x.path==='threads/'&&x.method==='POST').map(x=>x.body),[{kind:'coach',recipientId:'112'}]);}finally{h.unmount();}
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const visibleText=h=>h.nodes().filter(n=>n.type==='Text').flatMap(n=>n.props.children).flat(Infinity).filter(x=>typeof x==='string').join('\n');
test('pending coach thread creation cannot reopen a conversation after navigating to reminders',async()=>{
 const gate=deferred(),h=harness({role:'coach',overrides:{'POST:threads/':()=>gate.promise}});try{await h.settle();const pending=h.button('Synthetic peer').props.onPress();await h.settle();await h.press('Reminders');gate.resolve({id:'old',name:'Old conversation'});await pending;await h.settle();assert(!h.button('Back to messages'));assert(!visibleText(h).includes('Old conversation'));assert(visibleText(h).includes('Your reminders'));assert(!h.calls.some(x=>x.path==='threads/old/messages/'));}finally{h.unmount();}
});
test('a late failed thread open cannot show its error on a later page',async()=>{
 const gate=deferred(),h=harness({role:'coach',overrides:{'POST:threads/':()=>gate.promise}});try{await h.settle();const pending=h.button('Synthetic peer').props.onPress();await h.settle();await h.press('Reminders');gate.reject(Object.assign(new Error('Old assignment refused.'),{status:403}));await pending;await h.settle();assert(visibleText(h).includes('Your reminders'));assert(!visibleText(h).includes('Old assignment refused.'));}finally{h.unmount();}
});
test('403 and 404 membership revocation clear loaded conversation, draft and stale contacts',async()=>{
 for(const status of [403,404]){
  const overrides={'GET:threads/one/messages/':()=>({messages:[{id:10,body:'Previously authorised private content',sender:'Synthetic learner',isMine:false,createdAt:'2026-10-14T10:00:00Z'}],before:8})},h=harness({role:'coach',overrides});
  try{await h.settle();await h.press('Synthetic peer');assert(visibleText(h).includes('Previously authorised private content'));await h.type('Unsent private draft');overrides['GET:threads/one/messages/']=()=>{throw Object.assign(new Error('Conversation no longer available.'),{status});};await h.press('Refresh');assert(!h.button('Back to messages'));assert(!visibleText(h).includes('Previously authorised private content'));assert(!h.nodes().some(n=>n.type==='TextInput'&&n.props.value==='Unsent private draft'));assert(!h.button('Load earlier messages'));assert(visibleText(h).includes('Conversation no longer available.'));}finally{h.unmount();}
 }
});
test('a send refused after assignment removal clears old messages and never retries the send',async()=>{
 const h=harness({role:'coach',overrides:{'GET:threads/one/messages/':()=>({messages:[{id:10,body:'Private history',isMine:false,createdAt:'2026-10-14T10:00:00Z'}],before:null}),'POST:threads/one/messages/':()=>{throw Object.assign(new Error('Assignment removed.'),{status:403});}}});try{await h.settle();await h.press('Synthetic peer');await h.type('Private draft');await h.press('Send message');assert(!visibleText(h).includes('Private history'));assert(!h.button('Send message'));assert.equal(h.calls.filter(x=>x.path==='threads/one/messages/'&&x.method==='POST').length,1);}finally{h.unmount();}
});
