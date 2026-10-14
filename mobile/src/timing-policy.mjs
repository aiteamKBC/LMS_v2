/** Automatic observation policy only. Official OTJ approval remains with KBC LMS. */
export const IDLE_TIMEOUT_MS = 180_000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validTime = value => finite(value) && value >= 0;
const stableId = value => typeof value === 'string' && value.trim() && !['__proto__', 'prototype', 'constructor'].includes(value);
const foregroundKinds = new Set(['reading', 'msp_reading', 'extended_reading', 'project_controls_reading', 'case_reading', 'poster', 'quiz', 'practice_quiz', 'reflection', 'assignment']);
const mediaKinds = new Set(['listening', 'song', 'podcast', 'cartoon', 'narrated_slides', 'case_video', 'video', 'audio']);
const lmsKinds = new Set(['external', 'live_session', 'msp_quiz', 'extended_quiz', 'case_quiz', 'official_quiz']);
const learningSurfaces = new Set(['lesson', 'quiz', 'reflect', 'assignment', 'activity']);
const sourceKind = activity => activity?.journeyKind || activity?.kind;

/**
 * Derive an observation; never increment seconds here. Feed the result into recordInterval,
 * which rejects gaps, seeks, duplicate observations and overlapping activity intervals.
 * isTTS means speech has actually started, not that a request has been queued.
 */
export function automaticTimingDecision({
  activity, surface, visible = false, nowMs, lastInteractionMs,
  manualPausedActivityId = null, permissionPending = false, contentReady = true,
  playing = false, buffering = false, mediaPositionSeconds,
  isTTS = false, isDictating = false, allowBackgroundPlayback = false,
} = {}) {
  const kind = sourceKind(activity);
  const observationKind = mediaKinds.has(kind) ? 'listening' : ['quiz', 'practice_quiz'].includes(kind) ? 'quiz' : kind === 'reflection' ? 'reflection' : kind === 'assignment' ? 'assignment' : 'reading';
  const result = (active, reason, source = 'local') => ({ active, kind: observationKind, reason, source });
  if (!stableId(activity?.id)) return result(false, 'no-activity', 'none');
  if (surface === 'portal' || lmsKinds.has(kind)) return result(false, 'tracked-in-lms', 'lms');
  if (activity.released === false) return result(false, 'not-released', 'none');
  if (!foregroundKinds.has(kind) && !mediaKinds.has(kind)) return result(false, 'unsupported-activity', 'none');
  if (manualPausedActivityId === activity.id) return result(false, 'manually-paused');
  if (permissionPending) return result(false, 'permission-pending');
  if (!contentReady) return result(false, 'content-not-ready');
  if (mediaKinds.has(kind)) {
    if (!visible && !allowBackgroundPlayback) return result(false, 'not-visible');
    if (buffering) return result(false, 'buffering');
    if (!playing || !validTime(mediaPositionSeconds)) return result(false, 'awaiting-playback');
    return result(true, 'confirmed-playback');
  }
  if (!learningSurfaces.has(surface)) return result(false, 'outside-activity');
  if (!visible) return result(false, 'not-visible');
  if (isTTS) return result(true, 'confirmed-read-aloud');
  if (isDictating) return result(true, 'confirmed-dictation');
  if (!validTime(nowMs) || !validTime(lastInteractionMs) || nowMs < lastInteractionMs) return result(false, 'awaiting-interaction');
  if (nowMs - lastInteractionMs >= IDLE_TIMEOUT_MS) return result(false, 'idle');
  return result(true, 'automatic-foreground');
}

/** Optional reducer for UI event handlers. Returning to visibility resumes after idle,
 * while interaction and visibility never undo an explicit pause of the current activity.
 * Changing activity clears that pause, including when later revisiting the old activity.
 */
export function transitionAutomaticTiming(state = {}, event = {}) {
  const next = { activityId: null, manualPausedActivityId: null, lastInteractionMs: null, visible: false, permissionPending: false, ...state };
  const touch = () => { if (validTime(event.nowMs)) next.lastInteractionMs = event.nowMs; };
  switch (event.type) {
    case 'activity':
      if (event.activityId !== next.activityId) {
        next.activityId = stableId(event.activityId) ? event.activityId : null;
        next.manualPausedActivityId = null;
        touch();
      }
      break;
    case 'interaction': touch(); break;
    case 'visibility': next.visible = event.visible === true; if (next.visible) touch(); break;
    case 'pause': if (next.activityId) next.manualPausedActivityId = next.activityId; break;
    case 'resume': next.manualPausedActivityId = null; touch(); break;
    case 'permission': next.permissionPending = event.pending === true; if (!next.permissionPending) touch(); break;
    default: break;
  }
  return next;
}

