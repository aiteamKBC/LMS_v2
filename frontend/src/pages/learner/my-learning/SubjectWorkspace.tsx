import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, Search } from 'lucide-react';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import { fetchStudentActivity, subjectRequest, type StudentActivityItem, type StudentActivityResponse } from '@/api/studentActivity';
import { completedComponentIds, isComponentComplete, hasComponentContent, formatHoursMinutes, type JourneyComponent } from '@/utils/learnerJourney';
import { StudentMaterial } from './StudentMaterial';

type Schedule = Pick<StudentActivityItem, 'date' | 'month' | 'week_start' | 'week_end' | 'date_needs_review'>;
export type SubjectEntry = { id: string; title: string; category: string; completed: boolean; position: number; schedule: Schedule; week?: string; legacy?: StudentActivityItem; native?: JourneyComponent };
type Subject = { id: string; title: string; source: 'legacy' | 'current'; activities: SubjectEntry[] };
type CoverMetadata = { covers: Record<string, string>; can_manage: boolean; persistence_ready: boolean; csrf_token: string; activity_dates?: Record<string, Schedule>; current_subjects?: { id: string; title: string }[] };

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

function subjectsFrom(data: StudentActivityResponse | null, real: LearnerDetail | null, dates: Record<string, Schedule>, currentSubjects: { id: string; title: string }[] = []): Subject[] {
  const subjects = new Map<string, Subject>();
  for (const subject of data?.subjects || []) subjects.set(`legacy:${subject.id}`, { id: `legacy:${subject.id}`, title: subject.name, source: 'legacy', activities: [] });
  for (const item of data?.activities || []) {
    const key = `legacy:${item.group_id}`;
    const subject = subjects.get(key) || { id: key, title: item.group_name || 'Unnamed subject', source: 'legacy' as const, activities: [] };
    if (!subject.activities.some((entry) => entry.id === item.activity_id)) subject.activities.push({ id: item.activity_id, title: item.activity, category: item.category, completed: item.completed, position: item.position || 0, schedule: item.month ? item : scheduleForDate(item.date), legacy: item });
    subjects.set(key, subject);
  }
  const completed = completedComponentIds(real);
  for (const subject of currentSubjects) subjects.set(`current:${subject.id}`, { id: `current:${subject.id}`, title: subject.title, source: 'current', activities: [] });
  for (const [index, item] of (real?.components || []).entries()) {
    const key = item.moduleId ? `current:${item.moduleId}` : `unlinked:${item.module}`;
    const subject = subjects.get(key) || { id: key, title: item.module || 'Unnamed subject', source: 'current' as const, activities: [] };
    const component: JourneyComponent = { ...item, title: item.component,
      quizAttempts: item.isQuiz && item.quizMeta ? (real?.quizAttempts || []).filter((attempt) => String(attempt.quizId) === String(item.quizMeta!.quizId)) : undefined };
    const id = item.componentId || `quiz:${item.quizMeta?.quizId ?? `${item.week}:${index}`}`;
    if (!subject.activities.some((entry) => entry.id === id)) subject.activities.push({
      id, title: component.title, category: component.type || 'activity', completed: isComponentComplete(component, completed), position: index,
      schedule: dates[id] || scheduleForDate(component.sessionDate), week: item.week || undefined, native: component,
    });
    subjects.set(key, subject);
  }
  for (const title of real?.modules || []) {
    if (![...subjects.values()].some((subject) => subject.source === 'current' && subject.title === title)) subjects.set(`unlinked:${title}`, { id: `unlinked:${title}`, title, source: 'current', activities: [] });
  }
  return [...subjects.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

function Progress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round(done / total * 100) : 0;
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2 text-xs"><span className="text-foreground-500">{done} of {total} completed</span><strong className="text-primary-700">{percent}%</strong></div>
    <div role="progressbar" aria-label="Subject progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-foreground-100"><div className="h-full rounded-full bg-primary-500 transition-[width]" style={{ width: `${percent}%` }} /></div></div>;
}

export function SubjectOverview({ real, kind, learnerId, onOpen }: { real: LearnerDetail | null; kind?: LearnerKind; learnerId?: string; onOpen: () => void }) {
  const [data, setData] = useState<StudentActivityResponse | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!kind || !learnerId || !real?.studentActivityAvailable) return;
    const controller = new AbortController();
    setData(null); setError('');
    void fetchStudentActivity(kind, learnerId, controller.signal).then((payload) => { if (!controller.signal.aborted) setData(payload); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load progress.'); });
    return () => controller.abort();
  }, [kind, learnerId, real?.studentActivityAvailable, retry]);
  const subjects = subjectsFrom(data, real, {});
  const total = subjects.reduce((sum, subject) => sum + subject.activities.length, 0);
  const done = subjects.reduce((sum, subject) => sum + subject.activities.filter((entry) => entry.completed).length, 0);
  return <section aria-label="Subject learning progress" className="space-y-4 rounded-2xl border border-foreground-200 bg-white p-5">
    <h2 className="text-sm font-bold text-foreground-900">Overall subject progress</h2>
    {error ? <p role="alert" className="text-sm">{error} <button onClick={() => setRetry((value) => value + 1)} className="font-semibold text-primary-700 underline">Try again</button></p>
      : real?.studentActivityAvailable && !data ? <p role="status" className="text-sm text-foreground-500">Loading progress…</p>
        : <><Progress done={done} total={total} /><p className="text-xs text-foreground-500">Across {subjects.length} subjects</p></>}
    <button onClick={onOpen} className="flex items-center gap-2 text-sm font-semibold text-primary-700">Open your subjects<ChevronRight size={16} /></button>
  </section>;
}

