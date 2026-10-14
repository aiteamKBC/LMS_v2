import React,{useEffect,useRef,useState} from 'react';
import {AppState,Image,Linking,Platform,Pressable,Text,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSpeechRecognitionEvent} from 'expo-speech-recognition';
import {ActivityTimer} from './ActivityTimer';
import {StandaloneMedia,PlaybackSignal} from './StandaloneMedia';
import {Back,Btn,Busy,Card,Field,H,Notice,Txt} from './StandaloneUI';
import {s} from './styles';
import {requestDictation,stopVoice} from './voice';
import {answerIds,hasAnswer,normaliseAnswer,parseQuizVoice,toggleAnswer} from './quiz-model.mjs';
import {createLmsQuizDraft,mapLmsQuizAnswers,normaliseLmsQuiz,validateLmsQuizDraft} from './lms-quiz-model.mjs';
import {confirmedLmsActivityResult,createLmsActivityMeter,lmsActivityDraftKey,observeLmsActivity,readLmsActivityDraft,validLmsTimingSession} from './lms-activity-state.mjs';
import {LMS_MEETING_LINKS,lmsMeetingJoinUrl} from './lms-meetings-model.mjs';
import {appendLmsObservation,confirmLmsObservationEvent,newLmsObservations,prepareLmsObservationEvent,readLmsObservations} from './lms-observations.mjs';

type Props={client:any;session:any;activity:any;onBack:()=>void;onSaved:(result?:any)=>void|Promise<void>;onOpenLms?:(url:string)=>void|Promise<void>};
const monotonic=()=>globalThis.performance?.now?.()??Date.now();
const emptySignal:PlaybackSignal={playing:false,buffering:false,positionSeconds:0,durationSeconds:0};
const elapsed=(seconds:number)=>Math.floor(seconds/60)+'m '+Math.floor(seconds%60)+'s';
const visible=()=>AppState.currentState==='active'&&(Platform.OS!=='web'||!(globalThis as any).document?.hidden);

