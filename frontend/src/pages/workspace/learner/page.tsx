import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ClipboardList, FileText, Monitor } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { useAuth } from '@/hooks/useAuth';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { type LearnerKind } from '@/api/learnerDetail';
import { isOwnLearnerRecord } from '@/api/auth';
import { useFreshUserRedirect, useOnboardingRedirect } from '@/hooks/useOnboardingRedirect';
import { syncLearnerStatus } from '@/hooks/useLearnerNavGate';
import { useLearnerAttendance } from '@/hooks/useLearnerAttendance';
import { AppIcon } from '@/components/feature/AppIcon';
import { PageSkeleton } from '@/components/feature/Skeletons';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import { PageContainer } from '@/components/ui/PageContainer';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { LearnerProfilePhoto } from '@/components/feature/LearnerProfilePhoto';
import { LearnerDashboardHero } from './LearnerDashboardHero';
import { canViewAssignedProgramme, waitingCopy } from '@/utils/learnerAccessGate';
import { displayValue, EMPTY_VALUE } from '@/lib/format';
import overviewStyles from './Overview.module.css';
import { DashboardTrainingPlan } from './DashboardTrainingPlan';
import { DashboardActivities } from './DashboardActivities';
import { learnerHeaderPlan, learnerModuleHref } from './learnerHeaderPlan';
import { useDashboardPlan } from './useDashboardPlan';
import { useLearnerMetrics } from '@/hooks/useLearnerMetrics';
import { upcomingEvents, upcomingReviewOrMcm } from '@/pages/learner/home/homeData';
import type { SeasonCardProps } from '@/components/lightswind/seasonal-hover-cards';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { learnerLiveSessionHref } from './liveSessionRoute';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import MeetingBookingDialog from '@/pages/learner/reviews/MeetingBookingDialog';

function formatProgrammeStartDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function formatSessionTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' }).format(date);
}

