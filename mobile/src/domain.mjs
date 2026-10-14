/** Pure learning logic. Device observations are not official attendance or assessed competence. */
export const PASS_PERCENT = 70;
export const MAX_INTERVAL_SECONDS = 5;
export const MAX_OBSERVATION_GAP_SECONDS = 10;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const dictionary = () => Object.create(null);

export function initialState() {
  return { activity: {}, ledger: {}, intervals: {}, attempts: {}, measurement: { scope: 'device-only', official: false }, leaderboard: { optedIn: false, alias: '' } };
}
function copyState(state = initialState()) {
  return { ...initialState(), ...state, activity: { ...state.activity }, ledger: { ...state.ledger }, intervals: { ...state.intervals }, attempts: { ...state.attempts }, measurement: { ...state.measurement, scope: 'device-only', official: false }, leaderboard: { optedIn: false, alias: '', ...state.leaderboard } };
}
const emptyProgress = () => ({ seconds: 0, completed: false, quizBestScore: 0, quizPassed: false, practiceCount: 0 });
function progressOf(state, id) { return { ...emptyProgress(), ...(own(state.activity, id) ? state.activity[id] : {}) }; }
function requireId(value, label = 'id') { if (typeof value !== 'string' || !value.trim() || ['__proto__', 'prototype', 'constructor'].includes(value)) throw new TypeError(`${label} must be a stable non-empty ID`); return value; }

export function activitiesOf(course) {
  if (Array.isArray(course?.activities)) return course.activities;
  return (course?.weeks || []).flatMap(week => (week.points || []).flatMap(point => (point.activities || []).map(activity => ({
    ...activity, weekId: activity.weekId ?? week.id, pointId: activity.pointId ?? point.id,
    released: week.released !== false && point.released !== false && activity.released !== false,
  }))));
}
export function nextActivity(course, state = initialState()) {
  return activitiesOf(course).find(activity => activity.released !== false && !progressOf(state, activity.id).completed &&
    (activity.prerequisiteIds || []).every(id => progressOf(state, id).completed)) || null;
}

/** First observation establishes a baseline. Long gaps, seeking and idle time receive no credit. */
export function recordInterval(state, observation) {
  const next = copyState(state);
  const { sessionId, activityId, monotonicMs, kind = 'reading', active = false, visible = false, playing = false, buffering = false, mediaPositionSeconds, playbackRate = 1, clockId = 'default' } = observation;
  requireId(sessionId, 'sessionId'); requireId(activityId, 'activityId'); requireId(clockId, 'clockId');
  if (!finite(monotonicMs) || monotonicMs < 0) throw new TypeError('monotonicMs must be a non-negative monotonic timestamp');
  if (!finite(playbackRate) || playbackRate <= 0) throw new TypeError('playbackRate must be positive');
  if (next.measurement.clockId !== clockId) { next.intervals = {}; next.measurement = { scope: 'device-only', official: false, clockId }; }
  const eligible = active === true && (kind === 'listening' ? playing === true && buffering === false && finite(mediaPositionSeconds) && mediaPositionSeconds >= 0 : visible === true);
  const previous = next.intervals[sessionId];
  const sample = { activityId, kind, lastMonotonicMs: monotonicMs, eligible, mediaPositionSeconds, playbackRate };
  next.intervals[sessionId] = sample;
  let creditedSeconds = 0;
  if (previous && previous.activityId === activityId && previous.kind === kind && previous.eligible && eligible) {
    const elapsed = (monotonicMs - previous.lastMonotonicMs) / 1000;
    if (elapsed > 0 && elapsed <= MAX_OBSERVATION_GAP_SECONDS) {
      const lastCredited = next.measurement.lastCreditedUntilMs;
      const start = Math.max(previous.lastMonotonicMs, finite(lastCredited) ? lastCredited : previous.lastMonotonicMs);
      const available = Math.max(0, (monotonicMs - start) / 1000);
      creditedSeconds = Math.min(available, MAX_INTERVAL_SECONDS);
      if (kind === 'listening') {
        const mediaDelta = mediaPositionSeconds - previous.mediaPositionSeconds;
        const rateUnchanged = playbackRate === previous.playbackRate;
        const expected = elapsed * playbackRate;
        if (!rateUnchanged || !finite(mediaDelta) || mediaDelta <= 0 || Math.abs(mediaDelta - expected) > Math.max(0.75, expected * 0.25)) creditedSeconds = 0;
        else creditedSeconds = Math.min(creditedSeconds, mediaDelta / playbackRate);
      }
    }
  }
  if (creditedSeconds > 0) {
    const progress = progressOf(next, activityId);
    next.activity[activityId] = { ...progress, seconds: progress.seconds + creditedSeconds };
    next.measurement.lastCreditedUntilMs = monotonicMs;
  }
  return { state: next, creditedSeconds };
}

