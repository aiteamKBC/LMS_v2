import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, FileText, Headphones, HelpCircle, Layers3, Loader2, Lock, PenLine, Presentation, Sparkles, Video } from 'lucide-react';
import { fetchLearnerFreeCourses, markFreeCourseActivityComplete, peekLearnerFreeCourses, type FreeCourse, type FreeCourseActivity } from '@/api/freeCourses';
import type { LearnerKind } from '@/api/learnerDetail';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { Cover } from './SubjectWorkspace';
import styles from './SubjectWorkspace.module.css';

// Download the material players / quiz engine only when a learner opens an
// activity, exactly as the ordinary module workspace does via DeferredStudentMaterial.
const FreeCourseMaterial = lazy(() => import('./FreeCourseMaterial').then((module) => ({ default: module.FreeCourseMaterial })));
const FreeCourseQuiz = lazy(() => import('./FreeCourseQuiz').then((module) => ({ default: module.FreeCourseQuiz })));

const CARD_TONES = ['purple', 'navy', 'green', 'gold', 'blue', 'rose'] as const;

/** Icon + label per activity type — mirrors the normal sidebar's type styling. */
function typeMeta(type: string): { label: string; Icon: typeof BookOpen } {
  switch ((type || '').toLowerCase()) {
    case 'video': return { label: 'Video', Icon: Video };
    case 'powerpoint': return { label: 'Slides', Icon: Presentation };
    case 'podcast': return { label: 'Podcast', Icon: Headphones };
    case 'quiz': case 'monthly-ksb-quiz': return { label: 'Quiz', Icon: HelpCircle };
    case 'assignment': return { label: 'Assignment', Icon: FileText };
    case 'reflection': return { label: 'Reflection', Icon: PenLine };
    default: return { label: 'Reading', Icon: BookOpen };
  }
}

function isQuiz(activity: FreeCourseActivity): boolean {
  return /quiz/i.test(activity.type);
}

/** Whether an activity has something to show. A quiz is "available" only when a
 *  quiz is linked to it in the curriculum (quizId); otherwise it reads as not
 *  available, exactly like the normal modules. */
function hasContent(activity: FreeCourseActivity): boolean {
  if (isQuiz(activity)) return Boolean(activity.quizId);
  return Boolean(activity.videoUrl || activity.audioUrl || activity.contentHtml || activity.resourceUrl);
}

type LockInfo = { locked: boolean; reason: 'content' | 'prereq' | null };

/** Locking rule (free courses): ONLY quizzes can lock. A quiz is locked until
 *  every material (video/reading/…) SINCE THE PREVIOUS QUIZ is completed — its
 *  own "segment". Quizzes are independent of each other: quiz 2 depends only on
 *  the materials between quiz 1 and quiz 2, never on quiz 1 or the materials
 *  before it. Non-quiz activities never lock — they are either available or,
 *  with no content authored, shown as "not available".
 *
 *  An unlinked quiz (no quizId) has no quiz to attempt, so it reads as
 *  not-available rather than locked. */
function computeLocks(activities: FreeCourseActivity[], isDone: (activity: FreeCourseActivity) => boolean): Map<string, LockInfo> {
  const map = new Map<string, LockInfo>();
  let segmentMaterialsDone = true; // are all completable materials in the current segment done?
  for (const activity of activities) {
    if (isQuiz(activity)) {
      if (!hasContent(activity)) {
        map.set(activity.componentId, { locked: false, reason: 'content' }); // unlinked quiz → not available
      } else if (activity.manualUnlock) {
        map.set(activity.componentId, { locked: false, reason: null }); // author set it to open (manual unlock)
      } else {
        map.set(activity.componentId, segmentMaterialsDone ? { locked: false, reason: null } : { locked: true, reason: 'prereq' });
      }
      segmentMaterialsDone = true; // a quiz closes the segment; the next one starts fresh
      continue;
    }
    // Non-quiz material: never locked. It gates only the NEXT quiz in its segment.
    if (!hasContent(activity)) { map.set(activity.componentId, { locked: false, reason: 'content' }); continue; }
    map.set(activity.componentId, { locked: false, reason: null });
    if (!isDone(activity)) segmentMaterialsDone = false;
  }
  return map;
}

function activityCount(course: FreeCourse): number {
  return course.weeks.reduce((sum, week) => sum + week.activities.length, 0);
}

/** Completed vs completable. Anything with content counts — materials (marked
 *  complete) and linked quizzes (passed); empty placeholders and unlinked
 *  quizzes are excluded so the bar reflects what a learner can actually finish. */
