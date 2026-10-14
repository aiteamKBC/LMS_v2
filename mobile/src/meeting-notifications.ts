import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Platform} from 'react-native';
import {buildMeetingNotificationPlan,meetingNotificationDiff,ownsMeetingNotification} from './meeting-notification-plan.mjs';

export type MeetingReminder={id:string;type:'coaching'|'review'|'recording'|'appointment'|'catchup';dueAt:string;eventId?:string;status:'active'|'upcoming';recording?:{watchedFraction?:number;closed?:boolean}};
export type MeetingNotificationStatus='enabled'|'disabled'|'denied'|'unavailable'|'pending';
type NotificationAPI=typeof import('expo-notifications');
type Options={userId:string|null;enabled:boolean;reminders:MeetingReminder[];onOpenMeetings:(eventId?:string)=>void;onRefresh?:()=>void|Promise<unknown>};
const CHANNEL='kbc-learning-meetings-v1';
let loaded:Promise<NotificationAPI>|null=null,notificationQueue:Promise<unknown>=Promise.resolve(),activeUser:string|null=null;
function ordered<T>(work:()=>Promise<T>):Promise<T>{const next=notificationQueue.then(work,work);notificationQueue=next.catch(()=>{});return next;}
async function notifications(){if(Platform.OS==='web')throw new Error('Phone reminders are available in the installed Android or iPhone app. Your reminders remain visible here.');if(!loaded)loaded=import('expo-notifications');return loaded;}
const permitted=(N:NotificationAPI,p:Awaited<ReturnType<NotificationAPI['getPermissionsAsync']>>)=>p.granted||p.ios?.status===N.IosAuthorizationStatus.PROVISIONAL;
async function prepare(N:NotificationAPI){
 if(Platform.OS==='android')await N.setNotificationChannelAsync(CHANNEL,{name:'Learning and meeting reminders',description:'Optional reminders for your next learning activity or meeting.',importance:N.AndroidImportance.DEFAULT,lockscreenVisibility:N.AndroidNotificationVisibility.PRIVATE,showBadge:false,sound:null,enableVibrate:false});
 N.setNotificationHandler({handleNotification:async notification=>{const show=!!activeUser&&ownsMeetingNotification(notification,activeUser);return {shouldShowBanner:show,shouldShowList:show,shouldPlaySound:false,shouldSetBadge:false};}});
}
async function clearOwned(N:NotificationAPI,userId:string){
 const requests=await N.getAllScheduledNotificationsAsync();for(const request of requests)if(ownsMeetingNotification(request,userId))await N.cancelScheduledNotificationAsync(request.identifier);
 const shown=await N.getPresentedNotificationsAsync();for(const item of shown)if(ownsMeetingNotification(item,userId))await N.dismissNotificationAsync(item.request.identifier);
}
/** Call on sign-out if the root screen stays mounted. Other features' reminders are never cancelled. */
export async function cancelMeetingNotifications(userId:string|null){if(!userId||Platform.OS==='web')return;await ordered(async()=>{const N=await notifications();await clearOwned(N,userId);});}
async function reconcile(N:NotificationAPI,userId:string,reminders:MeetingReminder[]){
 const plan=buildMeetingNotificationPlan({userId,reminders,now:Date.now()} as any),existing=await N.getAllScheduledNotificationsAsync(),diff=meetingNotificationDiff(existing,plan,userId);
 for(const id of diff.cancel)await N.cancelScheduledNotificationAsync(id);
 // Close delivered notifications only when their reminder is no longer eligible, not merely because its date passed.
 const activeIds=new Set(reminders.filter(x=>x.status==='active'||x.status==='upcoming').filter(x=>x.type!=='recording'||(!x.recording?.closed&&Number(x.recording?.watchedFraction||0)<.2)).map(x=>x.id));
 for(const item of await N.getPresentedNotificationsAsync())if(ownsMeetingNotification(item,userId)&&!activeIds.has(String(item.request.content.data?.reminderId||'')))await N.dismissNotificationAsync(item.request.identifier);
 let failed=0;for(const item of diff.schedule){try{await N.scheduleNotificationAsync({identifier:item.identifier,content:{title:item.title,body:item.body,data:item.data,sound:false},trigger:{type:N.SchedulableTriggerInputTypes.DATE,date:new Date(item.date),...(Platform.OS==='android'?{channelId:CHANNEL}:{})}});}catch{failed++;}}
 return {count:plan.length,failed};
}

