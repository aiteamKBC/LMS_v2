import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { fetchKsbProfile } from '@/api/curriculum';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import OTJHTab from './components/OTJHTab';
import KSBsTab from './components/KSBsTab';
import EvidenceTab from './components/EvidenceTab';
import AuditTab from '@/features/audit/AuditTab';
import ActivityTab from './components/ActivityTab';
import DocumentsTab from './components/DocumentsTab';
import NetworkTab from './components/NetworkTab';
import LearningPlanTab from './components/OverviewTab';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import {
  flattenJourney,
  formatFraction,
  formatHours,
  formatPercent,
  toneFromPercent,
  useCoachLearnerCaseFileData,
  type CaseFileReviewMeeting,
  type CoachLearnerCaseFileData,
} from './data';

const coachNav = roleNavMap.coach;
const ATTENDANCE_DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';

const CASE_FILE_TABS = [
  { id: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { id: 'programme', label: 'Programme & Employer', icon: 'ri-building-line' },
  { id: 'progress', label: 'OTJH & KSB Progress', icon: 'ri-line-chart-line' },
  { id: 'attendance', label: 'Attendance', icon: 'ri-calendar-check-line' },
  { id: 'reviews', label: 'Reviews & Meetings', icon: 'ri-calendar-todo-line' },
  { id: 'support', label: 'Learning Plan', icon: 'ri-route-line' },
  { id: 'otjh', label: 'OTJH', icon: 'ri-time-line' },
  { id: 'ksbs', label: 'KSBs', icon: 'ri-award-line' },
  { id: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line' },
  { id: 'audit', label: 'Audit', icon: 'ri-file-search-line' },
  { id: 'activity', label: 'Activity', icon: 'ri-history-line' },
  { id: 'network', label: 'Network', icon: 'ri-user-heart-line' },
  { id: 'documents', label: 'Documents', icon: 'ri-folder-line' },
] as const;

type TabId = typeof CASE_FILE_TABS[number]['id'] | 'coach-notes';
const HIDDEN_CASE_FILE_TAB_IDS = new Set<typeof CASE_FILE_TABS[number]['id']>([
  'otjh',
  'ksbs',
  'evidence',
  'audit',
  'activity',
  'network',
  'documents',
]);
const NAV_TABS = CASE_FILE_TABS.filter(tab => !HIDDEN_CASE_FILE_TAB_IDS.has(tab.id));
type LocationState = {
  learnerId?: string;
  learnerName?: string;
  kind?: 'commercial' | 'apprenticeship';
  tab?: string;
};

interface AttendanceDetailSession {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  sessionId: string;
  sessionTitle: string;
  sessionType: string;
  sessionDate: string | null;
  sessionDateLabel: string;
  startTime: string;
  endTime: string;
  status: string;
  reason: string;
  catchupCompleted?: boolean;
}

interface AttendanceDetailsResponse {
  sessions?: AttendanceDetailSession[];
}

interface AttendanceDetailsErrorResponse {
  detail?: string;
  error?: string;
}

export default function LearnerCaseFile() {
  const coach = useCoachIdentity();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [stickyVisible, setStickyVisible] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as LocationState;

  const requestedTab = searchParams.get('tab') || state.tab;
  const learnerId = searchParams.get('id') || state.learnerId;
  const learnerName = state.learnerName;
  const explicitKind = parseLearnerKind(searchParams.get('kind') || state.kind);

  const { data, loading, error } = useCoachLearnerCaseFileData({
    learnerId,
    learnerName,
    kind: explicitKind,
    enabled: coach.isInitialized && coach.hasCoachAccess,
  });

  useEffect(() => {
    if (CASE_FILE_TABS.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab as TabId);
    }
  }, [requestedTab]);

  useEffect(() => {
    const onScroll = () => {
      setStickyVisible(window.scrollY > 240);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const subtitle = buildSubtitle(data);
  const pageTitle = data?.displayName || learnerName || 'Learner case file';
  const pageSubtitle = subtitle || 'Live learner view for coaching support';
  const planHighlights = data ? flattenJourney(data).slice(0, 6) : [];
  const riskItems = data ? buildRiskItems(data) : [];
  const contacts = data ? buildContacts(data) : [];
  const quizAttempts = data?.detail?.quizAttempts || [];
  const latestQuiz = [...quizAttempts].sort((left, right) => {
    return new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime();
  })[0];
  const latestQuizSummary = latestQuiz ? formatLatestQuizSummary(data?.detail ?? null, latestQuiz) : '--';
  const nextLiveSession = data?.upcomingSessions[0] || null;

  const handleOpenTrainingPlan = () => {
    if (!data?.kind || !data.learnerId) {
      return;
    }
    navigate(`/learner/training-plan/${data.kind}/${data.learnerId}`);
  };

  const renderTab = () => {
    if (!data) {
      return (
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          {loading
            ? <RowsSkeleton rows={5} />
            : <EmptyState text={error || 'No learner selected.'} />}
        </div>
      );
    }

    switch (activeTab) {
      case 'overview':
        return <ReferenceOverviewContent data={data} />;
      case 'programme':
        return <ReferenceProgrammeContent data={data} />;
      case 'progress':
        return <ReferenceProgressContent data={data} />;
      case 'attendance':
        return <ReferenceAttendanceContent data={data} />;
      case 'reviews':
        return <ReferenceReviewsContent data={data} />;
      case 'coach-notes':
        return <DocumentsTab data={data} />;
      case 'support':
        return <LearningPlanTab data={data} />;
      case 'otjh':
        return <OTJHTab data={data} />;
      case 'ksbs':
        return <KSBsTab data={data} />;
      case 'evidence':
        return <EvidenceTab data={data} />;
      case 'audit':
        return <AuditTab data={data} />;
      case 'activity':
        return <ActivityTab data={data} />;
      case 'network':
        return <NetworkTab data={data} />;
      case 'documents':
        return <DocumentsTab data={data} />;
      default:
        return <ReferenceOverviewContent data={data} />;
    }
  };

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      userName={data?.coachName || coach.name}
      userRole="Progress Coach"
    >
      <main className="min-h-screen bg-[#f7f6fb] p-4 md:p-6">
        <div className="w-full space-y-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-[11px] font-semibold text-foreground-400 transition hover:text-primary-700"
          >
            <AppIcon className="ri-arrow-left-line"></AppIcon>
            My Learners
            <span className="text-foreground-300">/</span>
            <span className="text-foreground-700">{pageTitle}</span>
          </button>

          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800">{error}</div>
          )}

          <section className="overflow-hidden rounded-2xl border border-primary-800/15 bg-white shadow-[0_12px_34px_rgba(48,24,90,0.1)]">
            <div
              className="px-6 py-7 text-white md:px-8 md:py-8"
              style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
            >
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-5">
                  <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-white/30 bg-white/15 text-[22px] font-bold shadow-lg">
                    {data?.initials || '--'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-[30px] font-heading font-bold leading-tight text-white md:text-[34px]">{pageTitle}</h1>
                      <span className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${statusBadgeClass(data)}`}>{statusLabel(data)}</span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-white/75">
                      {data?.email && <span className="inline-flex items-center gap-1.5"><AppIcon className="ri-mail-line"></AppIcon>{data.email}</span>}
                      {data?.detail?.phone && <span className="inline-flex items-center gap-1.5"><AppIcon className="ri-phone-line"></AppIcon>{data.detail.phone}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => navigate('/coach/timetable')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-[12px] font-bold text-primary-700 shadow-sm transition hover:bg-primary-50">
                    <AppIcon className="ri-calendar-line"></AppIcon> Schedule
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-foreground-100 sm:grid-cols-4 xl:grid-cols-7 xl:divide-y-0">
              <ProfileTopStat label="Overall" value={formatPercent(data?.overallProgress ?? null)} tone="primary" />
              <ProfileTopStat label="OTJH" value={data ? formatFraction(data.otjhCompleted, data.otjhTarget) : '--'} tone="primary" />
              <ProfileTopStat label="KSB" value={formatPercent(data?.ksbProgress ?? null)} tone="emerald" />
              <ProfileTopStat label="Attendance" value={formatPercent(data?.attendanceRate ?? null)} tone="emerald" />
              <ProfileTopStat label="RAG" value={data?.snapshot?.coachRag || '--'} tone={profileRagTone(data?.snapshot?.coachRag)} dot />
              <ProfileTopStat label="Gateway" value={data?.gatewayReviewDate || '--'} tone="primary" />
              <ProfileTopStat label="Next Session" value={nextLiveSession?.summary || '--'} tone="muted" wrap />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-white shadow-sm">
            <div className="overflow-x-auto border-b border-foreground-100 scrollbar-hide">
              <div className="flex min-w-max px-2">
                {NAV_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-1.5 px-4 py-3.5 text-[10px] font-semibold transition ${
                      activeTab === tab.id ? 'text-primary-700' : 'text-foreground-400 hover:text-foreground-700'
                    }`}
                  >
                    <AppIcon className={tab.icon}></AppIcon>
                    {tab.label}
                    {activeTab === tab.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary-600"></span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-background-100/30 p-4 md:p-5">
              {renderTab()}
            </div>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      userName="--"
      userRole="Progress Coach"
    >
      <div
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
          stickyVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-background-50/95 backdrop-blur-md border-b border-foreground-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full border border-background-200 bg-background-100 flex items-center justify-center shrink-0 text-xs font-bold text-foreground-800 font-heading">
              {data?.initials || '--'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground-900 truncate">{pageTitle}</p>
              <p className="text-[10px] text-foreground-400 truncate">{pageSubtitle}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {data?.kind && (
                <button
                  onClick={handleOpenTrainingPlan}
                  className="px-3 py-1.5 rounded-full bg-background-100 text-foreground-700 text-[11px] font-semibold hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1"
                >
                  <AppIcon className="ri-route-line text-xs"></AppIcon> Training Plan
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-screen bg-background-100/70 pb-10">
        <div className="px-4 py-5 md:px-8">
          <div className="space-y-5">
          {error && data && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 shadow-sm">
              {error}
            </div>
          )}

          <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#070112_0%,#130329_48%,#2a0756_100%)] text-white shadow-[0_24px_60px_rgba(7,1,18,0.22)] ring-1 ring-foreground-950/5">
            <div className="pointer-events-none absolute -left-16 top-8 h-56 w-56 rounded-full bg-primary-500/20 blur-3xl" aria-hidden="true"></div>
            <div className="pointer-events-none absolute -right-14 -top-20 h-64 w-64 rounded-full bg-secondary-400/10 blur-3xl" aria-hidden="true"></div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/10" aria-hidden="true"></div>

            <div className="relative p-5 md:p-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="relative mx-auto h-28 w-28 shrink-0 md:mx-0">
                    <ProgressRing progress={data?.overallProgress ?? null} initials={data?.initials || '--'} />
                  </div>

                  <div className="min-w-0 text-center md:text-left">
                    <div className="flex flex-col items-center gap-2 md:flex-row md:items-center">
                      <h1 className="text-2xl font-heading font-bold tracking-tight text-white md:text-3xl">
                        {pageTitle}
                      </h1>
                      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusBadgeClass(data)}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(data)}`}></span>
                        {statusLabel(data)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                      {data?.programme && (
                        <span className="text-sm font-semibold text-white/90">{data.programme}</span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12px] text-white/70 md:justify-start">
                      {data?.cohort && (
                        <span className="inline-flex items-center gap-1">
                          <AppIcon className="ri-group-line text-white/50"></AppIcon>
                          Cohort {data.cohort}
                        </span>
                      )}
                      {data?.group && (
                        <span className="inline-flex items-center gap-1">
                          <AppIcon className="ri-team-line text-white/50"></AppIcon>
                          Group {data.group}
                        </span>
                      )}
                      {data?.startDate && data.startDate !== '--' && (
                        <span className="inline-flex items-center gap-1">
                          <AppIcon className="ri-calendar-line text-white/50"></AppIcon>
                          Started {data.startDate}
                        </span>
                      )}
                      {data?.email && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <AppIcon className="ri-mail-line text-white/50"></AppIcon>
                          <span className="truncate">{data.email}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[500px]">
                  <SignalCard icon="ri-pie-chart-line" label="Progress" value={formatPercent(data?.overallProgress ?? null)} tone="primary" />
                  <SignalCard icon="ri-calendar-check-line" label="Attendance" value={formatPercent(data?.attendanceRate ?? null)} tone="emerald" />
                  <SignalCard icon="ri-time-line" label="OTJH" value={data ? formatFraction(data.otjhCompleted, data.otjhTarget) : '--'} tone="amber" />
                  <SignalCard icon="ri-folder-upload-line" label="Evidence" value={String(data?.evidenceCount ?? '--')} tone="accent" />
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/10 p-1 shadow-inner scrollbar-hide">
                  {NAV_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative px-3.5 py-2.5 rounded-xl text-[12px] font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                        activeTab === tab.id
                          ? 'bg-white text-[#140427] shadow-sm ring-1 ring-white/30'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <AppIcon className={`${tab.icon} text-sm ${activeTab === tab.id ? 'text-primary-700' : 'text-white/60'}`}></AppIcon>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {data?.kind && (
                    <button
                      onClick={handleOpenTrainingPlan}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/20 bg-white px-4 py-2.5 text-[13px] font-semibold text-foreground-950 shadow-sm transition-all hover:bg-white/90"
                    >
                      <AppIcon className="ri-route-line text-sm"></AppIcon> View Plan
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="min-w-0">
              {renderTab()}
            </div>

            <div className="w-full space-y-4 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto xl:pr-1 scrollbar-hide">
              <SidebarCard title="Risk Assessment">
                {riskItems.length === 0 ? (
                  <EmptyState text="Risk indicators will appear when live learner metrics are available." />
                ) : (
                  riskItems.map((item) => (
                    <div key={item.label} className="flex items-start gap-3 p-2.5 rounded-lg bg-background-100/50">
                      <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${riskToneDot(item.tone)}`}></span>
                      <div>
                        <p className="text-[12px] font-medium text-foreground-900">{item.label}</p>
                        <p className="text-[10px] text-foreground-400">{item.detail}</p>
                      </div>
                    </div>
                  ))
                )}
              </SidebarCard>

              <SidebarCard title="Key People">
                {contacts.length === 0 ? (
                  <EmptyState text="No contact records were returned for this learner yet." />
                ) : (
                  contacts.map((contact) => (
                    <div key={`${contact.role}-${contact.name}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-background-100/50">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${contact.tone}`}>
                        {contact.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-foreground-900">{contact.name}</p>
                        <p className="text-[10px] text-foreground-400">{contact.role}</p>
                        {contact.meta && <p className="text-[10px] text-foreground-300 truncate">{contact.meta}</p>}
                      </div>
                    </div>
                  ))
                )}
              </SidebarCard>

              <SidebarCard title="Plan Highlights">
                {planHighlights.length === 0 ? (
                  <EmptyState text="No structured learning plan has been attached to this learner yet." />
                ) : (
                  planHighlights.map((item, index) => (
                    <div key={`${item.module}-${item.week}-${item.title}-${index}`} className="flex items-start gap-3 p-2 rounded-lg bg-background-100/50">
                      <span className="text-[11px] font-semibold text-foreground-600 w-16 shrink-0">
                        {shortWeekLabel(item.week)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-foreground-900">{item.title}</p>
                        <p className="text-[10px] text-foreground-400">
                          {item.module}
                          {item.expectedOtjh ? ` - ${item.expectedOtjh}h OTJH` : ''}
                        </p>
                      </div>
                      {item.isQuiz && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                          Quiz
                        </span>
                      )}
                    </div>
                  ))
                )}
              </SidebarCard>

              <SidebarCard title="Programme Info">
                <InfoRow label="Programme" value={data?.programme || '--'} />
                <InfoRow label="Status" value={data?.programStatus || '--'} />
                <InfoRow label="Cohort" value={data?.cohort || '--'} />
                <InfoRow label="Group" value={data?.group || '--'} />
                <InfoRow label="Modules" value={String(data?.journey.length || 0)} />
                <InfoRow label="Weeks" value={String(data?.journey.reduce((count, module) => count + module.weeks.length, 0) || 0)} />
                <InfoRow label="KSBs" value={String(data?.detail?.ksbs.length || 0)} />
                <InfoRow label="Planned OTJH" value={data ? formatFraction(data.otjhCompleted, data.otjhTarget) : '--'} />
                <InfoRow label="Gateway Review" value={data?.gatewayReviewDate || '--'} />
                <InfoRow label="Planned End" value={data?.plannedEndDate || '--'} />
              </SidebarCard>

              <SidebarCard title="Assessment Snapshot">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center mb-3 shadow-sm">
                    <AppIcon className="ri-question-answer-line text-white text-2xl"></AppIcon>
                  </div>
                  <p className="text-2xl font-heading font-bold text-foreground-900">
                    {data?.detail?.quizAttempts.length || 0}
                  </p>
                  <p className="text-[11px] text-foreground-400 mt-0.5">Quiz attempts</p>
                  <div className="mt-3 pt-3 border-t border-background-200 space-y-1">
                    <p className="text-[11px] text-foreground-500">
                      Passed:{' '}
                      <span className="font-semibold text-foreground-900">
                        {data?.detail?.quizAttempts.filter((attempt) => attempt.passed).length || 0}
                      </span>
                    </p>
                    <p className="text-[11px] text-foreground-500">
                      Latest:{' '}
                      <span className="font-semibold text-foreground-900">
                        {latestQuizSummary}
                      </span>
                    </p>
                    <p className="text-[10px] text-foreground-400">
                      {data?.touchedKsbCodes.length || 0} KSB code(s) surfaced via learner progress
                    </p>
                  </div>
                </div>
              </SidebarCard>
            </div>
          </div>
        </div>
      </div>
      </div>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </WorkspaceShell>
  );
}