function courseProgress(course: FreeCourse, isDone: (activity: FreeCourseActivity) => boolean) {
  let completable = 0;
  let done = 0;
  for (const week of course.weeks) {
    for (const activity of week.activities) {
      if (!hasContent(activity)) continue;
      completable += 1;
      if (isDone(activity)) done += 1;
    }
  }
  return { done, completable, percent: completable ? Math.round((done / completable) * 100) : 0 };
}

/** A compact progress bar matching the normal SubjectCard's `Progress compact`
 *  (that component isn't exported, so its markup is mirrored here). */
function CourseProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-500">{done} of {total} completed</span>
        <strong className={`shrink-0 tabular-nums ${percent === 100 ? 'text-emerald-700' : 'text-primary-700'}`}>{percent}%</strong>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full motion-safe:transition-[width] ${percent === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary-500 to-violet-400'}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function FreeCourseCard({ course, tone, isDone, onOpen }: { course: FreeCourse; tone: string; isDone: (activity: FreeCourseActivity) => boolean; onOpen: () => void }) {
  const activities = activityCount(course);
  const weeks = course.weeks.length;
  const progress = courseProgress(course, isDone);
  // Status mirrors SubjectCard, scoped to what a learner can actually finish
  // (empty placeholders / unlinked quizzes are not counted as completable).
  const isComplete = progress.completable > 0 && progress.done === progress.completable;
  const status = progress.completable === 0 ? 'No activities yet'
    : isComplete ? 'Completed'
    : progress.done > 0 ? 'In progress'
    : 'Not started';
  // Next openable, not-done activity — shown with its real type icon, honouring
  // the same quiz-lock rule the detail view uses.
  const ordered = course.weeks.flatMap((week) => week.activities);
  const locks = computeLocks(ordered, isDone);
  const next = ordered.find((activity) => hasContent(activity) && !isDone(activity) && !(locks.get(activity.componentId)?.locked));
  const NextIcon = next ? typeMeta(next.type).Icon : BookOpen;
  return (
    <article className={`group ${styles.card} ${styles.freeCard} ${styles.subjectTheme}`} data-tone={tone}>
      <button type="button" onClick={onOpen} className={styles.cardButton}>
        <div className="relative w-full">
          <Cover title={course.courseName} url={course.coverImageUrl || undefined} large />
          <span className={styles.status} data-state={isComplete ? 'complete' : progress.done > 0 ? 'started' : 'new'}>
            <span aria-hidden="true" className={styles.statusDot} />{status}
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardMetaRow}>
            <p className={styles.cardEyebrow}><Layers3 size={13} aria-hidden="true" />{weeks} {weeks === 1 ? 'week' : 'weeks'} · {activities} {activities === 1 ? 'activity' : 'activities'}</p>
            <span className={styles.freeBadge}><Sparkles size={12} aria-hidden="true" />Free</span>
          </div>
          <h3 className={styles.cardTitle}>{course.courseName || 'Free course'}</h3>
          <p className={styles.cardDescription}>{course.description || 'Explore this free course and its activities.'}</p>
          <div className={styles.cardProgress}><CourseProgressBar done={progress.done} total={progress.completable} label={`${course.courseName || 'Free course'} progress`} /></div>
          <span className={styles.nextActivity}>
            {isComplete ? <CheckCircle2 size={20} /> : <NextIcon size={20} />}
            <span>
              <small>{isComplete ? 'Well done' : next ? `Next up · ${typeMeta(next.type).label}` : 'Get started'}</small>
              <strong>{isComplete ? 'All activities complete' : next?.title || 'Explore this course'}</strong>
            </span>
            <ChevronRight size={16} />
          </span>
          <span className={styles.cardAction}>Open course<ArrowRight size={16} aria-hidden="true" /></span>
        </div>
      </button>
    </article>
  );
}

/** Content on the left, the activity list on the right — the same master/detail
 *  shape as the normal module player (lg:grid-cols-[1fr_320px]). No progress,
 *  completion or hours: free courses carry none. */
