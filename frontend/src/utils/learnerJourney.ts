import type { ComponentKsbMapping, LearnerDetail, LearnerQuizAttempt } from '@/api/learnerDetail';
export { formatHoursMinutes } from '@/lib/format';

export interface JourneyComponent {
  title: string;
  expectedOtjh: number | null;
  moduleId?: string | null;
  weekId?: string | null;
  ksbWeightTotal?: number | null;
  ksbMappingCount?: number | null;
  ksbMappings?: ComponentKsbMapping[];
  componentId?: string | null;
  type?: string | null;
  description?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  contentHtml?: string | null;
  fileName?: string | null;
  downloadAllowed?: boolean;
  reflectionPrompt?: string | null;
  reflectionRequired?: boolean;
  reflectionQuestion?: string | null;
  resourceUrl?: string | null;
  liveSessionUrl?: string | null;
  teamsLiveSessionId?: string | null;
  sessionDate?: string | null;
  sessionTime?: string | null;
  sessionDateTimeUtc?: string | null;
  durationMinutes?: number | null;
  isQuiz?: boolean;
  quizMeta?: { quizId: number; questions: number | null; duration: number | null; timeUnit: string | null };
  quizAttempts?: LearnerQuizAttempt[];
}

/* ═══════════════════════════════════════════════════════
   COMPONENT COMPLETION MODEL
   Which component types a learner can OPEN + complete (with
   the reflection/KSBs/time flow) and how they're rendered.
   Quizzes and videos have their own dedicated flows.
   ═══════════════════════════════════════════════════════ */
export type ContentKind = 'video' | 'audio' | 'reading' | 'slides' | 'reflection' | 'resource';

/** Map a component's type to how its content should be presented. */
export function componentContentKind(type: string | null | undefined): ContentKind {
  const t = (type || '').toLowerCase();
  if (t === 'video') return 'video';
  if (t === 'podcast') return 'audio';
  if (t === 'reading') return 'reading';
  if (t === 'powerpoint') return 'slides';
  if (t === 'reflection') return 'reflection';
  return 'resource';
}

/* ═══════════════════════════════════════════════════════
   COMPLETION CRITERIA
   KSB weights describe curriculum contribution and never block
   a learner from finishing an activity. Assignments remain gated
   because they require an approved evidence upload.
   ═══════════════════════════════════════════════════════ */
/** Only assignments collect uploaded evidence, so only they can require it. */
export function componentRequiresEvidence(type: string | null | undefined): boolean {
  return (type || '').trim().toLowerCase().replace(/-/g, '_') === 'assignment';
}

export interface ComponentCriteria {
  gated: boolean;          // true only when an evidence upload is required
  evidenceRequired: boolean;
  evidenceMet: boolean;
  met: boolean;            // overall: safe to complete
}

/** Evaluate the completion gate. `evidenceCount` is the learner's approved
 * uploads for this component (pass 0 when not yet known). */
export function componentCriteria(c: JourneyComponent, evidenceCount: number): ComponentCriteria {
  const evidenceRequired = componentRequiresEvidence(c.type);
  const evidenceMet = evidenceRequired ? evidenceCount > 0 : true;
  return {
    gated: evidenceRequired,
    evidenceRequired,
    evidenceMet,
    met: evidenceMet,
  };
}

/* ═══════════════════════════════════════════════════════
   KSB PROGRESS (weighted)
   The component rule above, inverted: a component declares
   which KSBs it develops and at what weight, so a KSB's
   progress is the weight it has EARNED from completed
   components over the weight AVAILABLE across the plan.

   Weight is always taken from the component's AUTHORED
   mapping, never from the codes stored on a completion
   record — legacy records hold learner-picked codes with no
   weight behind them (one historic quiz attempt lists 31
   codes at once), which would otherwise wildly overstate
   progress.
   ═══════════════════════════════════════════════════════ */

/** Component mappings use sub-codes ('K3.1', 'S1.2') that are not themselves
 * programme KSB codes. Roll them up to the parent ('K3', 'S1') so the weight
 * lands on the KSB the learner is actually assessed against. */
