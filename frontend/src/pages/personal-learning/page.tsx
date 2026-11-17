import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, GraduationCap, Info, Play, RefreshCw, UserRoundCheck } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from "@/hooks/useAuth";
import { personalLearningJson, rememberPersonalLearning } from '@/lib/personalLearning';
import motion from '@/pages/users/presentation/EnrolmentMotion.module.css';
import styles from './courses.module.css';

interface Course {
  id: string; moduleId: string; title: string; progressPercent?: number;
  trackableTotal?: number; trackableDone?: number; blocked?: boolean; startDate?: string; unavailable?: boolean;
  reviewCoach?: string; reviewCoachIsSelf?: boolean;
}
export default function PersonalCoursesPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const accountId = auth.account?.id;
  const allowed = auth.account?.role === 'admin';
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setCourses(null); setError('');
    personalLearningJson<{ courses: Course[] }>('courses/')
      .then(data => { if (!cancelled) setCourses(data.courses); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load your courses.'); });
    return () => { cancelled = true; };
  }, [accountId, allowed, reload]);
  const nav = roleNavMap.admin;
  return <WorkspaceShell role="admin" roleLabel={nav.label} navItems={nav.items} pageTitle="My Courses" pageSubtitle="Your personal learning" userRole="Admin · Learner">
    <div className={`${motion.page} ${styles.page}`}>
      <header className={`${styles.hero} ${motion.cardEnter}`}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><GraduationCap size={16} aria-hidden="true" />Your personal learning space</span>
          <h1>Make time for your growth.</h1>
          <p>Explore your courses, build your knowledge and pick up where you left off.</p>
          <span className={styles.heroBadge}><BookOpen size={15} aria-hidden="true" />Learn at your own pace</span>
        </div>
      </header>
      <section aria-labelledby="personal-courses-heading">
        <div className={styles.sectionHeading}>
          <div><h2 id="personal-courses-heading">My courses</h2><p>Your next step starts here.</p></div>
          {allowed && courses && !error && <span className={styles.courseCount}>{courses.length} {courses.length === 1 ? 'course' : 'courses'}</span>}
        </div>
        {!allowed ? <div className={styles.state} role="alert">Sign in as an administrator to view personal courses.</div> : error ? <div className={styles.state} role="alert"><Info size={26} aria-hidden="true" /><h3>Your courses could not be loaded</h3><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)} className={styles.button}><RefreshCw size={16} aria-hidden="true" />Try again</button></div>
          : !courses ? <div className={styles.state} role="status"><BookOpen size={26} aria-hidden="true" /><p><LoadingSkeleton label="Loading your courses…" variant="rows" /></p></div>
            : !courses.length ? <div className={styles.state}><BookOpen size={30} aria-hidden="true" /><h3>No personal courses yet</h3><p>Courses you have joined as a learner appear here. Module Builder's “Preview as learner” is a read-only preview and does not add a course.</p></div>
              : <div className={`${motion.staggerCards} ${styles.cards}`}>{courses.map(course => <article key={course.id} className={styles.course} aria-label={course.title}>
                <div className={styles.cover}>
                  <img src="/assets/enrolment-course-cover.webp" alt="" width={960} height={560} />
                  <span className={styles.coverBadge}><GraduationCap size={14} aria-hidden="true" />Personal learning</span>
                  <span className={styles.coverIcon}><BookOpen size={28} aria-hidden="true" /></span>
                </div>
                <div className={styles.courseBody}>
                  <span className={styles.courseEyebrow}>Your learning journey</span>
                  <h3>{course.title}</h3>
                  {course.unavailable ? <p className={styles.unavailable}>This course is no longer available. Your saved records are retained.</p> : <>
                    <div className={styles.progressLabel}><span>{course.trackableDone} of {course.trackableTotal} activities completed</span><strong>{course.progressPercent}%</strong></div>
                    <progress aria-label={`${course.title} progress`} value={course.progressPercent} max={100} />
                    <div className={styles.notices}>
                      <p><UserRoundCheck size={17} aria-hidden="true" /><span>{course.reviewCoachIsSelf ? 'Your coursework needs another coach to review it. Check the course group assignment.' : course.reviewCoach ? `Coursework reviewed by ${course.reviewCoach}` : 'Assign a coach to this course group before coursework can be reviewed.'}</span></p>
                      {course.blocked && <p><CalendarDays size={17} aria-hidden="true" /><span>{course.startDate ? `Starts ${course.startDate}` : 'The cohort start date needs confirmation.'}</span></p>}
                    </div>
                    <button type="button" className={`${styles.button} ${styles.continue}`} onClick={() => {
                      rememberPersonalLearning(course.id, '/my-courses'); navigate(`/learner/my-learning/commercial/${encodeURIComponent(course.id)}`);
                    }}><Play size={15} aria-hidden="true" />Continue learning<ArrowRight size={17} aria-hidden="true" /></button></>}
                </div>
              </article>)}</div>}
      </section>
      <p className={styles.privacyNote}><Info size={18} aria-hidden="true" /><span>Study using the learner's course pages. Your personal progress and certificates stay separate from official study reports and Teams invitations.</span></p>
    </div>
  </WorkspaceShell>;
}