function FreeCourseDetail({ course, tone, kind, learnerId, activeId, isDone, onSelect, onComplete, onQuizPassed, completingId, completeError, onBack }: {
  course: FreeCourse; tone: string; kind: LearnerKind; learnerId: string; activeId: string | null;
  isDone: (activity: FreeCourseActivity) => boolean;
  onSelect: (componentId: string) => void;
  onComplete: (componentId: string) => void;
  onQuizPassed: (componentId: string) => void;
  completingId: string | null;
  completeError: string;
  onBack: () => void;
}) {
  const flat = useMemo(() => course.weeks.map((week) => ({
    weekTitle: week.weekTitle || `Week ${week.weekNumber || ''}`.trim(),
    activities: week.activities,
  })), [course]);
  const ordered = flat.flatMap((week) => week.activities);
  const locks = computeLocks(ordered, isDone);
  const isLocked = (activity: FreeCourseActivity) => locks.get(activity.componentId)?.locked ?? true;

  // Default to the URL activity if it's open, otherwise the next one to do.
  const openable = ordered.filter((activity) => !isLocked(activity));
  const current = ordered.find((activity) => activity.componentId === activeId && !isLocked(activity))
    ?? openable.find((activity) => !isDone(activity))
    ?? openable[0]
    ?? ordered[0]
    ?? null;
  const progress = courseProgress(course, isDone);
  const currentLock = current ? locks.get(current.componentId) : undefined;
  const currentLocked = currentLock?.locked ?? false;
  const currentDone = current ? isDone(current) : false;
  const completing = current != null && completingId === current.componentId;

  return (
    <section className={`${styles.workspace} space-y-5`} aria-label={`${course.courseName} free course`}>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-primary-700"><ChevronLeft size={17} />All free courses</button>
      <div className={`${styles.subjectTheme} relative overflow-hidden rounded-2xl border bg-white`} data-tone={tone}>
        <Cover title={course.courseName} url={course.coverImageUrl || undefined} large />
        <div className="space-y-2 p-5">
          <span className={styles.freeBadge}><Sparkles size={12} aria-hidden="true" />Free course</span>
          <h2 className="text-2xl font-bold text-foreground-900">{course.courseName || 'Free course'}</h2>
          {course.description && <p className="text-sm text-foreground-600">{course.description}</p>}
          {progress.completable > 0 && (
            <div className="max-w-sm space-y-1 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground-500">{progress.done} of {progress.completable} completed</span>
                <strong className={`tabular-nums ${progress.percent === 100 ? 'text-emerald-700' : 'text-primary-700'}`}>{progress.percent}%</strong>
              </div>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-1.5 overflow-hidden rounded-full bg-foreground-100">
                <div className={`h-full rounded-full motion-safe:transition-[width] ${progress.percent === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="text-[11px] text-foreground-400">Free-course progress only — it does not count towards your programme hours or overall progress.</p>
            </div>
          )}
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-foreground-500">Activities will appear here when they are added to this course.</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main — the selected activity's content. */}
          <div className="min-w-0 rounded-2xl border border-foreground-200 bg-white p-5">
            {current ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-600">{typeMeta(current.type).label}</p>
                    <h3 className="mt-1 text-xl font-bold text-foreground-900">{current.title}</h3>
                  </div>
                  {currentDone && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700"><CheckCircle2 size={14} />Completed</span>}
                </div>
                {currentLocked ? (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-dashed border-foreground-200 bg-background-50 p-4 text-sm text-foreground-500">
                    <Lock size={16} className="mt-0.5 shrink-0 text-foreground-400" />
                    <p>Complete the materials in this section to unlock this quiz.</p>
                  </div>
                ) : isQuiz(current) && hasContent(current) ? (
                  <div className="mt-4">
                    {currentDone ? (
                      <p className="text-sm text-emerald-700">You have passed this quiz.</p>
                    ) : (
                      <Suspense fallback={<p role="status" className="p-3 text-sm text-foreground-500">Loading quiz…</p>}>
                        <FreeCourseQuiz kind={kind} learnerId={learnerId} componentId={current.componentId} quizId={Number(current.quizId)} onPassed={() => onQuizPassed(current.componentId)} />
                      </Suspense>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="mt-4">
                      <Suspense fallback={<p role="status" className="p-3 text-sm text-foreground-500">Loading activity…</p>}>
                        <FreeCourseMaterial activity={current} />
                      </Suspense>
                    </div>
                    {!isQuiz(current) && hasContent(current) && !currentDone && (
                      <div className="mt-5 border-t border-foreground-100 pt-4">
                        <button
                          type="button"
                          onClick={() => onComplete(current.componentId)}
                          disabled={completing}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
                        >
                          {completing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                          {completing ? 'Saving…' : 'Mark as complete'}
                        </button>
                        {completeError && <p role="alert" className="mt-2 text-[12px] text-red-700">{completeError}</p>}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : <p className="text-sm text-foreground-500">Choose an activity from the list.</p>}
          </div>

          {/* Aside — every activity, grouped by week. */}
          <aside aria-label="Course activities" className="min-w-0 space-y-4 lg:sticky lg:top-4">
            {flat.map((week, weekIndex) => (
              <div key={weekIndex} className="overflow-hidden rounded-xl border border-background-300 bg-white">
                <div className="border-b border-background-300 px-4 py-3">
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-600">Week {weekIndex + 1}</p>
                  <h4 className="text-sm font-bold text-foreground-800">{week.weekTitle || 'Week'}</h4>
                  <p className="mt-0.5 text-[11px] text-foreground-400">{week.activities.length} {week.activities.length === 1 ? 'activity' : 'activities'}</p>
                </div>
                <ul className="divide-y divide-background-300">
                  {week.activities.map((activity) => {
                    const { label, Icon } = typeMeta(activity.type);
                    const isCurrent = current?.componentId === activity.componentId;
                    const done = isDone(activity);
                    const lock = locks.get(activity.componentId);
                    const locked = lock?.locked ?? true;       // prereq-locked only
                    const empty = !locked && lock?.reason === 'content'; // no content yet, still selectable
                    const muted = locked || empty;
                    return (
                      <li key={activity.componentId}>
                        <button
                          type="button"
                          onClick={() => { if (!locked) onSelect(activity.componentId); }}
                          disabled={locked}
                          aria-current={isCurrent || undefined}
                          title={locked ? 'Complete the materials in this section to unlock this quiz.' : empty ? 'Content for this activity has not been added yet.' : undefined}
                          className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                            isCurrent ? 'bg-primary-50' : locked ? 'cursor-not-allowed bg-background-100/50' : 'hover:bg-background-50'
                          }`}
                        >
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                            done ? 'bg-emerald-100 text-emerald-700' : isCurrent ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'
                          }`}>
                            {done ? <CheckCircle2 size={14} /> : locked ? <Lock size={13} /> : <Icon size={14} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{empty ? 'Not available yet' : label}</span>
                            <span className={`block truncate text-[13px] font-semibold leading-snug ${
                              done ? 'text-emerald-900' : isCurrent ? 'text-primary-700' : muted ? 'text-foreground-400' : 'text-foreground-800'
                            }`}>{activity.title}</span>
                          </span>
                          {done ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600" /> : locked ? <Lock size={14} className="shrink-0 text-foreground-400" /> : <ChevronRight size={15} className="shrink-0 text-foreground-400" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </aside>
        </div>
      )}
    </section>
  );
}

/** Placeholder cards shown while the free courses load — same shape as the
 *  programme catalogue's SubjectCardsSkeleton, using the bigger free grid. */
function FreeCoursesSkeleton() {
  return (
    <section className={`${styles.workspace} space-y-5`} role="status" aria-label="Loading your free courses">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">My learning</p>
        <h2 className="mt-1 text-2xl font-bold text-foreground-900">Free courses</h2>
        <p className="mt-1 text-sm text-foreground-500">Getting your assigned courses ready…</p>
      </header>
      <div className={styles.freeGrid} aria-hidden="true">
        {[0, 1, 2].map((key) => (
          <div key={key} className={`${styles.card} ${styles.freeCard} ${styles.skeleton}`}>
            <div className={`${styles.cover} ${styles.coverLarge}`}><span className={styles.skeletonIcon} /><span className={styles.skeletonBadge} /></div>
            <div className={styles.cardBody}>
              <span className={`${styles.skeletonLine} ${styles.shortLine}`} />
              <div className={styles.cardTitle}><span className={styles.skeletonLine} /><span className={`${styles.skeletonLine} ${styles.mediumLine}`} /></div>
              <div className={styles.cardProgress}><span className={`${styles.skeletonLine} ${styles.mediumLine}`} /><span className={styles.skeletonTrack} /></div>
              <span className={styles.skeletonNext} />
              <span className={styles.skeletonAction} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FreeCoursesTab({ kind, id }: { kind?: LearnerKind; id?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const selected = params.get('course');
  const activeActivity = params.get('activity');
  const select = (courseId?: string, componentId?: string) => {
    const next = new URLSearchParams(location.search);
    if (courseId) next.set('course', courseId); else next.delete('course');
    if (componentId) next.set('activity', componentId); else next.delete('activity');
    navigate({ pathname: location.pathname, search: next.toString() });
  };

  const identity = `${kind}:${id}`;
  const [state, setState] = useState<{ identity: string; courses: FreeCourse[] | null; error: string }>(
    () => ({ identity, courses: (kind && id ? peekLearnerFreeCourses(kind, id) : undefined) ?? null, error: '' }),
  );
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!kind || !id) return;
    let cancelled = false;
    setState((previous) => (previous.identity === identity ? previous : { identity, courses: peekLearnerFreeCourses(kind, id) ?? null, error: '' }));
    fetchLearnerFreeCourses(kind, id, retry > 0)
      .then((courses) => { if (!cancelled) setState({ identity, courses, error: '' }); })
      .catch((failure) => { if (!cancelled) setState({ identity, courses: null, error: failure instanceof Error ? failure.message : 'Could not load your free courses.' }); });
    return () => { cancelled = true; };
  }, [kind, id, identity, retry]);

  const courses = state.identity === identity ? state.courses : null;
  const error = state.identity === identity ? state.error : '';
  const loading = courses === null && !error;

  // Completion overlay: seeded from the server flags, so a just-marked activity
  // shows its tick without waiting for a refetch. Reset when the learner changes.
  const [done, setDone] = useState<{ identity: string; ids: Set<string> }>({ identity, ids: new Set() });
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState('');
  const doneIds = done.identity === identity ? done.ids : null;
  const isDone = (activity: FreeCourseActivity) => Boolean(activity.completed) || Boolean(doneIds?.has(activity.componentId));
  const complete = (componentId: string) => {
    if (!kind || !id || completingId) return;
    setCompletingId(componentId);
    setCompleteError('');
    markFreeCourseActivityComplete(kind, id, componentId)
      .then(() => setDone((previous) => {
        const ids = new Set(previous.identity === identity ? previous.ids : []);
        ids.add(componentId);
        return { identity, ids };
      }))
      .catch((failure) => setCompleteError(failure instanceof Error ? failure.message : 'Could not save. Please try again.'))
      .finally(() => setCompletingId((current) => (current === componentId ? null : current)));
  };
  // A passed quiz is already recorded server-side by the submit endpoint, so this
  // only needs to reflect it in the local overlay (no extra POST).
  const noteDone = (componentId: string) => setDone((previous) => {
    const ids = new Set(previous.identity === identity ? previous.ids : []);
    ids.add(componentId);
    return { identity, ids };
  });

  // Stable per-course colour, independent of display order.
  const tones = useMemo(() => new Map(
    [...(courses ?? [])].sort((a, b) => a.freeCourseId.localeCompare(b.freeCourseId))
      .map((course, index) => [course.freeCourseId, CARD_TONES[index % CARD_TONES.length]] as const),
  ), [courses]);

  const active = selected ? courses?.find((course) => course.freeCourseId === selected) : undefined;

  if (loading) return <FreeCoursesSkeleton />;
  if (error) return <Panel><EmptyState size="sm" variant="error" title={error} action={<EmptyStateAction label="Retry" onClick={() => setRetry((value) => value + 1)} />} /></Panel>;
  if (!courses?.length) return <Panel><EmptyState size="sm" title="No free courses yet" description="Free courses assigned to you will appear here." /></Panel>;

  if (selected && !active) {
    return <Panel><EmptyState size="sm" title="Course not available" description="This free course is no longer assigned to you." action={<EmptyStateAction label="Show your free courses" onClick={() => select()} />} /></Panel>;
  }

  if (active) {
    return (
      <FreeCourseDetail
        course={active}
        tone={tones.get(active.freeCourseId) ?? 'purple'}
        kind={kind as LearnerKind}
        learnerId={id as string}
        activeId={activeActivity}
        isDone={isDone}
        onSelect={(componentId) => select(active.freeCourseId, componentId)}
        onComplete={complete}
        onQuizPassed={noteDone}
        completingId={completingId}
        completeError={completeError}
        onBack={() => select()}
      />
    );
  }

  return (
    <section className={`${styles.workspace} space-y-5`} aria-label="Your free courses">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">My learning</p>
        <h2 className="mt-1 text-2xl font-bold text-foreground-900">Free courses</h2>
        <p className="mt-1 text-sm text-foreground-500">Courses assigned to you, outside your programme. No hours or targets — explore them any time.</p>
      </header>
      <div className={styles.freeGrid}>
        {courses.map((course) => (
          <FreeCourseCard key={course.freeCourseId} course={course} tone={tones.get(course.freeCourseId) ?? 'purple'} isDone={isDone} onOpen={() => select(course.freeCourseId)} />
        ))}
      </div>
    </section>
  );
}
