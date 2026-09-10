import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import { fetchStudentActivity, subjectRequest, type StudentActivityItem, type StudentActivityResponse, type SubjectAttemptResult } from '@/api/studentActivity';
import { completedComponentIds, isComponentComplete, hasComponentContent, formatHoursMinutes, type JourneyComponent } from '@/utils/learnerJourney';
import { StudentMaterial } from './StudentMaterial';

type Schedule = Pick<StudentActivityItem, 'date' | 'month' | 'week_start' | 'week_end' | 'date_needs_review' | 'date_source'>;
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
  completedSubjectCount: number;
  percent: number;
};

function subjectRefs(data: StudentActivityResponse | null, real: LearnerDetail | null) {
  return [...new Set([
    ...(data?.subjects || []).map(subject => `legacy:${subject.id}`),
    ...(data?.activities || []).map(activity => `legacy:${activity.group_id}`),
    ...(real?.components || []).flatMap(component => component.moduleId ? [`current:${component.moduleId}`] : []),
  ])].sort().join(',');
}

export function fetchSubjectMetadata(data: StudentActivityResponse | null, real: LearnerDetail | null, learnerId: string, signal?: AbortSignal) {
  return subjectRequest<CoverMetadata>(`/learner_api/subject-covers/${encodeURIComponent(learnerId)}/?refs=${encodeURIComponent(subjectRefs(data, real))}`, { signal });
}