function ReferenceOverviewContent({ data }: { data: CoachLearnerCaseFileData }) {
  const risks = buildRiskItems(data).filter((item) => item.tone === 'red' || item.tone === 'amber');
  const activities = data.activityItems.slice(0, 6);
  const upcomingSessions = data.upcomingSessions;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <ReferencePanel title="Programme" icon="ri-graduation-cap-line" tone="primary">
          <ProfileInfo label="Qualification" value={data.programme} />
          <ProfileInfo label="Cohort" value={data.cohort} />
          <ProfileInfo label="Group" value={data.group} />
          <ProfileInfo label="Start Date" value={data.startDate} />
          <ProfileInfo label="Gateway Date" value={data.gatewayReviewDate} />
        </ReferencePanel>
        <ReferencePanel title="Progress Summary" icon="ri-line-chart-line" tone="emerald">
          <ProfileProgress label="Overall Progress" value={data.overallProgress} color="bg-primary-600" />
          <ProfileProgress label="KSB Progress" value={data.ksbProgress} color="bg-emerald-500" />
          <ProfileProgress label="Attendance" value={data.attendanceRate} color="bg-amber-500" />
          <div className="mt-3 flex items-center justify-between border-t border-foreground-100 pt-3 text-[10px]">
            <span className="text-foreground-400">Evidence records</span>
            <strong className="text-foreground-800">{data.evidenceCount ?? '--'}</strong>
          </div>
        </ReferencePanel>
        <ReferencePanel title="Alerts & Actions" icon="ri-alarm-warning-line" tone="red">
          {risks.length === 0 ? (
            <p className="flex items-center gap-2 text-[11px] font-medium text-emerald-600"><AppIcon className="ri-checkbox-circle-line"></AppIcon>No risk factors identified</p>
          ) : risks.map((risk) => (
            <div key={risk.label} className="mb-2 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
              <p className="text-[11px] font-bold text-amber-800">{risk.label}</p>
              <p className="mt-0.5 text-[10px] text-amber-700">{risk.detail}</p>
            </div>
          ))}
        </ReferencePanel>
      </div>
      <ReferencePanel title="Recent Activity" icon="ri-history-line" tone="muted">
        {activities.length === 0 ? <ProfileEmpty text="No recent activity is available." /> : activities.map((item) => (
          <div key={item.id} className="flex gap-3 border-b border-foreground-100 py-2.5 last:border-0">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${overviewToneClasses(item.tone)}`}><AppIcon className="ri-history-line text-xs"></AppIcon></span>
            <div className="min-w-0 flex-1"><p className="text-[11px] font-bold text-foreground-800">{item.event}</p><p className="truncate text-[10px] text-foreground-400">{item.detail || 'No details available.'}</p></div>
            <span className="text-[9px] text-foreground-300">{item.date}</span>
          </div>
        ))}
      </ReferencePanel>
      <ReferencePanel title="Upcoming Sessions" icon="ri-calendar-event-line" tone="primary">
        {upcomingSessions.length === 0 ? <ProfileEmpty text="No upcoming live session is scheduled." /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {upcomingSessions.map((session) => (
              <div key={session.id} className="rounded-xl border border-primary-100 bg-primary-50/35 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold text-foreground-800">{session.title}</p>
                    <p className="mt-1 text-[10px] text-primary-700">{session.day} · {session.date}</p>
                    <p className="mt-1 text-[10px] font-medium text-foreground-500">{session.time}</p>
                  </div>
                  <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[9px] font-semibold text-primary-700">
                    Live
                  </span>
                </div>
                <p className="mt-2 text-[10px] text-foreground-500">{session.detail}</p>
              </div>
            ))}
          </div>
        )}
      </ReferencePanel>
    </div>
  );
}

function ReferenceProgrammeContent({ data }: { data: CoachLearnerCaseFileData }) {
  const contacts = buildContacts(data);
  return (
    <div className="space-y-5">
      <ReferencePanel title="Programme Details" icon="ri-graduation-cap-line" tone="primary">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <ProfileInfo label="Programme" value={data.programme} />
          <ProfileInfo label="Cohort" value={data.cohort} />
          <ProfileInfo label="Group" value={data.group} />
          <ProfileInfo label="Employer" value={data.employer} />
          <ProfileInfo label="Start Date" value={data.startDate} />
          <ProfileInfo label="Planned Gateway" value={data.gatewayReviewDate} />
          <ProfileInfo label="Planned End" value={data.plannedEndDate} />
          <ProfileInfo label="Status" value={data.programStatus} />
        </div>
      </ReferencePanel>
      <ReferencePanel title="Employer Information" icon="ri-building-line" tone="primary">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl bg-background-100/70 p-4">
            <ProfileInfo label="Organisation" value={data.employer} />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <ProfileInfo label="Employer Email" value={data.employerEmail} />
              <ProfileInfo label="Employer Phone" value={data.employerPhone} />
            </div>
          </div>
          <div className="space-y-2">
            {contacts.length === 0 ? <ProfileEmpty text="No employer contacts are available." /> : contacts.map((contact) => (
              <div key={`${contact.role}-${contact.name}`} className="rounded-xl bg-background-100/70 p-4">
                <p className="text-[11px] font-bold text-foreground-800">{contact.name}</p>
                <p className="text-[10px] text-foreground-400">{contact.role}</p>
                {contact.meta && <p className="mt-1 text-[10px] text-primary-600">{contact.meta}</p>}
              </div>
            ))}
          </div>
        </div>
      </ReferencePanel>
    </div>
  );
}

function ReferenceProgressContent({ data }: { data: CoachLearnerCaseFileData }) {
  const [activeKsbCategory, setActiveKsbCategory] = useState('All');
  const [ksbSearch, setKsbSearch] = useState('');
  const [fallbackKsbs, setFallbackKsbs] = useState<Array<{ code: string; description: string; type: string; number: string }>>([]);
  const [fallbackKsbsLoading, setFallbackKsbsLoading] = useState(false);
  const [openKsbCategory, setOpenKsbCategory] = useState<string | null>(null);
  const completed = data.otjhCompleted;
  const target = data.otjhTarget;
  const programmeTotal = data.totalExpectedOtjh || null;
  const remaining = completed !== null && target !== null ? Math.max(0, target - completed) : null;
  const otjhPercent = completed !== null && target !== null && target > 0
    ? Math.min(100, Math.round((completed / target) * 100))
    : null;
  const primaryKsbs = data.detail?.ksbs || [];

  useEffect(() => {
    if (primaryKsbs.length > 0 || !data.programme) {
      setFallbackKsbs([]);
      setFallbackKsbsLoading(false);
      return;
    }

    let cancelled = false;
    setFallbackKsbsLoading(true);

    fetchKsbProfile(data.programme)
      .then((response) => {
        if (cancelled) {
          return;
        }

        const deduped = new Map<string, { code: string; description: string; type: string; number: string }>();
        for (const item of response.results || []) {
          const kind = String(item.kind || item.theme || '').trim() || 'Knowledge';
          const description = String(item.title || '').trim();
          for (const rawCode of item.codes || []) {
            const code = String(rawCode || '').trim().toUpperCase();
            if (!code || deduped.has(code)) {
              continue;
            }
            deduped.set(code, {
              code,
              description: description || code,
              type: kind,
              number: code.replace(/^[A-Z]+/i, ''),
            });
          }
        }

        setFallbackKsbs(Array.from(deduped.values()));
      })
      .catch(() => {
        if (!cancelled) {
          setFallbackKsbs([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFallbackKsbsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [primaryKsbs.length, data.programme]);

  const touched = new Set(data.touchedKsbCodes.map((code) => code.toUpperCase()));
  const sourceKsbs = buildDisplayKsbs(data, fallbackKsbs);
  const ksbs = sourceKsbs
    .map((item) => {
      const code = String(item.code || '').toUpperCase();
      return {
        ...item,
        code,
        category: ksbCategoryFromCode(code),
        linked: touched.has(code),
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' }));
  const linkedCount = ksbs.filter((item) => item.linked).length;
  const unlinkedCount = Math.max(0, ksbs.length - linkedCount);
  const categoryOrder = ['Knowledge', 'Skills', 'Behaviours', 'Other'];
  const categoryOptions = Array.from(new Set(ksbs.map((item) => item.category))).sort((left, right) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    const normalizedLeft = leftIndex === -1 ? categoryOrder.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? categoryOrder.length : rightIndex;
    return normalizedLeft - normalizedRight || left.localeCompare(right);
  });
  const categorySummary = categoryOptions.map((category) => {
    const items = ksbs.filter((item) => item.category === category);
    const linked = items.filter((item) => item.linked).length;
    return { category, total: items.length, linked };
  });
  const normalizedSearch = ksbSearch.trim().toLowerCase();
  const filteredKsbs = ksbs.filter((item) => {
    const matchesCategory = activeKsbCategory === 'All' || item.category === activeKsbCategory;
    const matchesSearch = !normalizedSearch
      || item.code.toLowerCase().includes(normalizedSearch)
      || item.description.toLowerCase().includes(normalizedSearch)
      || item.category.toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });
  const visibleCategoryGroups = categoryOptions
    .map((category) => {
      const items = filteredKsbs.filter((item) => item.category === category);
      const linked = items.filter((item) => item.linked).length;
      return { category, items, total: items.length, linked };
    })
    .filter((group) => group.total > 0);
  const hasActiveFilters = activeKsbCategory !== 'All' || normalizedSearch.length > 0;
  const hasFocusedCategoryFilter = activeKsbCategory !== 'All' && !normalizedSearch;
  return (
    <div className="space-y-5">
      <ReferencePanel title="Off-the-Job Hours (OTJH)" icon="ri-time-line" tone="primary">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BigMetric value={formatHours(data.otjhCompleted)} label="Hours Logged" tone="primary" />
          <BigMetric value={formatHours(data.otjhTarget)} label="Current Target" tone="muted" />
          <BigMetric value={formatHours(programmeTotal)} label="Programme Total" tone="amber" />
          <BigMetric value={formatHours(remaining)} label="Hours Remaining" tone="red" />
        </div>
        <ProfileProgress label="OTJH Progress" value={otjhPercent} color="bg-primary-600" />
      </ReferencePanel>
      <ReferencePanel title="Progress Snapshot" icon="ri-pie-chart-line" tone="primary">
        <div className="grid gap-6 sm:grid-cols-2">
          <ProfileRing label="OTJH" value={otjhPercent} color="#0ea5e9" />
          <ProfileRing label="KSB" value={data.ksbProgress} color="#18b978" />
        </div>
      </ReferencePanel>
      <ReferencePanel title="KSB Detailed Breakdown" icon="ri-file-list-3-line" tone="primary">
        {fallbackKsbsLoading && ksbs.length === 0 ? <div className="p-2"><RowsSkeleton rows={4} avatar={false} /></div> : ksbs.length === 0 ? <ProfileEmpty text="No learner KSB snapshot or programme KSB framework is available yet." /> : (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <KsbOverviewCard icon="ri-stack-line" label="Total KSBs" value={String(ksbs.length)} tone="primary" />
              <KsbOverviewCard icon="ri-links-line" label="Evidence linked" value={String(linkedCount)} tone="emerald" />
              <KsbOverviewCard icon="ri-focus-3-line" label="Not evidenced" value={String(unlinkedCount)} tone="muted" />
            </div>

            <div className="grid gap-4 2xl:grid-cols-[minmax(330px,0.92fr)_minmax(0,1.35fr)]">
              <div className="rounded-3xl border border-primary-200/70 bg-primary-50/35 p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-primary-700 shadow-sm">
                    <AppIcon className="ri-filter-3-line text-lg"></AppIcon>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-foreground-900">Browse all programme KSBs</p>
                    <p className="mt-1 text-[11px] leading-5 text-foreground-500">
                      Search by code, category, or description, then review each KSB inside its own category section.
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/80 bg-white/90 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Quick filters</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {['All', ...categoryOptions].map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveKsbCategory(category)}
                        className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
                          activeKsbCategory === category
                            ? 'bg-primary-700 text-white shadow-sm'
                            : 'bg-background-50 text-foreground-600 ring-1 ring-foreground-200/70 hover:bg-background-100'
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>

                  <div className="relative mt-3">
                    <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></AppIcon>
                    <input
                      type="text"
                      value={ksbSearch}
                      onChange={(event) => setKsbSearch(event.target.value)}
                      placeholder="Search code, category, or description..."
                      className="w-full rounded-2xl border border-primary-200/70 bg-white py-2.5 pl-9 pr-3 text-[12px] text-foreground-900 outline-none transition focus:border-primary-400"
                    />
                  </div>
                </div>

                {hasActiveFilters && (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveKsbCategory('All');
                        setKsbSearch('');
                      }}
                      className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Reset filters
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-foreground-200/60 bg-background-100/45 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[13px] font-bold text-foreground-900">Coverage by category</p>
                    <p className="mt-1 text-[11px] leading-5 text-foreground-500">
                      Each section below keeps linked and not-evidenced KSBs separated in a cleaner way for review.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-foreground-200/70 bg-white px-3 py-2 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Visible now</p>
                    <p className="mt-1 text-[12px] font-bold text-foreground-900">{filteredKsbs.length} of {ksbs.length} KSBs</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {categorySummary.map((group) => (
                    <div key={group.category} className="rounded-2xl border border-foreground-200/70 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(31,14,59,0.03)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${ksbCodeTone(group.category)}`}>
                            <AppIcon className={`${ksbCategoryIcon(group.category)} text-sm`}></AppIcon>
                          </span>
                          <div>
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${ksbCategoryBadge(group.category)}`}>
                              {group.category}
                            </span>
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-foreground-700">{group.linked}/{group.total}</span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background-200">
                        <div
                          className={`h-full rounded-full ${ksbCategoryProgressTone(group.category)}`}
                          style={{ width: `${group.total ? (group.linked / group.total) * 100 : 0}%` }}
                        ></div>
                      </div>
                      <p className="mt-3 text-[11px] text-foreground-600">
                        {group.linked} linked and {Math.max(0, group.total - group.linked)} still awaiting evidence.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {filteredKsbs.length === 0 ? <ProfileEmpty text="No KSBs matched the current filter." /> : (
              <div className="space-y-4">
                {visibleCategoryGroups.map((group) => {
                  const categoryTone = ksbCategorySectionTone(group.category);
                  const isOpen = hasActiveFilters || openKsbCategory === group.category;
                  const sectionScrollClass = hasFocusedCategoryFilter
                    ? 'mt-4 max-h-[72vh] overflow-y-auto pr-1'
                    : 'mt-4 max-h-[520px] overflow-y-auto pr-1';

                  return (
                    <section
                      key={group.category}
                      className={`overflow-hidden rounded-3xl border bg-white shadow-[0_12px_28px_rgba(31,14,59,0.04)] ${categoryTone.shell}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (hasActiveFilters) {
                            return;
                          }
                          setOpenKsbCategory(openKsbCategory === group.category ? null : group.category);
                        }}
                        className={`w-full border-b px-5 py-4 text-left transition ${categoryTone.header}`}
                      >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                          <div className="flex items-start gap-3">
                            <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${categoryTone.icon}`}>
                              <AppIcon className={`${ksbCategoryIcon(group.category)} text-lg`}></AppIcon>
                            </span>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-[14px] font-bold text-foreground-900">{group.category}</h4>
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${ksbCategoryBadge(group.category)}`}>
                                  {group.total} KSBs
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-foreground-500">
                                {group.linked} evidenced and {Math.max(0, group.total - group.linked)} waiting for learner evidence.
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Evidence linked</p>
                              <p className="mt-1 text-[18px] font-bold text-foreground-900">{group.linked}</p>
                            </div>
                            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Coverage</p>
                              <p className="mt-1 text-[18px] font-bold text-foreground-900">
                                {group.total ? Math.round((group.linked / group.total) * 100) : 0}%
                              </p>
                            </div>
                            {!hasActiveFilters && (
                              <span className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-2 text-[10px] font-semibold text-foreground-600">
                                {isOpen ? 'Collapse' : 'Expand'}
                                <AppIcon className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-sm`}></AppIcon>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/80">
                          <div
                            className={`h-full rounded-full ${categoryTone.progress}`}
                            style={{ width: `${group.total ? (group.linked / group.total) * 100 : 0}%` }}
                          ></div>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="p-5">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground-200/70 pb-3">
                            <p className="text-[11px] font-semibold text-foreground-600">
                              Showing all {group.total} KSBs in this section
                            </p>
                            <span className="inline-flex items-center gap-2 rounded-full border border-foreground-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-foreground-500">
                              Scroll inside section
                              <AppIcon className="ri-arrow-down-up-line text-sm"></AppIcon>
                            </span>
                          </div>

                          <div className={sectionScrollClass}>
                            <div className="grid gap-4 xl:grid-cols-2">
                              {group.items.map((item) => (
                                <article key={item.code} className="flex h-full flex-col rounded-2xl border border-foreground-200/70 bg-white p-4 shadow-[0_8px_22px_rgba(31,14,59,0.04)]">
                                  <div className="flex items-start gap-3">
                                    <span className={`inline-flex h-11 min-w-11 items-center justify-center rounded-2xl px-2 text-[11px] font-bold ${ksbCodeTone(item.category)}`}>
                                      {item.code}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${ksbCategoryBadge(item.category)}`}>
                                          {item.category}
                                        </span>
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-semibold ${item.linked ? 'bg-emerald-50 text-emerald-700' : 'bg-background-200 text-foreground-500'}`}>
                                          {item.linked ? 'Evidence linked' : 'Not evidenced'}
                                        </span>
                                      </div>
                                      <p className="mt-3 text-[12px] font-semibold leading-5 text-foreground-900">{item.description}</p>
                                    </div>
                                  </div>

                                  <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] leading-5 ${item.linked ? 'border-emerald-100 bg-emerald-50/80 text-emerald-800' : 'border-foreground-200 bg-background-100/70 text-foreground-500'}`}>
                                    <AppIcon className={`${item.linked ? 'ri-checkbox-circle-line' : 'ri-information-line'} text-sm`}></AppIcon>
                                    <span>
                                      {item.linked
                                        ? 'Already surfaced in the learner evidence snapshot.'
                                        : 'No learner evidence has surfaced for this KSB yet.'}
                                    </span>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </ReferencePanel>
    </div>
  );
}