export function LmsActivity(props:Props){
 let ownerKey:string;
 try{ownerKey=lmsActivityDraftKey(props.session,props.activity);}catch(e:any){return <><Back onPress={props.onBack}/><Notice>{e.message}</Notice></>;}
 return <LmsActivityBody key={ownerKey} {...props} ownerKey={ownerKey}/>;
}
function LmsActivityBody({client,session,activity,onBack,onSaved,onOpenLms,ownerKey}:Props&{ownerKey:string}){
 const rewardObservations=session?.capabilities?.timeObservations===true&&activity.rewardObservationsSupported!==false;
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 const [quiz,setQuiz]=useState<any>(null),[answers,setAnswers]=useState<Record<string,string|string[]>>({}),[index,setIndex]=useState(0),[feedback,setFeedback]=useState('');
 const [timing,setTiming]=useState<any>(null),[seconds,setSeconds]=useState(0),[decision,setDecision]=useState<any>({active:false,kind:activity.mode==='quiz'?'quiz':'listening',reason:'content-not-ready'}),[paused,setPaused]=useState(false),[expired,setExpired]=useState(false),[changedQuiz,setChangedQuiz]=useState(false),[result,setResult]=useState<any>(null),[feedbackIndex,setFeedbackIndex]=useState(0);
 const [permission,setPermission]=useState(false),[listening,setListening]=useState(false),[voice,setVoice]=useState(''),[candidate,setCandidate]=useState<string[]>([]);
 const [transcript,setTranscript]=useState(''),[transcriptBusy,setTranscriptBusy]=useState(false);
 const [questionImages,setQuestionImages]=useState<Record<string,{state:'loaded'|'failed';ratio?:number}>>({}),[imageRetry,setImageRetry]=useState(0);
 const alive=useRef(true),finished=useRef(false),saving=useRef(false),storeQueue=useRef<Promise<unknown>>(Promise.resolve()),draft=useRef<any>(null),quizRef=useRef<any>(null),meter=useRef<any>(createLmsActivityMeter(0,'lms-'+Math.random().toString(36).slice(2))),lastInteraction=useRef(monotonic()),lastPersist=useRef(monotonic()),signal=useRef(emptySignal),shown=useRef(visible());
 const question=quiz?.questions[index];
 const questionImageReady=!question?.imageUrl||questionImages[question.id]?.state==='loaded';
 const allQuestionImagesReady=!quiz||quiz.questions.every((item:any)=>!item.imageUrl||questionImages[item.id]?.state==='loaded');
 const status=useRef<any>({});status.current={timing,paused,permission,loading,expired,changedQuiz,result,listening,questionImageReady};
 const voiceRef=useRef<any>({});voiceRef.current={listening,permission,question};
 const persist=(strict=false)=>{
  if(!draft.current||finished.current)return storeQueue.current;
  const snapshot=JSON.stringify({...draft.current,seconds:meter.current.seconds,updatedAt:Date.now()});
  const attempt=storeQueue.current.catch(()=>{}).then(()=>AsyncStorage.setItem(ownerKey,snapshot));
  storeQueue.current=attempt.catch(()=>{if(alive.current)setError('This phone could not save your draft. Keep this activity open until you can save it to the LMS.');});
  return strict?attempt:storeQueue.current;
 };
 const observe=()=>{
  const current=status.current;if(finished.current||!current.timing)return;
  const next=observeLmsActivity(meter.current,{activity,timing:current.timing,nowMs:monotonic(),lastInteractionMs:lastInteraction.current,visible:shown.current,paused:current.paused||saving.current||!!current.result,permissionPending:current.permission,contentReady:!current.loading&&!current.expired&&!current.changedQuiz&&current.questionImageReady!==false,signal:signal.current});
  meter.current=next;
  if(draft.current){draft.current.seconds=next.seconds;if(rewardObservations&&draft.current.observations)draft.current.observations=appendLmsObservation(draft.current.observations,next.measuredInterval);}
  if(alive.current){setSeconds(next.seconds);setDecision(next.decision);if(!validLmsTimingSession(current.timing,activity))setExpired(true);}
  if(monotonic()-lastPersist.current>5000){lastPersist.current=monotonic();void persist();}
 };
 const interact=()=>{lastInteraction.current=monotonic();};
 const open=async(url:string)=>{try{if(url.startsWith('https://lms.kentbusinesscollege.org/')&&onOpenLms)await onOpenLms(url);else await Linking.openURL(url);}catch{setError('This link could not open. Please try again.');}};
 const startFresh=async()=>{
  const fresh=await client.startLearning(activity.id,activity.mode);
  if(!validLmsTimingSession(fresh,activity)||(activity.mode==='quiz'&&String(fresh.activityId)!==String(quizRef.current?.lmsQuizId)))throw new Error('The LMS did not provide a valid timing session for this activity.');
  return fresh;
 };
 useEffect(()=>{
  alive.current=true;let cancelled=false;
  const load=async()=>{
   if(activity.mode==='session'){setLoading(false);return;}
   setLoading(true);setError('');
   const [raw,freshQuiz]=await Promise.all([AsyncStorage.getItem(ownerKey),activity.mode==='quiz'?client.quiz(activity.id):Promise.resolve(null)]);
   if(cancelled)return;
   const saved=readLmsActivityDraft(raw,ownerKey,activity);let nextAnswers:Record<string,string|string[]>={};let invalidQuiz=false;
   if(freshQuiz){
    const model=normaliseLmsQuiz(freshQuiz,{componentId:activity.id});quizRef.current=model;setQuiz(model);setQuestionImages({});
    if(saved?.quizDraft){const restored=validateLmsQuizDraft(model,saved.quizDraft);if(restored.valid)nextAnswers=restored.answers;else invalidQuiz=true;}
   }
   const oldTiming=saved?.timing;let usable=validLmsTimingSession(oldTiming,activity);
   if(activity.mode==='quiz'&&usable&&String(oldTiming.activityId)!==String(quizRef.current.lmsQuizId))usable=false;
   const fresh=oldTiming||invalidQuiz?oldTiming:await startFresh();if(cancelled)return;
   const base=Number(saved?.seconds||0),entry=saved||{version:1,ownerKey,componentId:activity.id,mode:activity.mode,seconds:0,feedback:'',index:0};
   draft.current={...entry,timing:fresh,quizDraft:saved?.quizDraft||(quizRef.current?createLmsQuizDraft(quizRef.current,{}):undefined)};
   let observationError='';
   if(rewardObservations&&fresh?.sessionId){try{draft.current.observations=readLmsObservations(saved?.observations,fresh.sessionId);}catch(problem:any){observationError=problem.message;}}
   meter.current=createLmsActivityMeter(base,'lms-'+Math.random().toString(36).slice(2));setSeconds(base);setTiming(fresh);status.current.timing=fresh;
   setAnswers(nextAnswers);setIndex(Math.max(0,Math.min((quizRef.current?.questions.length||1)-1,saved?.index||0)));setFeedback(saved?.feedback||'');
   setExpired((!!oldTiming&&!usable)||!!observationError);setChangedQuiz(invalidQuiz);setPaused(!!saved?.submissionPending);interact();setLoading(false);
   if(saved)setNotice(saved.submissionPending?'An earlier save was not confirmed. Your work is kept. Check LMS progress before submitting again.':'Your draft and measured time are restored on this phone.');
   if(observationError)setError(observationError);
   if(!invalidQuiz&&!observationError)await persist();
  };
  load().catch((e:any)=>{if(!cancelled){setError(e.message||'This activity could not load.');setLoading(false);}});
  const timer=setInterval(()=>{if(activity.mode==='quiz')observe();},1000);
  const visibility=()=>{shown.current=visible();if(shown.current)interact();else void stopVoice();observe();void persist();};
  const app=AppState.addEventListener('change',visibility),doc=Platform.OS==='web'?(globalThis as any).document:null;doc?.addEventListener('visibilitychange',visibility);
  return()=>{cancelled=true;alive.current=false;shown.current=false;status.current.paused=true;observe();void persist();clearInterval(timer);app.remove();doc?.removeEventListener('visibilitychange',visibility);void stopVoice();};
 },[retry]);
 useSpeechRecognitionEvent('result',(event:any)=>{if(!voiceRef.current.listening)return;const text=event.results?.[0]?.transcript||'';setVoice(text);if(event.isFinal){setCandidate(parseQuizVoice(text,voiceRef.current.question));setListening(false);interact();}});
 useSpeechRecognitionEvent('end',()=>{setListening(false);setPermission(false);});
 useSpeechRecognitionEvent('error',()=>{if(!voiceRef.current.listening&&!voiceRef.current.permission)return;setListening(false);setPermission(false);setError('Voice input stopped. You can choose an answer on screen.');});
 const dictate=async()=>{setPermission(true);status.current.permission=true;observe();setError('');setCandidate([]);setVoice('');try{const started=await requestDictation();if(alive.current)setListening(started);}catch(e:any){if(alive.current)setError(e.message);}finally{if(alive.current){setPermission(false);interact();}}};
 const changeAnswer=(value:string|string[])=>{
  if(!questionImageReady)return;
  interact();const next={...answers};if(answerIds(value).length)next[question.id]=value;else delete next[question.id];
  setAnswers(next);draft.current.quizDraft=createLmsQuizDraft(quizRef.current,next);setCandidate([]);void persist();
 };
 const move=(next:number)=>{void stopVoice();setListening(false);setCandidate([]);setVoice('');interact();setIndex(next);draft.current.index=next;void persist();};
 const restart=async()=>{
  if(saving.current)return;saving.current=true;setBusy(true);setError('');
  try{
   const fresh=await startFresh();if(!alive.current)return;
   const previous=meter.current.seconds;if(changedQuiz){draft.current.earlierQuizDraft=draft.current.quizDraft;draft.current.quizDraft=createLmsQuizDraft(quizRef.current,{});setAnswers({});setIndex(0);draft.current.index=0;}
   draft.current.previousObservedSeconds=(draft.current.previousObservedSeconds||0)+previous;draft.current.timing=fresh;draft.current.seconds=0;draft.current.submissionPending=false;
   draft.current.previousObservationDraft=draft.current.observations;draft.current.observations=rewardObservations?newLmsObservations(fresh.sessionId):undefined;
   meter.current=createLmsActivityMeter(0,'lms-'+Math.random().toString(36).slice(2));signal.current=emptySignal;setSeconds(0);setTiming(fresh);status.current.timing=fresh;setExpired(false);setChangedQuiz(false);setPaused(false);interact();await persist();
   setNotice('A new timed visit has started. '+elapsed(draft.current.previousObservedSeconds)+' from earlier visits remains saved on this phone and is not added to this new LMS session.');
  }catch(e:any){if(alive.current)setError(e.message);}finally{saving.current=false;if(alive.current)setBusy(false);}
 };
 const submit=async()=>{
  if(saving.current||finished.current)return;
  if(activity.mode==='quiz'&&!allQuestionImagesReady){setError('Load each question image before submitting your answers.');return;}
  if(!validLmsTimingSession(timing,activity)){setExpired(true);return;}
  if(activity.reflectionRequired&&!feedback.trim()){setError('Add your reflection before finishing this activity.');return;}
  observe();saving.current=true;setBusy(true);setPaused(true);status.current.paused=true;observe();void stopVoice();setListening(false);setError('');
  try{
   const measured=Math.floor(meter.current.seconds),body:any={trackingToken:timing.trackingToken,timeTakenSeconds:measured,feedback:feedback.trim()};
   if(activity.mode==='quiz')body.answers=mapLmsQuizAnswers(quizRef.current,answers);
   draft.current.submissionPending=true;await persist(true);
   if(rewardObservations){
    if(typeof client.recordObservations!=='function')throw new Error('The shared timer connection is unavailable.');
    for(;;){
     draft.current.observations=prepareLmsObservationEvent(draft.current.observations);const event=draft.current.observations.inFlight;if(!event)break;
     await persist(true);
     const receipt=await client.recordObservations({trackingToken:timing.trackingToken,componentId:activity.id,mode:activity.mode,...event});
     draft.current.observations=confirmLmsObservationEvent(draft.current.observations,receipt);await persist(true);
    }
   }
   const response=activity.mode==='quiz'?await client.submitQuiz(activity.id,body):await client.completeActivity(activity.id,body,{video:activity.mode==='video'});
   const confirmed=confirmedLmsActivityResult(response,activity,timing,{quizId:quizRef.current?.lmsQuizId,submittedSeconds:measured});
   finished.current=true;await storeQueue.current;if(!alive.current)return;
   setResult(confirmed);setNotice('');
   try{await AsyncStorage.removeItem(ownerKey);}catch{if(alive.current)setNotice('The LMS saved your work, but this phone could not clear the old draft. Check LMS progress before starting another attempt.');}
   try{await onSaved(response);}catch{if(alive.current)setNotice('The LMS saved your work. Refresh your progress screen to see the latest totals.');}
  }catch(e:any){if(alive.current)setError((e.message||'The LMS did not confirm this save.')+' Your draft remains on this phone.');}
  finally{saving.current=false;if(alive.current)setBusy(false);}
 };
 const loadTranscript=async()=>{if(transcriptBusy)return;setTranscriptBusy(true);try{const data=await client.transcript(activity.id);if(alive.current){if(data?.source!=='lms'||data.componentId!==activity.id||typeof data.transcript!=='string'||!data.transcript.trim())throw new Error('The LMS did not confirm a transcript for this activity.');setTranscript(data.transcript);}}catch(e:any){if(alive.current)setError(e.message);}finally{if(alive.current)setTranscriptBusy(false);}};
 const active=!!timing&&!loading&&!busy&&!expired&&!changedQuiz&&!paused&&!result;
 const toggleTimer=()=>{interact();setPaused(decision.reason==='idle'?false:!paused);status.current.paused=decision.reason==='idle'?false:!paused;observe();void persist();};
 const back=()=>{void stopVoice();void persist();onBack();};
 if(activity.mode==='session')return <><Back onPress={back}/><H>{activity.title}</H><Txt>Use your current LMS calendar for the correct session time, Teams link and attendance record.</Txt><Btn title="Open my LMS session calendar" onPress={()=>open(LMS_MEETING_LINKS.calendar)}/>{lmsMeetingJoinUrl(activity.joinUrl)&&<Btn title="Join Teams" secondary onPress={()=>open(lmsMeetingJoinUrl(activity.joinUrl)!)}/>}<Txt small>Joining does not by itself record attendance or learning hours.</Txt></>;
 return <View style={{gap:18}} onTouchStart={interact}>
  <Back onPress={back}/><Text style={s.eyebrow}>ONE ACTIVITY · ONE STEP</Text><H>{activity.mode==='quiz'?'AI Assisted Learning':activity.title}</H>{activity.mode==='quiz'&&<Txt small>{activity.title}</Txt>}
  {error&&<Notice>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  {loading?<Busy label="Preparing your LMS activity…"/>:!timing?<><Btn title="Try loading this activity again" onPress={()=>setRetry(v=>v+1)}/>{activity.mode==='quiz'&&<Btn title="Open quiz in the LMS" secondary onPress={()=>open('https://lms.kentbusinesscollege.org/learner/my-learning')}/>}</>:result?<>
   <Card>{activity.mode==='quiz'?<><Text style={s.result}>{Math.round(result.grade*100)}%</Text><Txt>{result.correct} of {result.total} correct</Txt><Txt>{result.passed?'You reached the LMS pass mark.':'Listen again to the ideas you found difficult, then practise when you are ready.'}</Txt></>:<Text style={s.cardTitle}>{result.awaitingCoachValidation?'Saved for coach review':'Saved to your LMS'}</Text>}<Txt small>{elapsed(result.verifiedSeconds)} recorded. Your LMS applies the hours, KSB and points rules.</Txt></Card>
   {result.breakdown.length>0&&<Card><Txt small>Answer {feedbackIndex+1} of {result.breakdown.length}</Txt><Txt>{result.breakdown[feedbackIndex].questionText}</Txt><Text style={s.sectionTitle}>{result.breakdown[feedbackIndex].correct?'Correct':'An idea to revisit'}</Text><Txt>Your answer: {result.breakdown[feedbackIndex].chosenAnswer||'No answer'}</Txt><Txt>Correct answer: {result.breakdown[feedbackIndex].correctAnswer}</Txt><Btn title="Previous answer" secondary disabled={!feedbackIndex} onPress={()=>setFeedbackIndex(i=>i-1)}/><Btn title="Next answer" secondary disabled={feedbackIndex>=result.breakdown.length-1} onPress={()=>setFeedbackIndex(i=>i+1)}/></Card>}
   <Btn title="Back to my learning" onPress={back}/>
  </>:<>
   <ActivityTimer seconds={seconds} decision={decision} onToggle={toggleTimer}/>
   {paused&&activity.mode!=='quiz'&&!expired&&!changedQuiz&&<Btn title="Continue this activity" secondary disabled={busy} onPress={()=>{interact();setPaused(false);status.current.paused=false;observe();}}/>}
   {(expired||changedQuiz)&&<Card><Notice>{changedQuiz?'The LMS quiz has changed. Your previous answers are kept on this phone. Start the current quiz to use its updated questions.':'This timing session has expired. Your answers, reflection and earlier time are kept on this phone.'}</Notice><Btn title={busy?'Starting…':changedQuiz?'Start the current quiz':'Start a new timed visit'} disabled={busy} onPress={restart}/></Card>}
   {activity.mode==='quiz'&&question?<>
    <Txt small>Question {index+1} of {quiz.questions.length} · No countdown</Txt>
    <Card><Text style={s.question}>{question.prompt}</Text>
     {question.imageUrl&&<>
      <Image key={question.id+':'+imageRetry} source={{uri:question.imageUrl}} resizeMode="contain" accessible accessibilityLabel={'Diagram for question '+(index+1)} style={{width:'100%',aspectRatio:questionImages[question.id]?.ratio||1.5,maxHeight:480,backgroundColor:'#fff'}}
       onLoad={(event:any)=>{if(!alive.current)return;const source=event.nativeEvent?.source,ratio=Number(source?.width)/Number(source?.height);setQuestionImages(previous=>({...previous,[question.id]:{state:'loaded',ratio:Number.isFinite(ratio)&&ratio>0?Math.max(0.25,Math.min(4,ratio)):1.5}}));interact();}}
       onError={()=>{if(alive.current)setQuestionImages(previous=>({...previous,[question.id]:{state:'failed'}}));}}/>
      {questionImages[question.id]?.state==='failed'?<><Notice>This question image could not load. Retry it before answering, or open the quiz in the LMS.</Notice><Btn title="Retry question image" secondary onPress={()=>{setQuestionImages(previous=>{const next={...previous};delete next[question.id];return next;});setImageRetry(value=>value+1);}}/><Btn title="Open quiz in the LMS" secondary onPress={()=>open('https://lms.kentbusinesscollege.org/learner/my-learning')}/></>:!questionImageReady&&<Txt small>Loading question image…</Txt>}
     </>}
     <Txt small>{question.selectionMode==='multiple'?'Choose all answers that apply.':'Choose one answer.'}</Txt>{question.options.map((option:any)=><Pressable key={option.id} accessibilityRole={question.selectionMode==='multiple'?'checkbox':'radio'} accessibilityState={{checked:answerIds(answers[question.id]).includes(option.id),disabled:busy||changedQuiz||!questionImageReady}} disabled={busy||changedQuiz||!questionImageReady} onPress={()=>changeAnswer(toggleAnswer(question,answers[question.id],option.id))} style={[s.option,answerIds(answers[question.id]).includes(option.id)&&s.optionSelected]}><Text style={s.optionLetter}>{option.id}</Text><Text style={[s.body,{flex:1}]}>{option.text}</Text></Pressable>)}</Card>
    <Btn title={listening?'Listening…':'Answer by voice'} secondary disabled={busy||permission||listening||changedQuiz||!questionImageReady} onPress={dictate}/>
    {voice&&<Card><Txt>You said: {voice}</Txt>{candidate.length>0?<Btn title={'Use answer'+(candidate.length>1?'s ':' ')+candidate.join(' and ')} onPress={()=>{changeAnswer(normaliseAnswer(question,candidate));setVoice('');}}/>:<Txt small>Say an option letter, such as “option B”, then confirm it on screen.</Txt>}</Card>}
    <View style={s.rowWrap}><Btn title="Previous question" secondary disabled={busy||!index} onPress={()=>move(index-1)}/><Btn title="Next question" secondary disabled={busy||index>=quiz.questions.length-1||!questionImageReady||!hasAnswer(question,answers[question.id])} onPress={()=>move(index+1)}/></View>
   </>:activity.mode!=='quiz'&&activity.url?<>
    <StandaloneMedia resource={{id:activity.id,url:activity.url,mime:activity.mode==='audio'?'audio/mpeg':'video/mp4',title:activity.title}} active={active} allowBackgroundAudio={activity.mode==='audio'} transcript={transcript} onSignal={value=>{signal.current=value;observe();if(!value.playing)void persist();}} onInteraction={interact} onError={setError}/>
    {activity.transcriptAvailable&&typeof client.transcript==='function'&&!transcript&&<Btn title={transcriptBusy?'Loading transcript…':'Transcript / learning support'} secondary disabled={transcriptBusy} onPress={loadTranscript}/>}
   </>:<Notice>The LMS has not supplied playable media for this activity.</Notice>}
   <Field label={activity.reflectionPrompt||(activity.reflectionRequired?'What have you learned? (required)':'Your reflection (optional)')} value={feedback} multiline maxLength={12000} editable={!busy} onChangeText={(value:string)=>{interact();setFeedback(value);draft.current.feedback=value;void persist();}}/>
   <Txt small>{activity.ksbs?.length?'Related KSBs: '+activity.ksbs.join(' · '):'KSB mapping is managed by the LMS.'}</Txt>
   <Btn title={busy?'Saving to the LMS…':activity.mode==='quiz'?'Submit my answers':'I’ve finished · save to LMS'} disabled={busy||expired||changedQuiz||seconds<1||(activity.mode==='quiz'&&(!allQuestionImagesReady||!quiz?.questions.every((q:any)=>hasAnswer(q,answers[q.id]))))||(!['audio','video','quiz'].includes(activity.mode))} onPress={submit}/>
   <Txt small>Your measured time is saved to the LMS when you finish. Your draft stays on this phone if a connection or validation check needs attention.</Txt>
   {draft.current?.submissionPending&&<Btn title="Check my LMS progress before retrying" secondary onPress={()=>open('https://lms.kentbusinesscollege.org/learner/my-progress')}/>}
  </>}
 </View>;
}
export default LmsActivity;
