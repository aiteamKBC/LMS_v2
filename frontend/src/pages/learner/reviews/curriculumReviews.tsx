import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerMeetingArtifacts, learnerMeetingArtifactContentUrl, saveLearnerEventReviewAnswers, signLearnerProgressReview, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { useLinkedLearner } from '@/hooks/useMyLearner';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { useReviewSessions } from './useReviewSessions';
import { useMeetingAttendance } from './useMeetingAttendance';
import { useMeetingBooking } from './useMeetingBooking';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { useCoachingReviewDefinitions } from '../monthly-coaching/useCoachingReviewDefinitions';
import { LearnerReviewInstanceForm, useLearnerReviewInstance } from './LearnerReviewInstanceForm';
import ReviewsHome from '../progress-reviews/ReviewsHome';
import { reviewsListHref } from '../progress-reviews/reviewPresentation';
import styles from '../progress-reviews/progressReviews.module.css';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { CoachMeetingArtifactsPanel } from '@/pages/coach/shared/CoachMeetingArtifactsPanel';
import AbsenceReportDialog from '../attendance/components/AbsenceReportDialog';
import AbsenceReportForm from '../attendance/components/AbsenceReportForm';

const learnerNav = roleNavMap.learner;
const basePath = '/learner/reviews';

function formatDate(value?: string | null): string {
  if (!value) return 'Date to be confirmed';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'Date to be confirmed' : date.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatTime(value?: string | null): string {
  if (!value) return 'Time to be confirmed';
  const [hour, minute] = value.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : 'Time to be confirmed';
}

export function curriculumReviewTitle(review?: LearnerCalendarEvent | null): string {
  if (!review) return 'Review';
  const name = review.title || review.reviewTypeName || 'Review';
  return review.reviewTemplateId && (review.occurrenceNumber || review.sequence)
    ? `${name} #${review.occurrenceNumber || review.sequence}` : name;
}

export function CurriculumReviewsListPage() {
  const learner = useLinkedLearner();
  return <CurriculumReviewsList key={`${learner.kind}:${learner.id}`} />;
}

function CurriculumReviewsList() {
  const { myLearner, learner, sessions, setEvents, bookingCalendar, loading, error, refresh } = useReviewSessions('review');
  const attendance = useMeetingAttendance(myLearner);
  const [absence, setAbsence] = useState<MeetingAttendance | null>(null);
  const signatures = useCoachingReviewDefinitions(myLearner.kind, myLearner.id, sessions);
  const booking = useMeetingBooking({
    learner: myLearner, rules: bookingCalendar, attendance: attendance.data?.sessions || [],
    titleOf: curriculumReviewTitle, setEvents, refresh: () => { refresh(); attendance.refresh(); },
  });

  return <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items}
    workspaceLabel={learnerNav.workspaceLabel} pageTitle="Reviews" pageSubtitle="Curriculum reviews and previous records"
    userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}>
    <main className="page-container min-w-0 w-full space-y-4 p-3 md:p-6">
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-700">{error}<button type="button" onClick={refresh} className="ml-3 min-h-12 font-bold underline">Try again</button></div>}
      {booking.notice}
      <ReviewsHome sessions={sessions} attendance={attendance.data?.sessions || []} definitions={signatures.definitions}
        learner={myLearner} lineManager={learner?.lineManager} today={attendance.data?.today || bookingCalendar?.today || new Date().toISOString().slice(0, 10)}
        timeZone={attendance.data?.timeZone} loading={loading} error={error} busy={Boolean(attendance.busy)} canAct={attendance.canAct}
        titleOf={curriculumReviewTitle} onSchedule={booking.openBooking} onAttend={attendance.attend} onReport={setAbsence} basePath={basePath}/>
      {booking.dialog}
      {absence?.absenceSessionId && absence.date && <AbsenceReportDialog onClose={() => setAbsence(null)}>
        <AbsenceReportForm key={absence.id} scope="meetings" compact showHistory={false}
          preselectMatch={{ id: absence.absenceSessionId, dateIso: absence.date, title: absence.title }}
          onSubmitted={() => attendance.refresh()} onCancel={() => setAbsence(null)} />
      </AbsenceReportDialog>}
    </main>
  </WorkspaceShell>;
}