function buildDisplayKsbs(
  data: CoachLearnerCaseFileData,
  fallbackKsbs: Array<{ code: string; description: string; type: string; number: string }> = [],
) {
  return data.detail?.ksbs?.length ? data.detail.ksbs : fallbackKsbs;
}

function ksbCategoryFromCode(code: string) {
  if (code.startsWith('K')) return 'Knowledge';
  if (code.startsWith('S')) return 'Skills';
  if (code.startsWith('B')) return 'Behaviours';
  return 'Other';
}

function ksbCategoryBadge(category: string) {
  if (category === 'Knowledge') return 'bg-primary-50 text-primary-700';
  if (category === 'Skills') return 'bg-sky-50 text-sky-700';
  if (category === 'Behaviours') return 'bg-amber-50 text-amber-700';
  return 'bg-background-100 text-foreground-600';
}

function ksbCodeTone(category: string) {
  if (category === 'Knowledge') return 'bg-primary-100 text-primary-700';
  if (category === 'Skills') return 'bg-sky-100 text-sky-700';
  if (category === 'Behaviours') return 'bg-amber-100 text-amber-700';
  return 'bg-background-100 text-foreground-600';
}

function ksbCategoryIcon(category: string) {
  if (category === 'Knowledge') return 'ri-book-open-line';
  if (category === 'Skills') return 'ri-tools-line';
  if (category === 'Behaviours') return 'ri-user-star-line';
  return 'ri-award-line';
}