function Cover({ title, url, large = false }: { title: string; url?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const hue = [...title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 90 + 210;
  return <div className={`relative overflow-hidden ${large ? 'h-40 sm:h-48' : 'aspect-[16/9]'} bg-primary-50`}>
    {url && !failed ? <img src={url} alt={`${title} cover`} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center" style={{ background: `linear-gradient(130deg, hsl(${hue} 45% 94%), hsl(${hue + 25} 55% 84%))` }}>
      <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full border-[22px] border-white/25" /><BookOpen className="relative h-12 w-12 text-primary-700/60" strokeWidth={1.3} />
    </div>}
  </div>;
}

function nativeHref(entry: SubjectEntry, kind?: string, learnerId?: string) {
  const component = entry.native;
  if (!component || !kind || !learnerId || !hasComponentContent(component)) return null;
  const path = component.isQuiz && component.quizMeta ? `quiz/${kind}/${learnerId}/${component.quizMeta.quizId}`
    : component.type === 'video' && component.videoUrl && component.componentId ? `video/${kind}/${learnerId}/${component.componentId}`
      : component.componentId ? `component/${kind}/${learnerId}/${component.componentId}` : null;
  return path ? `/learner/${path}?week=${encodeURIComponent(entry.week || '')}` : null;
}

function ActivityRow({ entry, kind, learnerId, onProgress }: { entry: SubjectEntry; kind?: string; learnerId?: string; onProgress?: () => void }) {
  const [open, setOpen] = useState(false);
  const href = nativeHref(entry, kind, learnerId);
  const legacy = entry.legacy;
  const score = legacy?.best_score_percent ?? (legacy?.quiz_score != null && legacy.quiz_maximum_score ? legacy.quiz_score / legacy.quiz_maximum_score * 100 : null);
  return <div className="border-t border-foreground-100 first:border-t-0"><div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 p-4 sm:flex sm:flex-wrap sm:items-center">
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${entry.completed ? 'bg-emerald-50 text-emerald-600' : 'bg-background-100 text-foreground-400'}`}>{entry.completed ? <CheckCircle2 size={18} /> : <BookOpen size={16} />}</span>
    <div className="min-w-0 flex-1"><h5 className="text-sm font-semibold text-foreground-900">{entry.title}</h5><p className="mt-1 text-xs text-foreground-500">{[entry.category, entry.schedule.date, score != null ? `Best score ${Math.round(score)}%` : ''].filter(Boolean).join(' · ')}</p>
      {entry.schedule.date_needs_review && <p className="mt-1 text-xs text-amber-700">Date needs review</p>}
    </div>
    <div className="col-start-2 flex flex-wrap items-center gap-2 sm:ml-auto"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${entry.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-600'}`}>{entry.completed ? 'Complete' : 'Not complete'}</span>
    {legacy && kind && learnerId && <button onClick={() => setOpen((value) => !value)} aria-expanded={open} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-primary-700">{open ? 'Close activity' : 'Open activity'}</button>}
    {href && <a href={href} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-primary-700">Open activity</a>}
    {!legacy && !href && <span className="text-xs text-foreground-500">Content not available yet</span>}</div>
  </div>
    {legacy && <p className="px-4 pb-3 text-[11px] text-foreground-400">OTJH: {legacy.hours_mapped ? formatHoursMinutes(legacy.actual) : 'Unavailable'} · Planned: {legacy.planned_hours_mapped ? formatHoursMinutes(legacy.planned) : 'Unavailable'}</p>}
    {open && legacy && kind && learnerId && <div className="p-3 pt-0"><StudentMaterial kind={kind} learnerId={learnerId} groupId={legacy.group_id} activityId={legacy.source_activity_id} onProgress={onProgress} /></div>}
  </div>;
}

export function StudentActivityPanel({ data, loading, error, onRetry, kind, learnerId, real = null, onProgress }: {
  kind?: string; learnerId?: string; real?: LearnerDetail | null; data: StudentActivityResponse | null;
  loading: boolean; error: string | null; onRetry: () => void; onProgress?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<CoverMetadata | null>(null);
  const [imageError, setImageError] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const subjects = useMemo(() => subjectsFrom(data, real, metadata?.activity_dates || {}, metadata?.current_subjects || []), [data, real, metadata]);
  const refs = subjects.map((subject) => subject.id).filter((ref) => !ref.startsWith('unlinked:')).join(',');
  useEffect(() => {
    if (!learnerId) return;
    const controller = new AbortController();
    void subjectRequest<CoverMetadata>(`/learner_api/subject-covers/${encodeURIComponent(learnerId)}/?refs=${encodeURIComponent(refs)}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setMetadata(result); setImageError(''); } })
      .catch(() => { if (!controller.signal.aborted) setImageError('Subject images and dates could not be refreshed.'); });
    return () => controller.abort();
  }, [learnerId, refs]);
  const covers = { ...data?.covers, ...metadata?.covers };
  const canManage = metadata?.can_manage ?? data?.can_manage_covers ?? false;
  const saveImage = async (subject: Subject, file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setImageError('Choose a JPG, PNG or WebP image smaller than 5 MB.'); return; }
    setUploading(subject.id); setImageError('');
    const body = new FormData(); body.append('image', file);
    try {
      const result = await subjectRequest<{ url: string }>(`/learner_api/subject-cover/${encodeURIComponent(subject.id)}/`, { method: 'POST', headers: { 'X-CSRFToken': metadata?.csrf_token || '' }, body });
      setMetadata((current) => current ? { ...current, covers: { ...current.covers, [subject.id]: result.url } } : current);
    } catch (failure) { setImageError(failure instanceof Error ? failure.message : 'Could not upload the cover.'); }
    finally { setUploading(null); }
  };
  const imageControl = (subject: Subject) => canManage && !subject.id.startsWith('unlinked:') && <label className="absolute right-3 top-3 z-10 flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-2 text-xs font-semibold text-foreground-700 shadow-sm">
    <ImagePlus size={15} />{uploading === subject.id ? 'Uploading…' : 'Upload image'}<input aria-label={`Upload image for ${subject.title}`} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!uploading || !metadata?.persistence_ready} onChange={(event) => { void saveImage(subject, event.target.files?.[0]); event.target.value = ''; }} />
  </label>;
  const term = search.trim().toLocaleLowerCase();
  const active = subjects.find((subject) => subject.id === selected);
  const visible = subjects.filter((subject) => !term || subject.title.toLocaleLowerCase().includes(term) || subject.activities.some((entry) => entry.title.toLocaleLowerCase().includes(term)));
  const visibleActivities = active ? active.activities.filter((entry) => !term || active.title.toLocaleLowerCase().includes(term) || entry.title.toLocaleLowerCase().includes(term)) : [];
  const groups = groupSubjectActivities(visibleActivities);
  const total = subjects.reduce((sum, subject) => sum + subject.activities.length, 0);
  const done = subjects.reduce((sum, subject) => sum + subject.activities.filter((entry) => entry.completed).length, 0);
  if (loading && !data && !subjects.length) return <div role="status" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((key) => <div key={key} className="h-72 animate-pulse rounded-2xl bg-foreground-100" />)}<span className="sr-only">Loading subjects</span></div>;
  if (error) return <div role="alert" className="rounded-2xl border bg-white p-6"><p className="font-semibold">Could not load your subjects</p><p className="mt-2 text-sm text-foreground-500">{error}</p><button onClick={onRetry} className="mt-4 rounded-lg border px-4 py-2 text-sm font-semibold">Try again</button></div>;
  return <section className="space-y-5" aria-label="Your subjects">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary-600">My learning</p><h2 className="mt-1 text-2xl font-bold text-foreground-900">{active ? active.title : 'Your subjects'}</h2>{data?.learner_name && <p className="mt-1 text-sm text-foreground-500">{data.learner_name}</p>}</div>
      <label className="relative min-w-0 flex-1 sm:max-w-xs"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input aria-label="Search modules or activities" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subjects or activities" className="h-11 w-full rounded-xl border border-foreground-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-primary-400" /></label>
    </header>
    {imageError && <p role="alert" className="text-sm text-amber-800">{imageError}</p>}
    {canManage && metadata && !metadata.persistence_ready && <p className="text-sm text-foreground-500">Cover uploads will be available after learning storage is enabled.</p>}
    {!active ? <>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground-500"><span><strong className="text-foreground-900">{subjects.length}</strong> subjects</span><span><strong className="text-foreground-900">{total}</strong> activities</span><span><strong className="text-foreground-900">{done}</strong> completed</span></div>
      {visible.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{visible.map((subject) => <article key={subject.id} className="relative overflow-hidden rounded-2xl border border-foreground-200 bg-white shadow-sm transition-shadow hover:shadow-md">
        {imageControl(subject)}<button onClick={() => setSelected(subject.id)} className="block h-full w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
          <Cover title={subject.title} url={covers[subject.id]} /><div className="space-y-3 p-4"><h3 className="min-h-10 text-sm font-bold leading-5 text-foreground-900">{subject.title}</h3><Progress done={subject.activities.filter((entry) => entry.completed).length} total={subject.activities.length} /><span className="flex items-center justify-between border-t border-foreground-100 pt-3 text-xs font-semibold text-primary-700">Open subject<ChevronRight size={16} /></span></div>
        </button></article>)}</div> : <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-foreground-500">{subjects.length ? 'No subjects or activities match your search.' : 'Your subjects will appear here when they are assigned.'}</div>}
      {data && <div className="flex flex-wrap gap-6 rounded-xl bg-background-100 px-4 py-3 text-xs"><div><span className="block text-foreground-500">Recorded OTJH</span><strong>{data.actual_total == null ? 'Unavailable' : formatHoursMinutes(data.actual_total)}</strong></div><div><span className="block text-foreground-500">Planned OTJH</span><strong>{data.planned_total == null ? 'Unavailable' : formatHoursMinutes(data.planned_total)}</strong></div></div>}
    </> : <>
      <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm font-semibold text-primary-700"><ChevronLeft size={17} />All subjects</button>
      <div className="relative overflow-hidden rounded-2xl border bg-white">{imageControl(active)}<Cover title={active.title} url={covers[active.id]} large /><div className="p-5"><Progress done={active.activities.filter((entry) => entry.completed).length} total={active.activities.length} /></div></div>
      {groups.map(({ month, weeks }) => <section key={month} className="space-y-3" aria-label={month === 'undated' ? 'Undated activities' : new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}>
        <h3 className="flex items-center gap-2 pt-2 text-lg font-bold text-foreground-900"><CalendarDays size={20} className="text-primary-500" />{month === 'undated' ? 'Undated activities' : new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
        {weeks.map(({ week, activities }, index) => <details key={week} open className="group overflow-hidden rounded-xl border border-foreground-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-background-100/70 px-4 py-3"><span className="text-sm font-semibold">{week === 'undated' ? 'Activities awaiting a date' : /^\d{4}-/.test(week) ? `Week ${index + 1} · ${week} – ${activities[0].schedule.week_end || ''}` : week}<span className="ml-3 text-xs font-normal text-foreground-500">{activities.filter((entry) => entry.completed).length}/{activities.length} completed</span></span><ChevronDown size={17} /></summary>
          {activities.map((entry) => <ActivityRow key={entry.id} entry={entry} kind={kind} learnerId={learnerId} onProgress={onProgress} />)}
        </details>)}
      </section>)}
      {!visibleActivities.length && <p className="rounded-xl border bg-white p-6 text-sm text-foreground-500">{active.activities.length ? 'No activities match your search.' : 'Activities will appear here when they are added to this subject.'}</p>}
    </>}
  </section>;
}
