import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {base,s} from './styles';
const clock=(seconds:number)=>{const n=Math.floor(seconds||0);return Math.floor(n/3600)>0?Math.floor(n/3600)+':'+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0'):Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
export function ActivityTimer({seconds=0,decision,onToggle,scale=1}:any){
 const lms=decision?.source==='lms',media=decision?.kind==='listening';
 const label=lms?'Recorded in KBC LMS':decision?.active?'Timing automatically':decision?.reason==='manually-paused'?'Paused by you':decision?.reason==='idle'?'Paused while inactive':decision?.reason==='permission-pending'?'Waiting for microphone permission':decision?.reason==='buffering'?'Paused while loading':decision?.reason==='content-not-ready'?'Timer stopped':media?(seconds>0?'Paused · follows playback':'Starts with playback'):'Paused while away';
 return <View accessibilityLabel="Activity timer" style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8}}><Ionicons name="time-outline" size={19} color={base.green}/><View style={{flex:1,gap:3}}>{!lms&&<Text style={[s.timerText,{fontSize:15*scale}]}>{clock(seconds)}</Text>}<Text style={[s.small,{fontSize:12*scale,lineHeight:18*scale}]}>{label}</Text></View>{!lms&&!media&&decision?.reason!=='content-not-ready'&&<Pressable accessibilityRole="button" accessibilityLabel={decision?.active?'Pause activity timer':'Resume activity timer'} onPress={onToggle} style={{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center'}}><Ionicons name={decision?.active?'pause-circle-outline':'play-circle-outline'} size={27} color={base.green}/></Pressable>}</View>;
}