export function ksbParentCode(code: string): string {
  return String(code || '').trim().toUpperCase().split('.')[0];
}

/** Normalise API labels (Knowledge / Skill / Behaviour) to the compact keys
 * used by the KSB page's category layout. */
export function ksbTypeCode(type: string | null | undefined, code = ''): 'K' | 'S' | 'B' | '?' {
  const value = String(type || code.charAt(0) || '').trim().toUpperCase();
  if (value === 'K' || value.startsWith('KNOWLEDGE')) return 'K';
  if (value === 'S' || value.startsWith('SKILL')) return 'S';
  if (value === 'B' || value.startsWith('BEHAVIOUR') || value.startsWith('BEHAVIOR')) return 'B';
  return '?';
}

export type KsbStatus = 'complete' | 'in-progress' | 'not-started';

export interface KsbContributor {
  componentId: string;
  title: string;
  module: string | null;
  week: string | null;
  type: string | null;
  weight: number;
  classification: string | null;
  done: boolean;
}

export interface KsbProgress {
  code: string;
  type: string;                 // K | S | B
  description: string;
  availableWeight: number;      // total weight this KSB can earn from the plan
  earnedWeight: number;         // weight from components already completed
  remainingWeight: number;
  pct: number;                  // earnedWeight / availableWeight (0 when no weight is available)
  status: KsbStatus;
  contributors: KsbContributor[];   // components that develop this KSB
  doneCount: number;
  totalCount: number;
}

export interface KsbProgressSource {
  ksbs: { code: string; type?: string; description?: string }[];
  components: {
    componentId?: string | null;
    component?: string;
    module?: string | null;
    week?: string | null;
    type?: string | null;
    ksbMappings?: { code: string; weight: number; classification?: string | null }[];
  }[];
  completedComponentIds: Iterable<string>;
  evidencedKsbCodes?: Iterable<string>;
}

/** Derive weighted progress for every programme KSB.
 * `completedComponentIds` must already be de-duplicated, so a component
 * completed twice (retake / re-watch) contributes its weight only once. */
export function buildKsbProgress(src: KsbProgressSource): KsbProgress[] {
  const done = new Set(src.completedComponentIds);
  const evidenced = new Set(Array.from(src.evidencedKsbCodes || [], ksbParentCode));
  const byCode = new Map<string, KsbContributor[]>();

  for (const c of src.components || []) {
    const componentId = c.componentId || '';
    if (!componentId) continue;
    for (const m of c.ksbMappings || []) {
      const code = ksbParentCode(m.code);
      if (!code) continue;
      const list = byCode.get(code) || [];
      // A component can map both a parent and its sub-code (e.g. K1 and K1.1);
      // both are genuine authored weight, so both are kept.
      list.push({
        componentId,
        title: c.component || 'Activity',
        module: c.module ?? null,
        week: c.week ?? null,
        type: c.type ?? null,
        weight: Number(m.weight) || 0,
        classification: m.classification ?? null,
        done: done.has(componentId),
      });
      byCode.set(code, list);
    }
  }

  return (src.ksbs || []).map((k) => {
    const code = String(k.code || '').trim().toUpperCase();
    const contributors = (byCode.get(code) || [])
      .slice()
      .sort((a, b) => Number(a.done) - Number(b.done) || b.weight - a.weight);
    const availableWeight = contributors.reduce((s, c) => s + c.weight, 0);
    const recordedEvidence = evidenced.has(code);
    const earnedWeight = recordedEvidence
      ? availableWeight
      : contributors.reduce((s, c) => s + (c.done ? c.weight : 0), 0);
    const doneCount = contributors.filter((c) => c.done).length;
    const pct = recordedEvidence
      ? 100
      : availableWeight > 0
      ? Math.max(0, Math.min(100, Math.round((earnedWeight / availableWeight) * 100)))
      : 0;
    const status: KsbStatus = recordedEvidence || (earnedWeight >= availableWeight && availableWeight > 0)
      ? 'complete'
      : earnedWeight > 0
        ? 'in-progress'
        : 'not-started';
    return {
      code,
      type: ksbTypeCode(k.type, code),
      description: k.description || '',
      availableWeight,
      earnedWeight,
      remainingWeight: Math.max(0, availableWeight - earnedWeight),
      pct,
      status,
      contributors,
      doneCount,
      totalCount: contributors.length,
    };
  });
}

