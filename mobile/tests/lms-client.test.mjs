import test from 'node:test';
import assert from 'node:assert/strict';
import {createLmsClient,LMS_ORIGIN} from '../src/lms-client.mjs';
const response=(body,status=200,type='application/json')=>({ok:status>=200&&status<300,status,headers:{get:()=>type},json:async()=>body});

test('absence requests use same authenticated LMS with bounded scope and no supplied learner identity',async()=>{
 const calls=[],client=createLmsClient({fetchImpl:async(url,options)=>{calls.push({url,options});return response({});}});
 await client.absenceReports('lectures');await client.absenceReports('meetings');
 await client.reportAbsence({scope:'meetings',sessionId:'meeting:42:mcr:17',reasonCategory:'illness'});
 assert.equal(calls[0].url,LMS_ORIGIN+'/learner_api/mobile/absence-reports/?scope=lectures');
 assert.equal(calls[1].url,LMS_ORIGIN+'/learner_api/mobile/absence-reports/?scope=meetings');
 assert.equal(calls[2].options.method,'POST');assert.equal(calls[2].options.credentials,'include');
 assert.equal(calls[2].options.headers['X-Requested-With'],'XMLHttpRequest');
 assert.equal(JSON.parse(calls[2].options.body).sessionId,'meeting:42:mcr:17');
 for(const scope of ['meetings&learnerId=4','../','',null])assert.throws(()=>client.absenceReports(scope));
 assert.throws(()=>client.reportAbsence({learnerId:99}));assert.equal(calls.length,3);
});

test('selected-course progress and hours preserve the canonical module ID without allowing query injection',async()=>{
 const calls=[],client=createLmsClient({fetchImpl:async url=>{calls.push(url);return response({});}});
 await client.progress('MOD-RISK:DELIVERY-1');await client.hours('MOD-RISK:DELIVERY-1');
 assert.deepEqual(calls,[LMS_ORIGIN+'/learner_api/mobile/progress/?moduleId=MOD-RISK%3ADELIVERY-1',LMS_ORIGIN+'/learner_api/mobile/hours/?moduleId=MOD-RISK%3ADELIVERY-1']);
 for(const id of ['MOD-RISK&learnerId=5','../secret','https://foreign.example',''])assert.throws(()=>client.progress(id));
 assert.equal(calls.length,2);
});
test('sign-in sends credentials only to fixed HTTPS LMS and checks integration separately',async()=>{
 const calls=[];const client=createLmsClient({fetchImpl:async(url,options)=>{calls.push({url,options});return response(url.includes('login/')?{user:{id:9}}:{authenticated:true,user:{id:'501',accountId:'9'}});}});
 await client.signIn(' learner@example.test ','private-fixture');
 assert.equal(calls.length,2);assert.equal(calls[0].url,LMS_ORIGIN+'/login_api/login/');assert.equal(calls[1].url,LMS_ORIGIN+'/learner_api/mobile/session/');
 assert.deepEqual(JSON.parse(calls[0].options.body),{email:'learner@example.test',password:'private-fixture',remember:true});
 assert.equal(calls[1].options.body,undefined);for(const {options} of calls){assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);}
});
test('successful login followed by absent adapter cannot be presented as connected',async()=>{
 const client=createLmsClient({fetchImpl:async url=>url.includes('/login_api/')?response({user:{id:9}}):response('<html>SPA</html>',200,'text/html')});
 await assert.rejects(client.signIn('a@b.test','fixture'),error=>error.code==='INTEGRATION_UNAVAILABLE');
});
test('invalid IDs and client-owned identity/score fields never reach LMS',async()=>{
 let sent=0;const client=createLmsClient({fetchImpl:async()=>{sent++;return response({});}});
 for(const id of ['../other','https://other.example','x/y','',7])assert.throws(()=>client.quiz(id));
 for(const field of ['learnerId','profileId','score','points','accepted'])assert.throws(()=>client.submitQuiz('PMP-W1-Q1',{answers:{q:['A','E']},[field]:1}));
 assert.equal(sent,0);
});
test('multi-answer payload and canonical component ID are preserved for server grading',async()=>{
 let call;const client=createLmsClient({fetchImpl:async(url,options)=>{call={url,options};return response({saved:true});}});
 await client.submitQuiz('PMP-W1-Q1',{answers:{'101':[501,505]},trackingToken:'fixture',timeTakenSeconds:16});
 assert.match(call.url,/quizzes\/PMP-W1-Q1\/submit\/$/);assert.deepEqual(JSON.parse(call.options.body).answers['101'],[501,505]);
});
test('LMS expiry is explicit and never produces fake progress',async()=>{
 let expired=0;const client=createLmsClient({onSessionExpired:()=>expired++,fetchImpl:async()=>response({},401)});
 await assert.rejects(client.progress(),error=>error.code==='AUTH_REQUIRED');assert.equal(expired,1);
});
test('HTML authentication expiry clears the account just like a JSON expiry',async()=>{
 let expired=0;const client=createLmsClient({onSessionExpired:()=>expired++,fetchImpl:async()=>response('Sign in',401,'text/html')});
 await assert.rejects(client.catalogue(),error=>error.code==='AUTH_REQUIRED');assert.equal(expired,1);
});
test('transcript fetch uses a fixed authenticated component endpoint and rejects a supplied URL',async()=>{
 let url;const client=createLmsClient({fetchImpl:async value=>{url=value;return response({source:'lms',componentId:'PMP-P01',transcript:'Alice: Welcome.'});}});
 assert.equal((await client.transcript('PMP-P01')).componentId,'PMP-P01');assert.equal(url,LMS_ORIGIN+'/learner_api/mobile/components/PMP-P01/transcript/');
 assert.throws(()=>client.transcript('https://foreign.test/transcript'));
});
test('a response from the previous learner cannot be reused after sign-out',async()=>{
 let resolve;const client=createLmsClient({fetchImpl:async url=>url.includes('progress/')?new Promise(r=>{resolve=r;}):response({})});
 const pending=client.progress();await client.signOut();resolve(response({componentProgress:[{id:'old-user'}]}));
 await assert.rejects(pending,error=>error.code==='SESSION_CHANGED');
});
test('write failures are reported without automatic replay of a quiz or booking',async()=>{
 let sent=0;const client=createLmsClient({fetchImpl:async()=>{sent++;throw new Error('socket');}});
 await assert.rejects(client.bookMeeting({eventKind:'coaching'}),error=>error.code==='NETWORK');assert.equal(sent,1);
});

