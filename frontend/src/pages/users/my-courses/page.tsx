import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, CirclePlay, GraduationCap, Info, ListTree, RefreshCw, UserRoundCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';
import { personalLearningJson, rememberPersonalLearning } from '@/lib/personalLearning';
import { useMyLearningModule } from '@/api/myLearning';
import { EnrolmentWorkspaceShell } from '../presentation/EnrolmentWorkspaceShell';
import { EnrolmentBreadcrumbs } from '../presentation/EnrolmentBreadcrumbs';
import frame from '../presentation/EnrolmentWorkspace.module.css';
import motion from '../presentation/EnrolmentMotion.module.css';
import styles from './courses.module.css';

interface Course {
  id: string; moduleId: string; title: string; progressPercent?: number;
  trackableTotal?: number; trackableDone?: number; blocked?: boolean; startDate?: string; unavailable?: boolean;
  reviewCoach?: string; reviewCoachIsSelf?: boolean;
}
const returnTo = '/users/my-courses';
const count = (value: number | undefined): value is number => Number.isSafeInteger(value) && value! >= 0;
const progress = (course: Course) => Number.isFinite(course.progressPercent) && course.progressPercent! >= 0 && course.progressPercent! <= 100 ? course.progressPercent : undefined;
const activityCount = (course: Course) => !course.unavailable && count(course.trackableDone) && count(course.trackableTotal) && course.trackableDone <= course.trackableTotal;

function CourseCard({ course, onContinue }: { course: Course; onContinue: (course: Course) => void }) {
  const [expanded, setExpanded] = useState(false);
  const outline = useMyLearningModule('commercial', course.id, expanded && !course.unavailable ? `current:${course.moduleId}` : null);
  const percent = progress(course);
  const activities = outline.data?.detail.components ?? [];
  const weeks = [...new Set(activities.map(activity => activity.week || 'Course activities'))];
  return <article className={styles.course} aria-label={course.title}>
    <div className={styles.cover}><span><UserRoundCheck size={13} aria-hidden="true" />Personal learning</span></div>
    <div className={styles.courseBody}>
      <h2>{course.title}</h2>
      {course.unavailable ? <p>This course is no longer available. Your saved records are retained.</p> : <>
        <p>Work through your course at your own pace. Your progress is saved to your personal learning record.</p>
        <div className={styles.chips}><span><BookOpen size={12} aria-hidden="true" />{count(course.trackableTotal) ? `${course.trackableTotal} activities` : 'Activities not provided'}</span><span><GraduationCap size={12} aria-hidden="true" />Personal course</span></div>
        <div className={styles.progressLabel}><span>{activityCount(course) ? `${course.trackableDone} of ${course.trackableTotal} activities completed` : 'Activity progress unavailable'}</span><strong>{percent === undefined ? '—' : `${percent}%`}</strong></div>
        {percent !== undefined && <progress max={100} value={percent} aria-label={`${course.title} progress`} />}
        <div className={styles.next}><CirclePlay size={17} aria-hidden="true" /><div><small>Your next step</small><strong>{percent === 100 ? 'Review your completed course' : 'Continue where you left off'}</strong><p>Open your course to view activities and available certificates.</p></div></div>
        <p className={styles.warning}><UserRoundCheck size={14} aria-hidden="true" />{course.reviewCoachIsSelf ? 'Your coursework needs another coach to review it. Check the course group assignment.' : course.reviewCoach ? `Coursework reviewed by ${course.reviewCoach}` : 'Assign a coach to this course group before coursework can be reviewed.'}</p>
        {course.blocked && <p className={styles.warning}><CalendarDays size={14} aria-hidden="true" />{course.startDate ? `Starts ${course.startDate}` : 'The cohort start date needs confirmation.'}</p>}
        <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => onContinue(course)}><CirclePlay size={14} aria-hidden="true" />Continue learning<span className="sr-only">: {course.title}</span></button></div>
        <details className={styles.outline} onToggle={event => setExpanded(event.currentTarget.open)}>
          <summary><ListTree size={14} aria-hidden="true" />Course outline</summary>
          {expanded && <div className={styles.outlineBody}>
            {outline.loading ? <p role="status">Loading course outline…</p> : outline.error ? <div role="alert"><p>{outline.error}</p><button type="button" className={styles.button} onClick={outline.refresh}>Try again</button></div> : outline.data ? <>
              <p>Nothing here counts towards official study reports.</p>
              {weeks.map(week => <section key={week}><h3>{week}</h3><ul>{activities.filter(activity => (activity.week || 'Course activities') === week).map((activity, index) => <li key={`${activity.componentId ?? activity.component}:${index}`}><BookOpen size={13} aria-hidden="true" /><span>{activity.component}</span></li>)}</ul></section>)}
              {!activities.length && <p>No activities are available in this course yet.</p>}
            </> : null}
          </div>}
        </details>
      </>}
    </div>
  </article>;
}