function ksbCategoryProgressTone(category: string) {
  if (category === 'Knowledge') return 'bg-primary-600';
  if (category === 'Skills') return 'bg-sky-500';
  if (category === 'Behaviours') return 'bg-amber-500';
  return 'bg-foreground-400';
}

function ksbCategorySectionTone(category: string) {
  if (category === 'Knowledge') {
    return {
      shell: 'border-primary-200/70',
      header: 'bg-primary-50/65',
      icon: 'bg-primary-100 text-primary-700',
      progress: 'bg-primary-600',
    };
  }
  if (category === 'Skills') {
    return {
      shell: 'border-sky-200/70',
      header: 'bg-sky-50/70',
      icon: 'bg-sky-100 text-sky-700',
      progress: 'bg-sky-500',
    };
  }
  if (category === 'Behaviours') {
    return {
      shell: 'border-amber-200/80',
      header: 'bg-amber-50/80',
      icon: 'bg-amber-100 text-amber-700',
      progress: 'bg-amber-500',
    };
  }
  return {
    shell: 'border-foreground-200/70',
    header: 'bg-background-100/75',
    icon: 'bg-background-100 text-foreground-600',
    progress: 'bg-foreground-400',
  };
}

function KsbOverviewCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'emerald' | 'muted';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    muted: 'bg-background-100 text-foreground-600',
  } as const;

  return (
    <div className="rounded-2xl border border-foreground-200/60 bg-background-100/45 p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneMap[tone]}`}>
        <AppIcon className={`${icon} text-base`}></AppIcon>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground-900">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-400">{label}</p>
    </div>
  );
}

