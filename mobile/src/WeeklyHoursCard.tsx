import React,{useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {base} from './styles';

type Props={weeklySeconds:number;programmeSeconds:number;assignmentMonthSeconds:number;weekLabel:string;monthLabel:string;ambiguousSeconds?:number;fontScale?:number;expandedByDefault?:boolean;standalone?:boolean;portfolio?:boolean;};
export function durationLabel(seconds:number,roundUp=false){const minutes=Math[roundUp?'ceil':'floor'](Math.max(0,seconds)/60);return Math.floor(minutes/60)+' h '+String(minutes%60).padStart(2,'0')+' min';}
export function WeeklyHoursCard({weeklySeconds,programmeSeconds,assignmentMonthSeconds,weekLabel,monthLabel,ambiguousSeconds=0,fontScale=1,expandedByDefault=false,standalone=false,portfolio=false}:Props){
 const [details,setDetails]=useState(expandedByDefault),goal=9*3600,complete=weeklySeconds>=goal,extra=Math.max(0,weeklySeconds-goal),percent=Math.min(100,Math.max(0,weeklySeconds/goal*100));
 const small={fontSize:13*fontScale,lineHeight:20*fontScale,color:base.muted};
 return <View style={[styles.card,complete&&styles.celebrated]}>
  <View style={styles.heading}><Text style={[styles.title,{fontSize:17*fontScale}]}>Your weekly hours</Text><Text style={small}>9–10 h aim</Text></View>
  <Text style={small}>{weekLabel} · Monday–Sunday</Text>
  <View style={styles.heading}><Text style={[styles.amount,{fontSize:20*fontScale}]}>{durationLabel(weeklySeconds)} completed</Text></View>
  <View accessibilityRole="progressbar" accessibilityLabel="Weekly learning hours" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(goal,weeklySeconds)} aria-valuetext={durationLabel(weeklySeconds)+' completed; weekly aim 9 to 10 hours'} accessibilityValue={{min:0,max:goal,now:Math.min(goal,weeklySeconds),text:durationLabel(weeklySeconds)+' completed; weekly aim 9 to 10 hours'}} style={styles.track}><View style={[styles.fill,{width:(percent+'%') as any,backgroundColor:complete?'#987339':base.green}]}/></View>
  {complete?<View style={styles.celebration}><Ionicons name="ribbon-outline" size={29} color="#886126"/><View style={{flex:1,gap:3}}><Text accessibilityLiveRegion="polite" style={[styles.title,{fontSize:17*fontScale}]}>Weekly goal reached. Well done!</Text><Text style={small}>{extra>=60?durationLabel(extra)+' beyond 9 hours, kept in your total.':'Take a moment to enjoy your progress.'}</Text></View></View>:<Text style={small}>{durationLabel(goal-weeklySeconds,true)} remaining to reach 9 hours</Text>}
  <Text style={small}>{standalone?'Saved to your independent learner account':'Recorded on this device · LMS hours not yet included'}</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={details?'Hide hours guidance':'Show hours guidance'} accessibilityState={{expanded:details}} onPress={()=>setDetails(v=>!v)} style={styles.detailsButton}><Text style={[small,{color:base.green,textDecorationLine:'underline'}]}>{details?'Hide guidance & total':'Guidance & programme total'}</Text><Ionicons name={details?'chevron-up':'chevron-down'} size={16} color={base.green}/></Pressable>
  {details&&<View style={styles.details}>
    <Text style={[styles.title,{fontSize:16*fontScale}]}>Plan your time flexibly</Text>
    <Text style={small}>Around 2 hours live and 5–6 hours guided learning each week: videos, reading, podcasts and quizzes.</Text>
    <Text style={small}>{portfolio?'Allow around 8 hours a month for portfolio evidence and reflection. Around 2 hours a week is a planning guide, not an automatic credit.':'Allow 8 hours a month for your case study or ALWI—one shared allowance. Around 2 hours a week is a planning guide, not an automatic credit.'}</Text>
    <Text style={small}>These are guides, not separate quotas. The weekly aim is 9–10 actual hours; you can keep learning beyond it.</Text>
    <Text style={small}>{monthLabel} {portfolio?'portfolio reflection':'assignment'} time: {durationLabel(assignmentMonthSeconds)} recorded here.</Text>
    <View style={styles.total}><Text style={[styles.title,{fontSize:16*fontScale}]}>Programme learning recorded here</Text><Text style={[styles.amount,{fontSize:23*fontScale}]}>{durationLabel(programmeSeconds)}</Text><Text style={small}>All measured time stays in this total, including time above 10 hours. Weekly hours are already included once.</Text></View>
    <Text style={small}>{standalone?'Learning observations and KSB opportunities are saved for your off-the-job log. Your provider confirms eligibility; measured time does not certify competence.':'For your off-the-job log: learning and assessment time remain separate for LMS review. Recorded time is not yet approved or uploaded.'}</Text>
    {ambiguousSeconds>0&&<Text style={small}>Some older sessions cross a reporting boundary. Their time remains in the programme total while their weekly allocation needs review.</Text>}
  </View>}
 </View>;
}
const styles=StyleSheet.create({card:{borderRadius:18,padding:18,gap:9,borderWidth:1,borderColor:base.line,backgroundColor:'#fff'},celebrated:{backgroundColor:'#F7F0DE',borderColor:'#D8C392'},heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8},title:{color:base.green,fontWeight:'600',lineHeight:25},amount:{color:base.green,fontWeight:'600',fontVariant:['tabular-nums']},track:{height:10,borderRadius:5,backgroundColor:'#E3E9DE',overflow:'hidden',marginVertical:4},fill:{height:10,borderRadius:5},celebration:{flexDirection:'row',gap:11,alignItems:'center',paddingVertical:7},detailsButton:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},details:{gap:12,borderTopWidth:1,borderTopColor:base.line,paddingTop:14},total:{gap:8,paddingVertical:10}});
