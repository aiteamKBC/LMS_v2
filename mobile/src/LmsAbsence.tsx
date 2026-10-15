import React,{useEffect,useRef,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {Back,Btn,Busy,Card,Field,H,Notice,Row,Txt} from './StandaloneUI';
import {ABSENCE_REASONS,ABSENCE_TYPES,absenceStatusLabel,absencePayload,checkedAbsenceResult,normaliseAbsenceOptions} from './lms-absence-model.mjs';
import {LMS_MEETING_LINKS} from './lms-meetings-model.mjs';
import {base,s} from './styles';

const blank=()=>({reasonCategory:'',otherReason:'',explanation:'',confirmed:false,recoveryMethod:'',recordingDate:'',recordingTime:'',recordingDurationMinutes:'60',targetOccurrenceId:''});
const dateText=(row:any)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(row.startsAt))+' · UK time';
type Props={client:any;session:any;moduleId?:string;onOpenLms:(url:string)=>void|Promise<void>;onSaved?:()=>unknown};

export function LmsAbsence({client,session,onOpenLms,onSaved}:Props){
 const [data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [target,setTarget]=useState<any>(null),[draft,setDraft]=useState<any>(blank),[result,setResult]=useState<any>(null),[mustRefresh,setMustRefresh]=useState(false);
 const generation=useRef(0),mounted=useRef(true),saving=useRef(false);
 const accountKey=String(session?.user?.accountId)+':'+session?.user?.learnerKind+':'+session?.user?.id;
 const owner=useRef(accountKey);owner.current=accountKey;
 async function refresh(){
  const run=++generation.current,who=owner.current;setLoading(true);setError('');
  try{
   const [lectures,meetings]=await Promise.all([client.absenceReports('lectures'),client.absenceReports('meetings')]);
   if(!mounted.current||who!==owner.current||run!==generation.current)return;
   setData(normaliseAbsenceOptions(lectures,meetings,session));setTarget(null);setDraft(blank());setMustRefresh(false);
  }catch(e:any){if(mounted.current&&who===owner.current&&run===generation.current){setError(e.message||'Your next sessions could not be loaded.');setData(null);}}
  finally{if(mounted.current&&who===owner.current&&run===generation.current)setLoading(false);}
 }
 useEffect(()=>{mounted.current=true;setData(null);setTarget(null);setDraft(blank());setResult(null);void refresh();return()=>{mounted.current=false;generation.current++;};},[client,accountKey]);
 const edit=(name:string,value:any)=>{setDraft((previous:any)=>({...previous,[name]:value,...(name==='confirmed'?{}:{confirmed:false})}));setError('');};
 const choose=(row:any)=>{setTarget(row);setResult(null);setError('');setDraft({...blank(),recordingDate:row.dateIso});};
 async function submit(){
  if(saving.current||mustRefresh)return;
  let payload;try{payload=absencePayload(target,draft);}catch(e:any){setError(e.message);return;}
  const who=owner.current,run=generation.current,selected=target;saving.current=true;setBusy(true);setError('');
  try{
   const response=await client.reportAbsence(payload);
   if(!mounted.current||who!==owner.current||run!==generation.current)return;
   setResult(checkedAbsenceResult(response,selected));setTarget(null);setDraft(blank());
   try{await onSaved?.();}catch{if(mounted.current&&who===owner.current)setError('Your report was saved. Refresh your calendar to see its latest details.');}
  }catch(e:any){if(mounted.current&&who===owner.current&&run===generation.current){setError((e.message||'The report could not be confirmed.')+' Refresh your reports before submitting again.');setMustRefresh(true);}}
  finally{saving.current=false;if(mounted.current&&who===owner.current)setBusy(false);}
 }
 const openLms=()=>onOpenLms(target?.type==='mcr'?LMS_MEETING_LINKS.coaching:target?.type==='progress-review'?LMS_MEETING_LINKS.review:LMS_MEETING_LINKS.absence);
 if(result)return <><H>Absence report saved</H><Card><Text style={s.cardTitle}>{result.sessionTitle}</Text><Txt>{result.reference} · {result.statusLabel}</Txt><Txt>{result.status==='pending'?'Your coach will review your request. It is not authorised until approved.':result.status==='approved'?'The LMS has approved this absence report. Complete your recovery plan; attendance and learning hours are recorded separately.':'This is the status recorded in the LMS.'}</Txt>{result.status==='pending'&&<Txt small>Contact your coach to arrange another meeting time.</Txt>}</Card>{error&&<Notice>{error}</Notice>}<Btn title="Back to next sessions" onPress={()=>{setResult(null);void refresh();}}/></>;
 return <><H>Authorised absence</H><Txt>Choose the next session you cannot attend. Your request and its approval status are saved in the LMS.</Txt>{error&&<Notice>{error}</Notice>}
  {loading?<Busy label="Loading your next sessions…"/>:!data?<Btn title="Try loading my sessions again" onPress={refresh}/>:target?<>
   <Back title="Choose a different meeting type" onPress={()=>{if(!busy){setTarget(null);setError('');}}}/>
   <Card><Text style={s.cardTitle}>{target.title}</Text><Txt>{dateText(target)}</Txt>{target.module&&<Txt small>{target.module}</Txt>}{target.coach&&<Txt small>{target.coach}</Txt>}</Card>
   <Text style={s.sectionTitle}>Why can’t you attend?</Text>
   {ABSENCE_REASONS.map(reason=><Btn key={reason.value} title={reason.label} secondary={draft.reasonCategory!==reason.value} disabled={busy} onPress={()=>edit('reasonCategory',reason.value)}/>)}
   {draft.reasonCategory==='other'&&<Field label="Other reason (up to 120 characters)" value={draft.otherReason} onChangeText={(value:string)=>edit('otherReason',value)} maxLength={120} editable={!busy}/>}
   <Field label="More details (optional, up to 600 characters)" multiline value={draft.explanation} onChangeText={(value:string)=>edit('explanation',value)} maxLength={600} editable={!busy}/>
   {target.type==='lecture'?<><Text style={s.sectionTitle}>How will you catch up?</Text>
    <Btn title="Watch the recording" secondary={draft.recoveryMethod!=='recorded'} disabled={busy} onPress={()=>edit('recoveryMethod','recorded')}/>
    {!!target.alternativeSessions?.length&&<Btn title="Attend an alternative session" secondary={draft.recoveryMethod!=='alternative'} disabled={busy} onPress={()=>edit('recoveryMethod','alternative')}/>}
    {draft.recoveryMethod==='recorded'&&<Card><Txt>Choose when you plan to watch. All dates and times are UK time.</Txt><Field label="Recording date (YYYY-MM-DD)" value={draft.recordingDate} onChangeText={(value:string)=>edit('recordingDate',value)} maxLength={10} editable={!busy}/><Field label="Recording time (HH:MM, 24-hour)" value={draft.recordingTime} onChangeText={(value:string)=>edit('recordingTime',value)} maxLength={5} editable={!busy}/><Field label="Planned minutes (15–480)" value={draft.recordingDurationMinutes} onChangeText={(value:string)=>edit('recordingDurationMinutes',value)} keyboardType="number-pad" maxLength={3} editable={!busy}/></Card>}
    {draft.recoveryMethod==='alternative'&&target.alternativeSessions.map((alternative:any)=><Btn key={alternative.id} title={alternative.dateIso+' '+alternative.startTime+' · '+(alternative.group||alternative.title)+' · UK time'} secondary={draft.targetOccurrenceId!==alternative.id} disabled={busy} onPress={()=>edit('targetOccurrenceId',alternative.id)}/>)}
   </>:<Notice>Your coach must approve this request. Reporting an absence does not reschedule the meeting.</Notice>}
   <Txt small>{target.type==='lecture'?'To attach evidence or arrange a coach catch-up, use the full LMS form.':'To attach evidence, use the absence option on your LMS meeting page.'}</Txt><Btn title="Open full LMS form" secondary disabled={busy} onPress={openLms}/>
   <Pressable accessibilityRole="checkbox" accessibilityLabel="I confirm this information is correct" accessibilityState={{checked:draft.confirmed,disabled:busy}} disabled={busy} onPress={()=>edit('confirmed',!draft.confirmed)} style={[s.rowLink,{borderColor:base.green}]}><Text style={s.rowTitle}>{draft.confirmed?'☑':'☐'} I confirm this information is correct</Text></Pressable>
   <Btn title={busy?'Submitting…':'Submit absence request'} disabled={busy||mustRefresh||!draft.confirmed} onPress={submit}/>
  </>:<>{ABSENCE_TYPES.map(type=>{const next=data.groups[type.value][0];return <Card key={type.value}><Text style={s.sectionTitle}>{type.label}</Text>{next?<><Txt>{next.title}</Txt><Txt small>{dateText(next)}</Txt><Btn title={type.action} onPress={()=>choose(next)}/></>:<Txt small>No upcoming session available to report. Already reported sessions are excluded.</Txt>}</Card>;})}<Txt small>These are your next booked sessions across the LMS. Your selected learning week does not change meeting dates.</Txt>{data.reports.length>0&&<><Text style={s.sectionTitle}>Recent absence reports</Text>{data.reports.slice(0,5).map((report:any)=><Card key={report.id}><Text style={s.rowTitle}>{report.sessionTitle}</Text><Txt small>{report.sessionDate} · {report.reference}</Txt><Txt>{absenceStatusLabel(report.status)}</Txt></Card>)}</>}</>}
  {!loading&&!busy&&<Btn title="Refresh next sessions and reports" secondary onPress={refresh}/>}
 </>;
}
