import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as model from '../src/comms-model.mjs';

const code=ts.transpileModule(fs.readFileSync(new URL('../src/mobile-push.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function harness({platform='android',granted=true,allow=true,tokenGate=null}={}){
 const calls=[],cells=[],effects=[],listeners=new Map();let cursor=0,dirty=false,value,permission=granted,notificationHandler,tokenRead=0;
 const hooks={useRef(initial){return cells[cursor++]??={current:initial};},useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return[cells[i],next=>{const result=typeof next==='function'?next(cells[i]):next;if(!Object.is(result,cells[i])){cells[i]=result;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((item,j)=>!Object.is(item,old.deps[j]))){old?.cleanup?.();effects[i]={fn,deps,pending:true};}}};
 const listen=(name,fn)=>{listeners.set(name,fn);return{remove:()=>listeners.delete(name)};};
 const N={AndroidImportance:{DEFAULT:3},AndroidNotificationVisibility:{PRIVATE:0},setNotificationHandler(handler){notificationHandler=handler;},
  async setNotificationChannelAsync(id,config){calls.push({kind:'channel',id,config});},async getPermissionsAsync(){calls.push({kind:'permission'});return{granted:permission};},async requestPermissionsAsync(){calls.push({kind:'prompt'});permission=allow;return{granted:permission};},
  async getDevicePushTokenAsync(){calls.push({kind:'native-token'});if(tokenGate&&tokenRead++===0)return tokenGate.promise;return{type:platform,data:platform==='ios'?'synthetic-apns-token':'synthetic-fcm-token'};},
  async getAllScheduledNotificationsAsync(){calls.push({kind:'scheduled'});return[];},async cancelScheduledNotificationAsync(id){calls.push({kind:'cancel',id});},async getLastNotificationResponseAsync(){return null;},async clearLastNotificationResponseAsync(){calls.push({kind:'clear-response'});},addNotificationResponseReceivedListener:fn=>listen('notification',fn),addPushTokenListener:fn=>listen('token',fn),async dismissAllNotificationsAsync(){calls.push({kind:'dismiss'});}};
 const client={async comms(path,method,body){calls.push({kind:'request',path,method,body});return{ok:true};}};
 const modules={'react':hooks,'react-native':{Platform:{OS:platform},AppState:{addEventListener:(name,fn)=>listen(name,fn)}},'expo-notifications':N,'./comms-model.mjs':model};
 const exports={};new Function('require','exports',code)(name=>{assert(name in modules,'Known dependency '+name);return modules[name];},exports);
 let owner='7';const render=()=>{let count=0;do{assert(++count<30);dirty=false;cursor=0;value=exports.useMobilePush(client,owner,()=>calls.push({kind:'open-reminders'}));for(const effect of effects)if(effect?.pending){effect.pending=false;effect.cleanup=effect.fn();}}while(dirty);};
 const settle=async()=>{for(let i=0;i<40;i++){await Promise.resolve();if(dirty)render();}return value;};
 render();return{calls,listeners,settle,get value(){return value;},async switchAccount(next){owner=next;render();return settle();},handler:notification=>notificationHandler.handleNotification(notification),unmount(){for(const effect of effects)effect?.cleanup?.();}};
}

test('iPhone readiness is explicit and never requests or posts an APNs token to the Android service',async()=>{
 const h=harness({platform:'ios'});try{const push=await h.settle();assert.equal(push.canConnectPhoneAlerts,false);assert.match(push.status,/iPhone.*Apple notification setup/);assert.match(push.status,/In-app reminders are still available/);await push.connect();await h.settle();await push.disconnect();assert.deepEqual(h.calls,[]);assert.equal(h.value.busy,false);assert.equal(h.listeners.size,0);}finally{h.unmount();}
});
test('Android retains native FCM registration and account-scoped disconnect',async()=>{
 const h=harness();try{const push=await h.settle();assert.equal(push.canConnectPhoneAlerts,true);assert.match(push.status,/phone is connected/);assert.equal(h.calls.filter(x=>x.kind==='channel').length,model.notificationCategories.length);assert.equal(h.calls.filter(x=>x.kind==='prompt').length,0);
  const registrations=h.calls.filter(x=>x.kind==='request');assert.deepEqual(registrations,[{kind:'request',path:'device/',method:'POST',body:{token:'synthetic-fcm-token',platform:'android'}}]);
  await push.disconnect();assert.deepEqual(h.calls.filter(x=>x.kind==='request').at(-1),{kind:'request',path:'device/',method:'DELETE',body:{token:'synthetic-fcm-token'}});
 }finally{h.unmount();}
});
test('Android requests permission only from explicit connection action and preserves in-app fallback on refusal',async()=>{
 const h=harness({granted:false,allow:false});try{let push=await h.settle();assert.equal(h.calls.filter(x=>x.kind==='prompt').length,0);assert.match(push.status,/In-app reminders are still available/);await push.connect();push=await h.settle();assert.equal(h.calls.filter(x=>x.kind==='prompt').length,1);assert.equal(h.calls.filter(x=>['native-token','request'].includes(x.kind)).length,0);assert.equal(push.canConnectPhoneAlerts,true);}finally{h.unmount();}
});
test('an old Android token response cannot register after the account changes',async()=>{
 const gate=deferred(),h=harness({tokenGate:gate});try{await h.settle();await h.switchAccount(null);gate.resolve({type:'android',data:'old-account-token'});await h.settle();assert(!h.calls.some(x=>x.kind==='request'));await h.switchAccount('8');assert.deepEqual(h.calls.filter(x=>x.kind==='request').map(x=>x.body),[{token:'synthetic-fcm-token',platform:'android'}]);}finally{h.unmount();}
});
test('iPhone lifecycle keeps notification ownership scoped without attempting device registration',async()=>{
 const h=harness({platform:'ios'});try{await h.settle();const event=accountId=>({request:{content:{data:{accountId,notificationId:'3'}}}});assert.equal((await h.handler(event('7'))).shouldShowBanner,true);assert.equal((await h.handler(event('8'))).shouldShowBanner,false);await h.switchAccount(null);assert.equal((await h.handler(event('7'))).shouldShowBanner,false);await h.switchAccount('8');assert.equal((await h.handler(event('8'))).shouldShowBanner,true);assert.deepEqual(h.calls,[]);}finally{h.unmount();}
});
test('web does not present a phone connection capability or call native registration',async()=>{
 const h=harness({platform:'web'});try{const push=await h.settle();assert.equal(push.canConnectPhoneAlerts,false);assert.match(push.status,/In-app reminders/);await push.connect();await h.settle();assert.deepEqual(h.calls,[]);}finally{h.unmount();}
});