/** No permission dialog is opened by an effect. The learner must press the enable button. */
export function useMeetingNotifications(options:Options){
 const latest=useRef(options);latest.current=options;
 const [status,setStatus]=useState<MeetingNotificationStatus>('disabled'),[message,setMessage]=useState(''),alive=useRef(true),enabling=useRef(false),handled=useRef(new Set<string>());
 const update=useCallback((value:MeetingNotificationStatus,text:string)=>{if(alive.current){setStatus(value);setMessage(text);}},[]);
 const refresh=useCallback(async()=>{
  const current=latest.current,userId=current.userId;
  if(!userId){update('disabled','');return false;}
  if(Platform.OS==='web'){update('unavailable','Phone reminders are available in the installed Android or iPhone app. Your reminders remain visible here.');return false;}
  return ordered(async()=>{
   if(latest.current.userId!==userId)return false;
   const N=await notifications();await prepare(N);
   if(!latest.current.enabled){await clearOwned(N,userId);update('disabled','Phone reminders are off. Your reminders remain visible in Meetings & support.');return false;}
   const permission=await N.getPermissionsAsync();
   if(latest.current.userId!==userId)return false;
   if(!latest.current.enabled){await clearOwned(N,userId);update('disabled','Phone reminders are off. Your reminders remain visible in Meetings & support.');return false;}
   if(!permitted(N,permission)){await clearOwned(N,userId);update('denied','Phone reminders are blocked. You can enable notifications in your phone settings; your reminders remain visible in the app.');return false;}
   const result=await reconcile(N,userId,latest.current.reminders);
   if(latest.current.userId!==userId)return false;
   if(result.failed){update('unavailable','Your phone could not schedule every reminder. Check KBC Learn notifications in phone settings. Reminders remain visible in the app.');return false;}
   update('enabled','Phone reminders are on. Booking changes update when the app connects.');return true;
  }).catch(()=>{update('unavailable','Phone reminders could not be updated. Your reminders remain visible in Meetings & support.');return false;});
 },[update]);
 const enable=useCallback(async()=>{
  const userId=latest.current.userId;if(!userId||enabling.current)return false;
  if(Platform.OS==='web'){update('unavailable','Phone reminders are available in the installed Android or iPhone app. Your reminders remain visible here.');return false;}
  enabling.current=true;update('pending','Checking phone reminder permission…');
  try{return await ordered(async()=>{
   const N=await notifications();await prepare(N);let permission=await N.getPermissionsAsync();
   if(!permitted(N,permission)&&permission.canAskAgain)permission=await N.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:false,allowSound:false}});
   if(latest.current.userId!==userId)return false;
   if(!permitted(N,permission)){await clearOwned(N,userId);update('denied','Phone reminders were not enabled. You can change this in phone settings; reminders remain visible in the app.');return false;}
   const result=await reconcile(N,userId,latest.current.reminders);
   if(result.failed){await clearOwned(N,userId);update('unavailable','Your phone could not schedule these reminders. Check KBC Learn notifications in phone settings. Your in-app reminders are still available.');return false;}
   update('enabled','Phone reminders are on. Booking changes update when the app connects.');return true;
  });}catch{update('unavailable','Phone reminders could not be enabled. Your reminders remain visible in Meetings & support.');return false;}finally{enabling.current=false;}
 },[update]);
 const disable=useCallback(async()=>{const userId=latest.current.userId;try{await cancelMeetingNotifications(userId);update('disabled','Phone reminders are off. Your reminders remain visible in Meetings & support.');return true;}catch{update('unavailable','The phone could not clear its reminders. Please turn off notifications for KBC Learn in your phone settings.');return false;}},[update]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  const userId=options.userId;activeUser=userId;handled.current.clear();
  if(!userId||Platform.OS==='web')return;
  let cancelled=false,subscription:{remove:()=>void}|undefined;
  const tapped=(response:any)=>{const request=response?.notification?.request;if(cancelled||latest.current.userId!==userId||!request||!ownsMeetingNotification(request,userId)||request.content.data?.userId!==userId||handled.current.has(request.identifier))return false;handled.current.add(request.identifier);latest.current.onOpenMeetings(typeof request.content.data?.eventId==='string'?request.content.data.eventId:undefined);return true;};
  void notifications().then(async N=>{if(cancelled)return;const handle=(response:any)=>{if(tapped(response))void N.clearLastNotificationResponseAsync().catch(()=>{});};subscription=N.addNotificationResponseReceivedListener(handle);const response=await N.getLastNotificationResponseAsync();if(response)handle(response);}).catch(()=>{});
  return()=>{cancelled=true;subscription?.remove();if(activeUser===userId)activeUser=null;void cancelMeetingNotifications(userId).catch(()=>{});};
 },[options.userId]);
 const signature=JSON.stringify(options.reminders);
 useEffect(()=>{void refresh();},[options.userId,options.enabled,signature,refresh]);
 useEffect(()=>{
  const sync=()=>{Promise.resolve().then(()=>latest.current.onRefresh?.()).catch(()=>{}).finally(()=>{void refresh();});};
  const interval=setInterval(sync,10*60*1000),subscription=AppState.addEventListener('change',state=>{if(state==='active')sync();});
  const doc=Platform.OS==='web'?(globalThis as any).document:null,focus=()=>{if(!doc?.hidden)sync();};doc?.addEventListener('visibilitychange',focus);
  return()=>{clearInterval(interval);subscription.remove();doc?.removeEventListener('visibilitychange',focus);};
 },[refresh]);
 return {status,permission:status,message,enable,disable,refresh};
}
