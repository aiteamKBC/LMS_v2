import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseLmsRewards,confirmLmsVoucherResponse,readLmsVoucherDraft} from '../src/lms-rewards-model.mjs';
const summary=()=>({source:'lms',moduleId:'MOD-KBC-PMP-M01-SMR',learnerId:'42',policy:{enabled:true,version:'rewards-v1',startsAt:'2026-10-05T12:00:00Z',pointsPerGbp:100},points:{learnerId:'42',earned:1700,committed:1000,balance:700},study:{acceptedStudySeconds:3700,basis:'reward_accepted_active_intervals',formalOtj:false,pendingSessionCount:1},opportunities:[{id:'career',title:'Career planner',points:100,status:'available',opensOn:null,closesOn:null,verifiedAt:null,actionable:false,actionUrl:null}],voucherOptions:[{rewardId:'R1',amountGbp:5,points:500,remaining:3},{rewardId:'R2',amountGbp:10,points:1000,remaining:5}],voucherRequests:[],leaderboard:{optedIn:false,displayName:'',entries:[]}});
const claim=()=>({requestId:'request-1',claimId:'claim-1',amountGbp:5,points:500,status:'pending',requestedAt:'2026-10-05T14:00:00Z'});
test('shared rewards use canonical wallet, explicit policy and reserved balance',()=>{
 const result=normaliseLmsRewards(summary(),'42');assert.equal(result.balance,700);assert.equal(result.policyConfirmed,true);assert.equal(result.voucherOptions[0].enoughPoints,true);assert.equal(result.voucherOptions[1].enoughPoints,false);assert.equal(result.study.formalOtj,false);
});
test('wrong learner or module, contradictory balance and invented conversion are rejected',()=>{
 for(const edit of [x=>x.learnerId='43',x=>x.moduleId='OTHER',x=>x.points.balance=1700,x=>x.policy.pointsPerGbp=50,x=>x.voucherOptions[0].points=250,x=>x.study.formalOtj=true]){const data=summary();edit(data);assert.throws(()=>normaliseLmsRewards(data,'42'));}
});
test('a nonparticipant cannot receive leaderboard identities',()=>{
 const data=summary();data.leaderboard.entries=[{rank:1,displayName:'An alias',points:100}];assert.throws(()=>normaliseLmsRewards(data,'42'));data.leaderboard.optedIn=true;assert.equal(normaliseLmsRewards(data,'42').leaderboard.entries.length,1);
});
test('voucher confirmation must match original request, learner and conversion',()=>{
 const payload={source:'lms',moduleId:'MOD-KBC-PMP-M01-SMR',learnerId:'42',request:claim(),duplicate:false},pending={requestId:'request-1',amountGbp:5};
 assert.equal(confirmLmsVoucherResponse(payload,'42',pending).points,500);
 for(const edit of [x=>x.learnerId='43',x=>x.request.requestId='wrong',x=>x.request.amountGbp=10,x=>x.request.claimId=null,x=>x.request.status='unknown',x=>x.duplicate=null]){const data=structuredClone(payload);edit(data);assert.throws(()=>confirmLmsVoucherResponse(data,'42',pending));}
});
test('pending voucher recovery preserves owner and exact idempotency reference',()=>{
 const draft={owner:'7:apprenticeship:42',requestId:'voucher:1:abcd',amountGbp:5};assert.deepEqual(readLmsVoucherDraft(JSON.stringify(draft),draft.owner),draft);assert.throws(()=>readLmsVoucherDraft(JSON.stringify(draft),'8:apprenticeship:43'));assert.throws(()=>readLmsVoucherDraft('{bad',draft.owner));assert.equal(readLmsVoucherDraft(null,draft.owner),null);
});
