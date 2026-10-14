import React,{useState} from 'react';
import {Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Card,Txt,Btn} from './StandaloneUI';
import {durationLabel} from './WeeklyHoursCard';
import {normaliseLmsHours} from './lms-hours-model.mjs';
import {base,s} from './styles';
export function LmsHours({value,moduleId}:any){
 const model=normaliseLmsHours(value,moduleId),[details,setDetails]=useState(false);
 if(!model)return <Card><Text style={s.sectionTitle}>Your weekly hours</Text><Txt>Your recorded weekly hours are unavailable. Refresh when connected.</Txt><Txt small>Weekly aim: 9–10 hours. Planned durations are guidance.</Txt></Card>;
 const remaining=Math.max(0,model.weeklyTargetSeconds-model.weeklySubmittedSeconds);
 return <Card><View style={s.spaceBetween}><Text style={s.sectionTitle}>Your weekly hours</Text><Txt small>9–10 h aim</Txt></View>
  <Txt small>Week beginning {new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'Europe/London'}).format(new Date(model.weekStart+'T12:00:00Z'))}</Txt>
  <Text style={s.statValue}>{durationLabel(model.weeklySubmittedSeconds)}</Text><Txt small>Measured study saved in the LMS</Txt>
  <View accessibilityRole="progressbar" accessibilityLabel="Recorded weekly learning" accessibilityValue={{min:0,max:model.weeklyTargetSeconds,now:Math.min(model.weeklySubmittedSeconds,model.weeklyTargetSeconds),text:durationLabel(model.weeklySubmittedSeconds)+' recorded; weekly aim 9 to 10 hours'}} style={{height:12,borderRadius:6,backgroundColor:'#E3E9DE',overflow:'hidden'}}><View style={{height:12,width:(model.percent+'%') as any,backgroundColor:model.goalReached?'#987339':base.green}}/></View>
  {model.goalReached?<View style={[s.spaceBetween,{justifyContent:'flex-start',gap:12}]}><Ionicons name="ribbon-outline" color="#886126" size={28}/><Text accessibilityLiveRegion="polite" style={[s.sectionTitle,{flex:1}]}>Weekly study goal reached. Well done!</Text></View>:<Txt small>{durationLabel(remaining,true)} to reach 9 hours</Txt>}
  <Btn title={details?'Hide hours details':'Hours details'} secondary onPress={()=>setDetails(!details)}/>
  {details&&<><Txt small>Recorded across this module: {durationLabel(model.moduleSubmittedSeconds)}. Time above 10 hours stays in the total.</Txt>
   {model.weeklyPendingReviewSeconds>0&&<Txt small>{durationLabel(model.weeklyPendingReviewSeconds)} recorded on activities awaiting coach review.</Txt>}
   {model.unallocatedMeasuredSeconds>0&&<Txt small>{durationLabel(model.unallocatedMeasuredSeconds)} needs its reporting week checked.</Txt>}
   <Txt small>The college confirms eligible off-the-job hours. This bar shows saved measured study, separately from programme OTJ totals.</Txt></>}
 </Card>;
}
