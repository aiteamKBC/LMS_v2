import {londonDateTimeISO, validDate} from './meetings-policy.mjs';

const ORIGIN = 'https://lms.kentbusinesscollege.org';
export const LMS_MEETING_LINKS = Object.freeze({
  calendar: ORIGIN+'/learner/calendar',
  coaching: ORIGIN+'/learner/monthly-coaching',
  review: ORIGIN+'/learner/progress-reviews',
  absence: ORIGIN+'/learner/report-absence',
  recordings: ORIGIN+'/learner/attendance',
  support: ORIGIN+'/learner/support',
});
const clean = (value, max=240) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const identity = value => (typeof value === 'string' || typeof value === 'number') && /^[1-9][0-9]*$/.test(String(value));
const displayType = row => ({'live-session':'live',mcr:'coaching','progress-review':'review',review:'review','catch-up':'catchup','student-support':'support','recorded-recovery':'recording'}[row.source] || (row.type==='review'?'review':'other'));

/** Only actual Teams joining URLs (or the LMS's protected join endpoint) can launch as a meeting. */
export function lmsMeetingJoinUrl(value) {
  if (typeof value !== 'string' || !value || value.length>8000 || /[\s\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, ORIGIN);
    if (url.protocol!=='https:' || url.username || url.password || url.port) return null;
    const teams = ['teams.microsoft.com','teams.live.com','teams.cloud.microsoft'].includes(url.hostname);
    const firstParty = url.origin===ORIGIN && /^\/learner_api\/session-results\/(commercial|apprenticeship)\/[^/]+\/[^/]+\/sessions\/[1-9][0-9]*\/join\/$/.test(url.pathname);
    return teams || firstParty ? url.toString() : null;
  } catch { return null; }
}

function scheduledStart(row) {
  // targetDate/date describe planning windows; they must not become appointments.
  if (row.isTimeEstimated===true || !validDate(row.scheduledDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.scheduledTime||'')) return null;
  const iso=londonDateTimeISO(row.scheduledDate,row.scheduledTime);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
  // A nonexistent spring-DST clock time is not silently shifted to a different class.
  if (`${parts.year}-${parts.month}-${parts.day}`!==row.scheduledDate || `${parts.hour}:${parts.minute}`!==row.scheduledTime) return null;
  return iso;
}

export function normalizeLmsMeetings(payload, session, {now=Date.now(),moduleId=null}={}) {
  const user=session?.user;
  if (!user || !identity(user.id) || !['commercial','apprenticeship'].includes(user.learnerKind)) throw new Error('Sign in to your LMS learner account to see your meetings.');
  if (!payload || !Array.isArray(payload.events) || !identity(payload.learner?.id) || String(payload.learner.id)!==String(user.id) || payload.learner.kind!==user.learnerKind) throw new Error('The LMS calendar did not match your learner account. Please refresh or sign in again.');
  const seen=new Set(),events=[];
  for (const row of payload.events) {
    if (!row || typeof row!=='object') continue;
    // Newer LMS projections may supply canonical moduleId; never match a title.
    if (moduleId && row.source==='live-session' && row.moduleId && row.moduleId!==moduleId) continue;
    const id=clean(row.eventKey||row.id,300);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const startsAt=scheduledStart(row),duration=Number(row.durationMinutes);
    const endsAt=startsAt&&Number.isFinite(duration)&&duration>0&&duration<=24*60 ? new Date(Date.parse(startsAt)+duration*60000).toISOString() : null;
    const rawStatus=clean(row.status,60),outcome=clean(row.meetingOutcome,60);
    const status=rawStatus==='cancelled'?'cancelled':rawStatus==='awaiting-signature'?'awaiting-signature':outcome==='completed'||rawStatus==='completed'?'completed':outcome==='ended'||endsAt&&Date.parse(endsAt)<=now?'ended':['scheduled','in-progress'].includes(rawStatus)&&startsAt&&endsAt?'confirmed':['not-scheduled','scheduled','in-progress'].includes(rawStatus)?'pending':'unknown';
    const warning=clean(row.syncWarning,700) || (row.syncError || ['failed','reconciliation'].includes(row.syncState) ? 'The LMS saved this appointment, but its calendar invitation needs attention. Check the details with your coach.' : '');
    const type=displayType(row);
    events.push({id,type,title:clean(row.title)||'Learning meeting',startsAt,endsAt,status,sourceStatus:rawStatus,
      targetDate:validDate(row.targetDate)?row.targetDate:null,moduleTitle:clean(row.module),moduleId:clean(row.moduleId)||null,
      joinUrl:status==='confirmed'?lmsMeetingJoinUrl(row.meetingLink):null,
      warning,invited:row.invited===true,changeClosed:row.changeClosed===true,
      watchedRecording:row.watchedRecording===true,
      manageUrl:type==='coaching'?LMS_MEETING_LINKS.coaching:type==='review'?LMS_MEETING_LINKS.review:LMS_MEETING_LINKS.calendar,
      recordingUrl:type==='live'||type==='recording'?LMS_MEETING_LINKS.recordings:null,
    });
  }
  events.sort((a,b)=>(Date.parse(a.startsAt)||Infinity)-(Date.parse(b.startsAt)||Infinity)||String(a.targetDate||'').localeCompare(String(b.targetDate||''))||a.id.localeCompare(b.id));
  const upcoming=events.filter(e=>e.status==='confirmed'&&Date.parse(e.endsAt)>now);
  const nextEvent=upcoming.find(e=>['live','coaching','review','catchup'].includes(e.type))||null;
  // Local reminders assist with confirmed appointments only. The LMS owns review cycles.
  const reminders=upcoming.filter(e=>['live','coaching','review','catchup'].includes(e.type)).map(e=>({id:'lms-appointment:'+e.id,type:'appointment',eventId:e.id,status:'upcoming',dueAt:new Date(Date.parse(e.startsAt)-15*60000).toISOString()})).filter(r=>Date.parse(r.dueAt)>now);
  return {source:'lms',events,upcoming,nextEvent,reminders,pending:events.filter(e=>e.status==='pending'),attention:events.filter(e=>['awaiting-signature','unknown'].includes(e.status)),past:events.filter(e=>['ended','completed','cancelled'].includes(e.status)),links:LMS_MEETING_LINKS};
}
