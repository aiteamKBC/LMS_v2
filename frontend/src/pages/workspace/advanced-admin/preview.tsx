import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { advancedAdminLearner, advancedAdminLearning, type AdvancedAdminLearner } from '@/api/advancedAdmin';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { LearnerDetail } from '@/api/learnerDetail';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import ReadOnlyLearning from './ReadOnlyLearning';
import ReviewSections, { type RecordTab } from './ReviewSections';
import { assignedAssessments } from './learningAssignments';
import { previewNavigation, previewSection } from './previewNavigation';
import { PreviewCalendar, PreviewCompliance, PreviewEnrolment, PreviewHome, PreviewMessages, PreviewMonthlyLogs } from './PreviewExtra';

const tabForSection: Record<string, RecordTab> = {
  'monthly-submission': 'assessments',
  'monthly-coaching': 'reviews', 'progress-reviews': 'reviews', 'reviews': 'reviews',
  'attendance': 'lectures', 'evidence': 'evidence',
};
const titleForSection: Record<string, string> = {
  home: 'Home', dashboard: 'Dashboard', learning: 'My Learning',
  'monthly-submission': 'Monthly Submission', 'monthly-logs': 'Monthly Logs',
  'monthly-coaching': 'Monthly Coaching Meeting', 'progress-reviews': 'Progress Review',
  reviews: 'Reviews', attendance: 'Attendance', evidence: 'Evidence',
  calendar: 'Calendar', enrolment: 'My Enrolment', compliance: 'Compliance documents',
  messages: 'Messages',
};

export default function AdvancedAdminLearnerPreview() {
  const { learnerId, section: requestedSection } = useParams();
  const id = Number(learnerId);
  const section = previewSection(requestedSection);
  const { auth } = useAuth();
  const [learner, setLearner] = useState<AdvancedAdminLearner | null>(null);
  const [learning, setLearning] = useState<{ current: LearnerDetail; historical: StudentActivityResponse } | null>(null);
  const [error, setError] = useState('');
  const [learningError, setLearningError] = useState('');
  const navigation = useMemo(() => previewNavigation(id), [id]);
  const assigned = useMemo(() => learning ? assignedAssessments(learning) : [], [learning]);

  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0) { setError('Invalid learner.'); return; }
    const controller = new AbortController();
    setLearner(null); setLearning(null); setError(''); setLearningError('');
    advancedAdminLearner(id, controller.signal)
      .then(result => { if (!controller.signal.aborted) setLearner(result.learner); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load learner preview.'); });
    advancedAdminLearning(id, controller.signal)
      .then(result => { if (!controller.signal.aborted) setLearning(result); })
      .catch(failure => { if (!controller.signal.aborted) setLearningError(failure instanceof Error ? failure.message : 'Could not load learning.'); });
    return () => controller.abort();
  }, [id]);

  const needsLearning = ['home', 'dashboard', 'learning', 'calendar'].includes(section);
  return <WorkspaceShell role="learner" roleLabel="Advanced Admin" navItems={navigation} filterLearnerNavigation={false}
    workspaceLabel="Read-only learner view" pageTitle={learner ? `${learner.name} · ${titleForSection[section]}` : 'Learner view'}
    pageSubtitle="The learner's saved records across the learner menu"
    userName={auth.account?.displayName || undefined} userRole="Advanced Admin">
    <div className="mx-auto max-w-[1840px] space-y-5">
      <Link to={`/workspace/advanced-admin/learners/${id}/learning`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700 hover:underline"><ArrowLeft size={16} />Back to learner record</Link>
      <p className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm text-primary-900"><LockKeyhole size={17} aria-hidden="true" />Read-only learner view. Submitting, signing, attendance updates and sending messages are disabled.</p>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</p>}
      {!learner && !error && <p role="status" className="rounded-xl border bg-white p-5">Loading learner…</p>}
      {learner && <>
        {needsLearning && learningError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{learningError}</p>}
        {needsLearning && !learning && !learningError && <p role="status" className="rounded-xl border bg-white p-5">Loading learning…</p>}
        {learning && (section === 'home' || section === 'dashboard') && <PreviewHome learning={learning} />}
        {learning && section === 'learning' && <ReadOnlyLearning key={id} learnerId={id} learning={learning} />}
        {learning && section === 'calendar' && <PreviewCalendar learnerId={id} learning={learning} />}
        {tabForSection[section] && <ReviewSections key={`${id}:${section}`} learnerId={id} assigned={assigned} readOnly
          initialTab={tabForSection[section]} showTabs={false}
          reviewFamily={section === 'monthly-coaching' ? 'mcm' : section === 'progress-reviews' ? 'pr' : undefined} />}
        {section === 'enrolment' && <PreviewEnrolment learnerId={id} />}
        {section === 'monthly-logs' && <PreviewMonthlyLogs learnerId={id} />}
        {section === 'compliance' && <PreviewCompliance learnerId={id} />}
        {section === 'messages' && <PreviewMessages learnerId={id} />}
      </>}
    </div>
  </WorkspaceShell>;
}
