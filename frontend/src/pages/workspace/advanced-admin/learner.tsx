import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { advancedAdminLearner, advancedAdminLearning, advancedAdminModuleProgress, advancedAdminWordPressCourses, type AdvancedAdminLearner, type AdvancedAdminModuleProgress, type AdvancedAdminWordPressCourse } from '@/api/advancedAdmin';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { LearnerDetail } from '@/api/learnerDetail';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import ReadOnlyLearning from './ReadOnlyLearning';
import LearnerModuleProgress from './LearnerModuleProgress';
import InclusionDashboard from './InclusionDashboard';
import ReviewSections, { type RecordTab } from './ReviewSections';
import { assignedAssessments } from './learningAssignments';
import { isLearnerSection, learnerNavigation, learnerSectionHref, sections } from './learnerNavigation';
import { achievedWordPressCourses } from './wordpressLearning';

const nav = roleNavMap['advanced-admin'];

function ModuleProgressPreview({ progress }: { progress: AdvancedAdminModuleProgress }) {
  return <section aria-label="Available module metrics" className="space-y-3 rounded-xl border border-primary-100 bg-white p-5">
    <div><h3 className="text-lg font-semibold text-primary-950">Module progress</h3>
      <p className="mt-1 text-sm text-primary-700">Training plan metrics are ready. Verified course activities are still loading.</p></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{progress.modules.map(module => {
      const metrics = progress.moduleProgress?.[module.id];
      return <div key={module.id} className="rounded-lg border border-primary-100 bg-primary-50/40 p-3 text-sm">
        <strong className="block text-primary-950">{module.title}</strong>
        <span className="mt-1 block text-primary-700">Recorded OTH: {metrics?.hours.actual == null ? 'N/A' : `${metrics.hours.actual}h`}</span>
        <span className="block text-primary-700">KSBs: {metrics?.ksb.completed ?? 'N/A'} / {metrics?.ksb.total ?? 'N/A'}</span>
      </div>;
    })}</div>
    {progress.modules.length === 0 && <p className="text-sm text-foreground-500">No modules are assigned.</p>}
  </section>;
}