/** Mirrors backend `learner_api/progress_rules.py`: kinds whose row is a graded
 * attempt, where achievement needs an explicit pass. Everything else records a
 * completion, so `passed` stays null and the row itself is the achievement. */
const GRADED_PROGRESS_KINDS = new Set(['quiz']);

/** Does this progress record count as achieved delivery?
 *
 * `passed === false` never counts, whatever the kind — a failed attempt with a
 * valid componentId and valid KSB codes is still a failed attempt. A graded
 * kind must have passed outright.
 */
export function progressCountsAsAchieved(
  record: { kind?: string | null; passed?: boolean | null } | null | undefined,
): boolean {
  if (!record) return false;
  if (record.passed === false) return false;
  if (GRADED_PROGRESS_KINDS.has(String(record.kind || '').trim().toLowerCase())) {
    return record.passed === true;
  }
  return true;
}

/** Component ids the learner has finished, de-duplicated across every
 * completion source (a re-watch or retake must not count twice). A failed
 * attempt is excluded: it is history, not a completion. */
export function completedComponentIds(real: {
  videoProgress?: { componentId: string; kind?: string; passed?: boolean | null }[];
  componentProgress?: { componentId: string; kind?: string; passed?: boolean | null }[];
} | null): Set<string> {
  const ids = new Set<string>();
  for (const v of real?.videoProgress || []) if (v.componentId && progressCountsAsAchieved(v)) ids.add(v.componentId);
  for (const c of real?.componentProgress || []) if (c.componentId && progressCountsAsAchieved(c)) ids.add(c.componentId);
  return ids;
}

/** Has the learner finished this plan row? A quiz counts once it has been
 * passed at all — a later failed retake is history and never revokes the
 * achievement, the same rule `progressCountsAsAchieved` applies to every other
 * completion source. Non-quiz rows are looked up in `completedIds`, which
 * callers build with `completedComponentIds`. */
export function isComponentComplete(c: JourneyComponent, completedIds: Set<string>): boolean {
  if (c.isQuiz) return (c.quizAttempts || []).some((a) => a.passed);
  return !!c.componentId && completedIds.has(c.componentId);
}

/** KSBs backed by a genuine completed learner activity. Failed attempts are
 * deliberately excluded — some legacy quiz attempts attach an entire KSB
 * profile even when the learner scored zero, and the same must hold for a
 * component or video recorded as not passed. Video/component completions remain
 * valid evidence when a curriculum refresh has changed their authored id.
 */
export function recordedKsbEvidenceCodes(real: LearnerDetail | null): Set<string> {
  const codes = new Set<string>();
  const records = [
    // quizAttempts is the graded bucket by construction — pre-'kind' rows land
    // there without one, so name the kind rather than relying on the field.
    ...(real?.quizAttempts || []).filter((attempt) => progressCountsAsAchieved({ kind: 'quiz', passed: attempt.passed })),
    ...(real?.videoProgress || []).filter((entry) => progressCountsAsAchieved(entry)),
    ...(real?.componentProgress || []).filter((entry) => progressCountsAsAchieved(entry)),
  ];
  for (const record of records) {
    for (const rawCode of record.ksbs || []) {
      const code = ksbParentCode(rawCode);
      if (code) codes.add(code);
    }
  }
  return codes;
}

/** Short noun used in the reflection copy ("this podcast", "this reading…"). */
export function componentNoun(type: string | null | undefined): string {
  const t = (type || '').toLowerCase();
  return ({
    video: 'video', podcast: 'podcast', reading: 'reading', powerpoint: 'slide deck',
    reflection: 'reflection', activity: 'activity', workplace_evidence: 'evidence task',
    'workplace-evidence': 'evidence task', live_session: 'session',
    recording_placeholder: 'recording', 'recording placeholder': 'recording',
  } as Record<string, string>)[t] || 'activity';
}

