import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as legacy from '../src/lms-points-model.mjs';
import * as rewards from '../src/lms-rewards-model.mjs';
const source=fs.readFileSync(new URL('../src/LmsPoints.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source+'\nexport {LmsPointsBody};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const fixture=()=>({source:'lms',moduleId:'MOD-KBC-PMP-M01-SMR',learnerId:'42',policy:{enabled:true,version:'v1',startsAt:'2026-10-05T12:00:00Z',pointsPerGbp:100},points:{learnerId:'42',earned:700,committed:0,balance:700},study:{acceptedStudySeconds:3600,basis:'reward_accepted_active_intervals',formalOtj:false,pendingSessionCount:0},opportunities:[],voucherOptions:[{rewardId:'R1',amountGbp:5,points:500,remaining:10}],voucherRequests:[],leaderboard:{optedIn:false,displayName:'',entries:[]}});
function harness({failOnce=false,failStorage=false,savedStore=new Map()}={}){
 let cursor=0,dirty=false,tree;const slots=[],effects=[],calls=[],data=fixture();
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(slots[i],next)){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(effect,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={effect,deps,run:true};}},useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={fn,deps};return slots[i].fn;}};
 const React={...hooks,createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
 const storage={async getItem(key){return savedStore.get(key)||null;},async setItem(key,value){if(failStorage)throw new Error('No storage');savedStore.set(key,value);},async removeItem(key){savedStore.delete(key);}};
 const client={async rewardsSummary(){return structuredClone(data);},async requestVoucher(body){calls.push({kind:'voucher',body});if(failOnce){failOnce=false;throw new Error('Connection interrupted');}const request={...body,claimId:'claim-1',points:body.amountGbp*100,status:'pending',requestedAt:'2026-10-05T14:00:00Z'};data.points.committed=500;data.points.balance=200;data.voucherRequests=[request];return{source:'lms',moduleId:data.moduleId,learnerId:'42',request,duplicate:calls.filter(x=>x.kind==='voucher').length>1};},async setLeaderboard(body){calls.push({kind:'leaderboard',body});data.leaderboard={...data.leaderboard,...body};return{source:'lms',moduleId:data.moduleId,learnerId:'42',...body};}};
 const modules={'react':React,'react-native':{AppState:{addEventListener:()=>({remove(){}})},Text:'Text',View:'View'},'@react-native-async-storage/async-storage':storage,'./StandaloneUI':Object.fromEntries(['Btn','Busy','Card','Field','H','Notice','Txt'].map(x=>[x,x])),'./styles':{s:{}},'./lms-points-model.mjs':legacy,'./lms-rewards-model.mjs':rewards};
 const mod={exports:{}};new Function('require','exports',compiled)(name=>{if(!modules[name])throw new Error(name);return modules[name];},mod.exports);
 const props={client,session:{authenticated:true,user:{id:'42',accountId:'7',learnerKind:'apprenticeship'},capabilities:{customPointsPolicy:true}}};
 const render=()=>{let loop=0;do{assert(++loop<50);dirty=false;cursor=0;tree=mod.exports.LmsPointsBody(props);for(const item of effects)if(item?.run){item.run=false;item.cleanup=item.effect();}}while(dirty);};
 const settle=async()=>{for(let i=0;i<35;i++){await Promise.resolve();if(dirty)render();}};
 const all=()=>{const nodes=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object'){nodes.push(n);walk(n.props?.children);}};walk(tree);return nodes;};
 const btn=title=>all().find(n=>n.type==='Btn'&&n.props.title===title);render();
 return{calls,savedStore,all,btn,settle,async press(title){const b=btn(title);assert(b,'Button exists: '+title);assert(!b.props.disabled,'Button enabled: '+title);await b.props.onPress();await settle();},async field(label,value){const f=all().find(n=>n.type==='Field'&&n.props.label===label);assert(f);f.props.onChangeText(value);await settle();},unmount(){effects.forEach(x=>x?.cleanup?.());}};
}
test('voucher selection needs explicit confirmation and uses only amount plus durable request ID',async()=>{
 const h=harness();await h.settle();assert.equal(h.calls.length,0);await h.press('£5 voucher · 500 points');assert.equal(h.calls.length,0);await h.press('Confirm voucher request');assert.equal(h.calls.length,1);assert.deepEqual(Object.keys(h.calls[0].body).sort(),['amountGbp','requestId']);assert.equal(h.savedStore.size,0);h.unmount();
});
test('ambiguous voucher failure retries the same reservation and then clears the stored draft',async()=>{
 const h=harness({failOnce:true});await h.settle();await h.press('£5 voucher · 500 points');await h.press('Confirm voucher request');assert.equal(h.savedStore.size,1);await h.press('Check my £5 request');assert.deepEqual(h.calls[0].body,h.calls[1].body);assert.equal(h.savedStore.size,0);h.unmount();
});
test('phone storage failure never sends a voucher reservation',async()=>{
 const h=harness({failStorage:true});await h.settle();await h.press('£5 voucher · 500 points');await h.press('Confirm voucher request');assert.equal(h.calls.length,0);h.unmount();
});
test('leaderboard is opt-in, requires alias, and can be left without a voucher action',async()=>{
 const h=harness();await h.settle();assert(h.btn('Join leaderboard').props.disabled);await h.field('Leaderboard display name','Pilot Learner');await h.press('Join leaderboard');assert.deepEqual(h.calls[0],{kind:'leaderboard',body:{optedIn:true,displayName:'Pilot Learner'}});await h.press('Leave leaderboard');assert.deepEqual(h.calls[1].body,{optedIn:false,displayName:''});h.unmount();
});
