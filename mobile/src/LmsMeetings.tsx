import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Linking,Platform,Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Back,Btn,Busy,Card,H,Notice,Row,Txt} from './StandaloneUI';
import {s} from './styles';
import {useMeetingNotifications} from './meeting-notifications';
import {LMS_MEETING_LINKS,normalizeLmsMeetings} from './lms-meetings-model.mjs';

type Options={client:any;session:any;refreshVersion?:number;moduleId?:string;serverReminders?:boolean;onOpenMeetings?:(eventId?:string)=>void};
const accountKey=(session:any)=>session?.authenticated&&session.user?.accountId&&session.user?.id ? 'lms:'+session.user.accountId+':'+session.user.learnerKind+':'+session.user.id : null;
const preferenceKey=(owner:string)=>'kbc:lms:meeting-reminders:v1:'+owner;

/** Keep this hook mounted in the authenticated shell, so tab changes retain phone reminders. */
export function useLmsMeetings({client,session,refreshVersion=0,moduleId,onOpenMeetings,serverReminders=false}:Options){
 const owner=accountKey(session),current=useRef({owner,client,session,moduleId,onOpenMeetings});current.current={owner,client,session,moduleId,onOpenMeetings};
 const [snapshot,setSnapshot]=useState<{owner:string;data:any}|null>(null),[fault,setFault]=useState<{owner:string;message:string}|null>(null),[pending,setPending]=useState<string|null>(null);
 const [preference,setPreference]=useState<{owner:string;enabled:boolean}|null>(null),[selected,setSelected]=useState<string|null>(null);
 const generation=useRef(0),busy=useRef(false);
 const refresh=useCallback(async()=>{
  const active=current.current;if(!active.owner)return;
  const run=++generation.current;setPending(active.owner);
  try{
   const response=await active.client.meetings();
   if(current.current.owner!==active.owner||run!==generation.current)return;
   const data=normalizeLmsMeetings(response,active.session,{moduleId:active.moduleId} as any);
   setSnapshot({owner:active.owner,data});setFault(null);return data;
  }catch(e:any){if(current.current.owner===active.owner&&run===generation.current)setFault({owner:active.owner,message:e?.message||'Your LMS calendar could not be refreshed. Please try again.'});}
  finally{if(current.current.owner===active.owner&&run===generation.current)setPending(null);}
 },[]);
 const data=snapshot?.owner===owner?snapshot.data:null;
 const enabled=preference?.owner===owner&&preference.enabled;
 const notifications=useMeetingNotifications({userId:serverReminders?null:owner,enabled:!serverReminders&&enabled,reminders:data?.reminders||[],onRefresh:refresh,onOpenMeetings:eventId=>{setSelected(eventId||null);current.current.onOpenMeetings?.(eventId);}});
 useEffect(()=>{
  let cancelled=false;setSelected(null);setPreference(null);setFault(null);setSnapshot(null);generation.current++;
  if(owner)void AsyncStorage.getItem(preferenceKey(owner)).then(value=>{if(!cancelled&&current.current.owner===owner)setPreference({owner,enabled:value==='enabled'});}).catch(()=>{if(!cancelled&&current.current.owner===owner)setFault({owner,message:'This phone could not read your reminder preference. You can enable reminders again.'});});
  return()=>{cancelled=true;generation.current++;};
 },[owner]);
 useEffect(()=>{if(owner)void refresh();},[owner,moduleId,refreshVersion,refresh]);
 const enableReminders=async()=>{
  const active=current.current.owner;if(!active||busy.current)return;busy.current=true;
  try{if(await notifications.enable()){
   if(current.current.owner!==active)return;
   await AsyncStorage.setItem(preferenceKey(active),'enabled');
   if(current.current.owner===active)setPreference({owner:active,enabled:true});
  }}catch{await notifications.disable();if(current.current.owner===active)setFault({owner:active,message:'Your reminder preference could not be saved. Please try again.'});}
  finally{busy.current=false;}
 };
 const disableReminders=async()=>{
  const active=current.current.owner;if(!active||busy.current)return;busy.current=true;
  try{await AsyncStorage.setItem(preferenceKey(active),'disabled');if(current.current.owner!==active)return;setPreference({owner:active,enabled:false});await notifications.disable();}
  catch{if(current.current.owner===active)setFault({owner:active,message:'The phone could not save this change. You can turn off KBC Learn notifications in phone settings.'});}
  finally{busy.current=false;}
 };
 return {serverReminders,data,error:fault?.owner===owner?fault.message:'',loading:pending===owner,refresh,selected,setSelected,notifications,enabled,enableReminders,disableReminders};
}

export type LmsMeetingsController=ReturnType<typeof useLmsMeetings>;
type Props={controller:LmsMeetingsController;onOpenLms?:(url:string)=>void|Promise<void>};
const labels:Record<string,string>={confirmed:'Scheduled',pending:'To arrange',ended:'Ended',completed:'Completed',cancelled:'Cancelled','awaiting-signature':'Awaiting signature',unknown:'Check LMS details'};
const dateText=(value:string|null)=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value))+' · UK time':'Time to be arranged';
const dueText=(value:string|null)=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short'}).format(new Date(value+'T12:00:00Z')):null;