export function CurriculumReviewPage() {
  const navigate = useNavigate();
  const [listParams] = useSearchParams();
  const { reviewId } = useParams<{ reviewId: string }>();
  const { myLearner, learner, sessions, setEvents, loading, error: loadError, refresh } = useReviewSessions('review');
  const { canProgress } = useLearnerWorkspaceAccess(myLearner.id);
  const [actionError, setActionError] = useState('');
  const selected = useMemo(() => sessions.find(review => review.id === reviewId || review.eventKey === reviewId) || null, [reviewId, sessions]);
  const eventKey = selected?.eventKey || '';
  const instance = useLearnerReviewInstance(myLearner.kind, myLearner.id, selected?.reviewTemplateId || selected?.reviewInstanceId ? eventKey : '');
  const error = loadError || actionError;

  useEffect(() => {
    if (!loading && reviewId && !selected) setActionError('This Curriculum Review could not be found.');
  }, [loading, reviewId, selected]);

  const loadArtifacts = useCallback((key: string, signal?: AbortSignal) => fetchLearnerMeetingArtifacts(myLearner.kind, myLearner.id, key, signal), [myLearner.kind, myLearner.id]);
  const artifactContentUrl = useCallback((key: string, type: string, id: string, options: { preview?: boolean } = {}) => learnerMeetingArtifactContentUrl(myLearner.kind, myLearner.id, key, type, id, options), [myLearner.kind, myLearner.id]);

  const saveSignature = async (signature: string) => {
    if (!selected || !canProgress) return;
    const result = await signLearnerProgressReview(myLearner.kind, myLearner.id, eventKey, { name: learner?.name || 'Learner', signature });
    setEvents(current => current.map(event => event.id === selected.id ? { ...event, ...result.event } : event));
    instance.refresh();
  };

  return <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items}
    workspaceLabel={learnerNav.workspaceLabel} pageTitle="Reviews" pageSubtitle="Curriculum review details"
    userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}>
    <div className={`page-container ${styles.page} min-w-0 w-full space-y-4 p-3 md:p-6`}>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}<button type="button" onClick={refresh} className="ml-3 font-bold underline">Try again</button></div>}
      <button type="button" onClick={() => navigate(reviewsListHref(myLearner, listParams, basePath))} className="inline-flex h-9 items-center gap-2 self-start rounded-xl border border-primary-200 bg-primary-50 px-3.5 text-xs font-bold text-primary-700 shadow-sm transition hover:bg-primary-100"><AppIcon className="ri-arrow-left-line" />Back to Reviews</button>
      {loading ? <div className="rounded-xl border border-background-200 bg-white p-5"><RowsSkeleton rows={5} /></div> : !selected ? <section className="rounded-xl border border-background-200 bg-white p-6"><h1 className="text-xl font-bold text-foreground-900">Review not found</h1><p className="mt-2 text-sm text-foreground-500">This review is no longer available for this learner.</p></section> : <>
        <section className="rounded-2xl border border-primary-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Curriculum Review</p>
          <h1 className="mt-2 text-2xl font-bold text-primary-800">{curriculumReviewTitle(selected)}</h1>
          <p className="mt-1 text-sm text-foreground-500">{formatDate(selected.scheduledDate || selected.targetDate || selected.date)} · {formatTime(selected.scheduledTime)}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><div><small className="text-xs text-foreground-500">Reviewer / Coach</small><p className="font-bold">{selected.coachName || 'Not assigned yet'}</p></div><div><small className="text-xs text-foreground-500">Review type</small><p className="font-bold">{selected.reviewTypeName || 'Curriculum Review'}</p></div><div><small className="text-xs text-foreground-500">Status</small><p className="font-bold capitalize">{selected.status.replaceAll('-', ' ')}</p></div></div>
          {selected.meetingLink && <a className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-xs font-bold text-white" href={selected.meetingLink} target="_blank" rel="noopener noreferrer"><AppIcon className="ri-video-chat-line" />Join meeting</a>}
        </section>
        {selected.meetingLink && <CoachMeetingArtifactsPanel event={{ ...selected, eventKey }} fetchArtifacts={loadArtifacts} contentUrl={artifactContentUrl} showAttendance={false} visibleArtifactTypes={['recording']} className="border-primary-100 bg-primary-50/30" />}
        {instance.loading ? <div className="rounded-xl border border-background-200 bg-white p-5"><RowsSkeleton rows={5} /></div> : instance.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{instance.error}<button type="button" onClick={instance.refresh} className="ml-2 underline">Retry review</button></p> : instance.definition ? <LearnerReviewInstanceForm definition={instance.definition} onSign={canProgress ? saveSignature : undefined} signatoryName={learner?.name || 'Learner'} onSaveAnswers={answers => saveLearnerEventReviewAnswers(myLearner.kind, myLearner.id, eventKey, answers)} /> : <section className="rounded-xl border border-background-200 bg-white p-5 text-sm text-foreground-500">This review form is not available yet.</section>}
      </>}
    </div>
  </WorkspaceShell>;
}

export default CurriculumReviewPage;