function ReferenceAttendanceContent({ data }: { data: CoachLearnerCaseFileData }) {
  const attendance = data.attendance;
  const [attendanceSessions, setAttendanceSessions] = useState<AttendanceDetailSession[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAttendanceSessions() {
      if (!attendance?.id || !attendance.hasAttendance) {
        setAttendanceSessions([]);
        setDetailsError(null);
        setDetailsLoading(false);
        return;
      }

      setDetailsLoading(true);
      setDetailsError(null);
      try {
        const params = new URLSearchParams({ learner_id: String(attendance.id) });
        const learnerEmail = attendance.email || data.email;
        if (learnerEmail) {
          params.set('learner_email', learnerEmail);
        }

        const response = await coachFetch(`${ATTENDANCE_DETAILS_ENDPOINT}?${params.toString()}`, {
          headers: { 'Content-Type': 'application/json' },
        });
        const payload = await response.json().catch(() => null) as unknown;
        const parsedPayload = payload && typeof payload === 'object'
          ? payload as AttendanceDetailsResponse & AttendanceDetailsErrorResponse
          : null;
        if (!response.ok) {
          const message = parsedPayload
            ? String(parsedPayload.error || parsedPayload.detail || 'Unable to load learner attendance sessions.')
            : 'Unable to load learner attendance sessions.';
          throw new Error(message);
        }

        if (!cancelled) {
          setAttendanceSessions(Array.isArray(parsedPayload?.sessions) ? parsedPayload.sessions : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setAttendanceSessions([]);
          setDetailsError(loadError instanceof Error ? loadError.message : 'Unable to load learner attendance sessions.');
        }
      } finally {
        if (!cancelled) {
          setDetailsLoading(false);
        }
      }
    }

    void loadAttendanceSessions();
    return () => {
      cancelled = true;
    };
  }, [attendance?.id, attendance?.email, attendance?.hasAttendance, data.email]);

  if (!attendance || !attendance.hasAttendance) return <ReferencePanel title="Attendance" icon="ri-calendar-check-line" tone="primary"><ProfileEmpty text="Live attendance data is not available for this learner." /></ReferencePanel>;
  const sessions = attendance.sessions || 0;
  const percentage = (value: number | null) => sessions > 0 && value !== null ? Math.round((value / sessions) * 100) : 0;
  const missedSessions = attendanceSessions.filter((session) => session.status === 'absent');
  const recentSessions = attendanceSessions.slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BigMetric value={formatPercent(attendance.attendance)} label="Attendance Rate" tone="primary" />
        <BigMetric value={String(attendance.sessions ?? '--')} label="Total Sessions" tone="muted" />
        <BigMetric value={String(attendance.present ?? '--')} label="Attended" tone="emerald" />
        <BigMetric value={String(attendance.absent ?? '--')} label="Absent" tone="red" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReferencePanel title="Attendance Breakdown" icon="ri-bar-chart-line" tone="primary">
          <ProfileProgress label={`Attended (${attendance.present ?? 0})`} value={percentage(attendance.present)} color="bg-emerald-500" />
          <ProfileProgress label={`Absent (${attendance.absent ?? 0})`} value={percentage(attendance.absent)} color="bg-red-500" />
          <ProfileProgress label={`Catch-up (${attendance.catchup ?? 0})`} value={percentage(attendance.catchup)} color="bg-slate-400" />
        </ReferencePanel>
        <ReferencePanel title="Missed Sessions" icon="ri-close-circle-line" tone="red">
          {detailsLoading ? (
            <div className="p-2"><RowsSkeleton rows={3} avatar={false} /></div>
          ) : detailsError ? (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-[11px] text-red-700">{detailsError}</div>
          ) : missedSessions.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-bold text-red-700">{missedSessions.length} session(s) missed</p>
                    <p className="mt-1 text-[10px] text-red-500">Latest absence reasons and catch-up status are shown below.</p>
                  </div>
                  {(attendance.consecutiveMissed || 0) > 0 && (
                    <span className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-[9px] font-semibold text-red-600">
                      {attendance.consecutiveMissed} consecutive
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                {missedSessions.slice(0, 3).map((session, index) => (
                  <div key={`${session.sessionId}-${session.sessionDate || index}`} className="rounded-xl border border-foreground-100 bg-background-100/55 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-semibold text-red-700">Absent</span>
                          <span className="text-[10px] text-foreground-400">{displayInline(session.sessionType)}</span>
                        </div>
                        <p className="mt-2 truncate text-[12px] font-bold text-foreground-900">{displayInline(session.sessionTitle)}</p>
                        <p className="mt-1 text-[10px] text-foreground-500">
                          Reason: {displayInline(session.reason, 'No reason recorded')}
                        </p>
                        <p className="mt-1 text-[10px] text-foreground-400">
                          {session.catchupCompleted ? 'Catch-up completed' : 'Catch-up not recorded'}
                        </p>
                      </div>
                      <div className="shrink-0 rounded-xl bg-background-50 px-3 py-2 text-left sm:text-right">
                        <p className="text-[11px] font-bold text-foreground-900">{displayInline(session.sessionDateLabel)}</p>
                        <p className="mt-0.5 text-[10px] text-foreground-400">{formatSessionTime(session.startTime, session.endTime)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {missedSessions.length > 3 && (
                <p className="text-[10px] text-foreground-400">Showing the latest 3 missed sessions out of {missedSessions.length}.</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-emerald-600">No missed sessions recorded.</p>
          )}
        </ReferencePanel>
      </div>
      <ReferencePanel title="Session History" icon="ri-table-line" tone="primary">
        {detailsLoading ? (
          <div className="p-2"><RowsSkeleton rows={3} avatar={false} /></div>
        ) : detailsError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[11px] text-amber-800">{detailsError}</div>
        ) : recentSessions.length ? (
          <div className="space-y-2">
            {recentSessions.map((session, index) => (
              <div key={`${session.sessionId}-${session.sessionDate || index}-history`} className="rounded-xl border border-foreground-100 bg-background-100/45 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${session.status === 'present' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : session.status === 'absent' ? 'border-red-200 bg-red-50 text-red-700' : 'border-foreground-200 bg-background-50 text-foreground-600'}`}>
                        {displayInline(session.status)}
                      </span>
                      <span className="text-[10px] text-foreground-400">{displayInline(session.sessionType)}</span>
                    </div>
                    <p className="mt-2 truncate text-[12px] font-bold text-foreground-900">{displayInline(session.sessionTitle)}</p>
                    <p className="mt-1 text-[10px] text-foreground-500">Reason: {displayInline(session.reason, 'No reason recorded')}</p>
                  </div>
                  <div className="shrink-0 rounded-xl bg-background-50 px-3 py-2 text-left sm:text-right">
                    <p className="text-[11px] font-bold text-foreground-900">{displayInline(session.sessionDateLabel)}</p>
                    <p className="mt-0.5 text-[10px] text-foreground-400">{formatSessionTime(session.startTime, session.endTime)}</p>
                  </div>
                </div>
              </div>
            ))}
            {attendanceSessions.length > recentSessions.length && (
              <p className="text-[10px] text-foreground-400">Showing the latest {recentSessions.length} attendance sessions.</p>
            )}
          </div>
        ) : (
          <ProfileEmpty text="No session history is available for this learner yet." />
        )}
      </ReferencePanel>
    </div>
  );
}

function ReferenceReviewsContent({ data }: { data: CoachLearnerCaseFileData }) {
  return (
    <div className="space-y-5">
      <ReferencePanel title="Progress Reviews" icon="ri-file-chart-line" tone="primary">
        {data.progressReviews.length === 0
          ? <ProfileEmpty text="No progress review records are available." />
          : <ReviewMeetingList items={data.progressReviews} />}
      </ReferencePanel>
      <ReferencePanel title="Monthly Coach Meetings" icon="ri-calendar-todo-line" tone="primary">
        {data.monthlyCoachMeetings.length === 0
          ? <ProfileEmpty text="No monthly coaching meeting data is available." />
          : <ReviewMeetingList items={data.monthlyCoachMeetings} />}
      </ReferencePanel>
    </div>
  );
}

function ReviewMeetingList({ items }: { items: CaseFileReviewMeeting[] }) {
  return (
    <div>
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-3 border-b border-foreground-100 py-4 last:border-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <AppIcon className="ri-calendar-event-line"></AppIcon>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-bold text-foreground-800">{item.title}</p>
              {item.isNext && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[8px] font-semibold text-emerald-700">
                  Next
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[8px] font-semibold ${reviewStatusPillClass(item.status)}`}>
                {item.statusLabel}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-medium text-foreground-500">{item.date} - {item.time}</p>
            <p className="mt-1 text-[10px] text-foreground-400">{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReferencePanel({ title, icon, tone, children }: { title: string; icon: string; tone: 'primary' | 'emerald' | 'red' | 'muted'; children: React.ReactNode }) {
  const toneClass = { primary: 'bg-primary-50 text-primary-600', emerald: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', muted: 'bg-background-100 text-foreground-500' }[tone];
  return <section className="rounded-2xl border border-foreground-200/60 bg-white p-5"><h3 className="mb-4 flex items-center gap-2 text-[12px] font-bold text-foreground-900"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}><AppIcon className={icon}></AppIcon></span>{title}</h3>{children}</section>;
}

function ProfileInfo({ label, value }: { label: string; value?: string | null }) {
  return <div><p className="text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p><p className="mt-1 text-[11px] font-bold text-foreground-800">{value && value !== '--' ? value : '--'}</p></div>;
}

function ProfileProgress({ label, value, color }: { label: string; value: number | null; color: string }) {
  return <div className="mb-3 last:mb-0"><div className="mb-1 flex justify-between text-[10px]"><span className="text-foreground-400">{label}</span><strong>{value === null ? '--' : `${Math.round(value)}%`}</strong></div><div className="h-2 overflow-hidden rounded-full bg-background-200"><div className={`h-full rounded-full ${color}`} style={{ width: `${value || 0}%` }}></div></div></div>;
}

function BigMetric({ value, label, tone }: { value: string; label: string; tone: 'primary' | 'emerald' | 'red' | 'amber' | 'muted' }) {
  const color = { primary: 'text-primary-700', emerald: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', muted: 'text-foreground-700' }[tone];
  return <div className="rounded-2xl border border-foreground-100 bg-background-100/55 p-4 text-center"><p className={`text-2xl font-bold ${color}`}>{value}</p><p className="mt-1 text-[8px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p></div>;
}

function reviewStatusPillClass(status: CaseFileReviewMeeting['status']) {
  if (status === 'completed' || status === 'confirmed') return 'bg-emerald-50 text-emerald-700';
  if (status === 'scheduled') return 'bg-primary-50 text-primary-700';
  if (status === 'in-progress') return 'bg-amber-50 text-amber-700';
  if (status === 'cancelled') return 'bg-red-50 text-red-700';
  return 'bg-orange-50 text-orange-700';
}

function displayInline(value?: string | null, fallback = '--') {
  const text = String(value || '').trim();
  return text && text !== '--' ? text : fallback;
}

function formatSessionTime(start?: string | null, end?: string | null) {
  const startLabel = displayInline(start);
  const endLabel = displayInline(end);
  return endLabel === '--' ? startLabel : `${startLabel} - ${endLabel}`;
}

function ProfileRing({ label, value, color }: { label: string; value: number | null; color: string }) {
  const percent = Math.max(0, Math.min(100, value || 0));
  return <div className="text-center"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: `conic-gradient(${color} ${percent * 3.6}deg, #eceaf2 0deg)` }}><div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[16px] font-bold" style={{ color }}>{value === null ? '--' : `${Math.round(value)}%`}</div></div><p className="mt-2 text-[10px] font-semibold text-foreground-700">{label}</p></div>;
}

function ProfileEmpty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-foreground-200 bg-background-100/45 px-4 py-6 text-center text-[10px] text-foreground-400">{text}</div>;
}

function profileRagTone(value?: string | null): 'primary' | 'emerald' | 'amber' | 'red' | 'muted' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'green') return 'emerald';
  if (normalized === 'amber') return 'amber';
  if (normalized === 'red') return 'red';
  return 'muted';
}

function ProfileTopStat({
  label,
  value,
  tone,
  dot = false,
  wrap = false,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'emerald' | 'amber' | 'red' | 'muted';
  dot?: boolean;
  wrap?: boolean;
}) {
  const toneClass = {
    primary: 'text-primary-700',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    muted: 'text-foreground-500',
  }[tone];
  const dotClass = {
    primary: 'bg-primary-600',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    muted: 'bg-foreground-300',
  }[tone];
  return (
    <div className="min-w-0 px-3 py-5 md:px-4 md:py-6 text-center">
      <p className={`${wrap ? 'text-[12px] leading-tight' : 'truncate text-[16px]'} font-bold ${toneClass}`}>
        {dot && <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${dotClass}`}></span>}
        {value}
      </p>
      <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
    </div>
  );
}

function SignalCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'emerald' | 'amber' | 'accent';
}) {
  const toneMap = {
    primary: 'bg-primary-500/20 text-primary-100 border-primary-300/30',
    emerald: 'bg-emerald-500/20 text-emerald-100 border-emerald-300/30',
    amber: 'bg-amber-500/20 text-amber-100 border-amber-300/30',
    accent: 'bg-white/10 text-white border-white/20',
  } as const;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-3 shadow-[0_14px_32px_rgba(0,0,0,0.12)] backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${toneMap[tone]}`}>
          <AppIcon className={`${icon} text-sm`}></AppIcon>
        </span>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-[9px] font-bold text-white/60">{label}</p>
          <p className="whitespace-nowrap text-sm font-heading font-bold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-[0_10px_30px_rgba(31,14,59,0.05)]">
      <div className="flex items-center gap-2 border-b border-background-200 bg-background-100/45 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-background-50 text-primary-600 ring-1 ring-background-200">
          <AppIcon className={`${sidebarIcon(title)} text-sm`}></AppIcon>
        </span>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-500">{title}</h3>
      </div>
      <div className="space-y-2 p-4">{children}</div>
    </div>
  );
}

function ProgressRing({ progress, initials }: { progress: number | null; initials: string }) {
  const safeProgress = progress === null ? 0 : Math.max(0, Math.min(100, progress));
  const ringRadius = 60;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDash = (safeProgress / 100) * ringCircumference;
  const ringGap = ringCircumference - ringDash;

  return (
    <>
      <svg className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] rotate-[-90deg]" viewBox="0 0 136 136">
        <circle cx="68" cy="68" r={ringRadius} fill="none" stroke="oklch(var(--background-200))" strokeWidth="5" />
        <circle
          cx="68"
          cy="68"
          r={ringRadius}
          fill="none"
          stroke="oklch(var(--primary-500))"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${ringDash} ${ringGap}`}
        />
      </svg>
      <div className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-background-200 bg-background-100 shadow-sm ring-4 ring-background-50">
        <span className="text-3xl font-bold text-foreground-900 font-heading">{initials}</span>
      </div>
    </>
  );
}

function sidebarIcon(title: string) {
  if (title.includes('Risk')) return 'ri-shield-check-line';
  if (title.includes('People')) return 'ri-team-line';
  if (title.includes('Plan')) return 'ri-route-line';
  if (title.includes('Programme')) return 'ri-information-line';
  if (title.includes('Assessment')) return 'ri-question-answer-line';
  return 'ri-file-list-3-line';
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-background-100 last:border-0 gap-3">
      <span className="text-[11px] text-foreground-400">{label}</span>
      <span className="text-[12px] font-medium text-foreground-900 text-right">{value}</span>
    </div>
  );
}

function buildSubtitle(data: CoachLearnerCaseFileData | null) {
  if (!data) {
    return '';
  }

  return [data.programme, data.cohort ? `Cohort ${data.cohort}` : '', data.group ? `Group ${data.group}` : '']
    .filter(Boolean)
    .join(' - ');
}

function parseLearnerKind(value?: string | null) {
  if (value === 'commercial' || value === 'apprenticeship') {
    return value;
  }
  return null;
}

function buildRiskItems(data: CoachLearnerCaseFileData) {
  const items = [];

  if (data.attendanceRate !== null) {
    items.push({
      label: 'Attendance',
      tone: toneFromPercent(data.attendanceRate),
      detail: `${formatPercent(data.attendanceRate)}${data.attendance?.sessions ? ` across ${data.attendance.sessions} session(s)` : ''}`,
    });
  }

  const otjhTone = toneFromOtjh(data.otjhCompleted, data.otjhTarget);
  items.push({
    label: 'OTJH Hours',
    tone: otjhTone,
    detail: `${formatFraction(data.otjhCompleted, data.otjhTarget)}${data.otjhPlanned ? ` planned ${data.otjhPlanned}h` : ''}`,
  });

  items.push({
    label: 'Evidence',
    tone: data.evidence?.pendingEvidence ? 'amber' : 'green',
    detail: data.evidence
      ? `${data.evidence.totalEvidence} total, ${data.evidence.acceptedEvidence} accepted, ${data.evidence.pendingEvidence} pending`
      : `${data.evidenceCount ?? 0} evidence item(s) in coach snapshot`,
  });

  if (data.ksbProgress !== null) {
    items.push({
      label: 'KSB Progress',
      tone: toneFromPercent(data.ksbProgress, 60),
      detail: `${formatPercent(data.ksbProgress)} with ${data.detail?.ksbs.length || 0} mapped KSB(s)`,
    });
  }

  return items;
}

function overviewToneClasses(tone: 'primary' | 'emerald' | 'amber' | 'accent' | 'red' | 'muted') {
  return {
    primary: 'bg-primary-100 text-primary-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    accent: 'bg-accent-100 text-accent-700',
    red: 'bg-red-100 text-red-700',
    muted: 'bg-background-100 text-foreground-600',
  }[tone];
}

function formatLatestQuizSummary(
  detail: CoachLearnerCaseFileData['detail'] | null,
  attempt: NonNullable<CoachLearnerCaseFileData['detail']>['quizAttempts'][number],
) {
  const title = detail?.components.find((component) => component.quizMeta?.quizId === attempt.quizId)?.component || `Quiz ${attempt.quizId}`;
  const rawGrade = Number(attempt.grade);
  const percent = Number.isNaN(rawGrade) ? '--' : `${rawGrade <= 1 ? Math.round(rawGrade * 100) : Math.round(rawGrade)}%`;
  return `${title} - ${percent}`;
}

function buildContacts(data: CoachLearnerCaseFileData) {
  const contacts = [];

  if (data.coachName) {
    contacts.push({
      name: data.coachName,
      role: 'Coach',
      meta: data.coachEmail,
      initials: initialsFromName(data.coachName),
      tone: 'bg-primary-100 text-primary-700',
    });
  }

  contacts.push({
    name: data.displayName,
    role: 'Learner',
    meta: data.email,
    initials: data.initials,
    tone: 'bg-accent-100 text-accent-700',
  });

  if (data.employer) {
    contacts.push({
      name: data.employer,
      role: 'Employer',
      meta: data.employerEmail || data.employerPhone,
      initials: initialsFromName(data.employer),
      tone: 'bg-secondary-100 text-secondary-700',
    });
  }

  return contacts;
}

function statusLabel(data: CoachLearnerCaseFileData | null) {
  if (!data) {
    return 'Loading';
  }
  return data.programStatus || '--';
}

function statusBadgeClass(data: CoachLearnerCaseFileData | null) {
  const tone = data?.attendance?.risk;
  if (tone === 'green') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (tone === 'red') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-background-100 text-foreground-600 border-background-200';
}

function statusDotClass(data: CoachLearnerCaseFileData | null) {
  const tone = data?.attendance?.risk;
  if (tone === 'green') return 'bg-emerald-500';
  if (tone === 'amber') return 'bg-amber-500';
  if (tone === 'red') return 'bg-red-500';
  return 'bg-foreground-300';
}

function riskToneDot(tone: 'green' | 'amber' | 'red' | 'neutral') {
  if (tone === 'green') return 'bg-emerald-500';
  if (tone === 'amber') return 'bg-amber-500';
  if (tone === 'red') return 'bg-red-500';
  return 'bg-foreground-300';
}

function toneFromOtjh(current: number | null, target: number | null): 'green' | 'amber' | 'red' | 'neutral' {
  if (current === null || target === null || target <= 0) {
    return 'neutral';
  }
  const ratio = (current / target) * 100;
  return toneFromPercent(Math.round(ratio), 60);
}

function shortWeekLabel(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return 'Week';
  }
  const match = normalized.match(/\d+/);
  return match ? `Week ${match[0]}` : normalized;
}

function initialsFromName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