export default function LearnerOverview() {
  const navigate = useNavigate();

  /* ── Real-learner mode: /workspace/learner/:kind/:id ── */
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const workspaceHome = urlKind && urlId ? `/workspace/learner/${kind}/${id}` : '/workspace/learner';
  const learnerNav = useMemo(() => ({ ...roleNavMap.learner, items: roleNavMap.learner.items.map(item => item.id === 'learner-home'
    ? { ...item, href: workspaceHome } : item.id === 'learner-overview'
      ? { ...item, href: `${workspaceHome}/dashboard` } : item) }), [workspaceHome]);
  const { isRealMode, real, loading, loadError, refresh } = useLearnerSummaryParam(kind, id);
  const { auth, canSeeNavItem } = useAuth();
  // "Reviewing" means somebody else's record, opened by staff from the
  // enrolment workspace: full menu, no progression gates, nothing saved.
  // A staff member or administrator who is ALSO a learner reaches their OWN
  // record the same way any learner would — the switcher sends them to their
  // own learnerRecordId/Kind — and there they need the real learner experience,
  // not the reviewing one, or they could never actually study.
  const isStaffOrAdmin = auth.account?.role === 'admin' || auth.account?.role === 'staff';
  const reviewingLearner = isStaffOrAdmin && !isOwnLearnerRecord(auth.account, kind, id);
  const knownLearner = real;
  const hasAssignedProgramme = canViewAssignedProgramme(kind, real?.accessGate);
  // A start date still in the future no longer holds anything shut: the learner
  // gets their normal working account and can open every assigned activity. The
  // upcoming date is still worth saying out loud, so it is shown as a notice
  // rather than used to disable anything.
  const startDatePending = !reviewingLearner && (real?.learningAccess?.blocked
    ?? real?.accessGate?.reasons.includes('start-date-future') ?? false);
  // An assigned plan can be previewed before teaching starts.
  const isCommercialPreStart = isRealMode && kind === 'commercial'
    && !reviewingLearner
    && real?.programmeStatus?.trim().toLowerCase() === 'delivery'
    && !real.studentActivityAvailable && !hasAssignedProgramme;
  const skipPreStartData = isRealMode && (!real || isCommercialPreStart);
  const learnerKind: LearnerKind | null = kind === 'commercial' || kind === 'apprenticeship' ? kind : null;
  const dashboardPlan = useDashboardPlan(learnerKind, id, isRealMode && !skipPreStartData);
  // Programme and KSB cards share the canonical metrics with My Learning.
  // Actual combines retained Audit hours and measured LMS completions once.
  // Migrated Planned hours use the retained Aptem total.
  const metrics = useLearnerMetrics(learnerKind, id, isRealMode && !skipPreStartData);
  const scheduleRead = dashboardPlan.schedule;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const attendanceRead = useLearnerAttendance(learnerKind, id, isRealMode && !skipPreStartData);
  const { data: attendance, loading: attendanceLoading } = attendanceRead;
  /* ── Onboarding learners land on their enrolment wizard, not the overview ──
     Gated on `!loading` so a not-yet-loaded status never reads as "not onboarding". */
  const redirectingToOnboarding = useOnboardingRedirect(real?.programmeStatus, isRealMode && !loading && !reviewingLearner, kind);

  /* ── A learner whose enrolment hasn't been started yet gets the waiting page ──
     Same gating as above: `!loading` so an unresolved status never reads as fresh. */
  const isFreshUser = useFreshUserRedirect(real?.programmeStatus, isRealMode && !loading && !reviewingLearner);
  const isCommercialWaiting = isCommercialPreStart && !loading;

  /* The sidebar caches the programme status for the whole browser session and
     never expires it. This page has just fetched the real record, so it hands
     the live value back — otherwise a learner whose status staff changed today
     would keep the menu (and, at 'Fresh user', the waiting page) they had when
     the session started. */
  useEffect(() => {
    if (!isRealMode || loading) return;
    syncLearnerStatus(kind, id, real?.programmeStatus, real || undefined);
  }, [isRealMode, loading, kind, id, real]);

  const heroName = (knownLearner?.name.split(' ')[0]) || knownLearner?.name || 'Learner';
  const heroFullName = knownLearner?.name || 'Learner';
  const heroProgramme = knownLearner?.programme || '';
  const heroEmployer = knownLearner?.employer || '';
  const heroCohort = knownLearner?.cohort || '';
  const subtitleParts = [
    heroProgramme ? `Programme: ${heroProgramme}` : '',
    heroEmployer ? `Employer: ${heroEmployer}` : '',
    heroCohort ? `Cohort: ${heroCohort}` : '',
  ].filter(Boolean);

  const weeklyPlanHref = kind && id ? `/learner/learning-plan/modules/${kind}/${id}` : '/learner/learning-plan/modules';
  const programmeProgressHref = kind && id ? `/learner/my-learning/${kind}/${id}` : '/learner/my-learning';
  const otjhProgressHref = kind && id ? `/learner/otjh/${kind}/${id}` : '/learner/otjh';
  const ksbProgressHref = kind && id ? `/learner/ksbs/${kind}/${id}` : '/learner/ksbs';
  const displayLearnerName = heroFullName;
  const displayCohort = heroCohort || EMPTY_VALUE;
  const headerDescription = heroProgramme || undefined;
  const programmeStartDate = real?.learnerStartDate
    ?? real?.learningAccess?.startDate
    ?? dashboardPlan.data?.programmeStartDate
    ?? real?.programmeStartDate;
  const programmeEndDate = dashboardPlan.auditPlannedEndDate
    ?? real?.programmeEndDate
    ?? dashboardPlan.data?.programmeEndDate
    ?? real?.learnerEndDate;
  const startDateDisplay = formatProgrammeStartDate(programmeStartDate) || (loading ? 'Loading…' : EMPTY_VALUE);
  const plannedEndDisplay = dashboardPlan.auditLoading
    ? 'Loading…'
    : formatProgrammeStartDate(programmeEndDate) || (loading ? 'Loading…' : EMPTY_VALUE);
  const plan = learnerHeaderPlan(scheduleRead.data?.modules || [], knownLearner || {},
    new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }));
  const planPlaceholder = scheduleRead.loading ? 'Loading...' : scheduleRead.error ? 'Unavailable' : EMPTY_VALUE;
  const coachDisplayName = scheduleRead.data?.coach.name || (scheduleRead.data ? 'Not yet assigned' : planPlaceholder);
  const continueLearningHref = learnerModuleHref(kind, id, plan.modules[0]?.id, scheduleRead.data?.moduleLinks);

  // "Your next action" reuses the training-plan module already resolved above; the
  // other two cards share the same nearest-lecture/nearest-assignment selection
  // Student Home uses, so all three destinations and empty-state copy stay in sync.
  const weekRead = dashboardPlan.week;
  const events = useMemo(() => upcomingEvents(scheduleRead.data, weekRead.data, new Date(now)),
    [scheduleRead.data, weekRead.data, now]);
  const [nextLecture, nextAssignment] = events;
  const nextReviewOrMcm = useMemo(() => upcomingReviewOrMcm(scheduleRead.data, new Date(now)),
    [scheduleRead.data, now]);
  const [bookingSession, setBookingSession] = useState<LearnerCalendarEvent | null>(null);
  const learnerDetailRead = useLearnerDetailParam(kind, id);
  const nextLectureActivityHref = learnerLiveSessionHref(learnerDetailRead.real, nextLecture, kind, id)
    || (nextLecture.moduleId
      ? learnerModuleHref(kind, id, nextLecture.moduleId, scheduleRead.data?.moduleLinks)
      : continueLearningHref);
  const reviewOrMcmHref = nextReviewOrMcm && kind && id
    ? `/learner/calendar?kind=${encodeURIComponent(kind)}&learner=${encodeURIComponent(id)}&event=${encodeURIComponent(nextReviewOrMcm.eventKey)}${nextReviewOrMcm.scheduledDate ? '' : '&action=schedule'}`
    : '/learner/calendar';
  const reviewPageHref = nextReviewOrMcm
    ? `/learner/${nextReviewOrMcm.source === 'mcr' ? 'monthly-coaching' : 'progress-reviews'}/${encodeURIComponent(nextReviewOrMcm.sessionId)}`
    : undefined;
  const reviewBookingSession = useMemo<LearnerCalendarEvent | null>(() => {
    if (!nextReviewOrMcm) return null;
    const source = nextReviewOrMcm.source;
    return {
      id: nextReviewOrMcm.eventKey,
      eventKey: nextReviewOrMcm.eventKey,
      title: nextReviewOrMcm.title,
      source,
      type: source === 'mcr' ? 'coaching' : 'review',
      sequence: 1,
      status: nextReviewOrMcm.scheduledDate ? 'scheduled' : 'not-scheduled',
      date: nextReviewOrMcm.date,
      targetDate: nextReviewOrMcm.date,
      scheduledDate: nextReviewOrMcm.scheduledDate,
      scheduledTime: nextReviewOrMcm.scheduledTime,
      durationMinutes: 60,
      coachName: scheduleRead.data?.coach.name || '',
      coachEmail: scheduleRead.data?.coach.email || '',
      meetingProvider: 'teams',
      meetingLink: nextReviewOrMcm.meetingLink || '',
      notes: '',
    };
  }, [nextReviewOrMcm, scheduleRead.data?.coach.email, scheduleRead.data?.coach.name]);
  const reviewActionHref = nextReviewOrMcm?.scheduledDate
    ? reviewPageHref
    : nextReviewOrMcm ? (reviewBookingSession ? undefined : reviewOrMcmHref) : reviewOrMcmHref;
  const reviewDateLabel = nextReviewOrMcm?.date
    ? `${formatProgrammeStartDate(nextReviewOrMcm.date)}${nextReviewOrMcm.scheduledTime ? ` · ${nextReviewOrMcm.scheduledTime.slice(0, 5)} UK time` : ''}`
    : '';
  const actionCards: SeasonCardProps[] = [
    {
      title: nextReviewOrMcm?.source === 'mcr' ? 'MCM' : 'Review',
      subtitle: nextReviewOrMcm?.title || 'No upcoming review or MCM',
      description: reviewDateLabel || 'Your next review or MCM will appear here.',
      cta: nextReviewOrMcm?.scheduledDate ? 'Attend' : 'Schedule',
      status: nextReviewOrMcm ? (nextReviewOrMcm.scheduledDate ? 'Scheduled' : 'Ready to schedule') : planPlaceholder,
      icon: FileText,
      variant: 'action',
      href: reviewActionHref || (!nextReviewOrMcm ? reviewOrMcmHref : undefined),
      onClick: !nextReviewOrMcm?.scheduledDate && reviewBookingSession ? () => setBookingSession(reviewBookingSession) : undefined,
      imageSrc: '/assets/dashboard-cards/next-action.svg',
      imageAlt: 'Continue learning artwork',
    },
    {
      title: 'Next live session',
      subtitle: nextLecture.date ? nextLecture.title : scheduleRead.loading ? 'Loading…' : 'No upcoming session',
      description: nextLecture.date
        ? `${formatProgrammeStartDate(nextLecture.date)} · ${formatSessionTime(nextLecture.date)}`
        : scheduleRead.loading ? 'Loading…' : 'Check back once your next session is scheduled.',
      cta: nextLecture.date ? 'Attend' : 'View schedule',
      status: nextLecture.date ? 'Scheduled' : scheduleRead.loading ? 'Loading…' : 'No session scheduled',
      icon: Monitor,
      variant: 'session',
      href: nextLecture.date ? nextLectureActivityHref : nextLecture.href,
      imageSrc: '/assets/dashboard-cards/next-session.svg',
      imageAlt: 'Next live session artwork',
    },
    {
      title: 'Due soon',
      subtitle: nextAssignment.date ? nextAssignment.title : weekRead.loading ? 'Loading…' : 'No upcoming assignment',
      description: nextAssignment.date ? `Due ${formatProgrammeStartDate(nextAssignment.date)}`
        : weekRead.loading ? 'Loading…' : 'You’re all caught up — nothing due soon.',
      cta: nextAssignment.date ? 'Open assignment' : 'View assignments',
      status: nextAssignment.date ? 'Pending' : weekRead.loading ? 'Loading…' : 'Nothing due',
      icon: ClipboardList,
      variant: 'due',
      href: nextAssignment.href,
      imageSrc: '/assets/dashboard-cards/due-soon.svg',
      imageAlt: 'Assignment due soon artwork',
    },
  ];
  const programme = metrics.data?.programme;
  const programmeProgressPercent = programme?.percent ?? null;
  const programmeProgressValue = programmeProgressPercent == null ? EMPTY_VALUE : `${programmeProgressPercent}%`;
  const programmeProgressSummary = programme?.total != null ? `${programme.completed} / ${programme.total}` : EMPTY_VALUE;

  const attendanceReady = !!attendance || (!attendanceLoading && !attendanceRead.error);
  const attendanceSessions = attendance?.sessions ?? (attendanceReady ? 0 : null);
  const attendancePresent = attendance?.present ?? (attendanceReady ? 0 : null);
  const attendancePercent = attendance?.attendanceRate ?? null;
  const attendanceValue = attendancePresent?.toLocaleString('en-GB') ?? EMPTY_VALUE;
  const attendanceTotalValue = attendanceSessions?.toLocaleString('en-GB') ?? EMPTY_VALUE;
  const attendanceSummary = attendancePresent == null || attendanceSessions == null
    ? EMPTY_VALUE : `${attendanceValue} / ${attendanceTotalValue}`;

  const otjPlannedHours = !metrics.data ? null : metrics.data.migrated
    ? metrics.data.aptem_planned_total ?? null : dashboardPlan.otjh.planned;
  const otjPlannedLoading = metrics.loading || (!metrics.data?.migrated && dashboardPlan.otjh.plannedLoading);
  // The headline is the canonical whole-programme metric. Monthly-log values
  // remain available inside Monthly Focus, but must not replace this total.
  const otjActualHours = metrics.data?.otjh.completed_actual ?? null;
  const otjPercent = otjActualHours != null && otjPlannedHours != null && otjPlannedHours > 0
    ? Math.round((otjActualHours / otjPlannedHours) * 100)
    : null;
  const otjPlannedValue = otjPlannedHours != null ? `${otjPlannedHours.toFixed(2)} h`
    : otjPlannedLoading ? 'Loading…' : 'Unavailable';
  const otjActualValue = otjActualHours != null ? `${otjActualHours.toFixed(2)} h`
    : metrics.loading ? 'Loading...' : 'Unavailable';
  const ksb = metrics.data?.ksb;
  const ksbPercent = ksb?.percent ?? null;
  const ksbValue = ksbPercent == null ? EMPTY_VALUE : `${ksbPercent}%`;
  const ksbSummary = ksb?.total != null ? `${ksb.completed} / ${ksb.total}` : EMPTY_VALUE;
  if (!isRealMode || !learnerKind || !id) {
    return (
      <WorkspaceShell
        role="learner"
        roleLabel={learnerNav.label}
        navItems={learnerNav.items}
        workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Dashboard"
        pageSubtitle="Select a learner to open their dashboard"
        userName={auth.account?.displayName || auth.account?.email || 'Staff'}
        userRole={auth.account?.role === 'admin' ? 'Administrator' : 'Staff'}
      >
        <PageContainer className={overviewStyles.overview}>
          <div role="status" className="rounded-2xl border border-foreground-200 bg-background-50 p-8 text-center">
            <h2 className="text-lg font-semibold text-foreground-900">No learner selected</h2>
            <p className="mt-2 text-sm text-foreground-500">Open a learner from the enrolment workspace to review their dashboard.</p>
          </div>
        </PageContainer>
      </WorkspaceShell>
    );
  }

  if (isRealMode && (loading || redirectingToOnboarding)) {
    // Only the small identity read gates the page; cards load independently.
    return <PageSkeleton workspaceRole="learner" />;
  }

  /* ================================================================
     Enrolment not started — the whole overview is replaced.
     ================================================================
     Everything below this point reads a training plan, KSB profile, evidence
     and attendance record that are only created once enrolment runs. For a
     fresh learner those queries return nothing (or, as the KSB one did, a raw
     "relation does not exist" error rendered into the page header), so the
     dashboard is not merely empty — it is misleading: 100% attendance from
     0 sessions, "1 Submitted" evidence belonging to nobody. One honest
     message beats a wall of figures that mean nothing yet. */
  if (isFreshUser || isCommercialWaiting) {
    const commercialWaiting = isCommercialWaiting;
    // What is actually holding this learner back, as progression sees it —
    // an unsigned document, an unassigned plan, or a date still to come. The
    // page used to say "your start date has not arrived" whichever it was.
    const waiting = waitingCopy(real?.accessGate, { commercial: kind === 'commercial' });
    return (
      <WorkspaceShell
        role="learner"
        roleLabel={learnerNav.label}
        navItems={learnerNav.items}
        workspaceLabel={learnerNav.workspaceLabel}
        pageTitle={`Welcome, ${heroName}`}
        pageSubtitle={commercialWaiting ? 'Your programme has not started yet' : "Your enrolment hasn't started yet"}
        userName={heroFullName}
        userRole="Learner"
      >
        <div className="p-3 md:p-6">
          <div className="max-w-2xl mx-auto mt-6 md:mt-16">
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden">
              <div className="px-6 md:px-10 pt-10 pb-8 text-center">
                <span className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-5">
                  <AppIcon className="ri-time-line text-3xl"></AppIcon>
                </span>
                <h2 className="text-xl md:text-2xl font-heading font-bold text-foreground-900 mb-3">
                  {commercialWaiting ? waiting.title : <>Your enrolment hasn&apos;t started yet</>}
                </h2>
                <p className={commercialWaiting ? 'hidden' : 'text-[14px] text-foreground-500 leading-relaxed max-w-lg mx-auto'}>
                  Your account is set up and ready. The enrolment team will be in touch to begin
                  your enrolment — there is nothing you need to do right now.
                </p>
                <p className={commercialWaiting ? 'hidden' : 'text-[13px] text-foreground-400 leading-relaxed max-w-lg mx-auto mt-3'}>
                  Once they start the process, your training plan, learning materials and progress
                  will appear here automatically.
                </p>
                {commercialWaiting && waiting.lines.map((line, index) => (
                  <p
                    key={line}
                    className={index === 0
                      ? 'text-[14px] text-foreground-500 leading-relaxed max-w-lg mx-auto'
                      : 'text-[13px] text-foreground-400 leading-relaxed max-w-lg mx-auto mt-3'}
                  >
                    {line}
                  </p>
                ))}
              </div>

              <div className="px-6 md:px-10 py-5 bg-background-100/60 border-t border-foreground-200/60">
                <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">
                  What happens next
                </p>
                <ol className="space-y-2.5">
                  {[
                    ...(commercialWaiting ? waiting.steps : [
                      'The enrolment team reviews your details and starts your enrolment.',
                      'You complete your enrolment form and book your onboarding reviews.',
                      'Your training plan is built and your programme begins.',
                    ]),
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-[13px] text-foreground-600 leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <p className="text-[12px] text-foreground-400 text-center mt-5">
              Need help in the meantime? Use <strong className="text-foreground-500">Contact Support</strong> at
              the bottom of the sidebar.
            </p>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Dashboard"
      pageSubtitle={subtitleParts.join(' · ')}
      userName={heroFullName}
      userRole={heroProgramme ? `${heroProgramme} Learner` : 'Learner'}
    >
      <PageContainer className={overviewStyles.overview}>
        {loadError && <LearnerLoadError error={loadError} onRetry={refresh} />}
        {startDatePending && (
          <div role="status" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-foreground-700">
            <p className="font-semibold">{real?.learningAccess?.startDate || real?.accessGate?.startDate
              ? `Your programme starts on ${formatProgrammeStartDate(real?.learningAccess?.startDate || real?.accessGate?.startDate)}`
              : 'Your cohort start date is awaiting confirmation'}</p>
            <p>You can get started straight away — your programme, training plan and assigned modules are all open now.</p>
          </div>
        )}
        {reviewingLearner && real?.accessGate?.reasons.includes('invitation') && (
          <div role="status" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-foreground-700">
            <p className="font-semibold">{real.accessGate.reasons.length === 1 ? 'Ready to invite' : 'Invitation pending'}</p>
            <p>You can review this learner’s saved data here. Programme activation waits for a successfully sent invitation and completed programme setup.</p>
          </div>
        )}

        {/* ================================================================
            PROFILE HEADER
            ================================================================ */}
        <LearnerDashboardHero
          avatar={<LearnerProfilePhoto kind={learnerKind} learnerId={id} name={displayLearnerName} />}
          name={displayLearnerName}
          description={headerDescription}
          cohort={displayCohort}
          moduleLabel={plan.label}
          modules={plan.modules.map(module => ({ id: module.id, title: module.title,
            href: learnerModuleHref(kind, id, module.id, scheduleRead.data?.moduleLinks) }))}
          modulePlaceholder={planPlaceholder}
          allModulesHref={programmeProgressHref}
          actionCards={actionCards}
          employer={knownLearner?.employer || EMPTY_VALUE}
          organization={knownLearner?.organization || EMPTY_VALUE}
          coach={coachDisplayName}
          coachEmail={scheduleRead.data?.coach.email}
          coachPhone={scheduleRead.data?.coach.phone}
          status={displayValue(knownLearner?.programmeStatus)}
          startDate={startDateDisplay}
          plannedEnd={plannedEndDisplay}
          loading={scheduleRead.loading}
          onContinue={() => navigate(continueLearningHref)}
          onOpenMap={() => navigate(weeklyPlanHref)}
        />

        {bookingSession && kind && id && <MeetingBookingDialog
          session={bookingSession}
          title={bookingSession.title}
          learner={{ kind, id }}
          rules={null}
          onClose={() => setBookingSession(null)}
          onBooked={() => { setBookingSession(null); dashboardPlan.refresh(); }}
        />}

        {metrics.error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          {metrics.error} <button className="ml-2 font-semibold underline" onClick={metrics.refresh}>Try again</button>
        </div>}
        {attendanceRead.error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          Attendance could not refresh. {attendanceRead.error}
          <button className="ml-2 font-semibold underline" onClick={attendanceRead.refresh}>Retry attendance</button>
        </div>}
        <div className={`${overviewStyles.metrics} ${overviewStyles.metricsInline}`}>
          <ProgressStat href={programmeProgressHref} label="Programme Progress" value={programmeProgressValue} summary={programmeProgressSummary} targetValue="100%" percent={programmeProgressPercent} accent="purple" />
          <ProgressStat href="/learner/attendance" label="Attendance" value={attendanceValue} summary={attendanceSummary} valueLabel="Attended" targetValue={attendanceTotalValue} targetLabel="Sessions to date" percent={attendancePercent} accent="green" />
          <ProgressStat
            href={otjhProgressHref}
            label="OTJ Hours"
            value={otjActualValue}
            summary={`${otjActualHours?.toFixed(2) ?? EMPTY_VALUE} / ${otjPlannedHours?.toFixed(2) ?? EMPTY_VALUE} h`}
            valueLabel="Actual"
            targetValue={otjPlannedValue}
            targetLabel="Planned hours"
            percent={otjPercent}
            accent="yellow"
          />
          <ProgressStat href={ksbProgressHref} label="KSB Progress" value={ksbValue} summary={ksbSummary} percent={ksbPercent} accent="purple" />
        </div>

        {real && <DashboardActivities kind={learnerKind} programmeStatus={real.programmeStatus} canSeeNavItem={canSeeNavItem} />}
        <DashboardTrainingPlan key={`plan:${learnerKind}:${id}`} kind={learnerKind} learnerId={id} plan={dashboardPlan} canOpenActivities
          programmeStartDate={programmeStartDate}
          programmeEndDate={programmeEndDate}
          canOpenRewards={!reviewingLearner} />
      </PageContainer>
    </WorkspaceShell>
  );
}

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
   ───────────────────────────────────────────── */

/** Shared linked summary cards; presentation does not change the metric sources. */
function ProgressStat({ href, label, value, summary, valueLabel = 'Current', targetValue, targetLabel = 'Target', percent, accent }: {
  href: string;
  label: string;
  value: string;
  summary: string;
  valueLabel?: string;
  targetValue?: string;
  targetLabel?: string;
  percent: number | null;
  accent: 'purple' | 'green' | 'yellow';
}) {
  const ringPercent = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  const ringLabel = percent == null ? EMPTY_VALUE : `${Number.isInteger(percent) ? percent : Number(percent.toFixed(1))}%`;
  return (
    <Link
      to={href}
      aria-label={`Open ${label}`}
      data-accent={accent}
      className={`group ${overviewStyles.metric}`}
    >
      <div className={overviewStyles.metricTop}>
        <span
          className={overviewStyles.metricRing}
          role="img"
          aria-label={`${label}: ${ringLabel}`}
          style={{ '--metric-progress': `${ringPercent}%` } as CSSProperties}
        >
          <span className={overviewStyles.metricRingValue}>{ringLabel}</span>
        </span>
        <div className={overviewStyles.metricBody}>
          <div className={overviewStyles.metricHeading}>
            <p className={overviewStyles.metricLabel}>{label}</p>
          </div>
          <p className={overviewStyles.metricDetail}>{summary}</p>
          <dl className={overviewStyles.metricA11yData}>
            <div><dt>{valueLabel}</dt><dd>{value}</dd></div>
            {targetValue != null && <div><dt>{targetLabel}</dt><dd>{targetValue}</dd></div>}
          </dl>
          <ProgressBar percent={percent} tone={overviewStyles.metricFill} className={overviewStyles.metricA11yProgress} />
        </div>
        <AppIcon aria-hidden="true" className={`ri-arrow-right-s-line ${overviewStyles.metricArrow}`} />
      </div>
    </Link>
  );
}
