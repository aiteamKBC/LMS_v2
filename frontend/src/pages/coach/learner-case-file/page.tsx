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
                  <i className="ri-route-line text-xs"></i> Training Plan
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
                          <i className="ri-group-line text-white/50"></i>
                          Cohort {data.cohort}
                        </span>
                      )}
                      {data?.group && (
                        <span className="inline-flex items-center gap-1">
                          <i className="ri-team-line text-white/50"></i>
                          Group {data.group}
                        </span>
                      )}
                      {data?.startDate && data.startDate !== '--' && (
                        <span className="inline-flex items-center gap-1">
                          <i className="ri-calendar-line text-white/50"></i>
                          Started {data.startDate}
                        </span>
                      )}
                      {data?.email && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <i className="ri-mail-line text-white/50"></i>
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
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative px-3.5 py-2.5 rounded-xl text-[12px] font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                        activeTab === tab.id
                          ? 'bg-white text-[#140427] shadow-sm ring-1 ring-white/30'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <i className={`${tab.icon} text-sm ${activeTab === tab.id ? 'text-primary-700' : 'text-white/60'}`}></i>
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
                      <i className="ri-route-line text-sm"></i> View Plan
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
      </div>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </WorkspaceShell>
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
          <i className={`${icon} text-sm`}></i>
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
          <i className={`${sidebarIcon(title)} text-sm`}></i>
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