export function LmsMeetings({controller:c,onOpenLms}:Props){
 const [actionError,setActionError]=useState(''),[showPast,setShowPast]=useState(false),[showAllUpcoming,setShowAllUpcoming]=useState(false),[showAllPending,setShowAllPending]=useState(false);
 const open=async(url:string)=>{setActionError('');try{if(url.startsWith('https://lms.kentbusinesscollege.org/')&&onOpenLms)await onOpenLms(url);else await Linking.openURL(url);}catch{setActionError('The link could not open. Please try again.');}};
 const event=c.data?.events.find((item:any)=>item.id===c.selected);
 const actions=<>
  <Row title="Book or change a meeting" subtitle="Your college’s current availability" onPress={()=>open(LMS_MEETING_LINKS.calendar)}/>
  <Row title="Recordings and catch-up" subtitle="Your attendance and session recordings" onPress={()=>open(LMS_MEETING_LINKS.recordings)}/>
 </>;
 const eventRows=(events:any[])=>events.map(item=><Row key={item.id} title={item.title} subtitle={['awaiting-signature','unknown'].includes(item.status)?labels[item.status]:item.startsAt?dateText(item.startsAt):dueText(item.targetDate)?'Target '+dueText(item.targetDate)+' · time to arrange':'Time to arrange'} onPress={()=>c.setSelected(item.id)}/>);
 if(!c.data)return <><H>Meetings</H>{c.error?<><Notice>{c.error}</Notice><Btn title="Try loading my calendar again" onPress={c.refresh}/>{actions}</>:<Busy label="Loading your LMS calendar…"/>}</>;
 return <>
  {event&&<Back title="Back to meetings" onPress={()=>c.setSelected(null)}/>}
  <H>{event?'Your meeting':'Meetings'}</H>
  {c.error&&<Notice>{c.error} The details below are from the last successful update. Refresh before joining.</Notice>}
  {actionError&&<Notice>{actionError}</Notice>}
  {event?<Card>
   <Text style={s.cardTitle}>{event.title}</Text><Txt>{dateText(event.startsAt)}</Txt><Txt small>{labels[event.status]||'Check LMS details'}{event.moduleTitle?' · '+event.moduleTitle:''}</Txt>
   {event.warning&&<Notice>{event.warning}</Notice>}
   {event.status==='confirmed'&&(event.joinUrl?<Btn title="Join Teams meeting" icon="videocam-outline" disabled={!!c.error} onPress={()=>open(event.joinUrl)}/>:<Notice>The joining link is not available yet. Open the LMS meeting details before your session.</Notice>)}
   {event.status==='confirmed'&&event.type==='live'&&<Btn title="I cannot attend" secondary onPress={()=>open(LMS_MEETING_LINKS.absence)}/>}
   {event.recordingUrl&&['ended','completed'].includes(event.status)&&<Btn title={event.watchedRecording?'Review session recording':'Check session recording'} onPress={()=>open(event.recordingUrl)}/>}
   <Btn title={event.status==='pending'?'Arrange this meeting in the LMS':'Open LMS meeting details'} secondary onPress={()=>open(event.manageUrl)}/>
   {event.status==='confirmed'&&<Txt small>Your attendance and learning hours come from the LMS session record. Opening Teams alone does not record attendance.</Txt>}
  </Card>:<>
   <Txt small>Your live sessions, coaching and reviews use the college’s current LMS calendar.</Txt>
   {c.data.nextEvent?<Card><Text style={s.eyebrow}>YOUR NEXT MEETING</Text><Text style={s.cardTitle}>{c.data.nextEvent.title}</Text><Txt>{dateText(c.data.nextEvent.startsAt)}</Txt><Btn title="View my next meeting" onPress={()=>c.setSelected(c.data.nextEvent.id)}/></Card>:<Card><Txt>No confirmed upcoming meeting is showing in your LMS calendar.</Txt><Btn title="Open my college calendar" onPress={()=>open(LMS_MEETING_LINKS.calendar)}/></Card>}
   {c.data.upcoming.length>0&&<><Text style={s.sectionTitle}>Coming up</Text>{eventRows(showAllUpcoming?c.data.upcoming:c.data.upcoming.slice(0,4))}{c.data.upcoming.length>4&&<Btn title={showAllUpcoming?'Show fewer meetings':'See all upcoming meetings'} secondary onPress={()=>setShowAllUpcoming(!showAllUpcoming)}/>}</>}
   {c.data.pending.length>0&&<><Text style={s.sectionTitle}>To arrange</Text><Txt small>These are target dates. Bookings are confirmed by the LMS.</Txt>{eventRows(showAllPending?c.data.pending:c.data.pending.slice(0,3))}{c.data.pending.length>3&&<Btn title={showAllPending?'Show fewer dates':'See all dates to arrange'} secondary onPress={()=>setShowAllPending(!showAllPending)}/>}</>}
   {c.data.attention.length>0&&<><Text style={s.sectionTitle}>Follow up</Text>{eventRows(c.data.attention)}</>}
   {actions}
   {c.data.past.length>0&&<><Btn title={showPast?'Hide previous meetings':'Previous meetings'} secondary onPress={()=>setShowPast(!showPast)}/>{showPast&&eventRows(c.data.past)}</>}
   <Card><Text style={s.sectionTitle}>Gentle reminders</Text><Txt small>{c.serverReminders?'Manage phone and in-app alerts in Chat > Notification choices.':c.notifications.message||'Choose a reminder on this phone, 15 minutes before a scheduled meeting.'}</Txt>{!c.serverReminders&&Platform.OS!=='web'&&<Btn title={c.enabled?'Turn off phone reminders':'Enable phone reminders'} secondary disabled={c.notifications.status==='pending'} onPress={c.enabled?c.disableReminders:c.enableReminders}/>}<Txt small>Changes refresh when the app connects. Your college controls coaching and review dates.</Txt></Card>
  </>}
  <Btn title={c.loading?'Refreshing…':'Refresh my calendar'} secondary disabled={c.loading} onPress={c.refresh}/>
 </>;
}