/** Readdy V488 /enrolment/my-courses, backed by the existing personal-course read. */
export default function EnrolmentCoursesPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<{ accountId?: number; courses: Course[] | null; error: string }>({ courses: null, error: '' });
  const [version, setVersion] = useState(0);
  const accountId = auth.account?.id;
  const allowed = auth.account?.role === 'admin';
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setState({ accountId, courses: null, error: '' });
    personalLearningJson<{ courses: Course[] }>('courses/', { signal: controller.signal })
      .then(data => {
        if (!Array.isArray(data.courses)) throw new Error('Your courses could not be read. Please try again.');
        if (!controller.signal.aborted) setState({ accountId, courses: data.courses, error: '' });
      })
      .catch(error => { if (!controller.signal.aborted) setState({ accountId, courses: null, error: error instanceof Error ? error.message : 'Could not load your courses.' }); });
    return () => controller.abort();
  }, [accountId, allowed, version]);
  const courses = allowed && state.accountId === accountId ? state.courses : null;
  const error = allowed && state.accountId === accountId ? state.error : '';
  const known = courses !== null && courses.every(activityCount);
  const total = known ? courses.reduce((sum, course) => sum + course.trackableTotal!, 0) : null;
  const done = known ? courses.reduce((sum, course) => sum + course.trackableDone!, 0) : null;
  const percent = total && done !== null ? Math.round(done / total * 100) : null;
  const completed = courses?.every(course => !course.unavailable && progress(course) !== undefined)
    ? courses.filter(course => progress(course) === 100 && (course.trackableTotal ?? 0) > 0).length : null;
  const next = courses?.find(course => !course.unavailable && progress(course) !== 100) ?? courses?.find(course => !course.unavailable);
  const nav = roleNavMap.apprentice;
  const open = (course: Course) => {
    rememberPersonalLearning(course.id, returnTo);
    navigate(`/learner/my-learning/commercial/${encodeURIComponent(course.id)}`);
  };
  return <EnrolmentWorkspaceShell role="compliance" roleLabel={nav.label} navItems={nav.items} workspaceLabel="Enrolment"
    pageTitle="My Courses" pageSubtitle="Your personal learning" directoryLayout hideBreadcrumbs showBackButton={false}>
    <div className={`${frame.page} ${motion.page} ${styles.page}`}>
      <header className={`${frame.hero} ${styles.hero} ${motion.cardEnter}`} style={{ '--enrolment-hero-image': "url('/assets/enrolment-my-courses-banner.png')" } as CSSProperties}>
        <div className={frame.heroCopy}>
          <EnrolmentBreadcrumbs current="My Courses" />
          <p className={frame.eyebrow}><span className={styles.dot} />Enrolment workspace</p>
          <h1>My Courses</h1>
          <p className={frame.heroDescription}>Your personal learning. Study using the learner’s course pages — your personal progress and certificates stay separate from official study reports and Teams invitations.</p>
          <div className={styles.heroSummary}><span><BookOpen size={13} aria-hidden="true" />{courses ? `${courses.length} personal ${courses.length === 1 ? 'course' : 'courses'}` : 'Personal courses'}</span>{done !== null && total !== null && <span>{done} of {total} activities completed</span>}{percent !== null && <small>{percent}% complete</small>}</div>
          {allowed && <div className={frame.heroActions}><a href="#personal-courses"><BookOpen size={14} aria-hidden="true" />View your courses</a>{next && <button type="button" onClick={() => open(next)}><CirclePlay size={14} aria-hidden="true" />Continue learning</button>}<button type="button" aria-label="Refresh personal courses" onClick={() => setVersion(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />Refresh</button></div>}
        </div>
      </header>
      {!allowed ? <div className={styles.state} role="alert">Sign in as an administrator to view personal courses.</div> : error ? <div className={styles.state} role="alert"><h2>Your courses could not be loaded</h2><p>{error}</p><button type="button" className={styles.button} onClick={() => setVersion(value => value + 1)}>Try again</button></div> : !courses ? <div className={styles.state} role="status">Loading your courses…</div> : <>
        <dl className={`${styles.stats} ${motion.staggerCards}`}>
          {[['Personal courses', courses.length, 'Assigned to you, not to a cohort'], ['Activities completed', done !== null ? `${done} / ${total}` : '—', done === null ? 'Activity totals unavailable' : done ? 'Saved to your personal record' : 'Nothing completed yet'], ['Overall completion', percent !== null ? `${percent}%` : '—', total === 0 ? 'No activities available yet' : 'Across your personal course activities'], ['Courses completed', completed ?? '—', 'Your personal learning progress']].map(([label, value, hint]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><p>{hint}</p></div>)}
        </dl>
        <section id="personal-courses" aria-label="Personal courses" className={`${styles.cards} ${motion.staggerCards}`}>
          {!courses.length && <div className={styles.state}><BookOpen size={30} aria-hidden="true" /><h2>No personal courses yet</h2><p>Courses you have joined as a learner appear here. Previewing a course does not add it to your personal learning.</p></div>}
          {courses.map(course => <CourseCard key={course.id} course={course} onContinue={open} />)}
          <aside className={styles.more}><span className={styles.moreIcon}><BookOpen size={20} aria-hidden="true" /></span><h2>Your own learning space</h2><p>Work through your personal courses at your own pace. Your saved activities and available certificates stay with your account.</p><p>Use a course’s outline to see its content, or continue learning to return to the learner’s course pages.</p><a className={styles.button} href="#personal-courses"><ArrowRight size={14} aria-hidden="true" />Explore your courses</a></aside>
        </section>
      </>}
      <p className={styles.notice}><Info size={16} aria-hidden="true" /><span>Personal learning stays outside the apprenticeship record. Completing activities here never changes learner progress, KSB coverage, funding evidence or reward points, and it is not included in official study reports or Teams invitations.</span></p>
    </div>
  </EnrolmentWorkspaceShell>;
}