export function totalPoints(state) { return Object.values(state?.ledger || {}).reduce((sum, entry) => sum + (finite(entry.points) && entry.points > 0 ? entry.points : 0), 0); }
function completionPoints(activity) { if(activity.rewardPolicy==='hours-and-quiz-v1')return 0; return Math.max(0, Math.floor(finite(activity.points) ? activity.points : activity.kind === 'quiz' ? 20 : 10)); }
export function completeActivity(state, activity) {
  requireId(activity?.id, 'activity.id');
  const next = copyState(state), progress = progressOf(next, activity.id), key = `completion:${activity.id}`;
  if (progress.completed) return { state: next, completed: true, awardedPoints: 0, reason: 'already-completed' };
  if (activity.released === false) return { state: next, completed: false, awardedPoints: 0, reason: 'not-released' };
  const needed = finite(activity.requiredSeconds) ? Math.max(0, activity.requiredSeconds) : 60;
  const qualifies = activity.kind === 'quiz' ? progress.quizPassed : progress.seconds >= needed;
  if (!qualifies) return { state: next, completed: false, awardedPoints: 0, reason: activity.kind === 'quiz' ? 'quiz-not-passed' : 'more-observed-time-needed' };
  next.activity[activity.id] = { ...progress, completed: true };
  const awardedPoints = own(next.ledger, key) ? 0 : completionPoints(activity);
  if (!own(next.ledger, key)) next.ledger[key] = { activityId: activity.id, points: awardedPoints, kind: 'completion' };
  return { state: next, completed: true, awardedPoints, reason: 'completed' };
}

/** Answers may be an array of choice indexes or a map keyed by question ID. */
export function scoreQuiz(questions, answers) {
  if (!Array.isArray(questions) || !questions.length) throw new TypeError('Quiz must contain questions');
  let correct = 0, answered = 0;
  questions.forEach((question, index) => {
    const expected = question.correctIndex ?? question.answerIndex;
    if (!Number.isInteger(expected) || expected < 0 || (question.options && expected >= question.options.length)) throw new TypeError('Each question needs a valid correctIndex');
    const given = Array.isArray(answers) ? answers[index] : answers?.[question.id];
    if (Number.isInteger(given) && given >= 0 && (!question.options || given < question.options.length)) { answered += 1; if (given === expected) correct += 1; }
  });
  const total = questions.length, percentage = correct / total * 100;
  return { correct, total, answered, percentage, passed: answered === total && percentage >= PASS_PERCENT, complete: answered === total };
}
export function recordQuizAttempt(state, activity, attempt) {
  requireId(activity?.id, 'activity.id'); requireId(attempt?.attemptId, 'attemptId');
  if (activity.kind !== 'quiz') throw new TypeError('Activity must be a quiz');
  const { correct, total, attemptId } = attempt;
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(correct) || correct < 0 || correct > total) throw new TypeError('Invalid quiz result');
  const next = copyState(state);
  if (activity.released === false) return { state: next, awardedPoints: 0, percentage: correct / total * 100, passed: false, duplicate: false, reason: 'not-released' };
  const attemptKey = JSON.stringify([activity.id, attemptId]);
  if (own(next.attempts, attemptKey)) return { state: next, awardedPoints: 0, ...next.attempts[attemptKey], duplicate: true };
  const percentage = correct / total * 100, passed = percentage >= PASS_PERCENT;
  const previous = progressOf(next, activity.id), best = Math.max(previous.quizBestScore, percentage);
  next.activity[activity.id] = { ...previous, quizBestScore: best, quizPassed: previous.quizPassed || passed, practiceCount: previous.practiceCount + 1 };
  next.attempts[attemptKey] = { activityId: activity.id, percentage, passed, correct, total, attemptNumber: previous.practiceCount + 1 };
  if(activity.rewardPolicy==='hours-and-quiz-v1'){const completion=completeActivity(next,activity);return {state:completion.state,awardedPoints:0,percentage,passed,duplicate:false};}
  // At most ten best-score points per quiz, regardless of repeated attempts.
  const bonusKey = `quiz-best:${activity.id}`, oldBonus = next.ledger[bonusKey]?.points || 0, newBonus = Math.floor(best / 10);
  next.ledger[bonusKey] = { activityId: activity.id, points: newBonus, kind: 'quiz-best' };
  const completion = completeActivity(next, activity);
  return { state: completion.state, awardedPoints: newBonus - oldBonus + completion.awardedPoints, percentage, passed, duplicate: false };
}

