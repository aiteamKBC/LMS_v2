import React,{useEffect,useRef,useState} from 'react';
import {AppState,KeyboardAvoidingView,Platform,Switch,Text,View} from 'react-native';
import {Back,Btn,Busy,Card,Field,H,Notice,Row,Txt} from './StandaloneUI';
import {base,s} from './styles';
import {mergeMessages,notificationCategories} from './comms-model.mjs';

export function LmsCommunications({client,session,push,initialPage='messages',initialRecipientId,onMeeting,onWork,onNavigate}:any){
 const [page,setPage]=useState(initialPage),[thread,setThread]=useState<any>(null),[threads,setThreads]=useState<any[]>([]);
 const [people,setPeople]=useState<any>(null),[messages,setMessages]=useState<any[]>([]),[before,setBefore]=useState<number|null>(null);
 const [alerts,setAlerts]=useState<any[]>([]),[prefs,setPrefs]=useState<any>(null),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),runId=useRef(0),sendRef=useRef<{text:string;id:string}|null>(null),lock=useRef(false);
 const currentThread=useRef<string|null>(null),olderLoaded=useRef(false),navigation=useRef(0);currentThread.current=thread?.id||null;
 const role=session?.communications?.role||'learner';
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;runId.current++;};},[]);
 const forgetAccess=()=>{navigation.current++;runId.current++;currentThread.current=null;olderLoaded.current=false;sendRef.current=null;setThread(null);setMessages([]);setBefore(null);setDraft('');setThreads([]);setPeople(null);setPage('messages');};
 const perform=async(fn:()=>Promise<void>)=>{if(lock.current)return;const intent=navigation.current;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e:any){if(alive.current&&intent===navigation.current){if([403,404].includes(e.status))forgetAccess();setError(e.message||'Please try again.');}}finally{lock.current=false;if(alive.current)setBusy(false);}};
 const refresh=async()=>{
  const run=++runId.current;
  try{
   if(thread){
    const result=await client.comms('threads/'+thread.id+'/messages/');
    if(!alive.current||run!==runId.current)return;
    setMessages(old=>mergeMessages(old,result.messages));if(!olderLoaded.current)setBefore(result.before);
    const last=result.messages.at(-1);if(last)await client.comms('threads/'+thread.id+'/read/','POST',{messageId:last.id});
   }else if(page==='messages'){
    const [list,directory]=await Promise.all([client.comms('threads/'),client.comms('directory/')]);
    if(!alive.current||run!==runId.current)return;setThreads(list.threads);setPeople(directory);
   }else if(page==='notifications'){
    const result=await client.comms('notifications/');if(alive.current&&run===runId.current)setAlerts(result.notifications);
   }else{
    const result=await client.comms('preferences/');if(alive.current&&run===runId.current)setPrefs(result.categories);
   }
  }catch(e:any){if(alive.current&&run===runId.current){if([403,404].includes(e.status))forgetAccess();setError(e.message);}}
 };
 useEffect(()=>{
  onNavigate?.();void refresh();const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},12000);
  return()=>{clearInterval(timer);runId.current++;};
 },[page,thread?.id]);
 const openThread=(value:any)=>{navigation.current++;runId.current++;currentThread.current=value.id;olderLoaded.current=false;setMessages([]);setBefore(null);setDraft('');sendRef.current=null;setThread(value);setError('');};
 const start=(kind:string,recipientId?:string,cohortId?:string)=>perform(async()=>{const intent=navigation.current;const result=await client.comms('threads/','POST',{kind,...(recipientId?{recipientId}:{}),...(cohortId?{cohortId}:{})});if(alive.current&&intent===navigation.current)openThread(result);});
 useEffect(()=>{if(role==='coach'&&typeof initialRecipientId==='string'&&/^[1-9][0-9]*$/.test(initialRecipientId))void start('coach',initialRecipientId);},[initialRecipientId]);
 const switchPage=(value:string)=>{navigation.current++;runId.current++;currentThread.current=null;setThread(null);setMessages([]);setBefore(null);setDraft('');sendRef.current=null;setPage(value);setError('');};
 const send=()=>perform(async()=>{
  const target=thread.id;
  const text=draft.trim();if(!text)return;
  // Keep one UUID when a timeout leaves the send result unknown.
  if(!sendRef.current||sendRef.current.text!==text){
   const bytes=globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(new Uint8Array(16)):Uint8Array.from({length:16},()=>Math.floor(Math.random()*256));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
   const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
   sendRef.current={text,id:hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)};
  }
  const saved=await client.comms('threads/'+target+'/messages/','POST',{body:text,clientId:sendRef.current.id});
  if(!alive.current||currentThread.current!==target)return;setMessages(old=>mergeMessages(old,[saved]));setDraft('');sendRef.current=null;
 });
 const chooseAlert=(item:any)=>perform(async()=>{
  const intent=navigation.current;
  await client.comms('notifications/'+item.id+'/read/','POST',{});
  if(!alive.current||intent!==navigation.current)return;
  if(item.target.screen==='messages'){const result=await client.comms('threads/');if(!alive.current||intent!==navigation.current)return;const match=result.threads.find((x:any)=>x.id===item.target.threadId);if(!match)throw new Error('This conversation is no longer available.');openThread(match);}
  else if(item.target.screen==='meetings')onMeeting();else onWork();
 });
 return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{gap:16}}>
  {thread?<><Back title="Back to messages" onPress={()=>switchPage('messages')}/><H>{thread.name}</H><Txt small>Only current conversation members can read these messages.</Txt></>:
   <><H>{page==='messages'?'Your messages':page==='notifications'?'Your reminders':'Notification choices'}</H>
    <View style={{gap:8}}>{[['messages','Messages'],['notifications','Reminders'],['preferences','Notification choices']].filter(([key])=>key!==page).map(([key,label])=><Btn key={key} title={label} secondary onPress={()=>switchPage(key)}/>)}</View></>}
  {!!error&&<Notice>{error}</Notice>}
  {thread?<>{before&&<Btn title="Load earlier messages" secondary disabled={busy} onPress={()=>perform(async()=>{const target=thread.id;const result=await client.comms('threads/'+target+'/messages/?before='+before);if(!alive.current||currentThread.current!==target)return;olderLoaded.current=true;setMessages(old=>mergeMessages(result.messages,old));setBefore(result.before);})}/>}
   {!messages.length&&<Txt>No messages yet. Start the conversation below.</Txt>}
   {messages.map(item=><View key={item.id} style={{padding:16,borderRadius:18,backgroundColor:item.isMine?'#E8EDE3':'#fff',borderWidth:1,borderColor:'#D2DAD0',gap:6}}>
    <Text style={s.rowTitle}>{item.isMine?'You':item.sender}</Text><Text selectable style={s.body}>{item.body}</Text><Txt small>{new Date(item.createdAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</Txt>
   </View>)}
   <Field label="Your message" multiline value={draft} onChangeText={setDraft} maxLength={4000} editable={!busy}/>
   <Btn title={busy?'Sending…':'Send message'} disabled={busy||!draft.trim()} onPress={send}/>
  </>:page==='messages'?<>
   {role==='learner'&&<>{!Array.isArray(people?.groups)&&<Btn title="Open my cohort group" disabled={busy||!session.communications?.cohortId} onPress={()=>start('cohort')}/>}<>{people?.coach?<Btn title={'Chat with '+people.coach.name} secondary disabled={busy} onPress={()=>start('coach')}/>:<Txt small>Your assigned coach will appear when their LMS account is available.</Txt>}</></>}
   {!!people?.groups?.length&&<><Text accessibilityRole="header" style={s.sectionTitle}>Class groups</Text>{role==='coach'&&<Txt small>Each group includes the whole class, including learners assigned to other coaches.</Txt>}{people.groups.map((group:any)=><Btn key={group.id} title={'Open class: '+group.name} secondary disabled={busy} onPress={()=>start('cohort',undefined,group.id)}/>)}</>}
   <Text accessibilityRole="header" style={s.sectionTitle}>Conversations</Text>{threads.map(item=><Row key={item.id} title={item.name} subtitle={item.unread?item.unread+' unread messages':'Open conversation'} onPress={()=>openThread(item)}/>)}
   <Text accessibilityRole="header" style={s.sectionTitle}>{role==='coach'?'Your learners':'Message a cohort member'}</Text>
   {!people?<Busy label="Loading contacts…"/>:people.people.length?people.people.map((person:any)=><Row key={person.id} title={person.name} onPress={()=>start(role==='coach'?'coach':'peer',person.id)}/>):<Txt>No available contacts in your current assignment.</Txt>}
  </>:page==='notifications'?<>
   <Txt>Updates from your current LMS record. Meeting times use UK time.</Txt>
   {!alerts.length&&<Txt>You’re up to date. New reminders will appear here.</Txt>}
   {alerts.map(item=><Row key={item.id} title={item.body} subtitle={item.read?'Read':'New'} onPress={()=>chooseAlert(item)}/>)}
  </>:<>
   <Txt>Choose in-app reminders and phone alerts separately. Phone alert choices apply to your account on connected devices.</Txt>
   {push.canConnectPhoneAlerts===true&&<Btn title="Connect phone alerts" disabled={push.busy} onPress={push.connect}/>} {!!push.status&&<Notice>{push.status}</Notice>}
   <Txt small>Meetings: the day before, 15 minutes before, and 15 minutes after if attendance is unconfirmed. Unfinished assignments and tasks: two days and one day before their due date.</Txt>
   {prefs?notificationCategories.map(([key,label])=><Card key={key}><Text style={s.sectionTitle}>{label}</Text>{[['inApp','In the app'],['push','Phone alerts']].map(([channel,title])=><View key={channel} style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:52,gap:12}}><Txt>{title}</Txt><Switch accessibilityLabel={label+' — '+title} disabled={busy} value={prefs[key][channel]} trackColor={{true:base.green,false:'#888'}} onValueChange={value=>perform(async()=>{const categories={...prefs,[key]:{...prefs[key],[channel]:value}};const result=await client.comms('preferences/','POST',{categories});if(alive.current)setPrefs(result.categories);})}/></View>)}</Card>):<Busy/>}
  </>}
  <Btn title="Refresh" secondary disabled={busy} onPress={()=>perform(refresh)}/>
 </KeyboardAvoidingView>;
}
