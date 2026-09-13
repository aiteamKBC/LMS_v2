import { useState, useEffect } from 'react';
import { BookOpen, CalendarCheck, Clock3, BarChart3, type LucideIcon } from 'lucide-react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { useAuth } from '@/hooks/useAuth';
import { overviewSchedule } from '@/api/learnerOverview';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { formatHoursMinutes } from '@/utils/learnerJourney';
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
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import { LearnerProfilePhoto } from '@/components/feature/LearnerProfilePhoto';
import { toneStyle, statusTone, type StatusTone } from '@/lib/statusTone';
import { canViewAssignedProgramme, waitingCopy } from '@/utils/learnerAccessGate';
import { displayValue, EMPTY_VALUE, ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { useLearnerMetrics } from '@/hooks/useLearnerMetrics';
import overviewStyles from './Overview.module.css';
import { DashboardTrainingPlan } from './DashboardTrainingPlan';
import { DashboardActivities } from './DashboardActivities';
import { learnerHeaderPlan, learnerModuleHref } from './learnerHeaderPlan';

function formatProgrammeStartDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

const learnerNav = roleNavMap.learner;

export default function LearnerOverview() {
  const p = LEARNER_PROFILE;
  const navigate = useNavigate();

  /* ── Real-learner mode: /workspace/learner/:kind/:id ── */
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
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
  const learningBlocked = !reviewingLearner && (real?.learningAccess?.blocked
    ?? real?.accessGate?.reasons.includes('start-date-future') ?? false);
  // An assigned plan can be previewed before teaching starts.
  const isCommercialPreStart = isRealMode && kind === 'commercial'
    && !reviewingLearner
    && real?.programmeStatus?.trim().toLowerCase() === 'delivery'
    && !real.studentActivityAvailable && !hasAssignedProgramme;
  const skipPreStartData = isRealMode && (!real || isCommercialPreStart);
  const learnerKind: LearnerKind | null = kind === 'commercial' || kind === 'apprenticeship' ? kind : null;
  const scheduleRead = useLiveLearnerRead(learnerKind, id, isRealMode && !skipPreStartData, overviewSchedule.read, overviewSchedule.peek);
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

  const heroName = isRealMode ? ((knownLearner?.name.split(' ')[0]) || knownLearner?.name || 'Learner') : p.firstName;
  const heroFullName = isRealMode ? (knownLearner?.name || 'Learner') : p.fullName;
  const heroProgramme = isRealMode ? (knownLearner?.programme || '') : p.programme;
  const heroEmployer = isRealMode ? (knownLearner?.employer || '') : p.employer;
  const heroCohort = isRealMode ? (knownLearner?.cohort || '') : p.cohort;
  const subtitleParts = isRealMode
    ? [
        heroProgramme ? `Programme: ${heroProgramme}` : '',
        heroEmployer ? `Employer: ${heroEmployer}` : '',
        heroCohort ? `Cohort: ${heroCohort}` : '',
      ].filter(Boolean)
    : [`${p.programme} ${p.programmeLevel}`, p.employer, `Cohort ${p.cohort}`];

  const weeklyPlanHref = kind && id ? `/learner/learning-plan/modules/${kind}/${id}` : '/learner/learning-plan/modules';
  const programmeProgressHref = kind && id ? `/learner/my-learning/${kind}/${id}` : '/learner/my-learning';
  const otjhProgressHref = kind && id ? `/learner/otjh/${kind}/${id}` : '/learner/otjh';
  const ksbProgressHref = kind && id ? `/learner/ksbs/${kind}/${id}` : '/learner/ksbs';
  const displayLearnerName = isRealMode ? heroFullName : p.fullName;
  const displayCohort = isRealMode ? (heroCohort || EMPTY_VALUE) : p.cohort;
  const headerDescription = isRealMode
    ? ([heroProgramme, heroEmployer].filter(Boolean).join(' · ') || undefined)
    : `${p.programme} ${p.programmeLevel} · ${p.employer}`;
  const startDateDisplay = isRealMode
    ? (formatProgrammeStartDate(real?.learningAccess?.startDate ?? real?.programmeStartDate) || (loading ? 'Loading…' : EMPTY_VALUE))
    : p.startDate;
  const plannedEndDisplay = isRealMode
    ? (formatProgrammeStartDate(real?.programmeEndDate) || (loading ? 'Loading…' : EMPTY_VALUE))
    : p.plannedEndDate;
  const plan = learnerHeaderPlan(scheduleRead.data?.modules || [], knownLearner || {},
    new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }));
  const planPlaceholder = scheduleRead.loading ? 'Loading...' : scheduleRead.error ? 'Unavailable' : EMPTY_VALUE;
  const coachDisplayName = isRealMode
    ? scheduleRead.data?.coach.name || (scheduleRead.data ? 'Not yet assigned' : planPlaceholder) : p.coach.name;
  const currentModuleLabel = isRealMode
    ? plan.modules.map(module => module.title).join(' · ') || planPlaceholder : p.currentModule;
  const continueLearningHref = learnerModuleHref(kind, id, plan.modules[0]?.id, scheduleRead.data?.moduleLinks);
  const metrics = useLearnerMetrics(learnerKind, id, isRealMode && !skipPreStartData);

  const programme = metrics.data?.programme;
  const programmeProgressPercent = isRealMode ? programme?.percent ?? null : p.overallProgress;
  const programmeProgressValue = programmeProgressPercent == null ? EMPTY_VALUE : `${programmeProgressPercent}%`;
  const programmeProgressCaption = isRealMode
    ? programme?.total != null ? `${programme.completed}/${programme.total} activities complete`
      : metrics.loading ? 'Loading progress...' : 'Progress unavailable'
    : p.currentModule;
  const programmeTargetDetail = isRealMode && programme?.total != null && programme.total > 0
    ? `${programme.total.toLocaleString('en-GB')} activities` : 'All assigned activities';

  const attendancePercent = isRealMode ? (attendance ? attendance.attendanceRate : null) : p.attendanceRate;
  const attendanceValue = attendancePercent == null ? EMPTY_VALUE : `${attendancePercent}%`;
  const attendanceCaption = isRealMode
    ? (attendance ? `${attendance.present}/${attendance.sessions} sessions` : attendanceLoading ? 'Loading…' : 'No attendance record yet')
    : `${p.sessionsAttended}/${p.sessionsAttended + p.sessionsMissed} sessions`;
  const attendanceTone: StatusTone = attendancePercent == null
    ? 'neutral'
    : attendancePercent >= ATTENDANCE_EXPECTED_RATE ? 'positive' : attendancePercent >= ATTENDANCE_MINIMUM_RATE ? 'caution' : 'critical';

  const otjPlannedHours = isRealMode ? metrics.data?.otjh.planned : p.otjhTarget;
  const otjActualHours = isRealMode ? metrics.data?.otjh.actual : p.otjhCompleted;
  const otjPercent = otjActualHours != null && otjPlannedHours != null && otjPlannedHours > 0
    ? Math.round((otjActualHours / otjPlannedHours) * 100)
    : null;
  const otjPlannedValue = otjPlannedHours != null ? `${otjPlannedHours.toFixed(2)} h`
    : metrics.loading ? 'Loading…' : 'Unavailable';
  const otjActualValue = otjActualHours != null ? `${otjActualHours.toFixed(2)} h` : EMPTY_VALUE;
  const otjCaption = isRealMode
    ? metrics.loading ? 'Loading recorded time...' : metrics.data?.otjh.actual == null ? 'Recorded time unavailable'
      : otjPlannedHours == null ? 'Training plan target hours are not available yet.' : 'Across your programme'
    : `${formatHoursMinutes(p.otjhCompleted)} / ${formatHoursMinutes(p.otjhTarget)} planned`;
  const otjTone: StatusTone = 'brand';
  const ksb = metrics.data?.ksb;
  const ksbPercent = isRealMode ? ksb?.percent ?? null : p.ksbProgress;
  const ksbValue = ksbPercent == null ? EMPTY_VALUE : `${ksbPercent}%`;
  const ksbCaption = isRealMode
    ? ksb?.total != null ? `${ksb.completed} of ${ksb.total} points achieved`
      : metrics.loading ? 'Loading KSB progress...' : 'KSB details unavailable'
    : `${p.ksbValidated} of ${p.ksbTotal} validated`;
  const ksbTargetDetail = isRealMode
    ? ksb?.total != null && ksb.total > 0 ? `${ksb.total.toLocaleString('en-GB')} KSB points` : 'KSB point total unavailable'
    : `${p.ksbTotal} KSB points`;
  const ksbTone: StatusTone = ksbPercent == null ? 'neutral'
    : ksbPercent >= 50 ? 'positive' : ksbPercent >= 30 ? 'caution' : 'critical';

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
      pageSubtitle={isRealMode ? subtitleParts.join(' · ') : `${p.programme} ${p.programmeLevel} · ${p.employer} · Cohort ${p.cohort}`}
      userName={isRealMode ? heroFullName : p.fullName}
      userRole={isRealMode ? (heroProgramme ? `${heroProgramme} Learner` : 'Learner') : `${p.programme} Apprentice`}
    >
      <PageContainer className={overviewStyles.overview}>
        {loadError && <LearnerLoadError error={loadError} onRetry={refresh} />}
        {learningBlocked && (
          <div role="status" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-foreground-700">
            <p className="font-semibold">{real?.learningAccess?.startDate || real?.accessGate?.startDate
              ? `Learning starts on ${formatProgrammeStartDate(real?.learningAccess?.startDate || real?.accessGate?.startDate)}`
              : 'Your cohort start date is awaiting confirmation'}</p>
            <p>You can view your programme and training plan now. All assigned modules open when your cohort starts.</p>
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
        <div>
            <header
              className={`learner-super-admin-hero ${overviewStyles.hero}`}
              aria-label="Learner programme"
            >
            <div aria-hidden="true" className={overviewStyles.heroArtwork} />
            <div className={overviewStyles.heroTop}>
              <div className={overviewStyles.identity}>
                {isRealMode && learnerKind && id ? <LearnerProfilePhoto
                  kind={learnerKind} learnerId={id} name={displayLearnerName}
                  className={overviewStyles.avatar}
                /> : <LearnerAvatar
                  name={displayLearnerName}
                  size="lg"
                  className={`${overviewStyles.avatar} bg-white/15 text-white ring-white/30`}
                />}
                <div className="min-w-0">
                  <p className={overviewStyles.eyebrow}>Learner</p>
                  <h1 className={`${overviewStyles.name} font-heading`}>{displayLearnerName}</h1>
                  {headerDescription ? <p className={overviewStyles.description}>{headerDescription}</p> : null}
                </div>
              </div>
              <div className={overviewStyles.heroActions}>
                <button
                  type="button"
                  onClick={() => navigate(continueLearningHref)}
                  disabled={learningBlocked || scheduleRead.loading}
                  aria-busy={scheduleRead.loading}
                  className={`${overviewStyles.heroAction} ${overviewStyles.primaryAction}`}
                >
                  <AppIcon className="ri-play-line" />
                  {learningBlocked ? 'Learning opens on your start date' : 'Continue learning'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(weeklyPlanHref)}
                  className={overviewStyles.heroAction}
                >
                  <AppIcon className="ri-road-map-line" />
                  Learner's Map
                </button>
              </div>
            </div>
            <dl className={overviewStyles.facts}>
              <ProfileFact icon="ri-group-line" label="Cohort" value={displayCohort} />
              <ProfileFact icon="ri-book-2-line" label={isRealMode ? plan.label : "Module"} value={currentModuleLabel} />
              <ProfileFact icon="ri-user-line" label="Coach" value={coachDisplayName} />
              <ProfileFact icon="ri-calendar-event-line" label="Start date" value={startDateDisplay} />
              <ProfileFact label="Status" value={displayValue(isRealMode ? knownLearner?.programmeStatus : p.status)} status />
              <ProfileFact icon="ri-calendar-event-line" label="Planned end" value={plannedEndDisplay} />
            </dl>
            </header>
        </div>

        {metrics.error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          {metrics.error} <button className="ml-2 font-semibold underline" onClick={metrics.refresh}>Try again</button>
        </div>}
        {attendanceRead.error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          Attendance could not refresh. {attendanceRead.error}
          <button className="ml-2 font-semibold underline" onClick={attendanceRead.refresh}>Retry attendance</button>
        </div>}
        {/* ================================================================
            PROGRAMME PROGRESS CARDS
            ================================================================ */}
        <div>
            <div className={overviewStyles.metrics}>
              <ProgressStat href={programmeProgressHref} icon={BookOpen} label="Programme Progress" value={programmeProgressValue} targetValue="100%" targetDetail={programmeTargetDetail} percent={programmeProgressPercent} caption={programmeProgressCaption} tone="brand" />
              <ProgressStat href="/learner/attendance" icon={CalendarCheck} label="Attendance" value={attendanceValue} targetValue={`${isRealMode ? ATTENDANCE_EXPECTED_RATE : p.attendanceTarget}%`} percent={attendancePercent} caption={attendanceCaption} tone={attendanceTone} />
              <ProgressStat
                href={otjhProgressHref}
                icon={Clock3}
                label="OTJ Hours"
                value={otjActualValue}
                valueLabel="Actual"
                targetValue={otjPlannedValue}
                targetLabel="Target (TP Planned)"
                percent={otjPercent}
                caption={otjCaption}
                tone={otjTone}
              />
              <ProgressStat href={ksbProgressHref} icon={BarChart3} label="KSB Progress" value={ksbValue} targetValue="100%" targetDetail={ksbTargetDetail} percent={ksbPercent} caption={ksbCaption} tone={ksbTone} />
            </div>
        </div>

        {isRealMode && real && learnerKind && <DashboardActivities kind={learnerKind} programmeStatus={real.programmeStatus} canSeeNavItem={canSeeNavItem} />}
        {isRealMode && learnerKind && id && <DashboardTrainingPlan key={`plan:${learnerKind}:${id}`} kind={learnerKind} learnerId={id} canOpenActivities={!learningBlocked}
          programmeStartDate={real?.learningAccess?.startDate ?? real?.programmeStartDate} canOpenRewards={!reviewingLearner} />}
      </PageContainer>
    </WorkspaceShell>
  );
}

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
   ───────────────────────────────────────────── */

