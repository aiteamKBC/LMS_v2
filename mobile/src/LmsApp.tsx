import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,BackHandler,Image,Linking,Platform,Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {StatusBar} from 'expo-status-bar';
import {Ionicons} from '@expo/vector-icons';
import {createLmsClient,LMS_ORIGIN} from './lms-client.mjs';
import {normaliseLmsCourses,normaliseLmsLearning,lmsCourseSession,completedLmsActivityIds,submittedLmsActivityIds,pendingReviewLmsActivityIds} from './lms-learning-model.mjs';
import {Btn,Card,H,Txt,Notice,Busy,Field,Row,Back} from './StandaloneUI';
import {LmsPointsScreen} from './LmsPoints';
import {LmsMeetings,useLmsMeetings} from './LmsMeetings';
import LmsActivity from './LmsActivity';
import {LmsHours} from './LmsHours';
import {base,s} from './styles';

export default function LmsApp(){return <SafeAreaProvider><LmsShell/></SafeAreaProvider>;}
function LmsShell(){
 const [session,setSession]=useState<any>(null),[catalogue,setCatalogue]=useState<any>(null),[courses,setCourses]=useState<any[]|null>(null),[progress,setProgress]=useState<any>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progressError,setProgressError]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[view,setView]=useState('home');
 const [weekId,setWeekId]=useState(''),[point,setPoint]=useState<number|null>(null),[activity,setActivity]=useState<any>(null),[refreshVersion,setRefreshVersion]=useState(0);
 const [placeOwner,setPlaceOwner]=useState<string|null>(null),[showSteps,setShowSteps]=useState(false);
 const requestGeneration=useRef(0),owner=useRef<string|null>(null),scroll=useRef<ScrollView>(null);
 const activeModule=useRef(''),activeActivity=useRef<any>(null);activeActivity.current=activity;
 const manualSigninRequired=useRef(false);
 const clearAccount=()=>{requestGeneration.current++;owner.current=null;activeModule.current='';setSession(null);setCatalogue(null);setCourses(null);setProgress(null);setProgressError('');setActivity(null);setPassword('');setWeekId('');setPoint(null);setPlaceOwner(null);setShowSteps(false);setView('home');};
 const clientRef=useRef<any>(null);
 if(!clientRef.current)clientRef.current=createLmsClient({onSessionExpired:clearAccount});
 const client=clientRef.current;
 const ownerKey=(value:any)=>value?.authenticated?String(value.user.accountId)+':'+String(value.user.learnerKind)+':'+String(value.user.id):null;
 const openLms=async(url:string=LMS_ORIGIN+'/learner/my-learning')=>{
  try{const parsed=new URL(url);if(parsed.origin!==LMS_ORIGIN||parsed.username||parsed.password)throw new Error('This LMS link is not valid.');await Linking.openURL(parsed.href);}
  catch(e:any){setError(e.message||'The LMS could not open.');}
 };
 const loadLearning=useCallback(async(currentSession:any,preferredModule?:string)=>{
  const who=ownerKey(currentSession);if(!who)return;
  const generation=++requestGeneration.current;
  const current=()=>generation===requestGeneration.current&&owner.current===who;
  try{
   const content=await client.catalogue();if(!current())return;
   const assigned=normaliseLmsCourses(content);
   const savedCourse=await AsyncStorage.getItem('kbc:lms:course:'+who).catch(()=>null);if(!current())return;
   const selected=[preferredModule,activeModule.current,savedCourse].map(id=>assigned.find((course:any)=>course.moduleId===id)).find(Boolean)||assigned[0];
   if(!selected){activeModule.current='';setCourses([]);setCatalogue(null);setProgress(null);setActivity(null);setWeekId('');setPoint(null);setPlaceOwner(null);setView('home');return;}
   const model=normaliseLmsLearning(content,{}, {},selected);
   const changed=activeModule.current!==selected.moduleId;
   // Remove revoked or switched activity state before awaiting another network request.
   if(changed||activeActivity.current&&!model.activities.some(row=>row.id===activeActivity.current.id)){
    setActivity(null);setPoint(null);setShowSteps(false);setView('home');setProgress(null);setCatalogue(null);setPlaceOwner(null);
   }
   activeModule.current=selected.moduleId;
   const [result,saved]=await Promise.all([
    client.progress(selected.moduleId).then((value:any)=>{
     if((content.courses!==undefined||value?.moduleId!==undefined)&&value?.moduleId!==selected.moduleId)throw new Error('The LMS returned progress for another course. Refresh to try again.');
     return {value,error:''};
    }).catch((e:any)=>({value:null,error:e.message})),
    AsyncStorage.getItem('kbc:lms:place:'+who+':'+selected.moduleId).catch(()=>null)
   ]);
   if(!current())return;
   let place:any=null;try{place=JSON.parse(saved||'null');}catch{}
   setCourses(assigned);setCatalogue(model);setProgress(result.value);setProgressError(result.error);
   setWeekId(previous=>!changed&&model.weeks.some(w=>w.id===previous)?previous:model.weeks.some(w=>w.id===place?.weekId)?place.weekId:model.weeks[0]?.id||'');
   setPlaceOwner(who+':'+selected.moduleId);setRefreshVersion(v=>v+1);
  }catch(e){if(!current())return;throw e;}
 },[client]);
 const connect=useCallback(async()=>{
  setLoading(true);setError('');
  try{if(manualSigninRequired.current||await AsyncStorage.getItem('kbc:lms:requires-signin')==='true')return;const result=await client.session();if(owner.current!==ownerKey(result))clearAccount();owner.current=ownerKey(result);setSession(result);await loadLearning(result);}
  catch(e:any){if(e.status===401||e.code==='AUTH_REQUIRED'){owner.current=null;setSession(null);}else setError(e.message);}
  finally{setLoading(false);}
 },[client,loadLearning]);
 useEffect(()=>{void connect();return()=>{requestGeneration.current++;};},[connect]);
 useEffect(()=>{if(!session?.authenticated)return;const sub=AppState.addEventListener('change',state=>{
  if(state==='active'&&view!=='activity')void loadLearning(session).catch(e=>setError(e.message));
 });return()=>sub.remove();},[session,view,loadLearning]);
 const moduleId=catalogue?.moduleId||'',courseTitle=catalogue?.title||'Your learning';
 const courseSession=lmsCourseSession(session,moduleId);
 const meetings=useLmsMeetings({client,session,refreshVersion,moduleId:moduleId||undefined,onOpenMeetings:()=>setView('meetings')});
 const go=(target:string)=>{setView(target);setShowSteps(false);setError('');scroll.current?.scrollTo({y:0,animated:false});};
 useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(view==='home')return false;go(view==='activity'?'path':'home');return true;});return()=>sub.remove();},[view]);
 useEffect(()=>{const who=ownerKey(session);if(who&&moduleId&&placeOwner===who+':'+moduleId){
  void AsyncStorage.setItem('kbc:lms:course:'+who,moduleId).catch(()=>{});
  if(weekId)void AsyncStorage.setItem('kbc:lms:place:'+who+':'+moduleId,JSON.stringify({weekId})).catch(()=>{});
 }},[session,moduleId,weekId,placeOwner]);
 const run=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await work();}catch(e:any){setError(e.message||'Please try again.');}finally{setBusy(false);}};
 const chooseCourse=(id:string)=>run(async()=>{if(!courses?.some(course=>course.moduleId===id))return;requestGeneration.current++;activeModule.current=id;setActivity(null);setCatalogue(null);setProgress(null);setProgressError('');setPlaceOwner(null);setWeekId('');setPoint(null);go('home');await loadLearning(session,id);});
 const signIn=()=>run(async()=>{const secret=password;setPassword('');const result=await client.signIn(email,secret);if(owner.current!==ownerKey(result))clearAccount();owner.current=ownerKey(result);manualSigninRequired.current=false;setSession(result);await AsyncStorage.removeItem('kbc:lms:requires-signin');await loadLearning(result);});
 const signOut=()=>run(async()=>{manualSigninRequired.current=true;clearAccount();let storageFailed=false;try{await AsyncStorage.setItem('kbc:lms:requires-signin','true');}catch{storageFailed=true;}try{await client.signOut();}catch{setError(storageFailed?'Your content is cleared. This phone and the LMS could not confirm saving the sign-out. Please end your session on the LMS website before sharing this phone.':'You are signed out on this phone. The LMS could not confirm ending the server session; sign in again when connected.');}});
 const openActivity=(item:any)=>{setWeekId(item.weekId);setPoint(item.pointNumber);setActivity(item);go('activity');};
 const weeks=catalogue?.weeks||[],week=weeks.find((w:any)=>w.id===weekId)||weeks[0],done=completedLmsActivityIds(progress);
 const ordered=[...(week?.activities||[]),...weeks.filter((w:any)=>w.id!==week?.id).flatMap((w:any)=>w.activities)];
 const submitted=submittedLmsActivityIds(progress);
 const pendingReview=pendingReviewLmsActivityIds(progress);
 const next=ordered.find((a:any)=>a.available&&a.recommended&&a.mode!=='session'&&!done.has(a.id)&&!pendingReview.has(a.id));
 const song=week?.activities.find((a:any)=>a.kind==='song');
 const visible=(week?.activities||[]).filter((a:any)=>point===null?a.pointNumber==null:a.pointNumber===point);
 const hours=progress?.completedHours??progress?.totalCompletedOtjh;
 const content=()=>{
  if(view==='activity'&&activity)return <LmsActivity key={ownerKey(session)+':'+moduleId+':'+activity.id} client={client} session={courseSession} activity={activity} onOpenLms={openLms} onBack={()=>go('path')} onSaved={async()=>{try{await loadLearning(session);}catch(e:any){setProgressError(e.message);}}}/>;
  if(view==='points')return <LmsPointsScreen key={ownerKey(session)+':'+moduleId} client={client} session={courseSession} refreshVersion={refreshVersion}/>;
  if(view==='courses')return <><Back onPress={()=>go('home')}/><H>Your courses</H><Txt>Choose one of your current LMS courses. Your place is saved separately for each course.</Txt>{courses?.map(course=><Row key={course.moduleId} title={course.title} subtitle={course.moduleId===moduleId?'Current course':course.availableActivityCount===0?'No audio, video or MCQ materials published yet':'Audio, video and MCQ materials'} onPress={()=>chooseCourse(course.moduleId)}/>)}</>;
  if(view==='meetings')return <><Back onPress={()=>go('home')}/><LmsMeetings controller={meetings} onOpenLms={openLms}/></>;
  if(view==='progress')return <><H>Your progress</H>{progressError&&<Notice>{progressError}</Notice>}
   <LmsHours key={moduleId} value={progress?.mobileMeasuredTime} moduleId={moduleId}/>
   <Card><Txt small>PROGRAMME OTJ TOTAL IN THE LMS</Txt><Text style={s.statValue}>{hours===undefined||hours===null?'Unavailable':String(hours)+' h'}</Text><Txt small>Your programme record can include attendance and previously reviewed hours. It is separate from this week’s measured study.</Txt></Card>
   <Card><Text style={s.sectionTitle}>KSBs covered</Text><Txt>{Array.isArray(progress?.progressKsbCodes)&&progress.progressKsbCodes.length?progress.progressKsbCodes.join(' · '):'Your LMS KSB progress will appear here as learning is recorded.'}</Txt></Card>
   <Row title="Meetings and reminders" subtitle="Live sessions, coaching and progress reviews" onPress={()=>go('meetings')}/>
   <Btn title="Refresh my LMS progress" secondary disabled={busy} onPress={()=>run(()=>loadLearning(session))}/></>;
  if(view==='work')return <><H>Your portfolio</H><Txt>Keep your workplace evidence and reflections together in your LMS record.</Txt><Card><Txt>Open your LMS evidence page to continue working with your coach.</Txt><Btn title="Open my portfolio in the LMS" onPress={()=>openLms(LMS_ORIGIN+'/learner/evidence')}/></Card></>;
  if(view==='settings')return <><Back onPress={()=>go('home')}/><H>Your settings</H><Card><Text style={s.sectionTitle}>{courseTitle}</Text><Txt small>Your LMS enrolment controls course access. Dates and Teams sessions come from the LMS.</Txt><Row title="Choose a course" onPress={()=>go('courses')}/><Row title="Choose a week" onPress={()=>go('weeks')}/><Row title="Phone reminders" onPress={()=>go('meetings')}/></Card><Btn title="Refresh from LMS" disabled={busy} secondary onPress={()=>run(()=>loadLearning(session))}/><Btn title="Sign out" disabled={busy} secondary onPress={signOut}/></>;
  if(view==='weeks')return <><Back onPress={()=>go('home')}/><H>Choose a week</H><Txt>One week at a time. Your place is saved.</Txt>{weeks.map((w:any)=><Row key={w.id} title={w.number===0?'Welcome':w.title} onPress={()=>{setWeekId(w.id);setPoint(null);go('path');}}/>)}</>;
  if(view==='path')return <><Back title={point===null?'All weeks':'Back to the week'} onPress={()=>{setShowSteps(false);point===null?go('weeks'):setPoint(null);}}/><Txt small>{week?.number===0?'WELCOME':'WEEK '+(week?.number??'')}</Txt><H>{point===null?week?.title:'Point '+point}</H><Txt small>Listen, watch, then practise. One activity at a time.</Txt>
   <Card><Text style={s.sectionTitle}>Your next step</Text>{(()=>{const item=(point===null?week?.activities||[]:visible).find((a:any)=>a.available&&a.recommended&&a.mode!=='session'&&!done.has(a.id)&&!pendingReview.has(a.id));return item?<><Txt>{item.title}</Txt><Btn title="Begin next activity" onPress={()=>openActivity(item)}/></>:<Txt>{point===null?'Choose a point below to continue.':'You have finished the suggested steps. Revisit them whenever you like.'}</Txt>;})()}<Btn title={showSteps?'Hide activity list':'Show the steps'} secondary onPress={()=>setShowSteps(!showSteps)}/>
   {showSteps&&visible.map((item:any)=><Row key={item.id} title={item.title} done={done.has(item.id)} subtitle={(item.requirement==='optional'?'Optional · ':'')+(submitted.has(item.id)&&!done.has(item.id)?'Submitted · ':'')+(item.kind==='narration'?'Alice and George · narrated section of the book':item.mode==='quiz'?'AI Assisted Learning':item.mode==='session'?'Live session':'Play '+item.mode)} onPress={()=>openActivity(item)}/>)}</Card>
   {point===null&&week?.points.map((number:number)=><Row key={number} title={'Point '+number} subtitle={week.activities.find((a:any)=>a.pointNumber===number&&a.kind==='narration')?.title?.replace(/^Narrated Section of the Book - /,'')||'Watch, listen and practise'} onPress={()=>{setPoint(number);setShowSteps(false);scroll.current?.scrollTo({y:0,animated:false});}}/>)}</>;
  return <><View style={s.hero}><Image source={require('../assets/horse-ibis.png')} style={s.horse} accessible={false}/><Text style={s.eyebrow}>YOUR NEXT SMALL STEP</Text><H>Learning that fits your day.</H><Txt small>One activity. A little progress. Your place saved.</Txt></View>
   {meetings.data?.nextEvent&&<Row title="Your next session" subtitle={meetings.data.nextEvent.title} onPress={()=>go('meetings')}/>}
   <Card><Txt small>{next?.weekNumber===0?'WELCOME':next?'WEEK '+next.weekNumber:'YOUR COURSE'}</Txt><Text style={s.cardTitle}>{next?.title||'Your learning path'}</Text>
   <Btn title={next?'Continue learning':'Choose a week'} icon="arrow-forward" onPress={()=>next?(setWeekId(next.weekId),setPoint(next.pointNumber),openActivity(next)):go('weeks')}/></Card>
   {song&&<Btn title="Play song of the week" icon="musical-notes-outline" secondary onPress={()=>openActivity(song)}/>}
   <LmsHours key={moduleId} value={progress?.mobileMeasuredTime} moduleId={moduleId}/>
   <Row title="This week, point by point" subtitle={week?.title} onPress={()=>{setPoint(null);go('path');}}/>
   <Row title="Meetings and reminders" subtitle="Live sessions · coaching · progress reviews" onPress={()=>go('meetings')}/>
   <Row title="Choose a week" onPress={()=>go('weeks')}/><Row title="Choose a course" subtitle={courseTitle} onPress={()=>go('courses')}/></>;
 };
 return <SafeAreaView style={s.safe}><StatusBar style="dark"/><View style={[s.shell,{maxWidth:720}]}>
  <View style={s.top}><View style={s.brand}><Image source={require('../assets/crest.png')} style={s.crest}/><View style={{flex:1}}><Text style={s.brandName}>KENT BUSINESS COLLEGE</Text><Text style={s.brandSub}>{courseTitle}</Text></View></View>{session?.authenticated&&<Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={()=>go('settings')} style={s.settings}><Ionicons name="settings-outline" size={23} color={base.green}/></Pressable>}</View>
  <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">{error&&<Notice>{error}</Notice>}
   {loading?<Busy/>:!session?.authenticated?<><View style={s.hero}><Image source={require('../assets/horse-ibis.png')} style={s.horse} accessible={false}/><H>Welcome back.</H><Txt>Use your Kent Business College LMS account.</Txt></View><Card><Field label="LMS email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email"/><Field label="LMS password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"/><Btn title={busy?'Signing in…':'Sign in'} disabled={busy} onPress={signIn}/><Btn title="Open LMS sign-in and password help" secondary onPress={()=>openLms(LMS_ORIGIN+'/login')}/></Card><Btn title="Check connection again" secondary onPress={connect}/>{Platform.OS==='web'&&<Txt small>This preview needs the LMS connection enabled. The phone build uses the college’s secure LMS service.</Txt>}</>:courses?.length===0?<><H>Your course access</H><Txt>A current course is not currently assigned to this account. Your college can check your enrolment.</Txt><Btn title="Refresh my courses" onPress={()=>run(()=>loadLearning(session))}/><Btn title="Open my LMS" onPress={()=>openLms()}/><Btn title="Sign out" secondary onPress={signOut}/></>:!catalogue?<><H>Your course is loading</H><Btn title="Try again" disabled={busy} onPress={()=>run(()=>loadLearning(session))}/></>:!weeks.length&&!['courses','settings','meetings','progress','points','work'].includes(view)?<><H>{courseTitle}</H><Txt>No audio, video or MCQ materials are currently published for this course.</Txt><Btn title="Choose a course" onPress={()=>go('courses')}/><Btn title="Refresh from LMS" onPress={()=>run(()=>loadLearning(session))}/><Btn title="Open my LMS" onPress={()=>openLms()}/></>:content()}
  </ScrollView>{session?.authenticated&&view!=='activity'&&<View style={s.tabbar}>{[['home','Learn','leaf-outline'],['progress','Progress','stats-chart-outline'],['work','My work','briefcase-outline'],['points','Points','ribbon-outline']].map(([key,title,icon])=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:view===key}} accessibilityLabel={title} onPress={()=>go(key)} style={s.tab}><View style={[s.tabIcon,view===key&&s.tabActive]}><Ionicons name={icon as any} size={23} color={view===key?'#fff':base.green}/></View><Text style={[s.tabLabel,{color:base.green}]}>{title}</Text></Pressable>)}</View>}
 </View></SafeAreaView>;
}
