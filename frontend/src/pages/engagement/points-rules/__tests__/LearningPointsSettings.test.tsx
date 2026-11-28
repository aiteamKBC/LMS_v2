import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import LearningPointsSettings from '../LearningPointsSettings';
const settings={pointsPerHour:1,quizThreshold:70,quizPointPerCorrect:1,perfectQuizPointPerCorrect:2,hourActivities:['reading','powerpoint','podcast','video','quiz'],bonusPoints:{inclusiveness:500,'linkedin-start':1000,'linkedin-learning':1000,'promotion-story':20000,'career-planner':100,'module-feedback':100,wellbeing:100,'semester-winner':1000}};
beforeEach(()=>{cleanup();vi.restoreAllMocks();});
const payload={policy:{id:4,effectiveAt:'2026-10-15T08:00:00Z',settings},defaults:settings,history:[],activityTypes:settings.hourActivities};
it('edits measured activity mapping with a revision guard and shows confirmed save',async()=>{
 const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{calls.push(init);return {ok:true,json:async()=>init.method==='GET'?payload:{policy:{...payload.policy,id:5,settings:JSON.parse(init.body).settings}}};}));
 render(<LearningPointsSettings/>);
 await screen.findByRole('button',{name:'Save rules for future activity'});
 fireEvent.click(screen.getByLabelText('Reading'));
 fireEvent.change(screen.getByLabelText('Points per complete accepted hour'),{target:{value:'2'}});
 fireEvent.click(screen.getByRole('button',{name:'Save rules for future activity'}));
 await screen.findByRole('status');
 const body=JSON.parse(calls[1].body);expect(body.expectedId).toBe(4);expect(body.settings.pointsPerHour).toBe(2);expect(body.settings.hourActivities).not.toContain('reading');
 expect(calls[1].headers['X-Requested-With']).toBe('XMLHttpRequest');
});
it('keeps unsaved settings on a conflict and never reports success',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>({ok:init.method==='GET',json:async()=>init.method==='GET'?payload:{error:'policy changed refresh before saving'}})));
 render(<LearningPointsSettings/>);await screen.findByRole('button',{name:'Save rules for future activity'});
 fireEvent.change(screen.getByLabelText('Points per complete accepted hour'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'Save rules for future activity'}));
 await screen.findByRole('alert');expect(screen.queryByRole('status')).toBeNull();expect(screen.getByLabelText('Points per complete accepted hour')).toHaveValue(3);
});
it('a failed read exposes retry without inventing settings or an activation button',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({error:'Unavailable'})})));
 render(<LearningPointsSettings/>);await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'Activate rules for all courses'})).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Retry loading settings'})).toBeEnabled());
});
