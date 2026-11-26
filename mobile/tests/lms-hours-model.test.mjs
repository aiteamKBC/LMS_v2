import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseLmsHours} from '../src/lms-hours-model.mjs';
const fixture={source:'lms',moduleId:'MOD-KBC-PMP-M01-SMR',basis:'saved_signed_active_seconds',timezone:'Europe/London',weekStart:'2026-10-05',weekEnd:'2026-10-11',weeklySubmittedSeconds:32400,moduleSubmittedSeconds:60000};
test('weekly measured goal celebrates at nine hours and retains all excess in the total',()=>{
 assert.equal(normaliseLmsHours({...fixture,weeklySubmittedSeconds:32399}).goalReached,false);
 const hours=normaliseLmsHours({...fixture,weeklySubmittedSeconds:40000});assert.equal(hours.goalReached,true);assert.equal(hours.percent,100);assert.equal(hours.weeklySubmittedSeconds,40000);
});
test('missing or wrong-source hours never become zero, planned values or another module total',()=>{
 for(const value of [null,{}, {...fixture,source:'demo'},{...fixture,moduleId:'OTHER'},{...fixture,basis:'expected_otjh'},{...fixture,weeklySubmittedSeconds:null},{...fixture,weeklySubmittedSeconds:NaN},{...fixture,moduleSubmittedSeconds:1}])assert.equal(normaliseLmsHours(value),null);
});
test('weekly range must be a coherent Monday–Sunday reporting week',()=>{
 assert.equal(normaliseLmsHours({...fixture,weekStart:'2026-10-06'}),null);assert.equal(normaliseLmsHours({...fixture,weekEnd:'2026-10-12'}),null);
 assert.ok(normaliseLmsHours({...fixture,weekStart:'2026-10-19',weekEnd:'2026-10-25'}));
});

test('selected-course hours accept its own projection and reject stale hours from the previous course',()=>{
 const selected={...fixture,moduleId:'MOD-RISK'};
 assert.equal(normaliseLmsHours(selected,'MOD-RISK').moduleId,'MOD-RISK');
 assert.equal(normaliseLmsHours(fixture,'MOD-RISK'),null);
 assert.equal(normaliseLmsHours(selected,'MOD-SP'),null);
});
