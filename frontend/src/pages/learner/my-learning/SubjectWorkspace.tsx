import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Award, BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Layers3, Loader2, Map as MapIcon, Search } from 'lucide-react';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import type { LearnerMetrics } from '@/api/learnerMetrics';
import { fetchStudentActivity, peekStudentActivity, subjectRequest, type StudentActivityItem, type StudentActivityResponse, type SubjectAttemptResult } from '@/api/studentActivity';
import { peekLearnerJson } from '@/api/learnerRead';
import { fetchLearnerCertificateTemplate, issueLearnerModuleCertificate, type CertificateTemplateSummary } from '@/api/learnerCertificates';
import { completedComponentIds, isComponentComplete, hasComponentContent, formatHoursMinutes, type JourneyComponent } from '@/utils/learnerJourney';
import { DeferredStudentMaterial as StudentMaterial } from './DeferredStudentMaterial';
import styles from './SubjectWorkspace.module.css';
import { LearningCatalogue } from './LearningCatalogue';
import { LearningMapHero, SubjectTimeline } from './SubjectTimeline';
import { certificateEligible, learningDate, learningDeadlines, learningPlanSelection, learningHref, nextLearningWeek, continuingLearningWeek, currentLearningWeek, recommendedLearningSubject, resolveLearningSubject, subjectMapWeeks, subjectOpeningActivity } from './subjectLearning';
import type { LearningSchedule } from '@/api/learnerOverview';
import type { PlanModule } from '@/api/trainingPlanDashboard';

type Schedule = Pick<StudentActivityItem, 'date' | 'month' | 'week_start' | 'week_end' | 'date_needs_review' | 'date_source'> & { due_timing?: string };
export type SubjectEntry = { id: string; title: string; category: string; completed: boolean; position: number; schedule: Schedule; week?: string; legacy?: StudentActivityItem; native?: JourneyComponent; bestScorePercent?: number | null };
export type Subject = { id: string; title: string; source: 'legacy' | 'current'; activities: SubjectEntry[] };
type BuilderSubject = { id: string; title: string };
type ActivitySource = { module_id: string; group_id: number; activity_id: number };
export type CoverMetadata = { covers: Record<string, string>; activity_dates?: Record<string, Schedule>; current_subjects?: BuilderSubject[]; builder_subjects?: Record<string, BuilderSubject>; activity_sources?: Record<string, ActivitySource> };
export type UnifiedLearningSummary = {
  subjects: Subject[];
  subjectCount: number;
  activityCount: number;
  completedActivityCount: number;
  percent: number;
};

function subjectRefs(data: StudentActivityResponse | null, real: LearnerDetail | null) {
  return [...new Set([
    ...(data?.subjects || []).map(subject => `legacy:${subject.id}`),
    ...(data?.activities || []).map(activity => `legacy:${activity.group_id}`),
    ...(real?.components || []).flatMap(component => component.moduleId ? [`current:${component.moduleId}`] : []),
  ])].sort().join(',');
}

export function useSubjectMetadata(data: StudentActivityResponse | null, real: LearnerDetail | null, kind?: string, learnerId?: string, enabled = true, assignedOnly = false) {
  // Raw, sorted IDs are independent of Builder renames and the merged cards.
  // The endpoint always resolves assigned Builder modules, titles and dates
  // from the learner ID. Their metadata can load alongside the plan/history;
  // historical covers already travel with the student-activity response.
  const refs = assignedOnly ? '' : subjectRefs(data, real);
  const key = `${kind}:${learnerId}:${refs}`;
  const url = `/learner_api/subject-covers/${encodeURIComponent(learnerId || '')}/?refs=${encodeURIComponent(refs)}`;
  const [state, setState] = useState<{ key: string; real: LearnerDetail | null; data: CoverMetadata | null; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const previousRequest = useRef<{ key: string; real: LearnerDetail | null } | null>(null);
  useEffect(() => {
    if (!enabled || !learnerId) return;
    const controller = new AbortController();
    const revalidate = retry > 0 || (previousRequest.current?.key === key && previousRequest.current.real !== real);
    previousRequest.current = { key, real };
    void subjectRequest<CoverMetadata>(`/learner_api/subject-covers/${encodeURIComponent(learnerId)}/?refs=${encodeURIComponent(refs)}`, { signal: controller.signal, revalidate })
      .then((result) => { if (!controller.signal.aborted) setState({ key, real, data: result, error: '' }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, real, data: null, error: 'Could not load your subject details. Please try again.' }); });
    return () => controller.abort();
  }, [enabled, learnerId, refs, key, retry, real]);
  const current = state?.key === key && state.real === real ? state : null;
  return { metadata: current?.data ?? (enabled && learnerId ? peekLearnerJson<CoverMetadata>(url) : undefined), error: current?.error || '', retry: () => { setState(null); setRetry((value) => value + 1); } };
}

function scheduleForDate(value?: string | null): Schedule {
  const date = value?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date: null, month: 'undated' };
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return { date: null, month: 'undated' };
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const week_start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  return { date, month: date.slice(0, 7), week_start, week_end: day.toISOString().slice(0, 10) };
}

function nativeActivitySchedule(schedule: Schedule | undefined, sessionDate?: string | null): Schedule {
  // Older metadata used the upload date. It cannot override a session date or
  // move a whole future programme into the month its components were created.
  if (!schedule || ['original_created_at', 'source_date', 'undated'].includes(schedule.date_source || '')) {
    return scheduleForDate(sessionDate);
  }
  return schedule;
}

