export const notificationCategories = [
 ['cohort_messages','Cohort messages'],['private_messages','Private messages'],
 ['meetings','Meetings and sessions'],['attendance','Attendance follow-up'],
 ['assignments','Assignments'],['tasks','Tasks'],
];
export function notificationData(notification) {
 const request=notification?.request||notification;
 const raw=request?.content?.data||{};
 const remote=request?.trigger?.remoteMessage?.data||{};
 return {...remote,...raw};
}
export function ownedNotification(notification,accountId) {
 const data=notificationData(notification);
 return !!accountId&&String(data.accountId)===String(accountId)&&/^[1-9][0-9]*$/.test(String(data.notificationId||''));
}
export function mergeMessages(existing,incoming) {
 return [...new Map([...existing,...incoming].map(row=>[row.id,row])).values()].sort((a,b)=>a.id-b.id);
}
