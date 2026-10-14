import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedNotification,mergeMessages,notificationCategories} from '../src/comms-model.mjs';
import {createLmsClient} from '../src/lms-client.mjs';
test('notification ownership includes Android remote payload and refuses other users',()=>{
 const n={request:{trigger:{remoteMessage:{data:{accountId:'11',notificationId:'1'}}},content:{data:{}}}};
 assert.equal(ownedNotification(n,'11'),true);assert.equal(ownedNotification(n,'12'),false);assert.equal(ownedNotification(n,null),false);
});
test('message refresh deduplicates retry and preserves older pages',()=>{
 assert.deepEqual(mergeMessages([{id:1},{id:2}],[{id:2,body:'saved'},{id:3}]),[{id:1},{id:2,body:'saved'},{id:3}]);
 assert.equal(notificationCategories.length,6);
});
test('coach sign-in never requests a learner catalogue or learner session',async()=>{
 const paths=[];
 const client=createLmsClient({communications:true,fetchImpl:async(url)=>{
  paths.push(new URL(url).pathname);
  return new Response(JSON.stringify(paths.length===1?{user:{id:11}}:{accountId:'11',role:'coach',name:'Test coach'}),{headers:{'Content-Type':'application/json'}});
 }});
 const result=await client.signIn('coach@example.test','synthetic');
 assert.equal(result.communications.role,'coach');
 assert.deepEqual(paths,['/login_api/login/','/learner_api/communications/session/']);
});
test('communications reject destination escape',async()=>{
 const client=createLmsClient({fetchImpl:()=>{throw new Error('must not fetch');}});
 await assert.rejects(client.comms('../login_api/me/'),/address is not valid/);
});
