import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { personalLearningJson, rememberPersonalLearning } from '@/lib/personalLearning';

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
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <p className="text-sm text-foreground-600">Study using the learner's course pages. Your personal progress and certificates stay separate from official study reports and Teams invitations.</p>
      {!allowed ? <p role="alert">Sign in as an administrator to view personal courses.</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => setReload(value => value + 1)} className="mt-3 rounded-lg border px-4 py-2">Try again</button></div>
        : !courses ? <p role="status">Loading your courses…</p>
          : !courses.length ? <div className="rounded-xl border bg-white p-6"><h2 className="font-semibold">No personal courses yet</h2><p className="mt-2 text-sm">Open a module and choose “Preview as learner”, then “Confirm and join as a learner”.</p></div>
            : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{courses.map(course => <article key={course.id} className="rounded-2xl border bg-white p-5 shadow-sm">
              <span className="text-xs font-bold uppercase text-primary-700">Personal learning</span><h2 className="mt-2 text-lg font-bold">{course.title}</h2>
              {course.unavailable ? <p className="mt-4 text-sm">This course is no longer available. Your saved records are retained.</p> : <>
                <p className="mt-4 text-sm">{course.trackableDone} of {course.trackableTotal} activities completed · {course.progressPercent}%</p>
                <progress aria-label={`${course.title} progress`} className="mt-2 w-full" value={course.progressPercent} max={100} />
                <p className="mt-2 text-sm">{course.reviewCoachIsSelf ? 'Your coursework needs another coach to review it. Check the course group assignment.' : course.reviewCoach ? `Coursework reviewed by ${course.reviewCoach}` : 'Assign a coach to this course group before coursework can be reviewed.'}</p>
                {course.blocked && <p className="mt-2 text-sm">{course.startDate ? `Starts ${course.startDate}` : 'The cohort start date needs confirmation.'}</p>}
                <button className="mt-5 rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white" onClick={() => {
                  rememberPersonalLearning(course.id, '/my-courses'); navigate(`/learner/my-learning/commercial/${encodeURIComponent(course.id)}`);
                }}>Continue learning</button></>}
            </article>)}</div>}
    </div>
  </WorkspaceShell>;
}
