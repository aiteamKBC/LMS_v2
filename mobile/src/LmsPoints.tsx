import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Text,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Btn,Busy,Card,Field,H,Notice,Txt} from './StandaloneUI';
import {s} from './styles';
import {normaliseLmsPoints} from './lms-points-model.mjs';
import {confirmLmsVoucherResponse,normaliseLmsRewards,readLmsVoucherDraft,voucherDraftKey} from './lms-rewards-model.mjs';

type Props={client:any,session:any,refreshVersion?:number};
const count=(value:number)=>value.toLocaleString('en-GB');
const requestKey=()=> 'voucher:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
export function LmsPointsScreen(props:Props){
 const user=props.session?.user;
 return <LmsPointsBody key={String(user?.accountId)+':'+String(user?.learnerKind)+':'+String(user?.id)} {...props}/>;
}
function LmsPointsBody({client,session,refreshVersion=0}:Props){
 const moduleId=session?.rewardModuleId||'MOD-KBC-PMP-M01-SMR';
 const learnerId=String(session?.user?.id||''),owner=String(session?.user?.accountId||'')+':'+String(session?.user?.learnerKind||'')+':'+learnerId;
 const shared=session?.capabilities?.customPointsPolicy===true;
 const [saved,setSaved]=useState<any>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(false);
 const [selection,setSelection]=useState<any>(null),[pending,setPending]=useState<any>(null),[draftLoaded,setDraftLoaded]=useState(false),[actionBusy,setActionBusy]=useState(false),[message,setMessage]=useState(''),[alias,setAlias]=useState('');
 const requestId=useRef(0),alive=useRef(false),currentOwner=useRef(owner),mutating=useRef(false);currentOwner.current=owner;
 const reload=useCallback(async()=>{
  const request=++requestId.current;setLoading(true);setError('');
  try{
   const model=shared?normaliseLmsRewards(await client.rewardsSummary(moduleId),learnerId,moduleId):normaliseLmsPoints(await client.points(),learnerId);
   if(alive.current&&currentOwner.current===owner&&request===requestId.current)setSaved({owner,model});
  }catch(problem:any){
   if(alive.current&&currentOwner.current===owner&&request===requestId.current){
    if(problem?.status===401||['AUTH_REQUIRED','SESSION_CHANGED','SESSION_REQUIRED'].includes(problem?.code))setSaved(null);
    setError(problem?.message||'Your LMS points could not be loaded. Please try again.');
   }
  }finally{if(alive.current&&currentOwner.current===owner&&request===requestId.current)setLoading(false);}
 },[client,learnerId,owner,shared,moduleId]);
 useEffect(()=>{
  alive.current=true;let stopped=false;setSaved(null);setExpanded(false);setPending(null);setSelection(null);setMessage('');setAlias('');setDraftLoaded(false);void reload();
  void AsyncStorage.getItem(voucherDraftKey(owner)).then(raw=>{if(stopped||currentOwner.current!==owner)return;setPending(readLmsVoucherDraft(raw,owner));setDraftLoaded(true);}).catch((e:any)=>{if(!stopped&&currentOwner.current===owner)setError(e.message||'This phone could not check earlier voucher requests.');});
  const listener=AppState.addEventListener('change',state=>{if(state==='active')void reload();});
  return()=>{stopped=true;alive.current=false;requestId.current++;listener.remove();};
 },[reload,owner]);
 const priorVersion=useRef(refreshVersion);
 useEffect(()=>{if(priorVersion.current!==refreshVersion){priorVersion.current=refreshVersion;void reload();}},[refreshVersion,reload]);
 const data=saved?.owner===owner?saved.model:null;
 const stillHere=()=>alive.current&&currentOwner.current===owner;
 const sendVoucher=async()=>{
  if(mutating.current||!draftLoaded||!data?.policyConfirmed||(!pending&&!selection))return;
  mutating.current=true;setActionBusy(true);setError('');setMessage('');
  const entry=pending||{owner,requestId:requestKey(),amountGbp:selection.amountGbp};
  try{
   // Persist before sending: a timeout must retry this same reservation.
   await AsyncStorage.setItem(voucherDraftKey(owner),JSON.stringify(entry));if(!stillHere())return;setPending(entry);
   const response=await client.requestVoucher({requestId:entry.requestId,amountGbp:entry.amountGbp},moduleId);
   const result=confirmLmsVoucherResponse(response,learnerId,entry,moduleId);if(!stillHere())return;
   await AsyncStorage.removeItem(voucherDraftKey(owner));if(!stillHere())return;
   setPending(null);setSelection(null);setMessage('Your £'+result.amountGbp+' voucher request is recorded ('+result.status+'). The college team will confirm fulfilment.');await reload();
  }catch(problem:any){if(stillHere())setError((problem.message||'The LMS could not confirm this request.')+' Any saved request will retry with the same reference.');}
  finally{mutating.current=false;if(stillHere())setActionBusy(false);}
 };
 const setCompetition=async(optedIn:boolean)=>{
  if(mutating.current||!data?.policyConfirmed)return;mutating.current=true;setActionBusy(true);setError('');
  try{
   const displayName=optedIn?alias.trim():'';
   const result=await client.setLeaderboard({optedIn,displayName},moduleId);
   if(result?.source!=='lms'||result.moduleId!==moduleId||String(result.learnerId)!==learnerId||result.optedIn!==optedIn||result.displayName!==displayName)throw new Error('The LMS did not confirm your leaderboard preference. Refresh before trying again.');
   if(!stillHere())return;setMessage(optedIn?'You have joined the optional module leaderboard.':'You have left the module leaderboard.');await reload();
  }catch(problem:any){if(stillHere())setError(problem.message||'Your preference could not be saved.');}
  finally{mutating.current=false;if(stillHere())setActionBusy(false);}
 };
 if(!data&&loading)return <Busy label="Loading your LMS points…"/>;
 return <View style={{gap:18}}><H>Your points</H><Txt>Your learning rewards, shared with the LMS.</Txt>
  {error&&<Notice>{error}</Notice>}{message&&<Notice>{message}</Notice>}
  {!data?<Card><Txt>Your points are currently unavailable.</Txt><Btn title="Refresh points" disabled={loading} onPress={reload}/></Card>:<>
   <Card><Text style={s.eyebrow}>{error?'LAST CONFIRMED LMS BALANCE':'LMS POINTS BALANCE'}</Text><Text style={s.result}>{count(data.balance)}</Text>
    <Txt small>{count(data.earned)} earned · {count(data.committed)} committed to voucher requests</Txt>
    {data.policyConfirmed&&<Txt>100 points = £1 Amazon voucher value.</Txt>}
    <Btn title={loading?'Refreshing…':'Refresh points'} secondary disabled={loading||actionBusy} onPress={reload}/></Card>
   {data.policyConfirmed?<>
    <Card><Text accessibilityRole="header" style={s.sectionTitle}>Your vouchers</Text>
     {pending?<><Notice>A voucher request is saved on this phone. Check or retry this request before starting another.</Notice><Btn title={actionBusy?'Checking request…':'Check my £'+pending.amountGbp+' request'} disabled={actionBusy} onPress={sendVoucher}/></>:selection?<>
      <Txt>Request £{selection.amountGbp} using {count(selection.points)} points?</Txt><Txt small>The LMS reserves these points for the college team to review and fulfil your request.</Txt>
      <Btn title={actionBusy?'Sending request…':'Confirm voucher request'} disabled={actionBusy||!draftLoaded||!!error} onPress={sendVoucher}/><Btn title="Back to vouchers" secondary disabled={actionBusy} onPress={()=>setSelection(null)}/>
     </>:<>{data.voucherOptions.length?data.voucherOptions.map((option:any)=><Btn key={option.rewardId} title={'£'+option.amountGbp+' voucher · '+count(option.points)+' points'} secondary disabled={!option.enoughPoints||actionBusy||!draftLoaded||!!error} onPress={()=>setSelection(option)}/>):<Txt>The college has not opened voucher requests for this module yet.</Txt>}</>}
     {data.voucherRequests.length>0&&<Txt small>Recent requests</Txt>}{data.voucherRequests.slice(0,5).map((item:any)=><Txt small key={item.requestId}>£{item.amountGbp} · {item.status} · {new Date(item.requestedAt).toLocaleDateString('en-GB')}</Txt>)}
    </Card>
    <Card><Text accessibilityRole="header" style={s.sectionTitle}>Optional leaderboard</Text>
     {data.leaderboard.optedIn?<><Txt>You are taking part as {data.leaderboard.displayName}.</Txt>{data.leaderboard.entries.slice(0,10).map((entry:any)=><Txt key={entry.rank+':'+entry.displayName}>{entry.rank}. {entry.displayName} · {count(entry.points)} points</Txt>)}<Btn title="Leave leaderboard" secondary disabled={actionBusy||!!error} onPress={()=>setCompetition(false)}/></>:<><Txt>Your learning continues whether or not you compete. Joining displays your chosen name and module points to other participants.</Txt><Field label="Leaderboard display name" value={alias} maxLength={80} onChangeText={setAlias}/><Btn title="Join leaderboard" secondary disabled={!alias.trim()||actionBusy||!!error} onPress={()=>setCompetition(true)}/></>}
    </Card>
   </>:<Card><Text accessibilityRole="header" style={s.sectionTitle}>Rewards in the LMS</Text>{data.rewards.length?data.rewards.map((reward:any)=><View key={reward.id} style={s.recordRow}><Text style={s.rowTitle}>{reward.name}</Text><Txt>{count(reward.points)} points</Txt></View>):<Txt>No rewards are currently listed.</Txt>}<Txt small>The updated mobile rewards are awaiting activation.</Txt></Card>}
  </>}
  <Card><Btn title={expanded?'Hide reward information':'How rewards work'} secondary onPress={()=>setExpanded(value=>!value)}/>{expanded&&<>
   {!data?.policyConfirmed&&<Notice>The updated rules are awaiting activation on the LMS. Your confirmed balance stays unchanged.</Notice>}
   <Txt>{data?.policy?.formula?.pointsPerHour??1} point(s) per complete hour of accepted study. Part-hours carry forward across courses.</Txt>
   <Txt>First submitted quiz only: at least {data?.policy?.formula?.quizThreshold??70}% earns {data?.policy?.formula?.quizPointPerCorrect??1} point(s) per correct answer; 100% earns {data?.policy?.formula?.perfectQuizPointPerCorrect??2} instead. Retakes earn no extra points.</Txt>
   {!!data?.policy?.minimumStudySeconds&&<Txt small>Study visits need at least {data.policy.minimumStudySeconds/60} accepted minutes to count towards hour rewards.</Txt>}
   <Txt>100 points represents £1 Amazon voucher value.</Txt>
   {data?.study&&<Txt small>{(data.study.acceptedStudySeconds/3600).toFixed(1)} hours accepted for study rewards · {data.study.pendingSessionCount} sessions awaiting confirmation. Your formal programme OTJ record is shown separately in Progress.</Txt>}
   {data?.opportunities?.map((item:any)=><View key={item.id} style={s.recordRow}><Text style={s.rowTitle}>{item.title} · {count(item.points)} points</Text><Txt small>{item.status==='completed'?'Verified':item.status==='needs_dates'?'Awaiting college dates':item.status==='scheduled'?'Opens '+item.opensOn:item.status==='closed'?'Window closed':'College verification required'}</Txt></View>)}
   <Txt small>Verified bonus activities and the semester award are controlled by the college. Personal dates do not authorise points. Unsent activity time is excluded until accepted by the LMS.</Txt>
  </>}</Card>
 </View>;
}
export default LmsPointsScreen;