test('password setup response never advances to a learner session',async()=>{
 const calls=[];const client=createLmsClient({fetchImpl:async(url)=>{calls.push(url);return response({passwordSetupRequired:true,setPasswordPath:'/set-password?token=fixture'});}});
 await assert.rejects(client.signIn('learner@example.test','fixture'),error=>error.code==='PASSWORD_SETUP_REQUIRED');
 assert.deepEqual(calls,[LMS_ORIGIN+'/login_api/login/']);
});

test('HTTP 200 without a valid login user is never treated as signed in',async()=>{
 for(const body of [{},{user:null},{user:{}},{user:{id:false}},{user:{id:0}}]){
  let calls=0;const client=createLmsClient({fetchImpl:async()=>{calls++;return response(body);}});
  await assert.rejects(client.signIn('learner@example.test','fixture'),error=>error.code==='INVALID_LOGIN_RESPONSE');
  assert.equal(calls,1);
 }
});

test('the adapter must positively authenticate the same account as login',async()=>{
 for(const session of [{},{authenticated:false,user:{id:'501',accountId:'9'}},{authenticated:true,user:{id:'501'}},{authenticated:true,user:{id:'501',accountId:'10'}}]){
  const client=createLmsClient({fetchImpl:async(url)=>response(url.includes('/login_api/')?{user:{id:9}}:session)});
  await assert.rejects(client.signIn('learner@example.test','fixture'),error=>['INVALID_SESSION_RESPONSE','SESSION_CHANGED'].includes(error.code));
 }
});

test('restoring a session also requires authenticated identity fields',async()=>{
 const client=createLmsClient({fetchImpl:async()=>response({authenticated:true,user:{id:'501'}})});
 await assert.rejects(client.session(),error=>error.code==='INVALID_SESSION_RESPONSE');
});

test('account changes while JSON is being decoded cannot leak the previous learner response',async()=>{
 let decode,started;const decoding=new Promise(resolve=>{started=resolve;});
 const client=createLmsClient({fetchImpl:async(url)=>url.includes('progress/')?{...response({}),json:async()=>{started();return new Promise(resolve=>{decode=resolve;});}}:response({})});
 const pending=client.progress();await decoding;await client.signOut();decode({componentProgress:[{id:'old-user'}]});
 await assert.rejects(pending,error=>error.code==='SESSION_CHANGED');
});

test('canonical LMS refusal codes survive without mislabelling assignment or temporary outage',async()=>{
 for(const [status,code] of [[404,'activity_not_assigned'],[503,'lms_unavailable'],[409,'quiz_answer_mapping_required']]){
  const client=createLmsClient({fetchImpl:async()=>response({error:'Please check this activity.',code},status)});
  await assert.rejects(client.progress(),error=>error.code===code&&error.status===status);
 }
});
