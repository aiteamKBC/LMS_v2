import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { fetchKsbProfile } from '@/api/curriculum';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { cn } from '@/lib/cn';
import { statusTone, toneStyle, type StatusTone } from '@/lib/statusTone';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
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
  formatFraction,
  formatHours,
  formatPercent,
  toneFromPercent,
  useCoachLearnerCaseFileData,
  type CaseFileActivityItem,
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
// PageTabs has no per-tab icon slot -- the icons above are still used to
// validate `?tab=` in the URL, but the rendered strip below is label-only.
const NAV_TAB_ITEMS: PageTabItem[] = NAV_TABS.map((tab) => ({ value: tab.id, label: tab.label }));
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

  const subtitle = buildSubtitle(data);
  const pageTitle = data?.displayName || learnerName || 'Learner case file';
  const pageSubtitle = subtitle || 'Live learner view for coaching support';
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
      pageTitle="Learner Case File"
      pageSubtitle="Coaching record, progress and evidence for one learner"
      userName={data?.coachName || coach.name}
      userRole="Progress Coach"
    >
      <PageContainer>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-[12px] font-semibold text-foreground-400 transition hover:text-primary-700"
        >
          <AppIcon className="ri-arrow-left-line"></AppIcon>
          My Learners
          <span className="text-foreground-300">/</span>
          <span className="text-foreground-700">{pageTitle}</span>
        </button>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <LearnerAvatar
            name={pageTitle}
            initials={data?.initials}
            size="lg"
            tone={statusTone(data?.attendance?.risk)}
            className="mt-1 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <PageHeader
              title={pageTitle}
              description={pageSubtitle}
              meta={(
                <>
                  <StatusBadge tone={statusTone(data?.attendance?.risk)} label={statusLabel(data)} size="sm" />
                  {data?.email && (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-foreground-500">
                      <AppIcon className="ri-mail-line"></AppIcon>{data.email}
                    </span>
                  )}
                  {data?.detail?.phone && (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-foreground-500">
                      <AppIcon className="ri-phone-line"></AppIcon>{data.detail.phone}
                    </span>
                  )}
                  <span className="text-[12px] text-foreground-500">Overall {formatPercent(data?.overallProgress ?? null)}</span>
                  <span className="text-[12px] text-foreground-500">OTJH {data ? formatFraction(data.otjhCompleted, data.otjhTarget) : '--'}</span>
                  <span className="text-[12px] text-foreground-500">KSB {formatPercent(data?.ksbProgress ?? null)}</span>
                  <span className="text-[12px] text-foreground-500">Attendance {formatPercent(data?.attendanceRate ?? null)}</span>
                  {data?.snapshot?.coachRag && (
                    <StatusBadge status={data.snapshot.coachRag} label={`RAG: ${data.snapshot.coachRag}`} size="sm" />
                  )}
                  <span className="text-[12px] text-foreground-500">Gateway {data?.gatewayReviewDate || '--'}</span>
                  <span className="text-[12px] text-foreground-500">Next session {nextLiveSession?.summary || '--'}</span>
                </>
              )}
              actions={(
                <>
                  <button
                    type="button"
                    onClick={() => navigate('/coach/timetable')}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary-600 px-3 text-[12px] font-semibold text-white transition hover:bg-primary-700"
                  >
                    <AppIcon className="ri-calendar-line"></AppIcon> Schedule
                  </button>
                  {data?.kind && (
                    <button
                      type="button"
                      onClick={handleOpenTrainingPlan}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100"
                    >
                      <AppIcon className="ri-route-line"></AppIcon> Training Plan
                    </button>
                  )}
                </>
              )}
            />
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
          <div className="border-b border-foreground-100 p-3">
            <PageTabs
              items={NAV_TAB_ITEMS}
              value={activeTab}
              onChange={(next) => setActiveTab(next as TabId)}
              label="Case file sections"
            />
          </div>
          <div className="p-4 md:p-5">
            {renderTab()}
          </div>
        </section>
      </PageContainer>
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
          <div className="mt-3 flex items-center justify-between border-t border-foreground-100 pt-3 text-[12px]">
            <span className="text-foreground-400">Evidence records</span>
            <strong className="text-foreground-800">{data.evidenceCount ?? '--'}</strong>
          </div>
        </ReferencePanel>
        <ReferencePanel title="Alerts & Actions" icon="ri-alarm-warning-line" tone="red">
          {risks.length === 0 ? (
            <p className="flex items-center gap-2 text-[12px] font-medium text-emerald-600"><AppIcon className="ri-checkbox-circle-line"></AppIcon>No risk factors identified</p>
          ) : risks.map((risk) => (
            <div key={risk.label} className="mb-2 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
              <p className="text-[12px] font-bold text-amber-800">{risk.label}</p>
              <p className="mt-0.5 text-[12px] text-amber-700">{risk.detail}</p>
            </div>
          ))}
        </ReferencePanel>
      </div>
      <ReferencePanel title="Recent Activity" icon="ri-history-line" tone="muted">
        {activities.length === 0 ? <ProfileEmpty text="No recent activity is available." /> : activities.map((item) => (
          <div key={item.id} className="flex gap-3 border-b border-foreground-100 py-2.5 last:border-0">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', toneStyle(activityStatusTone(item.tone)).bg, toneStyle(activityStatusTone(item.tone)).text)}><AppIcon className="ri-history-line text-xs"></AppIcon></span>
            <div className="min-w-0 flex-1"><p className="text-[12px] font-bold text-foreground-800">{item.event}</p><p className="truncate text-[12px] text-foreground-400">{item.detail || 'No details available.'}</p></div>
            <span className="text-[12px] text-foreground-300">{item.date}</span>
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
                    <p className="text-[12px] font-bold text-foreground-800">{session.title}</p>
                    <p className="mt-1 text-[12px] text-primary-700">{session.day} · {session.date}</p>
                    <p className="mt-1 text-[12px] font-medium text-foreground-500">{session.time}</p>
                  </div>
                  <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[12px] font-semibold text-primary-700">
                    Live
                  </span>
                </div>
                <p className="mt-2 text-[12px] text-foreground-500">{session.detail}</p>
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
                <p className="text-[12px] font-bold text-foreground-800">{contact.name}</p>
                <p className="text-[12px] text-foreground-400">{contact.role}</p>
                {contact.meta && <p className="mt-1 text-[12px] text-primary-600">{contact.meta}</p>}
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
                    <p className="mt-1 text-[12px] leading-5 text-foreground-500">
                      Search by code, category, or description, then review each KSB inside its own category section.
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/80 bg-white/90 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Quick filters</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {['All', ...categoryOptions].map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveKsbCategory(category)}
                        className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
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
                      className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
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
                    <p className="mt-1 text-[12px] leading-5 text-foreground-500">
                      Each section below keeps linked and not-evidenced KSBs separated in a cleaner way for review.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-foreground-200/70 bg-white px-3 py-2 text-right">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Visible now</p>
                    <p className="mt-1 text-[12px] font-bold text-foreground-900">{filteredKsbs.length} of {ksbs.length} KSBs</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {categorySummary.map((group) => (
                    <div key={group.category} className="rounded-2xl border border-foreground-200/70 bg-background-50 px-4 py-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl', toneStyle(ksbCategoryTone(group.category)).bg, toneStyle(ksbCategoryTone(group.category)).text)}>
                            <AppIcon className={`${ksbCategoryIcon(group.category)} text-sm`}></AppIcon>
                          </span>
                          <div>
                            <StatusBadge tone={ksbCategoryTone(group.category)} label={group.category} size="sm" dot={false} />
                          </div>
                        </div>
                        <span className="text-[12px] font-bold text-foreground-700">{group.linked}/{group.total}</span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background-200">
                        <div
                          className={cn('h-full rounded-full', toneStyle(ksbCategoryTone(group.category)).dot)}
                          style={{ width: `${group.total ? (group.linked / group.total) * 100 : 0}%` }}
                        ></div>
                      </div>
                      <p className="mt-3 text-[12px] text-foreground-600">
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
                  const groupToneStyle = toneStyle(ksbCategoryTone(group.category));
                  const categoryTone = {
                    shell: groupToneStyle.border,
                    header: groupToneStyle.bg,
                    icon: cn(groupToneStyle.bg, groupToneStyle.text),
                    progress: groupToneStyle.dot,
                  };
                  const isOpen = hasActiveFilters || openKsbCategory === group.category;
                  const sectionScrollClass = hasFocusedCategoryFilter
                    ? 'mt-4 max-h-[72vh] overflow-y-auto pr-1'
                    : 'mt-4 max-h-[520px] overflow-y-auto pr-1';

                  return (
                    <section
                      key={group.category}
                      className={`overflow-hidden rounded-2xl border bg-background-50 shadow-sm ${categoryTone.shell}`}
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
                                <StatusBadge tone={ksbCategoryTone(group.category)} label={`${group.total} KSBs`} size="sm" dot={false} />
                              </div>
                              <p className="mt-1 text-[12px] text-foreground-500">
                                {group.linked} evidenced and {Math.max(0, group.total - group.linked)} waiting for learner evidence.
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3">
                              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Evidence linked</p>
                              <p className="mt-1 text-[18px] font-bold text-foreground-900">{group.linked}</p>
                            </div>
                            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3">
                              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground-400">Coverage</p>
                              <p className="mt-1 text-[18px] font-bold text-foreground-900">
                                {group.total ? Math.round((group.linked / group.total) * 100) : 0}%
                              </p>
                            </div>
                            {!hasActiveFilters && (
                              <span className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-2 text-[12px] font-semibold text-foreground-600">
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
                            <p className="text-[12px] font-semibold text-foreground-600">
                              Showing all {group.total} KSBs in this section
                            </p>
                            <span className="inline-flex items-center gap-2 rounded-full border border-foreground-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-foreground-500">
                              Scroll inside section
                              <AppIcon className="ri-arrow-down-up-line text-sm"></AppIcon>
                            </span>
                          </div>

                          <div className={sectionScrollClass}>
                            <div className="grid gap-4 xl:grid-cols-2">
                              {group.items.map((item) => (
                                <article key={item.code} className="flex h-full flex-col rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
                                  <div className="flex items-start gap-3">
                                    <span className={cn('inline-flex h-11 min-w-11 items-center justify-center rounded-2xl px-2 text-[12px] font-bold', toneStyle(ksbCategoryTone(item.category)).bg, toneStyle(ksbCategoryTone(item.category)).text)}>
                                      {item.code}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <StatusBadge tone={ksbCategoryTone(item.category)} label={item.category} size="sm" dot={false} />
                                        <StatusBadge
                                          tone={item.linked ? 'positive' : 'neutral'}
                                          label={item.linked ? 'Evidence linked' : 'Not evidenced'}
                                          size="sm"
                                          dot={false}
                                        />
                                      </div>
                                      <p className="mt-3 text-[12px] font-semibold leading-5 text-foreground-900">{item.description}</p>
                                    </div>
                                  </div>

                                  <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] leading-5 ${item.linked ? 'border-emerald-100 bg-emerald-50/80 text-emerald-800' : 'border-foreground-200 bg-background-100/70 text-foreground-500'}`}>
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

/**
 * KSB category is a domain taxonomy (Knowledge/Skills/Behaviours/Other), not a
 * backend status string, so it maps onto the shared `StatusTone` vocabulary
 * explicitly. This single mapping replaces four separate hand-rolled colour
 * functions (`ksbCategoryBadge`, `ksbCodeTone`, `ksbCategoryProgressTone`,
 * `ksbCategorySectionTone`) that all re-encoded the same Knowledge/Skills/
 * Behaviours/Other -> primary/sky/amber/neutral mapping independently.
 */
function ksbCategoryTone(category: string): StatusTone {
  if (category === 'Knowledge') return 'brand';
  if (category === 'Skills') return 'info';
  if (category === 'Behaviours') return 'caution';
  return 'neutral';
}

function ksbCategoryIcon(category: string) {
  if (category === 'Knowledge') return 'ri-book-open-line';
  if (category === 'Skills') return 'ri-tools-line';
  if (category === 'Behaviours') return 'ri-user-star-line';
  return 'ri-award-line';
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
      <p className="mt-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground-400">{label}</p>
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
          <ProfileProgress label={`Catch-up (${attendance.catchup ?? 0})`} value={percentage(attendance.catchup)} color="bg-foreground-300" />
        </ReferencePanel>
        <ReferencePanel title="Missed Sessions" icon="ri-close-circle-line" tone="red">
          {detailsLoading ? (
            <div className="p-2"><RowsSkeleton rows={3} avatar={false} /></div>
          ) : detailsError ? (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-[12px] text-red-700">{detailsError}</div>
          ) : missedSessions.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-bold text-red-700">{missedSessions.length} session(s) missed</p>
                    <p className="mt-1 text-[12px] text-red-500">Latest absence reasons and catch-up status are shown below.</p>
                  </div>
                  {(attendance.consecutiveMissed || 0) > 0 && (
                    <span className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-red-600">
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
                          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[12px] font-semibold text-red-700">Absent</span>
                          <span className="text-[12px] text-foreground-400">{displayInline(session.sessionType)}</span>
                        </div>
                        <p className="mt-2 truncate text-[12px] font-bold text-foreground-900">{displayInline(session.sessionTitle)}</p>
                        <p className="mt-1 text-[12px] text-foreground-500">
                          Reason: {displayInline(session.reason, 'No reason recorded')}
                        </p>
                        <p className="mt-1 text-[12px] text-foreground-400">
                          {session.catchupCompleted ? 'Catch-up completed' : 'Catch-up not recorded'}
                        </p>
                      </div>
                      <div className="shrink-0 rounded-xl bg-background-50 px-3 py-2 text-left sm:text-right">
                        <p className="text-[12px] font-bold text-foreground-900">{displayInline(session.sessionDateLabel)}</p>
                        <p className="mt-0.5 text-[12px] text-foreground-400">{formatSessionTime(session.startTime, session.endTime)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {missedSessions.length > 3 && (
                <p className="text-[12px] text-foreground-400">Showing the latest 3 missed sessions out of {missedSessions.length}.</p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-emerald-600">No missed sessions recorded.</p>
          )}
        </ReferencePanel>
      </div>
      <ReferencePanel title="Session History" icon="ri-table-line" tone="primary">
        {detailsLoading ? (
          <div className="p-2"><RowsSkeleton rows={3} avatar={false} /></div>
        ) : detailsError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800">{detailsError}</div>
        ) : recentSessions.length ? (
          <div className="space-y-2">
            {recentSessions.map((session, index) => (
              <div key={`${session.sessionId}-${session.sessionDate || index}-history`} className="rounded-xl border border-foreground-100 bg-background-100/45 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold ${session.status === 'present' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : session.status === 'absent' ? 'border-red-200 bg-red-50 text-red-700' : 'border-foreground-200 bg-background-50 text-foreground-600'}`}>
                        {displayInline(session.status)}
                      </span>
                      <span className="text-[12px] text-foreground-400">{displayInline(session.sessionType)}</span>
                    </div>
                    <p className="mt-2 truncate text-[12px] font-bold text-foreground-900">{displayInline(session.sessionTitle)}</p>
                    <p className="mt-1 text-[12px] text-foreground-500">Reason: {displayInline(session.reason, 'No reason recorded')}</p>
                  </div>
                  <div className="shrink-0 rounded-xl bg-background-50 px-3 py-2 text-left sm:text-right">
                    <p className="text-[12px] font-bold text-foreground-900">{displayInline(session.sessionDateLabel)}</p>
                    <p className="mt-0.5 text-[12px] text-foreground-400">{formatSessionTime(session.startTime, session.endTime)}</p>
                  </div>
                </div>
              </div>
            ))}
            {attendanceSessions.length > recentSessions.length && (
              <p className="text-[12px] text-foreground-400">Showing the latest {recentSessions.length} attendance sessions.</p>
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
              <p className="text-[12px] font-bold text-foreground-800">{item.title}</p>
              {item.isNext && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">
                  Next
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${reviewStatusPillClass(item.status)}`}>
                {item.statusLabel}
              </span>
            </div>
            <p className="mt-1 text-[12px] font-medium text-foreground-500">{item.date} - {item.time}</p>
            <p className="mt-1 text-[12px] text-foreground-400">{item.detail}</p>
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
  return <div><p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p><p className="mt-1 text-[12px] font-bold text-foreground-800">{value && value !== '--' ? value : '--'}</p></div>;
}

function ProfileProgress({ label, value, color }: { label: string; value: number | null; color: string }) {
  return <div className="mb-3 last:mb-0"><div className="mb-1 flex justify-between text-[12px]"><span className="text-foreground-400">{label}</span><strong>{value === null ? '--' : `${Math.round(value)}%`}</strong></div><div className="h-2 overflow-hidden rounded-full bg-background-200"><div className={`h-full rounded-full ${color}`} style={{ width: `${value || 0}%` }}></div></div></div>;
}

function BigMetric({ value, label, tone }: { value: string; label: string; tone: 'primary' | 'emerald' | 'red' | 'amber' | 'muted' }) {
  const color = { primary: 'text-primary-700', emerald: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', muted: 'text-foreground-700' }[tone];
  return <div className="rounded-2xl border border-foreground-100 bg-background-100/55 p-4 text-center"><p className={`text-2xl font-bold ${color}`}>{value}</p><p className="mt-1 text-[12px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p></div>;
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
  return <div className="text-center"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: `conic-gradient(${color} ${percent * 3.6}deg, #eceaf2 0deg)` }}><div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[16px] font-bold" style={{ color }}>{value === null ? '--' : `${Math.round(value)}%`}</div></div><p className="mt-2 text-[12px] font-semibold text-foreground-700">{label}</p></div>;
}

function ProfileEmpty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-foreground-200 bg-background-100/45 px-4 py-6 text-center text-[12px] text-foreground-400">{text}</div>;
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

/**
 * The activity feed's tone is a locally-computed tier (data.ts's
 * `CaseFileActivityItem['tone']`), not a raw backend status string, so it maps
 * onto the shared `StatusTone` vocabulary explicitly rather than through
 * `statusTone()`.
 */
function activityStatusTone(tone: CaseFileActivityItem['tone']): StatusTone {
  const map: Record<CaseFileActivityItem['tone'], StatusTone> = {
    primary: 'brand',
    emerald: 'positive',
    amber: 'caution',
    accent: 'info',
    red: 'critical',
  };
  return map[tone];
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

function toneFromOtjh(current: number | null, target: number | null): 'green' | 'amber' | 'red' | 'neutral' {
  if (current === null || target === null || target <= 0) {
    return 'neutral';
  }
  const ratio = (current / target) * 100;
  return toneFromPercent(Math.round(ratio), 60);
}

function initialsFromName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
