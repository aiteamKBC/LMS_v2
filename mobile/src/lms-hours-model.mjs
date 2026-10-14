import {PMP_ID} from './lms-learning-model.mjs';
const validSeconds=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function normaliseLmsHours(value,moduleId=PMP_ID){
 if(!value||value.source!=='lms'||value.moduleId!==moduleId||value.basis!=='saved_signed_active_seconds'||value.timezone!=='Europe/London')return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value.weekStart||'')||!/^\d{4}-\d{2}-\d{2}$/.test(value.weekEnd||''))return null;
 const start=Date.parse(value.weekStart+'T12:00:00Z'),end=Date.parse(value.weekEnd+'T12:00:00Z');
 if(!Number.isFinite(start)||end-start!==6*86400000||new Date(start).getUTCDay()!==1)return null;
 if(!validSeconds(value.weeklySubmittedSeconds)||!validSeconds(value.moduleSubmittedSeconds)||value.weeklySubmittedSeconds>value.moduleSubmittedSeconds)return null;
 return{...value,weeklyTargetSeconds:9*3600,goalReached:value.weeklySubmittedSeconds>=9*3600,percent:Math.min(100,value.weeklySubmittedSeconds/(9*3600)*100)};
}
