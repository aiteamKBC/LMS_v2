import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseLmsPoints} from '../src/lms-points-model.mjs';
const sample=()=>({points:{learnerId:'42',earned:1200,committed:200,balance:1000},rewards:[{id:'reward-1',name:'Example reward',description:'Synthetic test only',points:500,category:'voucher',remaining:2}]});
test('only the canonical LMS balance is shown; committed points stay reserved',()=>{
 const input=sample();input.localPoints=99999;input.pendingSeconds=7200;input.policyVersion='pretend';
 const result=normaliseLmsPoints(input,42);
 assert.equal(result.balance,1000);assert.equal(result.earned,1200);assert.equal(result.committed,200);
 assert.equal(result.rewards[0].enoughPoints,true);assert.equal(result.policyConfirmed,false);
 assert.equal(result.redemptionAvailable,false);assert.equal(result.leaderboardAvailable,false);
 assert.equal(Object.hasOwn(result,'localPoints'),false);
});
test('zero is a real confirmed balance, but missing/null/string balances are unavailable',()=>{
 const input=sample();input.points={learnerId:42,earned:0,committed:0,balance:0};input.rewards=[];
 assert.equal(normaliseLmsPoints(input,'42').balance,0);
 for(const value of [undefined,null,{}, {points:{}}, {...input,points:{...input.points,balance:'0'}}, {...input,points:{...input.points,balance:null}}])assert.throws(()=>normaliseLmsPoints(value,42));
});
test('account mismatch never returns another learner balance',()=>{
 assert.throws(()=>normaliseLmsPoints(sample(),43),{code:'SESSION_CHANGED'});
 for(const id of ['',null,0,'42.0','042',Infinity])assert.throws(()=>normaliseLmsPoints(sample(),id),{code:'SESSION_REQUIRED'});
});
test('contradictory or unsafe totals are rejected and legitimate adjustment balances remain exact',()=>{
 for(const points of [{earned:100,committed:25,balance:100},{earned:100,committed:-1,balance:101},{earned:1.5,committed:0,balance:1.5},{earned:Infinity,committed:0,balance:Infinity},{earned:Number.MAX_SAFE_INTEGER,committed:Number.MAX_SAFE_INTEGER,balance:1}])assert.throws(()=>normaliseLmsPoints({...sample(),points:{learnerId:'42',...points}},42));
 const result=normaliseLmsPoints({...sample(),points:{learnerId:'42',earned:-20,committed:0,balance:-20}},42);
 assert.equal(result.balance,-20);assert.equal(result.rewards[0].enoughPoints,false);
});
test('malformed or duplicate catalogue entries fail closed instead of inventing rewards',()=>{
 const input=sample();assert.throws(()=>normaliseLmsPoints({...input,rewards:null},42));
 assert.throws(()=>normaliseLmsPoints({...input,rewards:[input.rewards[0],input.rewards[0]]},42));
 for(const change of [{id:''},{points:0},{points:'500'},{remaining:0},{remaining:-1},{name:''},{description:null}])assert.throws(()=>normaliseLmsPoints({...input,rewards:[{...input.rewards[0],...change}]},42));
});