export function aggregateKSBs(course, state = initialState()) {
  const result = dictionary();
  const dictionaryEntries = Array.isArray(course.ksbs) ? course.ksbs : Object.entries(course.ksbs || {}).map(([code, detail]) => ({
    code, title: typeof detail === 'string' ? detail : detail?.title || detail?.description || code,
  }));
  dictionaryEntries.forEach(ksb => { const code = typeof ksb === 'string' ? ksb : ksb?.code; if (code) result[code] = { code, title: typeof ksb === 'string' ? code : ksb.title || ksb.description || code }; });
  activitiesOf(course).forEach(activity => {
    const progress = progressOf(state, activity.id);
    [...new Set(activity.ksbs || [])].forEach(ksb => {
      const code = typeof ksb === 'string' ? ksb : ksb.code;
      if (!code) return;
      const item = result[code] ||= { code, title: typeof ksb === 'object' ? ksb.title || code : code };
      item.totalActivities = (item.totalActivities || 0) + 1;
      item.measuredSeconds = (item.measuredSeconds || 0) + progress.seconds;
      item.exposedActivities = (item.exposedActivities || 0) + Number(progress.seconds > 0 || progress.practiceCount > 0);
      item.practisedActivities = (item.practisedActivities || 0) + Number(progress.practiceCount > 0 || (['reflection', 'assignment'].includes(activity.kind) && progress.completed));
      item.passedActivities = (item.passedActivities || 0) + Number(progress.quizPassed);
    });
  });
  return Object.values(result).map(item => ({ totalActivities: 0, measuredSeconds: 0, exposedActivities: 0, practisedActivities: 0, passedActivities: 0, ...item, status: item.passedActivities ? 'quiz-passed' : item.practisedActivities ? 'practised' : item.exposedActivities ? 'exposed' : 'not-started', competent: false, official: false, evidenceScope: 'device-only' }));
}

function parseDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError('Use a YYYY-MM-DD calendar date');
  const value = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== day) throw new TypeError('Invalid calendar date');
  return value;
}
const dateOnly = date => date.toISOString().slice(0, 10);
export function addCalendarDays(day, amount) { if (!Number.isInteger(amount)) throw new TypeError('Days must be an integer'); const value = parseDay(day); value.setUTCDate(value.getUTCDate() + amount); return dateOnly(value); }
export function daysInMonth(year, month) { if (!Number.isInteger(year) || year < 100 || !Number.isInteger(month) || month < 1 || month > 12) throw new TypeError('Invalid year/month'); return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
export function coachingWindow(year, month) { const last = daysInMonth(year, month), prefix = `${year}-${String(month).padStart(2, '0')}-`; return { start: `${prefix}${String(last - 9).padStart(2, '0')}`, end: `${prefix}${last}` }; }

/** Converts a 09:00 local calendar reminder to an instant, preserving London DST. */
export function zonedReminderInstant(day, timeZone = 'Europe/London', hour = 9) {
  parseDay(day);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new TypeError('Invalid hour');
  const [year, month, date] = day.split('-').map(Number), desired = Date.UTC(year, month - 1, date, hour);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = desired;
  for (let i = 0; i < 3; i++) { const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value])); const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second); instant += desired - represented; }
  return new Date(instant).toISOString();
}
export function calendarReminders({ from, to, reviewAnchor, timeZone = 'Europe/London' }) {
  const first = parseDay(from), last = parseDay(to);
  if (last < first) throw new TypeError('to must not precede from');
  if ((last - first) / 86400000 > 366 * 5) throw new RangeError('Schedule at most five years at once');
  const reminders = [], push = (kind, date, details = {}) => { if (date >= from && date <= to) reminders.push({ id: `${kind}:${date}`, kind, date, timeZone, scheduledAt: zonedReminderInstant(date, timeZone), ...details }); };
  const month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1, 12));
  while (month <= last) {
    const year = month.getUTCFullYear(), number = month.getUTCMonth() + 1, prefix = `${year}-${String(number).padStart(2, '0')}`;
    push('assignment', `${prefix}-21`, { title: 'Assignment due today' });
    const window = coachingWindow(year, number);
    push('coaching', window.start, { title: 'Book your monthly coaching', windowEnd: window.end, appointmentConfirmed: false });
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  if (reviewAnchor) {
    parseDay(reviewAnchor);
    let review = addCalendarDays(reviewAnchor, 70);
    if (review < from) { const days = (parseDay(from) - parseDay(review)) / 86400000; review = addCalendarDays(review, Math.ceil(days / 70) * 70); }
    while (review <= to) { push('review', review, { title: 'Arrange your ten-week progress review', appointmentConfirmed: false }); review = addCalendarDays(review, 70); }
  }
  return reminders.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** Real supplied peers only. Opting out produces no comparison. No fictitious peer or rank. */
export function leaderboardRows(peers, { selfId, optedIn = false } = {}) {
  if (!optedIn) return [];
  const unique = new Map();
  (peers || []).forEach(peer => {
    if (!peer || peer.optedIn !== true || typeof peer.id !== 'string' || !peer.id || typeof peer.alias !== 'string' || !peer.alias.trim() || !finite(peer.points) || peer.points < 0) return;
    if (!unique.has(peer.id)) unique.set(peer.id, { id: peer.id, alias: peer.alias.trim(), points: Math.floor(peer.points), isSelf: peer.id === selfId });
  });
  const rows = [...unique.values()].sort((a, b) => b.points - a.points || a.alias.localeCompare(b.alias));
  return rows.map((row, index) => ({ ...row, rank: index && rows[index - 1].points === row.points ? 1 + rows.findIndex(other => other.points === row.points) : index + 1 }));
}