/** Does this activity contain something the learner can actually consume?
 * An id/title alone is not content and must never lead to an empty runner. */
export function hasComponentContent(c: JourneyComponent): boolean {
  const hasText = (value?: string | null) => Boolean(value?.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '').trim());
  const hasUrl = (value?: string | null) => Boolean(value?.trim());
  if (c.isQuiz) return c.quizMeta?.quizId != null && (c.quizMeta.questions ?? 0) > 0;

  const type = (c.type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const hasDescription = hasText(c.description);
  if (type === 'video') return hasUrl(c.videoUrl);
  if (type === 'podcast' || type === 'audio') return hasUrl(c.audioUrl) || hasUrl(c.resourceUrl) || hasDescription;
  if (type === 'reading') return hasText(c.contentHtml) || hasUrl(c.resourceUrl) || hasUrl(c.audioUrl) || hasDescription;
  if (type === 'powerpoint' || type === 'presentation' || type === 'slides') return hasUrl(c.resourceUrl) || hasDescription;
  if (type === 'reflection') return hasText(c.reflectionPrompt) || hasText(c.reflectionQuestion) || hasDescription;
  if (type === 'live_session') {
    return hasUrl(c.liveSessionUrl) || hasText(c.sessionDateTimeUtc) || hasText(c.sessionDate) || Boolean(c.teamsLiveSessionId) || hasDescription;
  }
  return hasUrl(c.resourceUrl)
    || hasText(c.reflectionPrompt)
    || hasText(c.reflectionQuestion)
    || hasText(c.contentHtml)
    || hasUrl(c.audioUrl)
    || hasDescription;
}

/** Can the learner open + complete this non-quiz component? */
export function isOpenableComponent(c: JourneyComponent): boolean {
  if (c.isQuiz || !c.componentId) return false;
  return hasComponentContent(c);
}
export interface JourneyWeek {
  week: string;
  otjh: number;
  components: JourneyComponent[];
}
export interface JourneyModule {
  module: string;
  weeks: JourneyWeek[];
}

export interface TrainingPlanWeekPosition {
  current: number | null;
  total: number;
  state: 'upcoming' | 'active' | 'complete';
}

function parsePlanDate(value?: string): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parsed = isoDate
    ? new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
    : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Calendar position in the learner's complete module/week training plan. */
export function trainingPlanWeekPosition(
  real: LearnerDetail | null,
  today = new Date(),
): TrainingPlanWeekPosition | null {
  if (!real) return null;
  const total = buildLearnerJourney(real).reduce((count, module) => count + module.weeks.length, 0);
  const start = parsePlanDate(real.programmeStartDate || real.cohortStartDate);
  if (!start || total === 0 || Number.isNaN(today.getTime())) return null;

  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const elapsedDays = Math.floor((todayDay - startDay) / 86_400_000);
  if (elapsedDays < 0) return { current: null, total, state: 'upcoming' };
  if (elapsedDays >= total * 7) return { current: total, total, state: 'complete' };
  return {
    current: Math.min(total, Math.floor(elapsedDays / 7) + 1),
    total,
    state: 'active',
  };
}

/**
 * Visual metadata for a component, derived from its title. Real learner data
 * carries no component "type" field — titles arrive as "Type · Detail" (or just
 * "Type"), so we key off the segment before the "·" to pick an icon/colour that
 * matches the mock training-plan's ACTIVITY_TYPE_META styling.
 */
export interface ComponentTypeMeta {
  label: string;
  detail: string | null;
  icon: string;
  bg: string;
  color: string;
}

