import { useEffect, useState } from 'react';
type Formula = {pointsPerHour:number;quizThreshold:number;quizPointPerCorrect:number;perfectQuizPointPerCorrect:number;hourActivities:string[];bonusPoints:Record<string,number>};
type Policy = {id:number;effectiveAt:string;settings:Formula};
const labels:Record<string,string>={reading:'Reading',powerpoint:'PowerPoint',podcast:'Audio and podcasts',video:'Videos',quiz:'AI Assisted Learning'};
const bonusLabels:Record<string,string>={inclusiveness:'Inclusiveness completion','linkedin-start':'LinkedIn start and education entry','linkedin-learning':'LinkedIn learning post','promotion-story':'Promotion case study','career-planner':'Career planner','module-feedback':'Module feedback and masterclass booking',wellbeing:'Wellbeing completion','semester-winner':'Semester module winner'};
async function request(method='GET',body?:unknown){
 const response=await fetch('/engagement_api/learning-points-policy/',{method,credentials:'include',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'The settings could not be confirmed.');
 return data;
}
export default function LearningPointsSettings(){
 const [policy,setPolicy]=useState<Policy|null>(null),[form,setForm]=useState<Formula|null>(null),[history,setHistory]=useState<Policy[]>([]);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const load=async()=>{setBusy(true);setError('');try{const data=await request();setPolicy(data.policy);setForm(data.policy?.settings||data.defaults);setHistory(data.history);setLoaded(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 useEffect(()=>{void load();},[]);
 const save=async()=>{setBusy(true);setError('');setNotice('');try{const data=await request('POST',{expectedId:policy?.id??null,settings:form});setPolicy(data.policy);setHistory(rows=>[data.policy,...rows].slice(0,20));setNotice('Saved. Future activity uses these rules. Existing awards are unchanged.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const numericFields:[keyof Omit<Formula,'hourActivities'|'bonusPoints'>,string,number,number][]=[
 ['pointsPerHour','Points per complete accepted hour',0,1000],
 ['quizThreshold','Minimum first-quiz score (%)',1,100],
 ['quizPointPerCorrect','Points per correct answer at the minimum score',0,1000],
 ['perfectQuizPointPerCorrect','Points per correct answer at 100%',0,1000]];
 const valid=form&&numericFields.every(([key,,min,max])=>Number.isInteger(form[key])&&form[key]>=min&&form[key]<=max)&&Object.values(form.bonusPoints).every(value=>Number.isInteger(value)&&value>=0&&value<=100000);
 return <section aria-labelledby="learning-points-title" className="rounded-xl border border-foreground-200 bg-background-50 p-5 space-y-4">
 <h2 id="learning-points-title" className="text-lg font-semibold">Learning points · all courses</h2>
 <p>One policy for the LMS and mobile app. Map activity types to measured study hours and set the first-submission quiz formula.</p>
 {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!loaded?<button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Loading settings…':'Retry loading settings'}</button>:form&&<>
 <p>{policy?'Active since '+new Date(policy.effectiveAt).toLocaleString('en-GB'):'The all-course policy has not been activated.'}</p>
 <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">Activity → hour points</legend>
 <p className="text-sm">Select which activities contribute to the same hour total. Visits must contain at least four minutes of accepted study. Partial hours carry forward; simultaneous activity is counted once.</p>
 <div className="flex flex-wrap gap-4">{Object.entries(labels).map(([key,label])=><label key={key} className="flex items-center gap-2"><input type="checkbox" checked={form.hourActivities.includes(key)} onChange={e=>setForm({...form,hourActivities:e.target.checked?[...form.hourActivities,key]:form.hourActivities.filter(x=>x!==key)})}/>{label}</label>)}</div>
 <div className="grid gap-4 sm:grid-cols-2">{numericFields.map(([key,label,min,max])=><label key={key} className="flex flex-col gap-1">{label}<input type="number" min={min} max={max} step={1} value={Number.isNaN(form[key])?'':form[key]} onChange={e=>setForm({...form,[key]:e.target.value===''?NaN:Number(e.target.value)})} className="border rounded p-2"/></label>)}</div>
 </fieldset>
 <details><summary>Verified activities → bonus points</summary><p className="text-sm my-3">These amounts still require college verification and the existing eligibility dates. Saving an amount does not award points or complete an activity.</p><div className="grid gap-3 sm:grid-cols-2">{Object.entries(bonusLabels).map(([key,label])=><label key={key} className="flex flex-col gap-1">{label}<input disabled={busy} type="number" min={0} max={100000} step={1} value={Number.isNaN(form.bonusPoints[key])?'':form.bonusPoints[key]} onChange={e=>setForm({...form,bonusPoints:{...form.bonusPoints,[key]:e.target.value===''?NaN:Number(e.target.value)}})} className="border rounded p-2"/></label>)}</div></details>
 <p className="text-sm">Retakes earn no extra quiz points. A perfect score uses the perfect-score rate instead. Manual time entries do not create measured-hour rewards. A zero rate disables future awards of that type.</p>
 <p className="text-sm">Changes apply from saving onward. Earlier quiz submissions retain their original rules; each whole hour uses the rate at the time it was completed. Past points and voucher reservations are preserved.</p>
 <div className="flex gap-3"><button type="button" disabled={busy||!valid} onClick={()=>void save()} className="bg-primary-700 text-white rounded px-4 py-2 disabled:opacity-50">{busy?'Saving…':policy?'Save rules for future activity':'Activate rules for all courses'}</button><button type="button" disabled={busy} onClick={()=>void load()} className="border rounded px-4 py-2">Reload saved settings</button></div>
 <details><summary>Rule change history ({history.length})</summary><ul className="space-y-2 mt-2">{history.map(row=><li key={row.id}>{new Date(row.effectiveAt).toLocaleString('en-GB')}: {row.settings.pointsPerHour} point(s)/hour; first quiz ≥{row.settings.quizThreshold}%: {row.settings.quizPointPerCorrect}/correct; perfect: {row.settings.perfectQuizPointPerCorrect}/correct. Hour activities: {row.settings.hourActivities.map(x=>labels[x]).join(', ')||'None'}.</li>)}</ul></details>
 </>}
 </section>;
}