function normaliseSubjectTitle(value?: string | null): string {
  return (value || '')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function groupSubjectActivities(activities: SubjectEntry[]) {
  const months = new Map<string, Map<string, SubjectEntry[]>>();
  for (const activity of activities) {
    const introduction = activity.schedule.date_source === 'introduction';
    const extra = activity.schedule.date_source === 'extra_activity';
    const month = introduction ? 'introduction' : extra ? 'extra' : activity.schedule.month || activity.schedule.date?.slice(0, 7) || 'undated';
    const week = extra ? activity.legacy?.section_title || activity.week || 'Additional activities' : activity.schedule.week_start || activity.week || 'undated';
    if (!months.has(month)) months.set(month, new Map());
    const weeks = months.get(month)!;
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week)!.push(activity);
  }
  const rank = (month: string) => month === 'introduction' ? -1 : month === 'extra' ? 2 : month === 'undated' ? 1 : 0;
  return [...months].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([month, weeks]) => ({
    month, weeks: [...weeks].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([week, items]) => ({
      week, activities: [...items].sort((a, b) => (a.schedule.date || '').localeCompare(b.schedule.date || '') || a.position - b.position || a.title.localeCompare(b.title)),
    })),
  }));
}

export function subjectsFrom(data: StudentActivityResponse | null, real: LearnerDetail | null, metadata?: CoverMetadata | null): Subject[] {
  const { activity_dates: dates = {}, current_subjects: currentSubjects = [], builder_subjects: builderSubjects = {} } = metadata || {};
  const activitySources = data?.activity_sources ?? metadata?.activity_sources ?? {};
  const subjects = new Map<string, Subject>();
  for (const subject of data?.subjects || []) subjects.set(`legacy:${subject.id}`, { id: `legacy:${subject.id}`, title: subject.name, source: 'legacy', activities: [] });
  for (const item of data?.activities || []) {
    const key = `legacy:${item.group_id}`;
    const subject = subjects.get(key) || { id: key, title: item.group_name || 'Unnamed subject', source: 'legacy' as const, activities: [] };
    if (!subject.activities.some((entry) => entry.id === item.activity_id)) subject.activities.push({ id: item.activity_id, title: item.activity, category: item.category, completed: item.completed, position: item.position || 0, schedule: item.month ? item : scheduleForDate(item.date), legacy: item });
    subjects.set(key, subject);
  }
  const legacyByBuilder = new Map<string, string[]>();
  const legacyByTitle = new Map<string, string[]>();
  for (const subject of subjects.values()) {
    const builder = builderSubjects[subject.id];
    if (builder) legacyByBuilder.set(builder.id, [...(legacyByBuilder.get(builder.id) || []), subject.id]);
    const title = normaliseSubjectTitle(subject.title);
    if (title) legacyByTitle.set(title, [...(legacyByTitle.get(title) || []), subject.id]);
  }
  for (const source of Object.values(activitySources)) {
    const key = `legacy:${source.group_id}`;
    if (!subjects.has(key)) continue;
    legacyByBuilder.set(source.module_id, [...new Set([...(legacyByBuilder.get(source.module_id) || []), key])]);
  }
  const currentTitlesById = new Map<string, Set<string>>();
  const currentIdsByTitle = new Map<string, Set<string>>();
  const registerCurrentTitle = (moduleId: string, title?: string | null) => {
    const normalised = normaliseSubjectTitle(title);
    if (!moduleId || !normalised) return;
    if (!currentTitlesById.has(moduleId)) currentTitlesById.set(moduleId, new Set());
    currentTitlesById.get(moduleId)!.add(normalised);
    if (!currentIdsByTitle.has(normalised)) currentIdsByTitle.set(normalised, new Set());
    currentIdsByTitle.get(normalised)!.add(moduleId);
  };
  for (const subject of currentSubjects) registerCurrentTitle(subject.id, subject.title);
  for (const item of real?.components || []) {
    if (item.moduleId) registerCurrentTitle(item.moduleId, item.module);
  }
  const currentKey = (moduleId: string) => {
    const matches = legacyByBuilder.get(moduleId);
    if (matches?.length === 1) return matches[0];
    const titleMatches = new Set<string>();
    for (const title of currentTitlesById.get(moduleId) || []) {
      if (currentIdsByTitle.get(title)?.size !== 1) continue;
      for (const legacyKey of legacyByTitle.get(title) || []) titleMatches.add(legacyKey);
    }
    return titleMatches.size === 1 ? [...titleMatches][0] : `current:${moduleId}`;
  };
  const completed = completedComponentIds(real);
  for (const subject of currentSubjects) {
    const key = currentKey(subject.id);
    if (!subjects.has(key)) subjects.set(key, { id: key, title: subject.title, source: 'current', activities: [] });
  }
  for (const [index, item] of (real?.components || []).entries()) {
    const key = item.moduleId ? currentKey(item.moduleId) : `unlinked:${item.module}`;
    const subject = subjects.get(key) || { id: key, title: item.module || 'Unnamed subject', source: 'current' as const, activities: [] };
    const component: JourneyComponent = { ...item, title: item.component,
      quizAttempts: item.isQuiz && item.quizMeta ? (real?.quizAttempts || []).filter((attempt) => String(attempt.quizId) === String(item.quizMeta!.quizId)) : undefined };
    const id = item.componentId || `quiz:${item.quizMeta?.quizId ?? `${item.week}:${index}`}`;
    const isComplete = isComponentComplete(component, completed);
    const scores = (component.quizAttempts || []).map((attempt) => attempt.grade * 100).filter(Number.isFinite);
    const bestScorePercent = scores.length ? Math.max(...scores) : null;
    const source = activitySources[id];
    const previous = source && source.module_id === item.moduleId && key === `legacy:${source.group_id}`
      ? subject.activities.find((entry) => entry.legacy?.source_activity_id === source.activity_id) : undefined;
    if (previous) {
      // One original activity can have results in both systems. Preserve its
      // original player/history and any later achievement without counting twice.
      previous.completed ||= isComplete;
      const legacy = previous.legacy!;
      const historicalScore = legacy.best_score_percent ?? (legacy.quiz_score != null && legacy.quiz_maximum_score ? legacy.quiz_score / legacy.quiz_maximum_score * 100 : null);
      const knownScores = [previous.bestScorePercent, historicalScore, bestScorePercent].filter((score): score is number => score != null);
      previous.bestScorePercent = knownScores.length ? Math.max(...knownScores) : null;
      previous.native = component;
      previous.week = item.week || undefined;
      const currentSchedule = nativeActivitySchedule(dates[id], component.sessionDate);
      if (currentSchedule.date && !currentSchedule.date_needs_review) previous.schedule = currentSchedule;
      continue;
    }
    if (!subject.activities.some((entry) => entry.id === id)) subject.activities.push({
      id, title: component.title, category: component.type || 'activity', completed: isComplete, bestScorePercent, position: index,
      schedule: nativeActivitySchedule(dates[id], component.sessionDate), week: item.week || undefined, native: component,
    });
    subjects.set(key, subject);
  }
  const nativeTitles = new Set([...currentSubjects.map((subject) => subject.title), ...(real?.components || []).map((item) => item.module)]);
  for (const title of real?.modules || []) {
    if (nativeTitles.has(title)) continue;
    const titleMatches = legacyByTitle.get(normaliseSubjectTitle(title));
    if (titleMatches?.length !== 1) subjects.set(`unlinked:${title}`, { id: `unlinked:${title}`, title, source: 'current', activities: [] });
  }
  return [...subjects.values()].map((subject) => ({ ...subject, title: builderSubjects[subject.id]?.title || subject.title }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** One roll-up for imported history and all later current-platform progress.
 * Exact source links merge the two representations first. A unique title match
 * also merges the subject card when older imports have no source link. */
export function buildUnifiedLearningSummary(
  data: StudentActivityResponse | null,
  real: LearnerDetail | null,
  metadata?: CoverMetadata | null,
): UnifiedLearningSummary {
  const subjects = subjectsFrom(data, real, metadata);
  const activityCount = subjects.reduce((sum, subject) => sum + subject.activities.length, 0);
  const completedActivityCount = subjects.reduce(
    (sum, subject) => sum + subject.activities.filter((entry) => entry.completed).length,
    0,
  );
  return {
    subjects,
    subjectCount: subjects.length,
    activityCount,
    completedActivityCount,
    percent: activityCount ? Math.round(completedActivityCount / activityCount * 10000) / 100 : 0,
  };
}

export function useUnifiedLearningSummary(
  real: LearnerDetail | null,
  kind?: LearnerKind,
  learnerId?: string,
  enabled = true,
) {
  const identity = `${kind}:${learnerId}`;
  const needsHistory = !!real?.studentActivityAvailable;
  const [state, setState] = useState<{
    identity: string;
    retry: number;
    data: StudentActivityResponse | null;
    error: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled || !kind || !learnerId || !needsHistory) return;
    const controller = new AbortController();
    setState(null);
    void fetchStudentActivity(kind, learnerId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ identity, retry, data, error: '' });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setState({
          identity,
          retry,
          data: null,
          error: failure instanceof Error ? failure.message : 'Could not load progress.',
        });
      });
    return () => controller.abort();
  }, [enabled, kind, learnerId, needsHistory, identity, retry]);

  const current = state?.identity === identity && state.retry === retry ? state : null;
  const data = needsHistory ? current?.data || (kind && learnerId ? peekStudentActivity(kind, learnerId) : null) || null : null;
  const metadataEnabled = enabled && !!learnerId && (!needsHistory || !!data);
  const { metadata, error: metadataError, retry: retryMetadata } = useSubjectMetadata(
    data,
    real,
    kind,
    learnerId,
    metadataEnabled,
  );
  const loading = enabled && !!learnerId && (
    (needsHistory && !current && !data) || (!current?.error && metadataEnabled && !metadata)
  );
  const summary = !enabled || loading || current?.error || metadataError
    ? null
    : buildUnifiedLearningSummary(data, real, metadata);
  return {
    data,
    metadata,
    summary,
    loading,
    error: current?.error || metadataError,
    retry: () => {
      setRetry((value) => value + 1);
      retryMetadata();
    },
  };
}