const TYPE_META: Record<string, { icon: string; bg: string; color: string }> = {
  video: { icon: 'ri-play-circle-line', bg: 'bg-red-50', color: 'text-red-600' },
  quiz: { icon: 'ri-questionnaire-line', bg: 'bg-amber-50', color: 'text-amber-600' },
  reading: { icon: 'ri-book-open-line', bg: 'bg-blue-50', color: 'text-blue-600' },
  podcast: { icon: 'ri-headphone-line', bg: 'bg-violet-50', color: 'text-violet-600' },
  reflection: { icon: 'ri-brain-line', bg: 'bg-purple-50', color: 'text-purple-600' },
  powerpoint: { icon: 'ri-slideshow-line', bg: 'bg-orange-50', color: 'text-orange-600' },
  'live session': { icon: 'ri-vidicon-line', bg: 'bg-rose-50', color: 'text-rose-600' },
  'recording placeholder': { icon: 'ri-record-circle-line', bg: 'bg-slate-50', color: 'text-slate-600' },
  'workplace evidence': { icon: 'ri-file-add-line', bg: 'bg-emerald-50', color: 'text-emerald-600' },
  evidence: { icon: 'ri-file-add-line', bg: 'bg-emerald-50', color: 'text-emerald-600' },
  activity: { icon: 'ri-tools-line', bg: 'bg-orange-50', color: 'text-orange-600' },
};

const DEFAULT_TYPE_META = { icon: 'ri-checkbox-circle-line', bg: 'bg-background-100', color: 'text-foreground-500' };

/** Split a "Type · Detail" component title into styled parts. */
export function componentTypeMeta(title: string): ComponentTypeMeta {
  const [rawLabel, ...rest] = title.split('·').map((s) => s.trim());
  const label = rawLabel || title;
  const detail = rest.length ? rest.join(' · ') : null;
  const meta = TYPE_META[label.toLowerCase()] || DEFAULT_TYPE_META;
  return { label, detail, ...meta };
}

/** Grade -> numeric percent (0-100). Accepts the new 0-1 decimal form (0.9 ->
 * 90), a legacy "30%" string, or a legacy whole-number percent. */