export default function AdvancedAdminLearnerPage() {
  const { learnerId, section: pathSection } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = Number(learnerId);
  const requestedSection = searchParams.get('section');
  const selectedSection = isLearnerSection(pathSection) ? pathSection
    : isLearnerSection(requestedSection) ? requestedSection : 'learning';
  const learningView = searchParams.get('view') === 'courses' ? 'courses' : 'progress';
  const sectionNavigation = useMemo(() => Number.isSafeInteger(id) && id > 0 ? learnerNavigation(id) : nav.items, [id]);
  const previousSection = useRef(selectedSection);
  const sectionHeading = useRef<HTMLHeadingElement>(null);
  const verifiedCoursesCache = useRef<{ learnerId: number; retry: number; courses: AdvancedAdminWordPressCourse[] } | null>(null);
  const { auth } = useAuth();
  const [learner, setLearner] = useState<AdvancedAdminLearner | null>(null);
  const [learning, setLearning] = useState<{ current: LearnerDetail; historical: StudentActivityResponse } | null>(null);
  const [moduleProgress, setModuleProgress] = useState<AdvancedAdminModuleProgress | null>(null);
  const [wordpressCourses, setWordpressCourses] = useState<AdvancedAdminWordPressCourse[] | null>(null);
  const [wordpressError, setWordpressError] = useState('');
  const [wordpressRetry, setWordpressRetry] = useState(0);
  const [activitySelection, setActivitySelection] = useState<{ subjectId: string; activityId: string } | null>(null);
  const [error, setError] = useState('');
  const [learningError, setLearningError] = useState('');
  const [progressError, setProgressError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0 || isLearnerSection(pathSection)) return;
    const keepCourseView = !pathSection && selectedSection === 'learning' && learningView === 'courses';
    navigate(`${learnerSectionHref(id, selectedSection)}${keepCourseView ? '?view=courses' : ''}`, { replace: true });
  }, [id, pathSection, selectedSection, learningView, navigate]);

  useEffect(() => {
    if (previousSection.current === selectedSection) return;
    previousSection.current = selectedSection;
    if (selectedSection === 'reviews') document.getElementById('advanced-student-reviews-heading')?.focus();
    else if (selectedSection === 'assessments') document.getElementById('advanced-assessments')?.focus();
    else sectionHeading.current?.focus();
  }, [selectedSection]);

  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0) { setError('Invalid learner.'); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setLearner(null); setLearning(null); setModuleProgress(null); setActivitySelection(null);
    setError(''); setLearningError(''); setProgressError('');
    advancedAdminLearner(id, controller.signal)
      .then(result => { setLearner(result.learner); setError(''); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load learner.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    advancedAdminLearning(id, controller.signal)
      .then(result => { setLearning(result); setLearningError(''); })
      .catch(failure => { if (!controller.signal.aborted) setLearningError(failure instanceof Error ? failure.message : 'Could not load learning.'); });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0 || selectedSection !== 'learning' || learningView !== 'progress'
        || moduleProgress || progressError) return;
    const controller = new AbortController();
    advancedAdminModuleProgress(id, controller.signal)
      .then(result => { if (!controller.signal.aborted) setModuleProgress(result.progress); })
      .catch(failure => { if (!controller.signal.aborted) setProgressError(
        failure instanceof Error ? failure.message : 'Could not load module progress.'); });
    return () => controller.abort();
  }, [id, selectedSection, learningView, moduleProgress, progressError]);

  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0 || selectedSection !== 'learning') return;
    if (verifiedCoursesCache.current?.learnerId === id && verifiedCoursesCache.current.retry === wordpressRetry) {
      setWordpressCourses(verifiedCoursesCache.current.courses);
      setWordpressError('');
      return;
    }
    const controller = new AbortController();
    setWordpressCourses(null); setWordpressError('');
    advancedAdminWordPressCourses(id, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          verifiedCoursesCache.current = { learnerId: id, retry: wordpressRetry, courses: result.courses };
          setWordpressCourses(result.courses);
        }
      })
      .catch(failure => { if (!controller.signal.aborted) setWordpressError(
        failure instanceof Error ? failure.message : 'Could not load verified WordPress courses.'); });
    return () => controller.abort();
  }, [id, selectedSection, wordpressRetry]);

  const assigned = useMemo(() => learning ? assignedAssessments(learning) : [], [learning]);
  const achievedCourses = useMemo(() => wordpressCourses
    ? achievedWordPressCourses(wordpressCourses) : null, [wordpressCourses]);

  return <WorkspaceShell role="advanced-admin" roleLabel={nav.label} navItems={sectionNavigation}
    workspaceLabel={nav.workspaceLabel} pageTitle={sections[selectedSection].title}
    pageSubtitle={selectedSection === 'assessments' ? 'View assignments by plan month and Additional Job Activity files by upload month.' : learner ? `${learner.programmeCode} · ${learner.programme}` : 'Learner review'}
    userName={auth.account?.displayName || undefined} userRole="Advanced Admin">
    <div className="mx-auto max-w-[1840px] space-y-5">
      {selectedSection !== 'learning' && selectedSection !== 'inclusion' && <Link to={selectedSection === 'reviews' || selectedSection === 'assessments' ? learnerSectionHref(id, 'learning') : '/workspace/advanced-admin'} className={`${selectedSection === 'assessments' ? 'ml-auto flex w-fit rounded-lg border border-[#cbd8ef] bg-white px-4 py-2' : 'inline-flex'} items-center gap-2 text-sm font-semibold text-primary-700 hover:underline`}><ArrowLeft size={16} />{selectedSection === 'reviews' || selectedSection === 'assessments' ? 'Back to Student Profile' : 'All learners'}</Link>}
      {loading && <p className="rounded-xl border border-foreground-200 bg-white p-5">Loading learner…</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</p>}
      {learner && <>
        {selectedSection !== 'learning' && selectedSection !== 'reviews' && selectedSection !== 'inclusion' && selectedSection !== 'assessments' && <div className="rounded-2xl border border-foreground-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="text-xl font-semibold text-foreground-900">Learner file</h2>
              <p className="mt-1 text-sm text-foreground-600">Choose a section to review this learner's records.</p></div>
          </div>
          <dl className="mt-5 grid gap-3 border-t border-foreground-100 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div><dt className="text-foreground-500">Programme</dt><dd className="font-semibold">{learner.programme}</dd></div>
            <div><dt className="text-foreground-500">Group</dt><dd className="font-semibold">{learner.group || 'Not recorded'}</dd></div>
            <div><dt className="text-foreground-500">Coach</dt><dd className="font-semibold">{learner.coach || 'Not recorded'}</dd></div>
            <div><dt className="text-foreground-500">Status</dt><dd className="font-semibold">{learner.programmeStatus || 'Not recorded'}</dd></div>
          </dl>
        </div>}
        <div className="min-w-0 space-y-4 scroll-mt-4" id="advanced-section-content">
            {selectedSection !== 'reviews' && selectedSection !== 'inclusion' && selectedSection !== 'assessments' && <div className="rounded-2xl border border-foreground-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Learner record</p>
              <h2 ref={sectionHeading} tabIndex={-1} className="mt-1 text-xl font-semibold text-foreground-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600">{sections[selectedSection].title}</h2>
              <p className="mt-1 text-sm text-foreground-600">{sections[selectedSection].description}</p>
            </div>}
            {selectedSection === 'learning' && <section className="space-y-4" aria-label="Learning and progress">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground-200 bg-white p-3">
                <div className="flex gap-2" role="tablist" aria-label="Learning views">
                  <Link role="tab" aria-selected={learningView === 'progress'} to={learnerSectionHref(id, 'learning')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${learningView === 'progress' ? 'bg-primary-700 text-white' : 'text-primary-700 hover:bg-primary-50'}`}>Module Progress</Link>
                  <Link role="tab" aria-selected={learningView === 'courses'} to={`${learnerSectionHref(id, 'learning')}?view=courses`} onClick={() => setActivitySelection(null)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${learningView === 'courses' ? 'bg-primary-700 text-white' : 'text-primary-700 hover:bg-primary-50'}`}>Courses &amp; Activities</Link>
                </div>
              </div>
              {learningError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">{learningError}</p>}
              {learningView === 'courses' && !learning && !learningError && <p role="status" className="rounded-xl border border-foreground-200 bg-white p-5">Loading learning…</p>}
              {wordpressError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <p>{wordpressError} Course progress needs a verified WordPress match.</p>
                <button type="button" onClick={() => setWordpressRetry(value => value + 1)} className="mt-2 font-semibold underline">Try again</button>
              </div>}
              {!achievedCourses && !wordpressError && ((learningView === 'courses' && learning) ||
                (learningView === 'progress' && moduleProgress)) && <p role="status" className="rounded-xl border border-foreground-200 bg-white p-5">Verifying course activities. Available records will appear first.</p>}
              {learningView === 'progress' && progressError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">{progressError}</p>}
              {learningView === 'progress' && !moduleProgress && !progressError && <p role="status" className="rounded-xl border border-foreground-200 bg-white p-5">Loading module progress…</p>}
              {learningView === 'progress' && moduleProgress && (!learning || !achievedCourses) &&
                <ModuleProgressPreview progress={moduleProgress} />}
              {learningView === 'progress' && learning && moduleProgress && achievedCourses && <LearnerModuleProgress key={id} learner={learner} learning={learning} progress={moduleProgress} wordpressCourses={achievedCourses}
                onOpenActivity={(subjectId, activityId) => { setActivitySelection({ subjectId, activityId }); navigate(`${learnerSectionHref(id, 'learning')}?view=courses`); }} />}
              {learningView === 'courses' && learning && <ReadOnlyLearning key={`${id}:${activitySelection?.subjectId || ''}:${activitySelection?.activityId || ''}`}
                learnerId={id} learning={learning} wordpressCourses={achievedCourses || []} initialSelection={activitySelection} />}
            </section>}
            {selectedSection === 'inclusion' && <InclusionDashboard key={id} learnerId={id} learner={learner} />}
            {selectedSection !== 'learning' && selectedSection !== 'inclusion' && <ReviewSections key={id} learnerId={id} learner={learner} assigned={assigned} selectedTab={selectedSection as RecordTab} showTabs={false} />}
          </div>
      </>}
    </div>
  </WorkspaceShell>;
}
