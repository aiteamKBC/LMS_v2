import {useEffect,useRef,useState} from 'react';
import {AppState,Platform} from 'react-native';
import * as N from 'expo-notifications';
import {notificationCategories,ownedNotification} from './comms-model.mjs';
let activeAccount:string|null=null;
N.setNotificationHandler({handleNotification:async notification=>{
 const show=ownedNotification(notification,activeAccount);
 return {shouldShowBanner:show,shouldShowList:show,shouldPlaySound:false,shouldSetBadge:false};
}});
export function useMobilePush(client:any,accountId:string|null,onOpen:()=>void){
 const canConnectPhoneAlerts=Platform.OS==='android';
 const unavailableMessage=Platform.OS==='ios'
  ? 'Phone alerts on iPhone need KBC’s Apple notification setup. In-app reminders are still available.'
  : 'Connect phone alerts in the installed Android app. In-app reminders are still available here.';
 const current=useRef({accountId,onOpen});current.current={accountId,onOpen};
 const token=useRef<string|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const register=async(prompt=false)=>{
  const owner=current.current.accountId;if(!owner||!canConnectPhoneAlerts)return;
  for(const [key,label] of notificationCategories)await N.setNotificationChannelAsync('kbc-'+key+'-v1',{
   name:label,importance:N.AndroidImportance.DEFAULT,lockscreenVisibility:N.AndroidNotificationVisibility.PRIVATE,
   showBadge:false,sound:null,enableVibrate:false,
  });
  let permission=await N.getPermissionsAsync();
  if(!permission.granted&&prompt)permission=await N.requestPermissionsAsync();
  if(current.current.accountId!==owner)return;
  if(!permission.granted){setStatus('Phone alerts are off in Android settings. In-app reminders are still available.');return;}
  const result=await N.getDevicePushTokenAsync();
  if(current.current.accountId!==owner)return;
  await client.comms('device/','POST',{token:String(result.data),platform:'android'});
  if(current.current.accountId!==owner)return;
  token.current=String(result.data);setStatus('This phone is connected. Choose the alerts you want below.');
 };
 useEffect(()=>{
  activeAccount=accountId;token.current=null;setStatus('');
  if(!accountId||!canConnectPhoneAlerts)return()=>{activeAccount=null;};
  let alive=true;
  // Cancel the older on-device schedules; the LMS now owns reminder timing.
  void N.getAllScheduledNotificationsAsync().then(rows=>Promise.all(rows.filter(x=>x.identifier.startsWith('kbc:meetings:v1:')).map(x=>N.cancelScheduledNotificationAsync(x.identifier)))).catch(()=>{});
  const safeRegister=()=>void register().catch(()=>{if(alive)setStatus('Phone alerts could not connect. Tap Connect phone alerts to retry.');});
  safeRegister();
  const tap=(response:N.NotificationResponse|null)=>{
   if(alive&&response&&ownedNotification(response.notification,current.current.accountId)){
    current.current.onOpen();void N.clearLastNotificationResponseAsync().catch(()=>{});
   }
  };
  void N.getLastNotificationResponseAsync().then(tap).catch(()=>{});
  const response=N.addNotificationResponseReceivedListener(tap);
  const refresh=N.addPushTokenListener(()=>safeRegister());
  const foreground=AppState.addEventListener('change',state=>{if(state==='active')safeRegister();});
  return()=>{alive=false;activeAccount=null;response.remove();refresh.remove();foreground.remove();void N.dismissAllNotificationsAsync().catch(()=>{});};
 },[accountId,client]);
 return {status:canConnectPhoneAlerts?status:unavailableMessage,busy,canConnectPhoneAlerts,connect:async()=>{if(!canConnectPhoneAlerts){setStatus(unavailableMessage);return;}setBusy(true);try{await register(true);}catch{setStatus('Could not connect phone alerts. Check your connection and try again.');}finally{setBusy(false);}},
  disconnect:async()=>{const value=token.current;token.current=null;activeAccount=null;if(value)await client.comms('device/','DELETE',{token:value});}};
}