export function gradePercent(grade: string | number | undefined): number {
  if (typeof grade === 'number') return grade <= 1 ? Math.round(grade * 100) : grade;
  const m = String(grade ?? '').match(/-?\d+(\.\d+)?/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  return n <= 1 ? Math.round(n * 100) : n;
}

/** First number found in a free-text time ("about 25 minutes" -> 25). null if none. */
function parseMinutes(text: string | undefined): number | null {
  const m = String(text ?? '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Parse a stored hours string ("1.5", "48") to a number. 0 on garbage. */
export function parseHours(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** For each quiz, the learner's BEST attempt = highest grade%, ties -> most recent. */
function bestAttemptPerQuiz(attempts: LearnerQuizAttempt[]): LearnerQuizAttempt[] {
  const byQuiz = new Map<number, LearnerQuizAttempt>();
  for (const a of attempts) {
    const cur = byQuiz.get(a.quizId);
    if (!cur) { byQuiz.set(a.quizId, a); continue; }
    const better = gradePercent(a.grade) > gradePercent(cur.grade)
      || (gradePercent(a.grade) === gradePercent(cur.grade) && (a.submittedAt || '') > (cur.submittedAt || ''));
    if (better) byQuiz.set(a.quizId, a);
  }
  return Array.from(byQuiz.values());
}

export interface QuizAggregateStats {
  quizzesTaken: number;       // distinct quizzes with at least one attempt
  totalMinutes: number;       // summed chosen time of each quiz's best attempt
  totalHours: number;         // totalMinutes / 60, rounded to 1dp
  ksbCodes: string[];         // union of KSB codes across best attempts
  ksbCount: number;           // distinct KSB count
}

/** Best watch per video component: highest reportedTime, ties -> most recent. */
function bestWatchPerVideo(videos: LearnerDetail['videoProgress']): NonNullable<LearnerDetail['videoProgress']> {
  const byComp = new Map<string, NonNullable<LearnerDetail['videoProgress']>[number]>();
  for (const v of videos || []) {
    const cur = byComp.get(v.componentId);
    const mins = parseMinutes(v.reportedTime) ?? 0;
    if (!cur) { byComp.set(v.componentId, v); continue; }
    const curMins = parseMinutes(cur.reportedTime) ?? 0;
    if (mins > curMins || (mins === curMins && (v.submittedAt || '') > (cur.submittedAt || ''))) {
      byComp.set(v.componentId, v);
    }
  }
  return Array.from(byComp.values());
}

/**
 * Aggregate a learner's progress into the overview-card figures.
 * KSBs: the union of KSB codes from each quiz's BEST attempt AND each video
 * component's best watch — retakes/re-watches never double-count a KSB.
 * `totalMinutes`/`totalHours`: a best-attempt-per-activity time rollup (the
 * user-facing OTJ hours come from the backend `completedHours`, which sums ALL
 * attempts — this figure is only a secondary KSB-time summary).
 */
export function quizAggregateStats(real: LearnerDetail | null): QuizAggregateStats {
  const empty: QuizAggregateStats = { quizzesTaken: 0, totalMinutes: 0, totalHours: 0, ksbCodes: [], ksbCount: 0 };
  if (!real) return empty;

  const bestQuizzes = bestAttemptPerQuiz(real.quizAttempts || []);
  const bestVideos = bestWatchPerVideo(real.videoProgress);
  if (bestQuizzes.length === 0 && bestVideos.length === 0) return empty;

  let totalMinutes = 0;
  const ksbSet = new Set<string>();
  for (const r of [...bestQuizzes, ...bestVideos]) {
    const mins = parseMinutes(r.reportedTime);
    if (mins != null) totalMinutes += mins;
    for (const code of r.ksbs || []) ksbSet.add(code);
  }
  return {
    quizzesTaken: bestQuizzes.length,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    ksbCodes: Array.from(ksbSet),
    ksbCount: ksbSet.size,
  };
}

/** Group a learner's flat week/components arrays into module -> week -> components. */
export function buildLearnerJourney(real: LearnerDetail | null): JourneyModule[] {
  if (!real) return [];
  return real.modules.map((moduleTitle) => {
    const weeksForModule = real.week.filter((w) => w.module === moduleTitle);
    return {
      module: moduleTitle,
      weeks: weeksForModule.map((w) => {
        const components = real.components
          .filter((c) => c.module === moduleTitle && c.week === w.week)
          .map((c) => ({
            title: c.component, expectedOtjh: c.expectedOtjh, isQuiz: c.isQuiz, quizMeta: c.quizMeta,
            moduleId: c.moduleId, weekId: c.weekId,
            ksbWeightTotal: c.ksbWeightTotal, ksbMappingCount: c.ksbMappingCount,
            ksbMappings: c.ksbMappings,
            componentId: c.componentId, type: c.type, description: c.description,
            videoUrl: c.videoUrl, durationMinutes: c.durationMinutes,
            audioUrl: c.audioUrl, contentHtml: c.contentHtml, fileName: c.fileName,
            downloadAllowed: c.downloadAllowed, reflectionPrompt: c.reflectionPrompt,
            reflectionRequired: c.reflectionRequired, reflectionQuestion: c.reflectionQuestion,
            resourceUrl: c.resourceUrl,
            liveSessionUrl: c.liveSessionUrl, sessionDate: c.sessionDate, sessionTime: c.sessionTime,
            teamsLiveSessionId: c.teamsLiveSessionId,
            sessionDateTimeUtc: c.sessionDateTimeUtc,
            quizAttempts: c.isQuiz && c.quizMeta
              // Normalised progress rows store quiz_ref as text, while the
              // curriculum API exposes quiz ids as numbers. Compare their
              // canonical string values so saved attempts still decorate the
              // learner-facing quiz card with its Passed/Attempted status.
              ? real.quizAttempts.filter((a) => String(a.quizId) === String(c.quizMeta!.quizId))
              : undefined,
          }));
        return {
          week: w.week,
          // Quiz duration remains available to the quiz runner and is credited
          // as actual learner time after submission. It is not planned OTJH.
          otjh: components.reduce(
            (n, c) => n + (c.isQuiz || (c.type || '').toLowerCase() === 'quiz' ? 0 : (c.expectedOtjh || 0)),
            0,
          ),
          components,
        };
      }),
    };
  });
}
