import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import OverviewTab from './components/OverviewTab';
import AttendanceTab from './components/AttendanceTab';
import OTJHTab from './components/OTJHTab';
import KSBsTab from './components/KSBsTab';
import EvidenceTab from './components/EvidenceTab';
import ActivityTab from './components/ActivityTab';
import DocumentsTab from './components/DocumentsTab';
import MessagesTab from './components/MessagesTab';
import NetworkTab from './components/NetworkTab';
import {
  flattenJourney,
  formatFraction,
  formatPercent,
  toneFromPercent,
  useCoachLearnerCaseFileData,
  type CoachLearnerCaseFileData,
} from './data';

const coachNav = roleNavMap.coach;

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { id: 'attendance', label: 'Attendance', icon: 'ri-calendar-check-line' },
  { id: 'otjh', label: 'OTJH', icon: 'ri-time-line' },
  { id: 'ksbs', label: 'KSBs', icon: 'ri-award-line' },
  { id: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line' },
  { id: 'activity', label: 'Activity', icon: 'ri-history-line' },
  { id: 'network', label: 'Network', icon: 'ri-user-heart-line' },
  { id: 'documents', label: 'Documents', icon: 'ri-folder-line' },
  { id: 'messages', label: 'Messages', icon: 'ri-mail-line' },
] as const;

type TabId = typeof TABS[number]['id'];
type LocationState = {
  learnerId?: string;
  learnerName?: string;
  kind?: 'commercial' | 'apprenticeship';
  tab?: string;
};

