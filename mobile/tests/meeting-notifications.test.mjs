import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as plan from '../src/meeting-notification-plan.mjs';
const source=fs.readFileSync(new URL('../src/meeting-notifications.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const tick=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness({platform='android',granted=false,allow=true,canAskAgain=true}={}){
 const calls=[],scheduled=new Map([['unrelated-feature',{identifier:'unrelated-feature',content:{data:{}}}]]),listeners=new Set(),cells=[];let cursor=0,effects=[],permission={granted,canAskAgain,status:granted?'granted':'undetermined'},lastResponse=null,responseListener;
 const React={useRef(initial){const i=cursor++;if(!cells[i])cells[i]={current:initial};return cells[i];},useState(initial){const i=cursor++;if(!cells[i])cells[i]={value:initial};return[cells[i].value,value=>{cells[i].value=typeof value==='function'?value(cells[i].value):value;}];},useCallback(fn,deps){const i=cursor++,old=cells[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))cells[i]={fn,deps};return cells[i].fn;},useEffect(fn,deps){const i=cursor++,old=cells[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){cells[i]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}}};
 const N={AndroidImportance:{DEFAULT:3},AndroidNotificationVisibility:{PRIVATE:0},IosAuthorizationStatus:{PROVISIONAL:3},SchedulableTriggerInputTypes:{DATE:'date'},
 async setNotificationChannelAsync(id,config){calls.push({name:'channel',id,config});},setNotificationHandler(handler){calls.push({name:'handler'});},
 async getPermissionsAsync(){calls.push({name:'permissions'});return permission;},async requestPermissionsAsync(){calls.push({name:'prompt'});permission={...permission,granted:allow,canAskAgain:false,status:allow?'granted':'denied'};return permission;},
 async getAllScheduledNotificationsAsync(){return [...scheduled.values()];},async getPresentedNotificationsAsync(){return [];},
 async scheduleNotificationAsync(value){calls.push({name:'schedule',value});scheduled.set(value.identifier,value);return value.identifier;},async cancelScheduledNotificationAsync(id){calls.push({name:'cancel',id});scheduled.delete(id);},async dismissNotificationAsync(id){calls.push({name:'dismiss',id});},
 addNotificationResponseReceivedListener(fn){responseListener=fn;return{remove(){responseListener=null;}};},async getLastNotificationResponseAsync(){return lastResponse;},async clearLastNotificationResponseAsync(){calls.push({name:'clear-response'});lastResponse=null;}};
 const exports={},context=vm.createContext({exports,require(name){if(name==='react')return React;if(name==='react-native')return{Platform:{OS:platform},AppState:{addEventListener(name,fn){listeners.add(fn);return{remove(){listeners.delete(fn);}};}}};if(name==='expo-notifications')return N;if(name==='./meeting-notification-plan.mjs')return plan;throw new Error(name);},setInterval(){return 1;},clearInterval(){},Date,Promise,Set,Map,JSON,globalThis:{}});
 vm.runInContext(compiled,context);
 let props={userId:'learner-a',enabled:false,reminders:[{id:'next',type:'appointment',dueAt:new Date(Date.now()+3600000).toISOString(),eventId:'event-a',status:'upcoming'}],onOpenMeetings(){}};
 function render(patch={}){props={...props,...patch};cursor=0;const value=exports.useMeetingNotifications(props);const current=effects;effects=[];for(const fn of current)fn();return value;}
 return{calls,scheduled,render,async settled(patch={}){render(patch);await tick();return render();},tap(notification){lastResponse={notification:{request:notification}};responseListener?.(lastResponse);},cleanup(){for(const cell of cells)cell?.cleanup?.();},listeners};
}
test('native mount does not prompt; explicit enable creates channel first and schedules private scoped reminders',async()=>{
 const h=harness();let hook=await h.settled();assert.equal(h.calls.filter(x=>x.name==='prompt').length,0);assert.equal(hook.status,'disabled');
 assert.equal(await hook.enable(),true);hook=await h.settled({enabled:true});assert.equal(hook.status,'enabled');
 assert.equal(h.calls.filter(x=>x.name==='prompt').length,1);assert(h.calls.findIndex(x=>x.name==='channel')<h.calls.findIndex(x=>x.name==='prompt'));
 const own=[...h.scheduled.values()].filter(x=>plan.ownsMeetingNotification(x,'learner-a'));assert.equal(own.length,1);assert.equal(own[0].trigger.type,'date');assert.equal(own[0].trigger.channelId,'kbc-learning-meetings-v1');assert.equal(own[0].content.title,'KBC Learn');
 assert.equal(h.calls.filter(x=>x.name==='schedule').length,1,'unchanged refresh does not duplicate alarms');assert(h.scheduled.has('unrelated-feature'));h.cleanup();await tick();
});
test('booking reconciliation, disabling and sign-out preserve unrelated notifications',async()=>{
 const h=harness({granted:true});let hook=await h.settled({enabled:true});assert.equal(h.scheduled.size,2);
 hook=await h.settled({reminders:[]});assert.equal(h.scheduled.size,1);
 hook=await h.settled({reminders:[{id:'next2',type:'appointment',dueAt:new Date(Date.now()+7200000).toISOString(),status:'upcoming'}]});assert.equal(h.scheduled.size,2);
 assert.equal(await hook.disable(),true);assert.deepEqual([...h.scheduled.keys()],['unrelated-feature']);
 await h.settled({enabled:false,userId:null});assert.deepEqual([...h.scheduled.keys()],['unrelated-feature']);h.cleanup();await tick();
});
test('account switch cancels previous user reminders and keeps newly signed-in user isolated',async()=>{
 const h=harness({granted:true});await h.settled({enabled:true});assert([...h.scheduled.values()].some(x=>plan.ownsMeetingNotification(x,'learner-a')));
 await h.settled({userId:'learner-b'});assert(![...h.scheduled.values()].some(x=>plan.ownsMeetingNotification(x,'learner-a')));assert([...h.scheduled.values()].some(x=>plan.ownsMeetingNotification(x,'learner-b')));assert(h.scheduled.has('unrelated-feature'));h.cleanup();await tick();
});
test('denied or synced permission never opens a prompt on boot and retains in-app fallback',async()=>{
 const h=harness({allow:false});let hook=await h.settled({enabled:true});assert.equal(hook.status,'denied');assert.equal(h.calls.filter(x=>x.name==='prompt').length,0);
 assert.equal(await hook.enable(),false);hook=h.render();assert.equal(hook.status,'denied');assert.equal(h.calls.filter(x=>x.name==='prompt').length,1);assert.equal(h.scheduled.size,1);
 assert.equal(await hook.enable(),false);assert.equal(h.calls.filter(x=>x.name==='prompt').length,1,'cannot ask again must not reopen native prompt');h.cleanup();await tick();
});
test('web offers in-app reminders without trying to register phone notifications',async()=>{
 const h=harness({platform:'web'});const hook=await h.settled({enabled:true});assert.equal(hook.status,'unavailable');assert.equal(await hook.enable(),false);assert.equal(h.calls.length,0);h.cleanup();await tick();
});
test('notification taps route only the current learner and clear handled responses',async()=>{
 const h=harness({granted:true});const opened=[];await h.settled({enabled:true,onOpenMeetings:id=>opened.push(id)});
 const own=[...h.scheduled.values()].find(x=>plan.ownsMeetingNotification(x,'learner-a'));h.tap(own);h.tap(own);await tick();assert.deepEqual(opened,['event-a']);assert.equal(h.calls.filter(x=>x.name==='clear-response').length,1);
 h.tap({...own,identifier:plan.meetingNotificationPrefix('learner-b')+'other'});assert.deepEqual(opened,['event-a']);h.cleanup();await tick();
});