export function useSubjectMetadata(data: StudentActivityResponse | null, real: LearnerDetail | null, kind?: string, learnerId?: string, enabled = true) {
  // Raw, sorted IDs are independent of Builder renames and the merged cards.
  const refs = subjectRefs(data, real);
  const key = `${kind}:${learnerId}:${refs}`;
  const [state, setState] = useState<{ key: string; real: LearnerDetail | null; data: CoverMetadata | null; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !learnerId) return;
    const controller = new AbortController();
    void subjectRequest<CoverMetadata>(`/learner_api/subject-covers/${encodeURIComponent(learnerId)}/?refs=${encodeURIComponent(refs)}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setState({ key, real, data: result, error: '' }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, real, data: null, error: 'Could not load your subject details. Please try again.' }); });
    return () => controller.abort();
  }, [enabled, learnerId, refs, key, retry, real]);
  const current = state?.key === key && state.real === real ? state : null;
  return { metadata: current?.data, error: current?.error || '', retry: () => { setState(null); setRetry((value) => value + 1); } };
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

export function groupSubjectActivities(activities: SubjectEntry[]) {
  const months = new Map<string, Map<string, SubjectEntry[]>>();
  for (const activity of activities) {
    const month = activity.schedule.month || activity.schedule.date?.slice(0, 7) || 'undated';
    const week = activity.schedule.week_start || activity.week || 'undated';
    if (!months.has(month)) months.set(month, new Map());
    const weeks = months.get(month)!;
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week)!.push(activity);
  }
  return [...months].sort(([a], [b]) => a === 'undated' ? 1 : b === 'undated' ? -1 : a.localeCompare(b)).map(([month, weeks]) => ({
    month, weeks: [...weeks].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([week, items]) => ({
      week, activities: [...items].sort((a, b) => (a.schedule.date || '').localeCompare(b.schedule.date || '') || a.position - b.position || a.title.localeCompare(b.title)),
    })),
  }));
}

export function subjectsFrom(data: StudentActivityResponse | null, real: LearnerDetail | null, metadata?: CoverMetadata | null): Subject[] {
  const { activity_dates: dates = {}, current_subjects: currentSubjects = [], builder_subjects: builderSubjects = {}, activity_sources: activitySources = {} } = metadata || {};
  const subjects = new Map<string, Subject>();
  for (const subject of data?.subjects || []) subjects.set(`legacy:${subject.id}`, { id: `legacy:${subject.id}`, title: subject.name, source: 'legacy', activities: [] });
  for (const item of data?.activities || []) {
    const key = `legacy:${item.group_id}`;
    const subject = subjects.get(key) || { id: key, title: item.group_name || 'Unnamed subject', source: 'legacy' as const, activities: [] };
    if (!subject.activities.some((entry) => entry.id === item.activity_id)) subject.activities.push({ id: item.activity_id, title: item.activity, category: item.category, completed: item.completed, position: item.position || 0, schedule: item.month ? item : scheduleForDate(item.date), legacy: item });
    subjects.set(key, subject);
  }
  const legacyByBuilder = new Map<string, string[]>();
  for (const subject of subjects.values()) {
    const builder = builderSubjects[subject.id];
    if (builder) legacyByBuilder.set(builder.id, [...(legacyByBuilder.get(builder.id) || []), subject.id]);
  }
  const currentKey = (moduleId: string) => {
    const matches = legacyByBuilder.get(moduleId);
    return matches?.length === 1 ? matches[0] : `current:${moduleId}`;
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
      continue;
    }
    if (!subject.activities.some((entry) => entry.id === id)) subject.activities.push({
      id, title: component.title, category: component.type || 'activity', completed: isComplete, bestScorePercent, position: index,
      schedule: dates[id] || scheduleForDate(component.sessionDate), week: item.week || undefined, native: component,
    });
    subjects.set(key, subject);
  }
  const nativeTitles = new Set([...currentSubjects.map((subject) => subject.title), ...(real?.components || []).map((item) => item.module)]);
  for (const title of real?.modules || []) {
    if (!nativeTitles.has(title)) subjects.set(`unlinked:${title}`, { id: `unlinked:${title}`, title, source: 'current', activities: [] });
  }
  return [...subjects.values()].map((subject) => ({ ...subject, title: builderSubjects[subject.id]?.title || subject.title }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** One roll-up for imported history and all later current-platform progress.
 * Exact source links merge the two representations before totals are
 * calculated, so the same activity can never be counted twice. */
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
  const completedSubjectCount = subjects.filter(
    (subject) => subject.activities.length > 0 && subject.activities.every((entry) => entry.completed),
  ).length;
  return {
    subjects,
    subjectCount: subjects.length,
    activityCount,
    completedActivityCount,
    completedSubjectCount,
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
  const data = needsHistory ? current?.data || null : null;
  const metadataEnabled = enabled && !!learnerId && (!needsHistory || !!data);
  const { metadata, error: metadataError, retry: retryMetadata } = useSubjectMetadata(
    data,
    real,
    kind,
    learnerId,
    metadataEnabled,
  );
  const loading = enabled && !!learnerId && (
    (needsHistory && !current) || (!current?.error && metadataEnabled && !metadata)
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

export function SubjectOverview({ real, kind, learnerId, onOpen }: { real: LearnerDetail | null; kind?: LearnerKind; learnerId?: string; onOpen: () => void }) {
  const { summary, loading, error, retry } = useUnifiedLearningSummary(real, kind, learnerId);
  return <section aria-label="Subject learning progress" className="space-y-4 rounded-2xl border border-foreground-200 bg-white p-5">
    <h2 className="text-sm font-bold text-foreground-900">Overall subject progress</h2>
    {error ? <p role="alert" className="text-sm">{error} <button onClick={retry} className="font-semibold text-primary-700 underline">Try again</button></p>
      : loading || !summary ? <p role="status" className="text-sm text-foreground-500">Loading progress…</p>
        : <><Progress done={summary.completedActivityCount} total={summary.activityCount} /><p className="text-xs text-foreground-500">Across {summary.subjectCount} subjects</p></>}
    <button onClick={onOpen} className="flex items-center gap-2 text-sm font-semibold text-primary-700">Open your subjects<ChevronRight size={16} /></button>
  </section>;
}

function Cover({ title, url, large = false }: { title: string; url?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const hue = [...title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 55 + 220;
  return <div className={`relative overflow-hidden ${large ? 'h-40 sm:h-48' : 'h-28'} bg-primary-50`}>
    {url && !failed ? <img src={url} alt={`${title} cover`} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105" /> : <div className={`flex h-full ${large ? 'items-center justify-center' : 'items-end p-4'}`} style={{ background: `linear-gradient(120deg, hsl(${hue} 60% 97%), hsl(${hue + 15} 55% 90%))` }}>
      <div aria-hidden="true" className="absolute -right-7 -top-16 h-48 w-48 rotate-12 rounded-[3rem] border border-white/70 bg-white/20" />
      <div aria-hidden="true" className="absolute -bottom-20 right-8 h-40 w-40 -rotate-12 rounded-[2.5rem] border border-white/60" />
      <span className={`relative flex items-center justify-center rounded-2xl border border-white/90 bg-white/85 text-primary-600 shadow-sm ${large ? 'h-16 w-16' : 'h-11 w-11'}`}><BookOpen className={large ? 'h-8 w-8' : 'h-5 w-5'} strokeWidth={1.7} aria-hidden="true" /></span>
    </div>}
  </div>;
}

function SubjectCard({ subject, cover, onOpen }: { subject: Subject; cover?: string; onOpen: () => void }) {
  const total = subject.activities.length;
  const completed = subject.activities.filter((activity) => activity.completed).length;
  const isComplete = total > 0 && completed === total;
  const status = isComplete ? 'Completed' : completed > 0 ? 'In progress' : total ? 'Not started' : 'No activities yet';
  const statusColor = isComplete ? 'bg-emerald-500' : completed > 0 ? 'bg-violet-500' : 'bg-slate-400';
  return <article className="group min-w-0 overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_2px_8px_-4px_rgba(30,20,60,0.12)] transition-[border-color,box-shadow] hover:border-primary-200 hover:shadow-[0_12px_28px_-12px_rgba(76,29,149,0.22)] focus-within:ring-2 focus-within:ring-primary-400 focus-within:ring-offset-2">
    <button type="button" onClick={onOpen} className="flex h-full w-full flex-col text-left focus-visible:outline-none">
      <div className="relative w-full">
        <Cover title={subject.title} url={cover} />
        <span className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/90 bg-white/95 px-2.5 py-1 text-[11px] font-semibold shadow-sm ${isComplete ? 'text-emerald-700' : 'text-slate-600'}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />{status}
        </span>
      </div>
      <div className="flex w-full flex-1 flex-col p-4">
        <h3 className="min-h-[3.75rem] break-words text-sm font-bold leading-5 text-slate-900 transition-colors group-hover:text-primary-700">{subject.title}</h3>
        <div className="mt-auto pt-4"><Progress done={completed} total={total} compact /></div>
        <span className="mt-4 flex min-h-10 items-center justify-between gap-2 rounded-xl bg-primary-50 px-3 text-xs font-bold text-primary-700 transition-colors group-hover:bg-primary-500 group-hover:text-white group-focus-within:bg-primary-500 group-focus-within:text-white">Open subject<ArrowUpRight size={17} aria-hidden="true" /></span>
      </div>
    </button>
  </article>;
}

function nativeHref(entry: SubjectEntry, kind?: string, learnerId?: string) {
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
        : href ? <a href={href} className="text-primary-700 underline-offset-4 hover:underline focus-visible:underline">{entry.title}</a> : entry.title}
    </h5><p className="mt-1 text-xs text-foreground-500">{[entry.category, entry.schedule.date, score != null ? `Best score ${Math.round(score)}%` : ''].filter(Boolean).join(' · ')}</p>
      {legacy?.section_title && <p className="mt-1 text-xs text-foreground-500">Lecture: {legacy.section_title}</p>}
    </div>
    <div className="col-start-2 flex flex-wrap items-center gap-2 sm:ml-auto"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${entry.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-600'}`}>{entry.completed ? 'Complete' : 'Not complete'}</span>
    {legacy && kind && learnerId && <button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={contentId} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-primary-700">{open ? 'Close activity' : 'Open activity'}</button>}
    {href && <a href={href} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-primary-700">Open activity</a>}
    {!legacy && !href && <span className="text-xs text-foreground-500">Content not available yet</span>}</div>
  </div>
    {legacy && <p className="px-4 pb-3 text-[11px] text-foreground-400">OTJH: {legacy.hours_mapped ? formatHoursMinutes(legacy.actual) : 'Unavailable'} · Planned: {legacy.planned_hours_mapped ? formatHoursMinutes(legacy.planned) : 'Unavailable'}</p>}
    <div id={contentId}>{open && legacy && kind && learnerId && <div role="region" aria-label={`${entry.title} content`} className="p-3 pt-0"><StudentMaterial kind={kind} learnerId={learnerId} groupId={legacy.group_id} activityId={legacy.source_activity_id} completed={entry.completed} onProgress={onProgress} /></div>}</div>
  </div>;
}

export function StudentActivityPanel({ data: incomingData, loading, error, onRetry, kind, learnerId, real: incomingReal = null, onProgress }: {
  kind?: string; learnerId?: string; real?: LearnerDetail | null; data: StudentActivityResponse | null;
  loading: boolean; error: string | null; onRetry: () => void; onProgress?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get('subject'));
  const identity = `${kind}:${learnerId}`;
  const { metadata: incomingMetadata, error: imageError, retry: retryMetadata } = useSubjectMetadata(incomingData, incomingReal, kind, learnerId, !loading && !error);
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
  const recordedOtjh = data?.audit_lms_actual ?? data?.recorded_otjh_total ?? data?.actual_total ?? null;
  const plannedOtjh = data?.audit_tp_planned ?? data?.planned_total ?? null;
  const [savedProgress, setSavedProgress] = useState<{ identity: string; activities: Record<number, SubjectAttemptResult> }>({ identity, activities: {} });
  const updatedData = useMemo(() => {
    if (!data || savedProgress.identity !== identity) return data;
    return { ...data, activities: data.activities.map((item) => {
      const saved = savedProgress.activities[item.source_activity_id];
      if (!saved) return item;
      const scores = [item.best_score_percent, saved.score_percent].filter((score): score is number => score != null);
      return { ...item, completed: item.completed || saved.completed, best_score_percent: scores.length ? Math.max(...scores) : null };
    }) };
  }, [data, identity, savedProgress]);
  const recordProgress = (activityId: number, result: SubjectAttemptResult) => {
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
  const covers = { ...data?.covers, ...metadata?.covers };
  const term = search.trim().toLocaleLowerCase();
  const active = subjects.find((subject) => subject.id === selected);
  const visible = subjects.filter((subject) => !term || subject.title.toLocaleLowerCase().includes(term) || subject.activities.some((entry) => entry.title.toLocaleLowerCase().includes(term)));
  const visibleActivities = active ? active.activities.filter((entry) => !term || active.title.toLocaleLowerCase().includes(term) || entry.title.toLocaleLowerCase().includes(term)) : [];
  const visibleActivityIds = new Set(visibleActivities.map((entry) => entry.id));
  const groups = groupSubjectActivities(active?.activities || []).filter(({ weeks }) => weeks.some(({ activities }) => activities.some((entry) => visibleActivityIds.has(entry.id))));
  const total = summary.activityCount;
  const done = summary.completedActivityCount;
  if (!displayed && (error || imageError)) return <div role="alert" className="rounded-2xl border bg-white p-6"><p className="font-semibold">Could not load your subjects</p><p className="mt-2 text-sm text-foreground-500">{error || imageError}</p><button onClick={error ? onRetry : retryMetadata} className="mt-4 rounded-lg border px-4 py-2 text-sm font-semibold">Try again</button></div>;
  if (!displayed) return <div role="status" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((key) => <div key={key} className="h-72 motion-safe:animate-pulse rounded-2xl bg-foreground-100" />)}<span className="sr-only">Loading subjects</span></div>;
  return <section className="space-y-5" aria-label="Your subjects" aria-busy={!ready && !error && !imageError}>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary-600">My learning</p><h2 className="mt-1 text-2xl font-bold text-foreground-900">{active ? active.title : 'Your subjects'}</h2>{data?.learner_name && <p className="mt-1 text-sm text-foreground-500">{data.learner_name}</p>}</div>
      <label className="relative min-w-0 flex-1 sm:max-w-xs"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input aria-label="Search modules or activities" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subjects or activities" className="h-11 w-full rounded-xl border border-foreground-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-primary-400" /></label>
    </header>
    {imageError && <p role="alert" className="text-sm text-amber-800">{imageError} <button onClick={retryMetadata} className="font-semibold underline">Try again</button></p>}
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error} <button onClick={onRetry} className="font-semibold underline">Try again</button></p>}
    {!active ? <>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground-500"><span><strong className="text-foreground-900">{subjects.length}</strong> subjects</span><span><strong className="text-foreground-900">{total}</strong> activities</span><span><strong className="text-foreground-900">{done}</strong> completed</span></div>
      {visible.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{visible.map((subject) => <SubjectCard key={subject.id} subject={subject} cover={covers[subject.id]} onOpen={() => setSelected(subject.id)} />)}</div> : <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-foreground-500">{subjects.length ? 'No subjects or activities match your search.' : 'Your subjects will appear here when they are assigned.'}</div>}
      {data && <div className="flex flex-wrap gap-6 rounded-xl bg-background-100 px-4 py-3 text-xs"><div><span className="block text-foreground-500">Recorded OTJH</span><strong>{recordedOtjh == null ? 'Unavailable' : formatHoursMinutes(recordedOtjh)}</strong></div><div><span className="block text-foreground-500">Planned OTJH</span><strong>{plannedOtjh == null ? 'Unavailable' : formatHoursMinutes(plannedOtjh)}</strong></div></div>}
    </> : <>
      <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm font-semibold text-primary-700"><ChevronLeft size={17} />All subjects</button>
      <div className="relative overflow-hidden rounded-2xl border bg-white"><Cover title={active.title} url={covers[active.id]} large /><div className="p-5"><Progress done={active.activities.filter((entry) => entry.completed).length} total={active.activities.length} showFormula /></div></div>
      {groups.map(({ month, weeks }) => {
        const monthTitle = month === 'undated' ? 'Undated activities' : new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return <ActivityGroup key={`${active.id}:${month}`} title={monthTitle} activities={weeks.flatMap(({ activities }) => activities)} level={3}>
          <div className="space-y-3 p-3 pt-0">{weeks.map(({ week, activities }, index) => {
            const visibleEntries = activities.filter((entry) => visibleActivityIds.has(entry.id));
            if (!visibleEntries.length) return null;
            const weekTitle = week === 'undated' ? 'Activities awaiting a date' : /^\d{4}-/.test(week) ? `Week ${index + 1} · ${week} – ${activities[0].schedule.week_end || ''}` : week;
            return <ActivityGroup key={week} title={weekTitle} label={`${monthTitle}, ${weekTitle}`} activities={activities} level={4}>
              {visibleEntries.map((entry) => <ActivityRow key={entry.id} entry={entry} kind={kind} learnerId={learnerId} onProgress={(result) => { if (entry.legacy) recordProgress(entry.legacy.source_activity_id, result); }} />)}
            </ActivityGroup>;
          })}</div>
        </ActivityGroup>;
      })}
      {!visibleActivities.length && <p className="rounded-xl border bg-white p-6 text-sm text-foreground-500">{active.activities.length ? 'No activities match your search.' : 'Activities will appear here when they are added to this subject.'}</p>}
    </>}
  </section>;
}
