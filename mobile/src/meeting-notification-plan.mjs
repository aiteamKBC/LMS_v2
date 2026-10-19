const PREFIX='kbc:meetings:v1:';
export const meetingNotificationPrefix=userId=>PREFIX+encodeURIComponent(String(userId))+':';
export const ownsMeetingNotification=(notification,userId)=>!!userId&&String(notification?.identifier||notification?.request?.identifier||'').startsWith(meetingNotificationPrefix(userId));
const isValidDate=value=>Number.isFinite(new Date(value).getTime());
function londonParts(date){return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',minute:'2-digit'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));}
export function londonNine(year,month,day){
 let date=new Date(Date.UTC(year,month-1,day,9));
 for(let i=0;i<2;i++){const p=londonParts(date),asUtc=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);date=new Date(date.getTime()+Date.UTC(year,month-1,day,9)-asUtc);}
 return date;
}
export function nextLondonReminder(now){const p=londonParts(new Date(now));let date=londonNine(p.year,p.month,p.day);if(date.getTime()<=Number(now)+60000){const next=new Date(Date.UTC(p.year,p.month-1,p.day+1));date=londonNine(next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate());}return date;}
const addLondonDays=(date,days)=>{const p=londonParts(date),next=new Date(Date.UTC(p.year,p.month-1,p.day+days));return londonNine(next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate());};
/** Server policy owns eligibility. This helper only schedules its current reminders, with generic lock-screen text. */
export function buildMeetingNotificationPlan({userId,reminders=[],now=Date.now(),maxCount=48,horizonDays=93}={}){
 if(!userId||!Number.isFinite(Number(now)))return [];
 const result=[],seen=new Set(),cutoff=Number(now)+horizonDays*86400000;
 for(const reminder of reminders){
  if(!reminder?.id||!['coaching','review','recording','appointment','catchup'].includes(reminder.type)||!['active','upcoming'].includes(reminder.status)||!isValidDate(reminder.dueAt))continue;
  if(reminder.type==='recording'&&(reminder.recording?.closed||Number(reminder.recording?.watchedFraction)>=.2))continue;
  let first=new Date(reminder.dueAt);
  // Historical missed booking windows stay in-app; they must not create a burst of old phone reminders.
  if(['coaching','review'].includes(reminder.type)){const due=londonParts(first),today=londonParts(new Date(now));if(due.year*12+due.month<today.year*12+today.month)continue;}
  // An appointment which has already passed cannot usefully be joined via an old reminder.
  if(first.getTime()<=Number(now)+60000){if(reminder.type==='appointment')continue;first=nextLondonReminder(Number(now));}
  for(const days of reminder.type==='recording'?[0,2,5,8]:[0]){
   const date=days?addLondonDays(first,days):first,when=date.getTime();if(when<=Number(now)+60000||when>cutoff)continue;
   const identifier=meetingNotificationPrefix(userId)+encodeURIComponent(reminder.id)+':'+when;
   if(seen.has(identifier))continue;seen.add(identifier);
   result.push({identifier,date:date.toISOString(),title:'KBC Learn',body:reminder.type==='recording'?'Your learning reminder is ready. Open Meetings & support.':reminder.type==='appointment'?'Your next meeting is coming up. Open Meetings & support.':'Take a moment to check your next booking in Meetings & support.',data:{owner:'kbc-meetings-v1',userId:String(userId),reminderId:String(reminder.id),eventId:typeof reminder.eventId==='string'?reminder.eventId:'',screen:'meetings'}});
  }
 }
 return result.sort((a,b)=>new Date(a.date)-new Date(b.date)||a.identifier.localeCompare(b.identifier)).slice(0,Math.max(0,Math.min(48,maxCount)));
}
export function meetingNotificationDiff(existing,plan,userId){const desired=new Set(plan.map(item=>item.identifier)),present=new Set(existing.filter(item=>ownsMeetingNotification(item,userId)).map(item=>item.identifier));return {cancel:[...present].filter(id=>!desired.has(id)),schedule:plan.filter(item=>!present.has(item.identifier))};}