function Progress({ done, total, label = 'Subject progress', showFormula = false, compact = false }: {
  done: number; total: number; label?: string; showFormula?: boolean; compact?: boolean;
}) {
  const percent = total ? Math.round(done / total * 10000) / 100 : 0;
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2 text-xs"><span className={compact ? 'text-slate-500' : 'text-foreground-500'}>{done} of {total} completed</span><strong className={`shrink-0 tabular-nums ${compact && percent === 100 ? 'text-emerald-700' : 'text-primary-700'}`}>{percent}%</strong></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={`h-1.5 overflow-hidden rounded-full ${compact ? 'bg-slate-100' : 'bg-foreground-100'}`}><div className={`h-full rounded-full motion-safe:transition-[width] ${compact ? percent === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary-500 to-violet-400' : 'bg-primary-500'}`} style={{ width: `${percent}%` }} /></div>
    {showFormula && <p className="text-xs text-foreground-500">Progress = completed activities ÷ total activities × 100{total > 0 ? ` = ${done} ÷ ${total} × 100 = ${percent}%` : '. No activities yet'}. Quizzes count as complete after passing.</p>}
  </div>;
}

function ActivityGroup({ title, label = title, activities, level, children }: {
  title: string; label?: string; activities: SubjectEntry[]; level: 3 | 4; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const progressId = `${contentId}-progress`;
  const Heading = level === 3 ? 'h3' : 'h4';
  const done = activities.filter((entry) => entry.completed).length;
  const percent = activities.length ? Math.round(done / activities.length * 10000) / 100 : 0;
  return <section aria-label={label} className={`overflow-hidden border border-foreground-200 bg-white ${level === 3 ? 'rounded-2xl' : 'rounded-xl'}`}>
    <Heading><button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={contentId}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`} aria-describedby={progressId}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-background-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
      <span className="min-w-0 flex-1 basis-40">
        <span className={`flex items-center gap-2 font-bold ${level === 3 ? 'text-base' : 'text-sm'}`}>{level === 3 && <CalendarDays size={20} className="shrink-0 text-primary-500" />}{title}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span id={progressId} role="progressbar" aria-label={`${label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          aria-valuetext={`${done} of ${activities.length} completed (${percent}%)`} className="flex items-center gap-2 whitespace-nowrap text-xs">
          <span className="font-normal text-foreground-500">{done}/{activities.length} completed</span>
          <span className={`rounded-full px-2.5 py-1 font-semibold tabular-nums ${percent === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-primary-50 text-primary-700'}`}>{percent}%</span>
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background-100 text-primary-700"><ChevronDown size={17} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} /></span>
      </span>
    </button></Heading>
    <div id={contentId} hidden={!expanded}>{children}</div>
  </section>;
}

const SUBJECT_CARD_TONES = ['purple', 'navy', 'green', 'gold', 'blue', 'rose'] as const;
type SubjectCardTone = typeof SUBJECT_CARD_TONES[number];

export function Cover({ title, url, large = false }: { title: string; url?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <div className={`${styles.cover} ${large ? styles.coverLarge : ''}`}>
    {url && !failed ? <img src={url} alt={`${title} cover`} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105" /> : <div className={`${styles.coverFallback} flex h-full ${large ? 'items-center justify-center' : 'items-end p-4'}`}>
      <div aria-hidden="true" className={styles.coverOrbit} />
      <span className={`${styles.coverSymbol} relative flex items-center justify-center rounded-2xl border border-white/90 bg-white/85 text-primary-600 shadow-sm ${large ? 'h-16 w-16' : 'h-11 w-11'}`}><BookOpen className={large ? 'h-8 w-8' : 'h-5 w-5'} strokeWidth={1.7} aria-hidden="true" /></span>
    </div>}
  </div>;
}

function SubjectCertificateAction({
  subject,
  template,
  csrfToken,
  kind,
  learnerId,
}: {
  subject: Subject;
  template: CertificateTemplateSummary | null;
  csrfToken: string;
  kind?: string;
  learnerId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [cachedHref, setCachedHref] = useState('');
  const ready = !!kind && !!learnerId && certificateEligible(subject, template);
  const cacheKey = ready && template && kind && learnerId
    ? `learner-certificate:${kind}:${learnerId}:${subject.id}:v${template.version}`
    : '';

  useEffect(() => {
    setCachedHref('');
    if (!ready || !kind || !learnerId || !cacheKey) return;
    try {
      const stored = window.localStorage.getItem(cacheKey);
      if (stored) {
        setCachedHref(stored);
        return;
      }
    } catch {
      // Local storage can be unavailable in private or locked-down contexts.
    }
    // Existing certificates are resolved by the idempotent issue endpoint on
    // click. Avoid one status request (and an eligibility rebuild) per card.
  }, [ready, kind, learnerId, subject.id, cacheKey]);

  if (!ready) return null;

  const issue = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (cachedHref) {
      window.open(cachedHref, '_blank', 'noopener,noreferrer');
      return;
    }
    const certificateWindow = window.open('about:blank', '_blank');
    if (certificateWindow) {
      certificateWindow.document.title = 'Preparing certificate';
      certificateWindow.document.body.innerHTML = '<main style="min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;color:#0f172a;background:#f8fafc"><section style="width:min(92vw,760px);padding:32px;border:1px solid #e2e8f0;border-radius:16px;background:white;box-shadow:0 24px 70px rgba(15,23,42,.16);text-align:center"><h1 style="margin:0 0 8px;font-size:24px">Preparing certificate</h1><p style="margin:0;color:#475569">Your certificate is being generated...</p></section></main>';
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await issueLearnerModuleCertificate(kind, learnerId, subject.id, csrfToken);
      const href = result.certificate?.verificationUrl;
      if (href) {
        setCachedHref(href);
        if (cacheKey) {
          try {
            window.localStorage.setItem(cacheKey, href);
          } catch {
            // Non-critical cache.
          }
        }
      }
      if (href && certificateWindow) certificateWindow.location.replace(href);
      else if (href) window.location.assign(href);
      else {
        if (certificateWindow) certificateWindow.close();
        setMessage('Certificate issued, but the verification link was not returned.');
      }
    } catch (error) {
      if (certificateWindow) certificateWindow.close();
      setMessage(error instanceof Error ? error.message : 'Could not issue certificate.');
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.certificateAction}>
    <button type="button" onClick={issue} disabled={busy} className={styles.certificateButton}>
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Award size={14} aria-hidden="true" />}
      {busy ? 'Issuing certificate' : cachedHref ? 'View certificate' : 'Get certificate'}
    </button>
    {message && <p className={styles.certificateError}>{message}</p>}
  </div>;
}

function SubjectCard({ subject, cover, tone = 'purple', onOpen, template, csrfToken, kind, learnerId, planModule }: {
  subject: Subject;
  cover?: string;
  tone?: SubjectCardTone;
  onOpen: () => void;
  template: CertificateTemplateSummary | null;
  csrfToken: string;
  kind?: string;
  learnerId?: string;
  planModule?: PlanModule;
}) {
  const total = subject.activities.length;
  const completed = subject.activities.filter((activity) => activity.completed).length;
  const isComplete = total > 0 && completed === total;
  const certificateReady = certificateEligible(subject, template);
  const status = isComplete ? 'Completed' : completed > 0 ? 'In progress' : total ? 'Not started' : 'No activities yet';
  const next = nextLearningWeek(subject)?.activities.find(entry => !entry.completed);
  const moduleName = planModule?.title || subject.title;
  const tutorName = planModule?.tutor_name?.trim() || 'To be assigned';
  const startDate = planModule?.start_date ? learningDate(planModule.start_date) : 'Not scheduled';
  const endDate = planModule?.end_date ? learningDate(planModule.end_date) : 'Not scheduled';
  const sessionCount = planModule?.sessions_number;
  return <article className={`group ${styles.card} ${styles.subjectTheme}`} data-tone={tone}>
    <button type="button" onClick={onOpen} className={styles.cardButton}>
      <div className="relative w-full">
        <Cover title={subject.title} url={cover} />
        <span className={styles.status} data-state={isComplete ? 'complete' : completed > 0 ? 'started' : 'new'}>
          <span aria-hidden="true" className={styles.statusDot} />{status}
        </span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardMetaRow}>
          <p className={styles.cardEyebrow}><Layers3 size={13} aria-hidden="true" />{total} {total === 1 ? 'activity' : 'activities'}</p>
          {certificateReady && <span className={styles.certificateBadge}><Award size={13} aria-hidden="true" />Ready</span>}
        </div>
        <h3 className={styles.cardTitle}>{subject.title}</h3>
        <dl className={styles.moduleDetails} aria-label={`${moduleName} module details`}>
          <div><dt>Tutor</dt><dd>{tutorName}</dd></div>
          <div><dt>Start date</dt><dd>{startDate}</dd></div>
          <div><dt>End date</dt><dd>{endDate}</dd></div>
          <div><dt>Sessions</dt><dd>{sessionCount == null ? 'Not set' : `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`}</dd></div>
        </dl>
        <p className={styles.cardDescription}>Explore your learning materials and activities.</p>
        <div className={styles.cardProgress}><Progress done={completed} total={total} compact label={`${subject.title} progress`} /></div>
        <span className={styles.nextActivity}>{isComplete ? <CheckCircle2 size={20} /> : <BookOpen size={20} />}<span><small>{isComplete ? 'Well done' : 'Next up'}</small><strong>{isComplete ? 'All activities complete' : next?.title || 'Explore this subject'}</strong></span><ChevronRight size={16} /></span>
        <span className={styles.cardAction}>Open subject<ArrowRight size={16} aria-hidden="true" /></span>
      </div>
    </button>
    <SubjectCertificateAction subject={subject} template={template} csrfToken={csrfToken} kind={kind} learnerId={learnerId} />
  </article>;
}

function SubjectCardsSkeleton() {
  return <div role="status" className={styles.workspace} aria-label="Loading subjects">
    <div className={styles.loadingHeader}><div><span className={styles.loadingLabel}>Loading subjects</span><p className={styles.loadingHint}>Getting your activities and progress ready…</p></div><BookOpen size={22} aria-hidden="true" /></div>
    <div className={`${styles.stats} ${styles.skeletonStats}`} aria-hidden="true">{[0, 1, 2, 3].map(key => <div key={key} className={styles.stat}><span className={`${styles.skeletonLine} ${styles.mediumLine}`} /><span className={`${styles.skeletonLine} ${styles.shortLine}`} /></div>)}</div>
    <div className={styles.catalogueLayout} aria-hidden="true"><div className={styles.catalogueMain}><div className={styles.skeletonToolbar}><span className={`${styles.skeletonLine} ${styles.mediumLine}`} /></div><div className={styles.grid}>{[0, 1, 2, 3].map(key => <div key={key} className={`${styles.card} ${styles.skeleton}`}>
      <div className={styles.cover}><span className={styles.skeletonIcon} /><span className={styles.skeletonBadge} /></div>
      <div className={styles.cardBody}><span className={`${styles.skeletonLine} ${styles.shortLine}`} /><div className={styles.cardTitle}><span className={styles.skeletonLine} /><span className={`${styles.skeletonLine} ${styles.mediumLine}`} /></div>
        <div className={styles.cardProgress}><span className={`${styles.skeletonLine} ${styles.mediumLine}`} /><span className={styles.skeletonTrack} /></div><span className={styles.skeletonNext} /><span className={styles.skeletonAction} /></div>
    </div>)}</div></div><div className={styles.catalogueAside}>{[0, 1].map(key => <div key={key} className={`${styles.asidePanel} ${styles.skeletonAside}`}><span className={`${styles.skeletonLine} ${styles.mediumLine}`} /><span className={styles.skeletonNext} /><span className={styles.skeletonLine} /><span className={`${styles.skeletonLine} ${styles.shortLine}`} /></div>)}</div></div>
  </div>;
}

export function nativeHref(entry: SubjectEntry, kind?: string, learnerId?: string) {
  const component = entry.native;
  if (!component || !kind || !learnerId || !hasComponentContent(component)) return null;
  const path = component.isQuiz && component.quizMeta ? `quiz/${kind}/${learnerId}/${component.quizMeta.quizId}`
    : component.type === 'video' && component.videoUrl && component.componentId ? `video/${kind}/${learnerId}/${component.componentId}`
      : component.componentId ? `component/${kind}/${learnerId}/${component.componentId}` : null;
  return path ? `/learner/${path}?week=${encodeURIComponent(entry.week || '')}` : null;
}

function ActivityRow({ entry, kind, learnerId, onProgress }: { entry: SubjectEntry; kind?: string; learnerId?: string; onProgress?: (result: SubjectAttemptResult) => void }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const href = nativeHref(entry, kind, learnerId);
  const legacy = entry.legacy;
  const score = entry.bestScorePercent ?? legacy?.best_score_percent ?? (legacy?.quiz_score != null && legacy.quiz_maximum_score ? legacy.quiz_score / legacy.quiz_maximum_score * 100 : null);
  return <div role="group" aria-label={`${entry.title} activity`} className="border-t border-foreground-100 first:border-t-0"><div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 p-4 sm:flex sm:flex-wrap sm:items-center">
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${entry.completed ? 'bg-emerald-50 text-emerald-600' : 'bg-background-100 text-foreground-400'}`}>{entry.completed ? <CheckCircle2 size={18} /> : <BookOpen size={16} />}</span>
    <div className="min-w-0 flex-1"><h5 className="text-sm font-semibold text-foreground-900">
      {legacy && kind && learnerId ? <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={contentId} className="text-left text-primary-700 underline-offset-4 hover:underline focus-visible:underline">{entry.title}</button>
        : href ? <Link to={href} className="text-primary-700 underline-offset-4 hover:underline focus-visible:underline">{entry.title}</Link> : entry.title}
    </h5><p className="mt-1 text-xs text-foreground-500">{[entry.category, entry.schedule.date, score != null ? `Best score ${Math.round(score)}%` : ''].filter(Boolean).join(' · ')}</p>
      {legacy?.section_title && <p className="mt-1 text-xs text-foreground-500">Lecture: {legacy.section_title}</p>}
    </div>
    <div className="col-start-2 flex flex-wrap items-center gap-2 sm:ml-auto"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${entry.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-600'}`}>{entry.completed ? 'Complete' : 'Not complete'}</span>
    {legacy && kind && learnerId && <button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={contentId} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-primary-700">{open ? 'Close activity' : 'Open activity'}</button>}
    {!legacy && href && <Link to={href} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-primary-700">Open activity</Link>}
    {!legacy && !href && <span className="text-xs text-foreground-500">Content not available yet</span>}</div>
  </div>
    {legacy && <p className="px-4 pb-3 text-[11px] text-foreground-400">OTJH: {legacy.hours_mapped ? formatHoursMinutes(legacy.actual) : 'Unavailable'} · Planned: {legacy.planned_hours_mapped ? formatHoursMinutes(legacy.planned) : 'Unavailable'}</p>}
    <div id={contentId}>{open && legacy && kind && learnerId && <div role="region" aria-label={`${entry.title} content`} className="p-3 pt-0"><StudentMaterial kind={kind} learnerId={learnerId} groupId={legacy.group_id} activityId={legacy.source_activity_id} completed={entry.completed} onProgress={onProgress} /></div>}</div>
  </div>;
}

export function StudentActivityPanel({ data: incomingData, loading, error, onRetry, kind, learnerId, real: incomingReal = null, onProgress, metrics, view = 'catalogue', schedule, scheduleLoading = false }: {
  kind?: string; learnerId?: string; real?: LearnerDetail | null; data: StudentActivityResponse | null;
  loading: boolean; error: string | null; onRetry: () => void; onProgress?: () => void;
  metrics?: LearnerMetrics | null;
  view?: 'catalogue' | 'map'; schedule?: LearningSchedule | null; scheduleLoading?: boolean;
}) {
  const [search, setSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const routeParams = new URLSearchParams(location.search);
  const selected = routeParams.get('subject') || routeParams.get('module');
  const selectedWeek = routeParams.get('week');
  const continueCurrentWeek = selectedWeek === 'current';
  const select = (subject?: string, week?: string) => {
    const params = new URLSearchParams(location.search);
    params.delete('module'); params.delete('week'); params.delete('subject');
    if (subject) params.set('subject', subject);
    if (week) params.set('week', week);
    navigate({ pathname: location.pathname, search: params.toString() });
  };
  const identity = `${kind}:${learnerId}`;
  const [certificateConfig, setCertificateConfig] = useState<{ template: CertificateTemplateSummary | null; csrfToken: string }>({ template: null, csrfToken: '' });
  const { metadata: incomingMetadata, error: imageError, retry: retryMetadata } = useSubjectMetadata(incomingData, incomingReal, kind, learnerId, !error, true);
  const ready = !loading && !error && (!learnerId || !!incomingMetadata);
  const [snapshot, setSnapshot] = useState<{
    identity: string; data: StudentActivityResponse | null; real: LearnerDetail | null; metadata?: CoverMetadata | null;
  } | null>(null);
  useEffect(() => {
    if (ready) setSnapshot({ identity, data: incomingData, real: incomingReal, metadata: incomingMetadata });
  }, [ready, identity, incomingData, incomingReal, incomingMetadata]);
  // Publish a complete set of cards and totals together. During a refresh keep
  // the last complete set, including an open activity and its saved progress.
  // A previous learner's snapshot is never eligible for reuse.
  const displayed = ready ? { data: incomingData, real: incomingReal, metadata: incomingMetadata }
    : snapshot?.identity === identity ? snapshot : null;
  const data = displayed?.data || null;
  const real = displayed?.real || null;
  const metadata = displayed?.metadata;
  const recordedOtjh = metrics !== undefined ? metrics?.otjh.actual ?? null : data?.audit_lms_actual ?? data?.recorded_otjh_total ?? data?.actual_total ?? null;
  const plannedOtjh = metrics !== undefined ? metrics?.otjh.planned ?? null : data?.audit_tp_planned ?? data?.planned_total ?? null;
  const hasProgrammeOtjh = data?.audit_lms_actual != null || data?.audit_tp_planned != null;
  const [savedProgress, setSavedProgress] = useState<{ identity: string; activities: Record<string, SubjectAttemptResult> }>({ identity, activities: {} });
  useEffect(() => {
    setCertificateConfig({ template: null, csrfToken: '' });
    if (view !== 'catalogue' || !kind || !learnerId) return;
    let cancelled = false;
    fetchLearnerCertificateTemplate(kind, learnerId)
      .then((result) => { if (!cancelled) setCertificateConfig({ template: result.template, csrfToken: result.csrfToken || '' }); })
      .catch(() => { if (!cancelled) setCertificateConfig({ template: null, csrfToken: '' }); });
    return () => { cancelled = true; };
  }, [view, kind, learnerId]);
  const updatedData = useMemo(() => {
    if (!data || savedProgress.identity !== identity) return data;
    return { ...data, activities: data.activities.map((item) => {
      const saved = savedProgress.activities[item.activity_id];
      if (!saved) return item;
      const scores = [item.best_score_percent, saved.score_percent].filter((score): score is number => score != null);
      return { ...item, completed: item.completed || saved.completed, best_score_percent: scores.length ? Math.max(...scores) : null };
    }) };
  }, [data, identity, savedProgress]);
  const recordProgress = (activityId: string, result: SubjectAttemptResult) => {
    setSavedProgress((previous) => {
      const activities = previous.identity === identity ? previous.activities : {};
      const existing = activities[activityId];
      const scores = [existing?.score_percent, result.score_percent].filter((score): score is number => score != null);
      return { identity, activities: { ...activities, [activityId]: { ...result, completed: !!existing?.completed || result.completed, score_percent: scores.length ? Math.max(...scores) : null } } };
    });
    onProgress?.();
  };
  const summary = useMemo(() => buildUnifiedLearningSummary(updatedData, real, metadata), [updatedData, real, metadata]);
  const subjects = summary.subjects;
  const deadlines = useMemo(() => learningDeadlines(subjects), [subjects]);
  // Assign colours from the full ID-sorted set, before display filters or sorts,
  // so finding, completing or renaming a subject does not change its colour.
  const subjectTones = useMemo(() => new Map([...subjects]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((subject, index) => [subject.id, SUBJECT_CARD_TONES[index % SUBJECT_CARD_TONES.length]] as const)), [subjects]);
  const planModulesBySubject = useMemo(() => {
    const modules = new Map<string, PlanModule>();
    for (const module of schedule?.modules || []) {
      const subject = resolveLearningSubject(subjects, `current:${module.id}`, metadata, schedule);
      if (subject && !modules.has(subject.id)) modules.set(subject.id, module);
    }
    return modules;
  }, [subjects, metadata, schedule]);
  const covers = { ...data?.covers, ...metadata?.covers };
  const term = search.trim().toLocaleLowerCase();
  const planSelection = learningPlanSelection(subjects, real, metadata, schedule);
  const planLabel = planSelection.status === 'current' ? 'Current module' : planSelection.status === 'next' ? 'Next module' : planSelection.status === 'previous' ? 'Previous module' : 'Dates pending';
  const currentSubject = recommendedLearningSubject(subjects, real, metadata, schedule);
  const defaultSubject = planSelection.status !== 'undated' ? planSelection.entries[0]?.subject : undefined;
  const continuedSubject = continueCurrentWeek ? defaultSubject || subjects.find(subject => currentLearningWeek(subject)) : undefined;
  const active = resolveLearningSubject(subjects, selected, metadata, schedule)
    || (!selected && !scheduleLoading ? (view === 'map' ? defaultSubject : continuedSubject) : undefined);
  const activePlan = planSelection.entries.find(entry => entry.subject.id === active?.id)?.module;
  const noScheduledModule = scheduleLoading ? 'Finding your current module…'
    : !subjects.length ? 'Your weeks will appear when a module is assigned.'
    : planSelection.status === 'unavailable' ? 'Training plan dates are unavailable. Choose a module below to explore your learning.'
    : planSelection.status === 'undated' ? 'Your training plan needs module dates before a current module can be identified. You can still choose a module below.'
    : 'No scheduled module is available in your learning map. Choose a module below to explore your learning.';
  const weeks = active ? subjectMapWeeks(active, real, metadata, schedule) : [];
  const activeWeek = continueCurrentWeek && active ? continuingLearningWeek(active)
    : selectedWeek ? weeks.find(week => week.id === selectedWeek) : undefined;
  const visibleActivities = active ? active.activities.filter((entry) => !term || active.title.toLocaleLowerCase().includes(term) || entry.title.toLocaleLowerCase().includes(term)) : [];
  const visibleActivityIds = new Set(visibleActivities.map((entry) => entry.id));
  const groups = groupSubjectActivities(active?.activities || []).filter(({ weeks }) => weeks.some(({ activities }) => activities.some((entry) => visibleActivityIds.has(entry.id))));
  const total = metrics !== undefined ? metrics?.programme.total ?? '—' : summary.activityCount;
  const done = metrics !== undefined ? metrics?.programme.completed ?? '—' : summary.completedActivityCount;
  const percent = metrics !== undefined ? metrics?.programme.percent ?? null : summary.percent;
  if (!displayed && (error || imageError)) return <div role="alert" className="rounded-2xl border bg-white p-6"><p className="font-semibold">Could not load your subjects</p><p className="mt-2 text-sm text-foreground-500">{error || imageError}</p><button onClick={error ? onRetry : retryMetadata} className="mt-4 rounded-lg border px-4 py-2 text-sm font-semibold">Try again</button></div>;
  if (!displayed) return <SubjectCardsSkeleton />;
  // Catalogue links open the existing player directly. Imported-only courses
  // and weeks awaiting content keep their material browser available.
  const openingActivity = active && view === 'catalogue' && (!selectedWeek || activeWeek)
    ? subjectOpeningActivity(active, activeWeek) : undefined;
  const openingHref = openingActivity ? nativeHref(openingActivity, kind, learnerId) : null;
  if (openingHref) return <Navigate to={openingHref} replace />;
  return <section className={`${styles.workspace} space-y-5`} aria-label="Your subjects" aria-busy={!ready && !error && !imageError}>
    {view === 'map' && <LearningMapHero subject={active} weeks={weeks} kind={kind} learnerId={learnerId} planModule={activePlan} planLabel={activePlan ? planLabel : 'Selected module'} />}
    {view === 'catalogue' && data?.learner_name && <p className="text-sm text-foreground-500">{data.learner_name}</p>}
    {active && view === 'catalogue' && <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary-600">My learning</p><h2 className="mt-1 text-2xl font-bold text-foreground-900">{active.title}</h2></div>
      <label className={`${styles.search} w-full min-w-0 sm:max-w-xs`}><Search size={17} aria-hidden="true" /><input aria-label="Search modules or activities" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subjects or activities" /></label>
    </header>}
    {imageError && <p role="alert" className="text-sm text-amber-800">{imageError} <button onClick={retryMetadata} className="font-semibold underline">Try again</button></p>}
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error} <button onClick={onRetry} className="font-semibold underline">Try again</button></p>}
    {data?.source_status === 'historical' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Showing saved previous learning. The latest results could not be verified. <button onClick={onRetry} className="font-semibold underline">Try again</button></p>}
    {selected && !active && <p role="alert" className={styles.empty}>This module is not available in your learning plan. <button onClick={() => select()}>Show your modules</button></p>}
    {view === 'map' && <div className={styles.mapToolbar}>
      <label className={styles.selectLabel}>Module<select aria-label="Filter by module" value={active?.id || ''} onChange={event => { setSearch(''); select(event.target.value); }}><option value="" disabled>{scheduleLoading ? 'Finding your current module…' : 'Choose a module'}</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.title}{planSelection.entries.some(entry => entry.subject.id === subject.id) ? ` · ${planLabel}` : ''}</option>)}</select></label>
      <label className={styles.search}><Search size={18} aria-hidden="true" /><input aria-label="Search modules or activities" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search weeks or activities…" /></label>
      <Link to={learningHref('catalogue', kind, learnerId)} className={styles.textLink}>My Learning<ArrowRight size={17} aria-hidden="true" /></Link>
    </div>}
    {activeWeek ? <>
      <button onClick={() => select(active!.id)} className={styles.textLink}><ChevronLeft size={17} />{view === 'map' ? 'Back to timeline' : 'Back to subject'}</button>
      <section className={styles.weekMaterial} aria-label={`${activeWeek.label} materials`}><header><p className={styles.eyebrow}>{activeWeek.label}</p><h3>{activeWeek.title}</h3><Progress done={activeWeek.activities.filter(a => a.completed).length} total={activeWeek.activities.length} label="Week progress" /></header>
        {activeWeek.activities.filter(entry => !term || active!.title.toLowerCase().includes(term) || entry.title.toLowerCase().includes(term)).map(entry => <ActivityRow key={entry.id} entry={entry} kind={kind} learnerId={learnerId} onProgress={result => { if (entry.legacy) recordProgress(entry.legacy.activity_id, result); }} />)}
        {!activeWeek.activities.length && <p className="p-6 text-sm text-foreground-500">Learning materials will appear here when they are added to this week.</p>}
        {activeWeek.activities.length > 0 && !activeWeek.activities.some(entry => !term || active!.title.toLowerCase().includes(term) || entry.title.toLowerCase().includes(term)) && <p className="p-6 text-sm text-foreground-500">No activities match your search.</p>}
      </section>
    </> : selectedWeek && active ? <div className={styles.empty}><p>{continueCurrentWeek ? 'Learning materials will appear here when they are added to this module.' : 'This week is no longer available in this module.'}</p><button onClick={() => select(active.id)}>View module</button></div>
      : view === 'map' ? (active ? <SubjectTimeline subject={active} weeks={weeks} search={search} onOpen={week => { setSearch(''); select(active.id, week); }} /> : !selected && <div className={styles.empty}>{noScheduledModule}</div>)
      : !active ? <>
      <LearningCatalogue summary={summary} search={search} onSearch={setSearch} current={currentSubject} total={total} done={done} percent={percent} kind={kind} learnerId={learnerId}
        deadlines={deadlines}
        moduleStartDate={subject => planModulesBySubject.get(subject.id)?.start_date}
        onContinue={subject => { setSearch(''); select(subject.id, 'current'); }}
        renderCard={subject => <SubjectCard key={subject.id} subject={subject} cover={covers[subject.id]} tone={subjectTones.get(subject.id)} onOpen={() => select(subject.id)} template={certificateConfig.template} csrfToken={certificateConfig.csrfToken} kind={kind} learnerId={learnerId} planModule={planModulesBySubject.get(subject.id)} />} />
      {(data || metrics) && <><div className="flex flex-wrap gap-6 rounded-xl bg-background-100 px-4 py-3 text-xs"><div><span className="block text-foreground-500">Recorded OTJH</span><strong>{recordedOtjh == null ? 'Unavailable' : formatHoursMinutes(recordedOtjh)}</strong></div><div><span className="block text-foreground-500">Planned OTJH</span><strong>{plannedOtjh == null ? 'Unavailable' : formatHoursMinutes(plannedOtjh)}</strong></div></div>{hasProgrammeOtjh && <p className="text-[12px] text-foreground-500">Programme totals include accepted historical hours and new recorded learning. Planned hours come from your training plan.</p>}</>}
    </> : <>
      <div className="flex flex-wrap items-center justify-between gap-3"><button onClick={() => select()} className="flex items-center gap-1.5 text-sm font-semibold text-primary-700"><ChevronLeft size={17} />All subjects</button><Link to={learningHref('map', kind, learnerId, active.id)} className={styles.textLink}><MapIcon size={17} />View learning map<ArrowRight size={16} /></Link></div>
      <div className={`${styles.subjectTheme} relative overflow-hidden rounded-2xl border bg-white`} data-tone={subjectTones.get(active.id)}><Cover title={active.title} url={covers[active.id]} large /><div className="p-5"><Progress done={active.activities.filter((entry) => entry.completed).length} total={active.activities.length} showFormula /></div></div>
      {groups.map(({ month, weeks }) => {
        const monthTitle = month === 'introduction' ? 'Introduction' : month === 'extra' ? 'Extra activities' : month === 'undated' ? 'Undated activities' : new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return <ActivityGroup key={`${active.id}:${month}`} title={monthTitle} activities={weeks.flatMap(({ activities }) => activities)} level={3}>
          <div className="space-y-3 p-3 pt-0">{weeks.map(({ week, activities }, index) => {
            const visibleEntries = activities.filter((entry) => visibleActivityIds.has(entry.id));
            if (!visibleEntries.length) return null;
            if (month === 'introduction') return visibleEntries.map((entry) => <ActivityRow key={entry.id} entry={entry} kind={kind} learnerId={learnerId} onProgress={(result) => { if (entry.legacy) recordProgress(entry.legacy.activity_id, result); }} />);
            const weekTitle = week === 'undated' ? 'Activities awaiting a date' : /^\d{4}-/.test(week) ? `Week ${index + 1} · ${week} – ${activities[0].schedule.week_end || ''}` : week;
            return <ActivityGroup key={week} title={weekTitle} label={`${monthTitle}, ${weekTitle}`} activities={activities} level={4}>
              {visibleEntries.map((entry) => <ActivityRow key={entry.id} entry={entry} kind={kind} learnerId={learnerId} onProgress={(result) => { if (entry.legacy) recordProgress(entry.legacy.activity_id, result); }} />)}
            </ActivityGroup>;
          })}</div>
        </ActivityGroup>;
      })}
      {!visibleActivities.length && <p className="rounded-xl border bg-white p-6 text-sm text-foreground-500">{active.activities.length ? 'No activities match your search.' : 'Activities will appear here when they are added to this subject.'}</p>}
    </>}
  </section>;
}