export default function LearnerCaseFile() {
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
  });

  useEffect(() => {
    if (TABS.some((tab) => tab.id === requestedTab)) {
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

  const handleMessage = () => {
    const target = data?.email || learnerName || learnerId || '';
    navigate('/messages', { state: { openContact: target } });
  };

  const handleOpenTrainingPlan = () => {
    if (!data?.kind || !data.learnerId) {
      return;
    }
    navigate(`/learner/training-plan/${data.kind}/${data.learnerId}`);
  };

  const renderTab = () => {
    if (!data) {
      return (
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6">
          <EmptyState text={loading ? 'Loading learner case file...' : (error || 'No learner selected.')} />
        </div>
      );
    }

    switch (activeTab) {
      case 'overview':
        return <OverviewTab data={data} />;
      case 'attendance':
        return <AttendanceTab data={data} />;
      case 'otjh':
        return <OTJHTab data={data} />;
      case 'ksbs':
        return <KSBsTab data={data} />;
      case 'evidence':
        return <EvidenceTab data={data} />;
      case 'activity':
        return <ActivityTab data={data} />;
      case 'network':
        return <NetworkTab data={data} />;
      case 'documents':
        return <DocumentsTab data={data} />;
      case 'messages':
        return <MessagesTab data={data} />;
      default:
        return <OverviewTab data={data} />;
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
      userName="Med Maher"
      userRole="Progress Coach"
    >
      <div
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
          stickyVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-background-50/95 backdrop-blur-md border-b border-foreground-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center shrink-0 text-xs font-bold text-white font-heading">
              {data?.initials || '--'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground-900 truncate">{pageTitle}</p>
              <p className="text-[10px] text-foreground-400 truncate">{pageSubtitle}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleMessage}
                className="px-3 py-1.5 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-[11px] font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1"
              >
                <i className="ri-message-3-line text-xs"></i> Message
              </button>
              {data?.kind && (
                <button
                  onClick={handleOpenTrainingPlan}
                  className="px-3 py-1.5 rounded-full bg-background-100 text-foreground-700 text-[11px] font-semibold hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1"
                >
                  <i className="ri-route-line text-xs"></i> Training Plan
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="pb-8">
        <section className="relative">
          <div className="relative h-40 md:h-48 lg:h-52 rounded-b-lg overflow-hidden bg-background-50 border-b border-background-200">
            <div className="absolute inset-0 bg-gradient-to-br from-background-50 via-background-100 to-background-200"></div>
            <div className="absolute top-0 right-0 w-1/3 h-full opacity-30 bg-gradient-to-l from-primary-100 to-transparent"></div>
          </div>

          <div className="relative px-4 md:px-8">
            <div className="-mt-14 md:-mt-16 flex flex-col md:flex-row md:items-start gap-4 md:gap-6 pb-6">
              <div className="relative shrink-0 w-28 h-28 md:w-32 md:h-32">
                <ProgressRing progress={data?.overallProgress ?? null} initials={data?.initials || '--'} />
              </div>

              <div className="flex-1 min-w-0 flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                <div className="flex-1 min-w-0 pt-1 md:pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1">
                    <h1 className="text-xl md:text-2xl font-heading font-bold text-foreground-900 tracking-tight">
                      {pageTitle}
                    </h1>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border w-fit ${statusBadgeClass(data)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(data)}`}></span>
                      {statusLabel(data)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {data?.employer && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 text-[11px] font-medium border border-primary-200">
                        <i className="ri-building-2-line text-xs"></i>
                        {data.employer}
                      </span>
                    )}
                    {data?.programme && (
                      <p className="text-sm text-foreground-500">{data.programme}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-foreground-400">
                    {data?.cohort && (
                      <span className="flex items-center gap-1">
                        <i className="ri-group-line text-foreground-300"></i>
                        Cohort {data.cohort}
                      </span>
                    )}
                    {data?.group && (
                      <span className="flex items-center gap-1">
                        <i className="ri-team-line text-foreground-300"></i>
                        Group {data.group}
                      </span>
                    )}
                    {data?.startDate && data.startDate !== '--' && (
                      <span className="flex items-center gap-1">
                        <i className="ri-calendar-line text-foreground-300"></i>
                        Started {data.startDate}
                      </span>
                    )}
                    {data?.email && (
                      <span className="flex items-center gap-1">
                        <i className="ri-mail-line text-foreground-300"></i>
                        {data.email}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 md:pt-4">
                  <button
                    onClick={handleMessage}
                    className="px-4 py-2 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-[13px] font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-sm"
                  >
                    <i className="ri-message-3-line text-sm"></i> Message
                  </button>
                  {data?.kind && (
                    <button
                      onClick={handleOpenTrainingPlan}
                      className="px-4 py-2 rounded-full bg-background-50 text-foreground-700 text-[13px] font-semibold hover:bg-background-100 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-sm border border-background-200"
                    >
                      <i className="ri-route-line text-sm"></i> View Plan
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="px-4 md:px-8 mt-4">
          {error && data && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
              {error}
            </div>
          )}

          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-full text-[13px] font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? 'bg-primary-500 text-background-50 dark:text-foreground-950 shadow-sm'
                    : 'text-foreground-500 hover:text-foreground-700 hover:bg-background-100'
                }`}
              >
                <i className={`${tab.icon} text-sm`}></i>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col lg:flex-row gap-5 mt-4">
            <div className="flex-1 min-w-0">
              {renderTab()}
            </div>

            <div className="w-full lg:w-[340px] shrink-0 space-y-4">
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
                    <i className="ri-question-answer-line text-white text-2xl"></i>
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
                        {latestQuiz ? `${latestQuiz.quizName} - ${latestQuiz.grade}` : '--'}
                      </span>
                    </p>
                    <p className="text-[10px] text-foreground-400">
                      {data?.touchedKsbCodes.length || 0} KSB code(s) surfaced via quiz evidence
                    </p>
                  </div>
                </div>
              </SidebarCard>
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

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
      <h3 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
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
      <svg className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] rotate-[-90deg]" viewBox="0 0 136 136">
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
      <div className="w-28 h-28 md:w-32 md:h-32 rounded-full ring-4 ring-background-50 bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center overflow-hidden shadow-lg relative z-10">
        <span className="text-3xl md:text-4xl font-bold text-white font-heading">{initials}</span>
      </div>
      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded-full bg-background-50 border border-background-200 shadow-sm text-[10px] font-bold text-foreground-700 whitespace-nowrap">
        {progress === null ? 'No progress yet' : `${safeProgress}% progress`}
      </div>
    </>
  );
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

  return [data.programme, data.employer, data.cohort ? `Cohort ${data.cohort}` : '']
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
  return data.programStatus || 'Live learner';
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
