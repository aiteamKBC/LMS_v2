import type { ComponentKsbMapping, LearnerDetail, LearnerQuizAttempt } from '@/api/learnerDetail';

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
  resourceUrl?: string | null;
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
   A component with KSBs mapped can only be completed once
   those mappings carry at least COMPONENT_KSB_WEIGHT_TARGET
   total weight AND the learner has uploaded evidence for it.
   Components with no KSBs mapped are not gated.
   Mirrors COMPONENT_KSB_WEIGHT_TARGET / _completion_criteria
   in learner_api/components.py, which is the authority — this
   copy exists so the UI can explain what's outstanding.
   ═══════════════════════════════════════════════════════ */
export const COMPONENT_KSB_WEIGHT_TARGET = 100;

/** Only assignments collect uploaded evidence, so only they can require it. */
export function componentRequiresEvidence(type: string | null | undefined): boolean {
  return (type || '').trim().toLowerCase().replace(/-/g, '_') === 'assignment';
}

export interface ComponentCriteria {
  gated: boolean;          // false => no KSBs mapped, nothing to satisfy
  weightTotal: number;
  weightMet: boolean;
  evidenceRequired: boolean;
  evidenceMet: boolean;
  met: boolean;            // overall: safe to complete
}

/** Evaluate the completion gate. `evidenceCount` is the learner's approved
 * uploads for this component (pass 0 when not yet known). */
export function componentCriteria(c: JourneyComponent, evidenceCount: number): ComponentCriteria {
  const weightTotal = Number(c.ksbWeightTotal || 0);
  const gated = Number(c.ksbMappingCount || 0) > 0;
  const weightMet = weightTotal >= COMPONENT_KSB_WEIGHT_TARGET;
  const evidenceRequired = componentRequiresEvidence(c.type);
  const evidenceMet = evidenceRequired ? evidenceCount > 0 : true;
  return {
    gated,
    weightTotal,
    weightMet,
    evidenceRequired,
    evidenceMet,
    met: !gated || (weightMet && evidenceMet),
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

export type KsbStatus = 'complete' | 'in-progress' | 'not-started' | 'not-scheduled';

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
  pct: number;                  // earnedWeight / availableWeight (0 when unscheduled)
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
}

/** Derive weighted progress for every programme KSB.
 * `completedComponentIds` must already be de-duplicated, so a component
 * completed twice (retake / re-watch) contributes its weight only once. */
export function buildKsbProgress(src: KsbProgressSource): KsbProgress[] {
  const done = new Set(src.completedComponentIds);
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
    const earnedWeight = contributors.reduce((s, c) => s + (c.done ? c.weight : 0), 0);
    const doneCount = contributors.filter((c) => c.done).length;
    const pct = availableWeight > 0
      ? Math.max(0, Math.min(100, Math.round((earnedWeight / availableWeight) * 100)))
      : 0;
    const status: KsbStatus = contributors.length === 0
      ? 'not-scheduled'
      : earnedWeight >= availableWeight && availableWeight > 0
        ? 'complete'
        : earnedWeight > 0
          ? 'in-progress'
          : 'not-started';
    return {
      code,
      type: (k.type || code.charAt(0) || '?').toUpperCase(),
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

/** Component ids the learner has finished, de-duplicated across every
 * completion source (a re-watch or retake must not count twice). */
export function completedComponentIds(real: {
  videoProgress?: { componentId: string }[];
  componentProgress?: { componentId: string }[];
} | null): Set<string> {
  const ids = new Set<string>();
  for (const v of real?.videoProgress || []) if (v.componentId) ids.add(v.componentId);
  for (const c of real?.componentProgress || []) if (c.componentId) ids.add(c.componentId);
  return ids;
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

/** Can the learner open + complete this component on the component page?
 * Every backend-configured non-quiz component is available through the shared
 * component flow. Videos still require a playable source for their dedicated
 * player; the other types can present their authored instructions/resources
 * and collect the completion reflection. */
export function isOpenableComponent(c: JourneyComponent): boolean {
  if (c.isQuiz || !c.componentId) return false;
  const t = (c.type || '').toLowerCase();
  if (t === 'video') return !!c.videoUrl;
  return true;
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

/** Decimal hours -> "1h 30m" (drops the minutes part when it's a whole hour,
 * and the hours part when under an hour: 0.5 -> "30m", 2 -> "2h", 1.25 -> "1h 15m"). */
export function formatHoursMinutes(hours: number): string {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0 && m === 0) return '0h';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
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
            downloadAllowed: c.downloadAllowed, reflectionPrompt: c.reflectionPrompt, resourceUrl: c.resourceUrl,
            quizAttempts: c.isQuiz && c.quizMeta
              ? real.quizAttempts.filter((a) => a.quizId === c.quizMeta!.quizId)
              : undefined,
          }));
        return {
          week: w.week,
          otjh: components.reduce((n, c) => n + (c.expectedOtjh || 0), 0),
          components,
        };
      }),
    };
  });
}