const validIso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && finite(Date.parse(value)) ? value : null;
const stringOrNull = value => typeof value === 'string' && value.trim() ? value : null;
function dateInZone(iso, timeZone) {
  if (!iso) return null;
  const fields = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const values = Object.fromEntries(fields.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function timeCategory(activity) {
  if (['learning', 'assessment'].includes(activity?.timeCategory)) return activity.timeCategory;
  const kind = sourceKind(activity);
  if (['assignment', 'quiz', 'practice_quiz', 'msp_quiz', 'extended_quiz', 'case_quiz', 'official_quiz'].includes(kind)) return 'assessment';
  if (foregroundKinds.has(kind) || mediaKinds.has(kind) || kind === 'live_session') return 'learning';
  return 'unknown';
}

/** Build reviewable observed-time rows from existing session records, never from a
 * planned duration, quiz score or UI completion flag. A KSB list is an association,
 * not a repeated award of the same seconds to every KSB. No claim is submitted.
 */
export function buildOtjReviewRecords({ sessions = {}, activities = [], moduleId = null, nativeModuleId = null, timeZone = 'Europe/London' } = {}) {
  // Fail early for an unsupported time zone instead of silently assigning a wrong date.
  new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date(0));
  const lookup = new Map();
  for (const activity of activities || []) if (stableId(activity?.id) && !lookup.has(activity.id)) lookup.set(activity.id, activity);
  return Object.entries(sessions || {}).filter(([sessionId, session]) => stableId(sessionId) && stableId(session?.activityId) && finite(session?.seconds) && session.seconds > 0).map(([sessionId, session]) => {
    const hasSnapshot = Object.prototype.hasOwnProperty.call(session, 'activityMetadata');
    const activity = hasSnapshot ? (session.activityMetadata?.id === session.activityId ? session.activityMetadata : null) : lookup.get(session.activityId);
    const startedAt = validIso(session.startedAt), lastObservedAt = validIso(session.lastObservedAt);
    const dateOrderValid = !!startedAt && !!lastObservedAt && Date.parse(lastObservedAt) >= Date.parse(startedAt);
    const spanSeconds = dateOrderValid ? (Date.parse(lastObservedAt) - Date.parse(startedAt)) / 1000 : null;
    const plausibleDuration = spanSeconds !== null && session.seconds <= spanSeconds + 1;
    const ksbs = [...new Set((Array.isArray(activity?.ksbs) ? activity.ksbs : []).map(value => typeof value === 'string' ? value : value?.code).filter(value => typeof value === 'string' && /^[KSB]\d+$/.test(value)))];
    const category = activity ? timeCategory(activity) : 'unknown';
    const sourceComponentId = stringOrNull(activity?.sourceComponentId) || stringOrNull(activity?.resource?.componentId) || stringOrNull(activity?.sourceId);
    const resolvedModuleId = stringOrNull(activity?.moduleId) || stringOrNull(moduleId);
    const resolvedNativeModuleId = stringOrNull(activity?.nativeModuleId) || stringOrNull(nativeModuleId);
    const mappingComplete = !!activity && !!(resolvedModuleId || resolvedNativeModuleId) && !!sourceComponentId && ksbs.length > 0 && category !== 'unknown';
    return {
      sessionId, activityId: session.activityId, activityTitle: stringOrNull(activity?.title),
      activityKind: activity ? sourceKind(activity) || null : null,
      observationKind: stringOrNull(session.kind), actualSeconds: session.seconds,
      startedAt, lastObservedAt, timeZone,
      localStartDate: dateInZone(startedAt, timeZone), localEndDate: dateInZone(lastObservedAt, timeZone),
      moduleId: resolvedModuleId, nativeModuleId: resolvedNativeModuleId,
      weekId: stringOrNull(activity?.weekId), pointId: stringOrNull(activity?.pointId), sourceComponentId,
      ksbs, timeCategory: category,
      mappingProvenance: hasSnapshot ? 'session-snapshot' : 'current-catalogue',
      activityMapped: !!activity, ksbMappingKnown: ksbs.length > 0, mappingComplete,
      datesValid: dateOrderValid, durationPlausible: plausibleDuration,
      readyForReview: mappingComplete && dateOrderValid && plausibleDuration,
      evidenceScope: 'device-only', official: false, competent: false,
      approvalStatus: 'not-reviewed', approvedEligibleSeconds: null,
    };
  }).sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || '') || a.sessionId.localeCompare(b.sessionId));
}