/** One labelled fact in the profile header's meta row. */
function ProfileFact({ icon, label, value, status = false }: { icon?: string; label: string; value: string; status?: boolean }) {
  const statusStyle = status ? toneStyle(statusTone(value)) : null;
  return (
    <div className={overviewStyles.fact}>
      {statusStyle ? (
        <span aria-hidden="true" className={`${overviewStyles.statusIcon} ${statusStyle.dot}`}>
          <span />
        </span>
      ) : <AppIcon aria-hidden="true" className={`${icon} ${overviewStyles.factIcon}`} />}
      <div className="min-w-0">
        <dt className={overviewStyles.factLabel}>{label}</dt>
        <dd className={overviewStyles.factValue}>{value || EMPTY_VALUE}</dd>
      </div>
    </div>
  );
}

/** Shared linked summary cards; presentation does not change the metric sources. */
function ProgressStat({ href, icon: Icon, label, value, valueLabel = 'Current', targetValue, targetLabel = 'Target', targetDetail, percent, caption, tone = 'neutral' }: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  valueLabel?: string;
  targetValue: string;
  targetLabel?: string;
  targetDetail?: string;
  percent: number | null;
  caption?: string;
  tone?: StatusTone;
}) {
  const style = toneStyle(tone);
  return (
    <Link
      to={href}
      aria-label={`Open ${label}`}
      data-tone={tone}
      className={`group ${overviewStyles.metric}`}
    >
      <div className={overviewStyles.metricTop}>
        <span className={overviewStyles.metricIcon}>
          <Icon aria-hidden="true" />
        </span>
        <p className={overviewStyles.metricLabel}>{label}</p>
        <AppIcon aria-hidden="true" className={`ri-arrow-right-s-line ${overviewStyles.metricArrow}`} />
      </div>
      <dl className={overviewStyles.metricValues}>
        <div>
          <dt className={overviewStyles.metricSubLabel}>{valueLabel}</dt>
          <dd className={`${overviewStyles.metricValue} ${tone === 'neutral' ? 'text-foreground-900' : style.text}`}>{value}</dd>
        </div>
        <div>
          <dt className={overviewStyles.metricSubLabel}>{targetLabel}</dt>
          <dd className={`${overviewStyles.metricValue} text-foreground-900`}>{targetValue}
            {targetDetail && <span className={overviewStyles.metricValueDetail}>{targetDetail}</span>}
          </dd>
        </div>
      </dl>
      <ProgressBar percent={percent} tone={percent == null || tone === 'neutral' ? undefined : style.dot} height="h-3" className={overviewStyles.metricBar} />
      {caption ? <p className={overviewStyles.metricCaption}>
        <span>{caption}</span>
      </p> : null}
    </Link>
  );
}
