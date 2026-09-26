import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { fetchKsbProfile } from '@/api/curriculum';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { cn } from '@/lib/cn';
import { statusTone, type StatusTone } from '@/lib/statusTone';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import { DashboardTrainingPlan } from '@/pages/workspace/learner/DashboardTrainingPlan';
import { useDashboardPlan } from '@/pages/workspace/learner/useDashboardPlan';
import { ImportedReviewHistory } from '@/pages/learner/reviews/ImportedReviewHistory';
import OTJHTab from './components/OTJHTab';
import KSBsTab from './components/KSBsTab';
import EvidenceTab from './components/EvidenceTab';
import AuditTab from '@/features/audit/AuditTab';
import ActivityTab from './components/ActivityTab';
import DocumentsTab from './components/DocumentsTab';
import NetworkTab from './components/NetworkTab';
import LearningPlanTab from './components/OverviewTab';
import AssignmentsTab from './components/AssignmentsTab';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import {
  createLearnerReviewAddition,
  fetchLearnerAdditionReviewTemplates,
  type LearnerAdditionReasonCode,
  type LearnerAdditionReviewTemplate,
} from '@/api/reviewInstances';
import { ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '@/pages/coach/shared/ScheduleControls';
import { scheduleCoachCalendarEvent, type ScheduleFormState } from '@/pages/coach/shared/calendarEvents';
import {
  formatFraction,
  formatHours,
  formatPercent,
  normalizeKsbCode,
  selectCaseFileOtjh,
  useCoachLearnerCaseFileData,
  type CaseFileReviewMeeting,
  type CoachLearnerCaseFileData,
} from './data';
import styles from './learnerCaseFile.module.css';

const coachNav = roleNavMap.coach;
const ATTENDANCE_DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';
const EMPTY_REVIEW_SCHEDULE: ScheduleFormState = { date: '', time: '09:00', durationMinutes: 60 };

const CASE_FILE_TABS = [
  { id: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { id: 'progress', label: 'OTJH & KSB Progress', icon: 'ri-line-chart-line' },
  { id: 'attendance', label: 'Attendance', icon: 'ri-calendar-check-line' },
  { id: 'support', label: 'Learning Plan', icon: 'ri-route-line' },
  { id: 'reviews', label: 'Reviews', icon: 'ri-file-list-3-line' },
  { id: 'assignments', label: 'Assignments', icon: 'ri-file-text-line' },
  { id: 'otjh', label: 'OTJH', icon: 'ri-time-line' },
  { id: 'ksbs', label: 'KSBs', icon: 'ri-award-line' },
  { id: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line' },
  { id: 'audit', label: 'Audit', icon: 'ri-file-search-line' },
  { id: 'activity', label: 'Activity', icon: 'ri-history-line' },
  { id: 'network', label: 'Network', icon: 'ri-user-heart-line' },
  { id: 'documents', label: 'Documents', icon: 'ri-folder-line' },
] as const;

type TabId = typeof CASE_FILE_TABS[number]['id'] | 'programme' | 'reviews' | 'coach-notes';
type EvidencePreviewTarget = {
  code?: string;
  title: string;
  category?: string;
  linked?: boolean;
  activities: Array<{ title: string; type: string; componentId?: string; source?: string; activityId?: string; completedAt?: string; status?: string; module?: string }>;
};
type KsbSortKey = 'code' | 'title' | 'category' | 'status' | 'evidence';
type SortDirection = 'asc' | 'desc';
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
  /** enrolment."Created_users".id -- see useCoachLearnerCaseFileData's enrolmentId doc. */
  enrolmentId?: string;
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
  startTime?: string | null;
  endTime?: string | null;
  status: string;
  reason?: string | null;
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
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreviewTarget | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as LocationState;

  const requestedTab = searchParams.get('tab') || state.tab;
  const requestedReviewId = searchParams.get('reviewId') || undefined;
  const learnerId = searchParams.get('id') || state.learnerId;
  const learnerName = state.learnerName;
  const explicitKind = parseLearnerKind(searchParams.get('kind') || state.kind);
  const enrolmentId = searchParams.get('enrolmentId') || state.enrolmentId;

  const { data, loading, error, refresh } = useCoachLearnerCaseFileData({
    learnerId,
    learnerName,
    kind: explicitKind,
    enrolmentId,
    enabled: coach.isInitialized && coach.hasCoachAccess,
  });
  const dashboardKind = data?.kind || explicitKind;
  const dashboardLearnerId = data?.enrolmentId || enrolmentId;
  const dashboardPlan = useDashboardPlan(
    dashboardKind,
    dashboardLearnerId,
    coach.isInitialized && coach.hasCoachAccess && !!dashboardKind && !!dashboardLearnerId,
  );

  useEffect(() => {
    if (CASE_FILE_TABS.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab as TabId);
    }
  }, [requestedTab]);

  const subtitle = buildSubtitle(data);
  const pageTitle = data?.displayName || learnerName || 'Learner case file';
  const pageSubtitle = subtitle || 'Live learner view for coaching support';
  const nextLiveSession = data?.upcomingSessions.find((session) => session.kind === 'live') || null;
  const headerOtjh = data ? selectCaseFileOtjh(data) : null;
  const headerKsb = data?.metricsAvailable === false ? null : data ? selectCaseFileKsbSummary(selectCaseFileKsbRows(data)) : null;

  const handleOpenReviewMeeting = (item: CaseFileReviewMeeting) => {
    const returnParams = new URLSearchParams(location.search);
    returnParams.set('id', data?.learnerId || learnerId || '');
    returnParams.set('tab', 'reviews');
    if (data?.kind) returnParams.set('kind', data.kind);
    const returnTo = `${location.pathname}?${returnParams.toString()}`;
    const detailBase = item.source === 'mcr'
      ? '/coach/meetings'
      : '/coach/reviews';
    const detailKey = item.eventKey;

    navigate(`${detailBase}/${encodeURIComponent(detailKey)}`, {
      state: { returnTo },
    });
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
        return dashboardKind ? <DashboardTrainingPlan
          kind={dashboardKind}
          learnerId={data.enrolmentId || data.learnerId}
          plan={dashboardPlan}
          programmeStartDate={data.detail?.programmeStartDate}
          programmeEndDate={data.detail?.programmeEndDate}
          canOpenActivities
          showRewards={false}
          activityOverviewOnly
          programmeSnapshot={{
            overall: data.overallProgress,
            otjhActual: headerOtjh?.logged ?? null,
            otjhTarget: headerOtjh?.target ?? null,
            ksb: headerKsb?.percent ?? null,
            ksbAvailable: Boolean(headerKsb?.total),
            attendancePresent: data.attendancePresentCount,
            attendanceTotal: data.attendanceSessionCount,
          }}
        /> : null;
      case 'programme':
        return <ReferenceProgrammeContent data={data} />;
      case 'progress':
        return <ReferenceProgressContent data={data} onViewEvidence={setEvidencePreview} />;
      case 'attendance':
        return <ReferenceAttendanceContent data={data} />;
      case 'reviews':
        return <ReferenceReviewsContent
          data={data}
          onOpen={handleOpenReviewMeeting}
          requestedReviewId={requestedReviewId}
        />;
      case 'assignments':
        return dashboardKind && (data.enrolmentId || data.learnerId)
          ? <AssignmentsTab kind={dashboardKind} learnerId={data.enrolmentId || data.learnerId} />
          : <EmptyState text="Assignments are unavailable because this learner's record type is unknown." />;
      case 'coach-notes':
        return <DocumentsTab data={data} />;
      case 'support':
        return <div className="space-y-5">
          {dashboardKind ? <DashboardTrainingPlan
            kind={dashboardKind}
            learnerId={data.enrolmentId || data.learnerId}
            plan={dashboardPlan}
            programmeStartDate={data.detail?.programmeStartDate}
            programmeEndDate={data.detail?.programmeEndDate}
            canOpenActivities
            showRewards={false}
            timelineOnly
          /> : null}
          <LearningPlanTab data={data} ksbSummary={headerKsb || undefined} onOpenNotes={() => setActiveTab('coach-notes')} />
        </div>;
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
        return null;
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
      hidePageChrome
    >
      <main className={styles.page}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <button type="button" aria-label="Coach dashboard" onClick={() => navigate('/workspace/coach')}><AppIcon className="ri-home-4-line" /></button>
          <AppIcon className="ri-arrow-right-s-line" />
          <button type="button" onClick={() => navigate('/workspace/coach')}>Coach Workspace</button>
          <AppIcon className="ri-arrow-right-s-line" />
          <button type="button" onClick={() => navigate('/coach/caseload')}>Coach</button>
          <AppIcon className="ri-arrow-right-s-line" />
          <strong>Learner Case File</strong>
        </nav>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>
        )}

        <section className={styles.hero} aria-label="Learner profile summary">
          <div className={styles.heroTop}>
              <div className={styles.identity}>
                <LearnerAvatar
                  name={pageTitle}
                  initials={data?.initials}
                  size="lg"
                  tone={statusTone(data?.programStatus)}
                  className={styles.avatar}
                />
                <div className={styles.identityCopy}>
                  <div className={styles.nameRow}>
                    <h1>{pageTitle}</h1>
                    <StatusBadge tone={statusTone(data?.programStatus)} label={statusLabel(data)} size="sm" />
                    {data?.snapshot?.coachRag && (
                      <StatusBadge status={data.snapshot.coachRag} label={`RAG: ${data.snapshot.coachRag}`} size="sm" />
                    )}
                  </div>
                  <p className={styles.subtitle}>{pageSubtitle}</p>
                  <div className={styles.contactLine}>
                    {data?.email && (
                      <span>
                        <AppIcon className="ri-mail-line"></AppIcon>{data.email}
                      </span>
                    )}
                    {data?.detail?.phone && (
                      <span>
                        <AppIcon className="ri-phone-line"></AppIcon>{data.detail.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

            </div>

          {data && (
            <section className={styles.heroSnapshot} aria-labelledby="profile-snapshot-heading">
              <div className={styles.heroSnapshotHeading}>
                <span><AppIcon className="ri-user-line" /></span>
                <div>
                  <h2 id="profile-snapshot-heading">Profile Snapshot</h2>
                  <p>Current progress and support context</p>
                </div>
              </div>
              <div className={styles.heroProfileGrid}>
                <ProfileInfo icon="ri-calendar-line" label="Planned Gateway" value={data.gatewayReviewDate} />
                <ProfileInfo icon="ri-group-line" label="Cohort" value={data.cohort} />
                <ProfileInfo icon="ri-building-line" label="Employer" value={data.employer} />
                <ProfileInfo icon="ri-box-3-line" label="Group" value={data.group} />
                <ProfileInfo icon="ri-user-line" label="Coach" value={data.coachName} />
                <ProfileInfo icon="ri-calendar-event-line" label="Start Date" value={data.startDate} />
                <ProfileInfo icon="ri-graduation-cap-line" label="Programme" value={data.programme} />
                <ProfileInfo icon="ri-checkbox-circle-line" label="Status" value={data.programStatus} />
                <ProfileInfo icon="ri-calendar-check-line" label="Planned End" value={data.plannedEndDate} />
                <ProfileInfo icon="ri-mail-line" label="Email" value={data.email} />
              </div>
            </section>
          )}

          <div className={styles.metrics}>
              <CaseFileHeroMetric icon="ri-focus-3-line" label="Overall" value={formatPercent(data?.overallProgress ?? null)} />
              <CaseFileHeroMetric icon="ri-time-line" label="OTJH (Actual / Target)" value={headerOtjh ? formatFraction(headerOtjh.logged, headerOtjh.target) : '--'} />
              <CaseFileHeroMetric icon="ri-stack-line" label="KSB" value={headerKsb?.percent == null ? '--' : formatPercent(headerKsb.percent)} />
              <CaseFileHeroMetric icon="ri-group-line" label="Attendance" value={formatAttendanceFraction(data?.attendancePresentCount ?? null, data?.attendanceSessionCount ?? null)} />
              <CaseFileHeroMetric icon="ri-calendar-line" label="Gateway" value={data?.gatewayReviewDate || '--'} />
              <CaseFileHeroMetric icon="ri-calendar-event-line" label="Next session" value={nextLiveSession?.summary || '--'} />
          </div>
        </section>

        <nav className={styles.tabs} aria-label="Case file sections" role="tablist">
          {NAV_TABS.map(tab => {
            const active = activeTab === tab.id;
            return <button key={tab.id} type="button" role="tab" aria-selected={active}
              className={cn(styles.tab, active && styles.tabActive)} onClick={() => setActiveTab(tab.id)}>
              <AppIcon className={tab.icon} />{tab.label}
            </button>;
          })}
        </nav>

        <section className={styles.content} role="tabpanel">
          {renderTab()}
        </section>
      </main>
      {evidencePreview && (
        <EvidencePreviewModal
          evidence={evidencePreview}
          onClose={() => setEvidencePreview(null)}
          onOpenAssignment={(componentId) => {
            if (!data?.kind || !data.learnerId) return;
            navigate(`/learner/monthly-submission/${data.kind}/${data.learnerId}/${encodeURIComponent(componentId)}`);
          }}
        />
      )}
    </WorkspaceShell>
  );
}

function CaseFileHeroMetric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricIcon}><AppIcon className={icon} /></span>
      <div className="min-w-0">
        <span className={styles.metricLabel}>{label}</span>
        <strong className={styles.metricValue} title={value}>{value}</strong>
      </div>
    </div>
  );
}

function ReferenceProgrammeContent({ data }: { data: CoachLearnerCaseFileData }) {
  const contacts = buildContacts(data);
  return (
    <div className={styles.stack}>
      <ReferencePanel title="Programme Details" subtitle="Key programme information for this learner" icon="ri-graduation-cap-line" tone="primary">
        <div className={styles.programmeGrid}>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-graduation-cap-line" label="Programme" value={data.programme} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-group-line" label="Cohort" value={data.cohort} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-group-2-line" label="Group" value={data.group} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-building-line" label="Employer" value={data.employer} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-pulse-line" label="Status" value={data.programStatus} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-calendar-line" label="Start Date" value={data.startDate} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-calendar-check-line" label="Planned Gateway" value={data.gatewayReviewDate} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-calendar-event-line" label="Planned End" value={data.plannedEndDate} /></div>
          <div className={styles.programmeCell}><ProfileInfo icon="ri-user-line" label="Coach" value={data.coachName} /></div>
        </div>
      </ReferencePanel>
      <ReferencePanel title="Employer & Contacts" subtitle="Employer information and key contacts for this learner" icon="ri-team-line" tone="primary">
        <div className={styles.employerGrid}>
          <div className={styles.subPanel}>
            <p className={styles.subPanelTitle}><AppIcon className="ri-building-line" />Employer Information</p>
            <ProfileInfo icon="ri-building-line" label="Organisation" value={data.employer} />
            <div className="mt-5 grid grid-cols-2 gap-4">
              <ProfileInfo icon="ri-mail-line" label="Employer Email" value={data.employerEmail} />
              <ProfileInfo icon="ri-phone-line" label="Employer Phone" value={data.employerPhone} />
            </div>
          </div>
          <div className={styles.subPanel}>
            <p className={styles.subPanelTitle}><AppIcon className="ri-group-line" />Key Contacts</p>
            <div className={styles.contacts}>
            {contacts.length === 0 ? <ProfileEmpty text="No employer contacts are available." /> : contacts.map((contact) => (
              <div key={`${contact.role}-${contact.name}`} className={styles.contactCard}>
                <span className={styles.contactAvatar}>{contact.initials}</span>
                <span><strong>{contact.name}</strong><small>{contact.role}{contact.meta ? ` · ${contact.meta}` : ''}</small></span>
                {contact.meta && <AppIcon className="ri-mail-line text-primary-600" />}
              </div>
            ))}
            </div>
          </div>
        </div>
      </ReferencePanel>
      <ReferencePanel title="Quick Notes" subtitle="Key insights and things to be aware of" icon="ri-file-list-3-line" tone="primary">
        {(data.coachNotes || []).length === 0 ? <ProfileEmpty text="No persisted coach notes are available for this learner." /> : <div className={styles.notesGrid}>
          {(data.coachNotes || []).map((note, index) => <div className={styles.note} key={`${note}-${index}`}><AppIcon className="ri-file-text-line" /><div><strong>Coach note</strong><p>{note}</p></div></div>)}
        </div>}
      </ReferencePanel>
    </div>
  );
}

function ReferenceProgressContent({ data, onViewEvidence }: {
  data: CoachLearnerCaseFileData;
  onViewEvidence: (evidence: EvidencePreviewTarget) => void;
}) {
  const [activeKsbCategory, setActiveKsbCategory] = useState('All');
  const [ksbSearch, setKsbSearch] = useState('');
  const [ksbSortKey, setKsbSortKey] = useState<KsbSortKey>('code');
  const [ksbSortDirection, setKsbSortDirection] = useState<SortDirection>('asc');
  const [fallbackKsbs, setFallbackKsbs] = useState<Array<{ code: string; description: string; type: string; number: string }>>([]);
  const [fallbackKsbsLoading, setFallbackKsbsLoading] = useState(false);
  const otjh = selectCaseFileOtjh(data);
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

  const ksbs = selectCaseFileKsbRows(data, fallbackKsbs);
  const ksbSummary = selectCaseFileKsbSummary(ksbs);
  const categoryOrder = ['Knowledge', 'Skills', 'Behaviours', 'Other'];
  const categoryOptions = Array.from(new Set(ksbs.map((item) => item.category))).sort((left, right) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    const normalizedLeft = leftIndex === -1 ? categoryOrder.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? categoryOrder.length : rightIndex;
    return normalizedLeft - normalizedRight || left.localeCompare(right);
  });
  const categorySummary = categoryOptions.map((category) => {
    const summary = category === 'Knowledge' ? ksbSummary.knowledge
      : category === 'Skills' ? ksbSummary.skills
        : category === 'Behaviours' ? ksbSummary.behaviours
          : { total: ksbs.filter((item) => item.category === category).length, achieved: ksbs.filter((item) => item.category === category && item.linked).length };
    return { category, total: summary.total, linked: summary.achieved, available: summary.total > 0 };
  });
  const categoryCodeCounts = new Map(categoryOptions.map((category) => [
    category,
    ksbs.filter((item) => item.category === category).length,
  ]));
  const normalizedSearch = ksbSearch.trim().toLowerCase();
  const filteredKsbs = ksbs.filter((item) => {
    const matchesCategory = activeKsbCategory === 'All' || item.category === activeKsbCategory;
    const matchesSearch = !normalizedSearch
      || item.code.toLowerCase().includes(normalizedSearch)
      || item.description.toLowerCase().includes(normalizedSearch)
      || item.category.toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  }).sort((left, right) => {
    const value = (item: typeof left): string | number => {
      switch (ksbSortKey) {
        case 'title': return item.description;
        case 'category': return item.category;
        case 'status': return item.linked ? 1 : 0;
        case 'evidence': return item.evidenceCount;
        default: return item.code;
      }
    };
    const leftValue = value(left);
    const rightValue = value(right);
    const delta = typeof leftValue === 'number'
      ? leftValue - Number(rightValue)
      : leftValue.localeCompare(String(rightValue), undefined, { numeric: ksbSortKey === 'code', sensitivity: 'base' });
    return (ksbSortDirection === 'asc' ? delta : -delta)
      || left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' });
  });
  const sortKsbs = (key: KsbSortKey) => {
    setKsbSortDirection((current) => ksbSortKey === key ? (current === 'asc' ? 'desc' : 'asc') : 'asc');
    setKsbSortKey(key);
  };
  const ksbSortHeader = (label: string, key: KsbSortKey) => {
    const active = ksbSortKey === key;
    return <button type="button" className={styles.columnLabel} onClick={() => sortKsbs(key)} aria-label={`Sort by ${label}`}>
      <span>{label}</span>
      {active ? (ksbSortDirection === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />) : <ArrowUpDown aria-hidden="true" />}
    </button>;
  };
  return (
    <div className={styles.stack}>
      <ReferencePanel title="Off-the-Job Hours (OTJH)" subtitle="Track on-the-job learning hours against your programme requirements." icon="ri-time-line" tone="primary">
        <div className={styles.metricGrid}>
          <BigMetric value={formatHours(otjh.logged)} label="Actual" tone="primary" />
          <BigMetric value={formatHours(otjh.target)} label="Target Hours" tone="muted" />
          <BigMetric value={formatHours(otjh.programmeTotal)} label="Planned" tone="amber" />
          <BigMetric value={formatHours(otjh.remaining)} label="Hours Remaining" tone="red" />
        </div>
        <ProfileProgress label="OTJH Progress" value={otjh.progressPercent} color="bg-primary-600" />
      </ReferencePanel>
      <ReferencePanel title="KSB Detailed Breakdown" subtitle="View your KSB progress and browse evidence coverage by framework code." icon="ri-stack-line" tone="primary">
        {fallbackKsbsLoading && ksbs.length === 0 ? <div className="p-2"><RowsSkeleton rows={4} avatar={false} /></div> : ksbs.length === 0 ? <ProfileEmpty text="No learner KSB snapshot or programme KSB framework is available yet." /> : (
          <div className="space-y-5">
            <div className={styles.ksbSummary}>
              <KsbOverviewCard icon="ri-stack-line" label="Total KSB points" value={String(ksbSummary.total)} tone="primary" />
              <KsbOverviewCard icon="ri-links-line" label="Points achieved" value={String(ksbSummary.achieved)} tone="emerald" />
              <KsbOverviewCard icon="ri-focus-3-line" label="Points remaining" value={String(ksbSummary.remaining)} tone="muted" />
            </div>

            <div>
              <p className="text-[12px] font-bold text-foreground-900">KSB points by category</p>
              <p className="mt-1 text-[11px] text-foreground-500">Counts use the same normalized KSB rows and evidence as the browser below.</p>
              <div className={styles.coverageGrid}>
                {categorySummary.map((group) => (
                  <div key={group.category} className={styles.coverageCard}>
                    <div className={styles.coverageHead}>
                      <span className="inline-flex items-center gap-2"><AppIcon className={ksbCategoryIcon(group.category)} />{group.category}</span>
                      <span>{group.available ? `${group.linked} / ${group.total}` : '--'}</span>
                    </div>
                    <ProfileProgress label="" value={group.available && group.total ? Math.round((group.linked / group.total) * 100) : null} tone={group.category === 'Behaviours' ? 'amber' : 'primary'} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ReferencePanel>

      <ReferencePanel title="KSB Browser" subtitle="Search and filter KSBs to review details and evidence coverage." icon="ri-book-open-line" tone="primary" className={styles.browserPanel}>
        <div className={styles.browserToolbar}>
          <label className={styles.search}>
            <span className="sr-only">Search KSBs</span>
            <AppIcon className="ri-search-line" />
            <input value={ksbSearch} onChange={(event) => setKsbSearch(event.target.value)} placeholder="Search KSBs by code, title or description..." />
          </label>
          <div className={styles.filterPills}>
            {['All', ...categoryOptions].map((category) => (
              <button key={category} type="button" className={cn(styles.filterPill, activeKsbCategory === category && styles.filterPillActive)} onClick={() => setActiveKsbCategory(category)}>
                {category} ({category === 'All' ? ksbs.length : categoryCodeCounts.get(category) || 0})
              </button>
            ))}
          </div>
        </div>
        {filteredKsbs.length === 0 ? <ProfileEmpty text="No KSBs matched the current filter." /> : (
          <div className={styles.tableScroll}>
            <table className={styles.ksbTable}>
              <thead><tr>
                <th aria-sort={ksbSortKey === 'code' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('KSB Code', 'code')}</th>
                <th aria-sort={ksbSortKey === 'title' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Title', 'title')}</th>
                <th aria-sort={ksbSortKey === 'category' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Category', 'category')}</th>
                <th aria-sort={ksbSortKey === 'status' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Status', 'status')}</th>
                <th aria-sort={ksbSortKey === 'evidence' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Evidence', 'evidence')}</th>
                <th>Actions</th>
              </tr></thead>
              <tbody>
                {filteredKsbs.map((item) => (
                  <tr key={item.code} className={!item.code.includes('.') ? styles.ksbParentRow : undefined}>
                    <td><strong className={styles.ksbCode}>{item.code}</strong></td>
                    <td>{item.description}</td>
                    <td><StatusBadge tone={ksbCategoryTone(item.category)} label={item.category} size="sm" dot={false} /></td>
                    <td><StatusBadge tone={item.linked ? 'positive' : 'neutral'} label={item.linked ? 'Evidence linked' : 'Not evidenced'} size="sm" /></td>
                    <td>{item.evidenceCount}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.tableButton}
                        onClick={() => onViewEvidence({ code: item.code, title: item.description, category: item.category, linked: item.linked, activities: item.evidenceActivities })}
                      >
                        View <AppIcon className="ri-arrow-right-s-line" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReferencePanel>
    </div>
  );
}

function EvidencePreviewModal({ evidence, onClose, onOpenAssignment }: { evidence: EvidencePreviewTarget; onClose: () => void; onOpenAssignment: (componentId: string) => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-preview-title"
        className="max-h-[84vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-foreground-200/60 bg-white shadow-2xl"
      >
        <div className="border-b border-primary-100 bg-primary-50/40 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">KSB Evidence Details</p>
              <h2 id="evidence-preview-title" className="mt-1 break-words text-lg font-semibold leading-6 text-foreground-900">{evidence.title || 'KSB evidence'}</h2>
              <p className="mt-1 text-xs text-foreground-500">View completed activities and evidence linked to this KSB.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close evidence" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-400 hover:bg-white hover:text-foreground-700">
              <AppIcon className="ri-close-line" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {evidence.code && <span className="rounded-md bg-white px-2.5 py-1 font-bold text-primary-700">{evidence.code}</span>}
            {evidence.category && <span className="rounded-md border border-primary-100 bg-white px-2.5 py-1 text-foreground-600">{evidence.category}</span>}
            <span className={`rounded-md px-2.5 py-1 font-semibold ${evidence.linked ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-600'}`}>{evidence.linked ? 'Evidence linked' : 'Not evidenced'}</span>
            <span className="text-foreground-500">{evidence.activities.length} evidence {evidence.activities.length === 1 ? 'item' : 'items'}</span>
          </div>
        </div>
        <div className="max-h-[calc(84vh-190px)] overflow-y-auto p-6">
          {evidence.activities.length ? <div className="grid gap-3 md:grid-cols-2">{evidence.activities.map((activity, index) => (
            <div
              key={`${activity.title}-${activity.type}-${index}`}
              className="rounded-xl border border-background-200 bg-background-50 p-4"
            >
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{activity.type}</p><p className="mt-1 break-words text-sm font-semibold text-foreground-900">{activity.title || 'Aptem evidence'}</p></div>{activity.componentId && <button type="button" aria-label={`${activity.type} ${activity.title}`} onClick={() => onOpenAssignment(activity.componentId!)} className="shrink-0 rounded-md border border-primary-200 px-2 py-1 text-[10px] font-semibold text-primary-700 hover:bg-primary-50">View Details</button>}</div>
              <p className="mt-3 text-xs text-foreground-500">{activity.type === 'Historical Activity' ? 'Historical Activity' : `Source: ${activity.source || activity.type}`}</p>
              {activity.source && <p className="mt-1 text-[11px] text-foreground-500">Source: {activity.source}</p>}
              {activity.completedAt && <p className="mt-1 text-[11px] text-foreground-500">Completed: {activity.completedAt}</p>}
              {activity.activityId && <p className="mt-1 text-[11px] text-foreground-500">Activity ID: {activity.activityId}</p>}
              {activity.status && <p className="mt-1 text-[11px] text-foreground-500">Status: {activity.status}</p>}
              {activity.module && <p className="mt-1 text-[11px] text-foreground-500">Module: {activity.module}</p>}
            </div>
          ))}</div> : <p className="rounded-xl border border-dashed border-background-300 p-6 text-sm text-foreground-500">No evidence details are available for this KSB.</p>}
        </div>
      </section>
    </div>
  );
}

type CaseFileKsbBrowserRow = {
  code: string;
  description: string;
  type: string;
  number: string;
  category: string;
  evidenceActivities: EvidencePreviewTarget['activities'];
  evidenceCount: number;
  linked: boolean;
};

function selectCaseFileKsbRows(
  data: CoachLearnerCaseFileData,
  fallbackKsbs: Array<{ code: string; description: string; type: string; number: string }> = [],
): CaseFileKsbBrowserRow[] {
  const touched = new Set(data.touchedKsbCodes.map((code) => normalizeKsbCode(code)));
  const mapped = new Set(data.mappedKsbCodes.map((code) => normalizeKsbCode(code)));
  const parentRows = new Map<string, ReturnType<typeof buildDisplayKsbs>[number]>();
  for (const item of buildDisplayKsbs(data, fallbackKsbs)) {
    const rawCode = String(item.code || '').trim().toUpperCase();
    const parentCode = normalizeKsbCode(rawCode);
    if (!parentCode || (mapped.size > 0 && !mapped.has(parentCode))) continue;
    const current = parentRows.get(parentCode);
    // Profiles commonly contain both B1 and B1.1/B1.2. Keep one row per
    // canonical parent and prefer the parent's own title over a child title.
    if (!current || rawCode === parentCode) {
      parentRows.set(parentCode, { ...item, code: parentCode });
    }
  }

  return Array.from(parentRows.entries())
    .map(([code, item]) => {
      const evidenceActivities = ksbLearningActivities(data, code);
      return {
        ...item,
        code,
        category: ksbCategoryFromCode(code),
        evidenceActivities,
        evidenceCount: evidenceActivities.length,
        linked: touched.has(code),
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' }));
}

function selectCaseFileKsbSummary(rows: CaseFileKsbBrowserRow[]) {
  const total = rows.length;
  const achieved = rows.filter((row) => row.linked).length;
  const byCategory = (category: string) => {
    const categoryRows = rows.filter((row) => row.category === category);
    const categoryTotal = categoryRows.length;
    const categoryAchieved = categoryRows.filter((row) => row.linked).length;
    return {
      total: categoryTotal,
      achieved: categoryAchieved,
      percent: categoryTotal ? Math.round((categoryAchieved / categoryTotal) * 100) : null,
    };
  };
  return {
    total,
    achieved,
    remaining: Math.max(0, total - achieved),
    percent: total ? Math.round((achieved / total) * 100) : null,
    knowledge: byCategory('Knowledge'),
    skills: byCategory('Skills'),
    behaviours: byCategory('Behaviours'),
  };
}

function ksbLearningActivities(data: CoachLearnerCaseFileData, code: string): EvidencePreviewTarget['activities'] {
  const normalizedCode = normalizeKsbCode(code);
  const activities: EvidencePreviewTarget['activities'] = [];
  const seen = new Set<string>();
  const add = (title: string | null | undefined, type: string | null | undefined, key: string, componentId?: string | null, metadata?: Partial<EvidencePreviewTarget['activities'][number]>) => {
    if (!title || seen.has(key)) return;
    seen.add(key);
    const normalizedType = String(type || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
    activities.push({
      title,
      componentId: componentId || undefined,
      type: normalizedType === 'live session' ? 'Live session'
        : normalizedType ? normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)
          : 'Activity type unavailable',
      ...metadata,
    });
  };

  const completedDetail = data.snapshot?.ksbCompletedDetails?.find(
    (item) => normalizeKsbCode(item.code) === normalizedCode,
  );
  for (const [index, source] of (completedDetail?.sources || []).entries()) {
    add(
      source.title || source.id || 'Aptem evidence',
      source.typeLabel || source.kind,
      source.id || `completed-source:${normalizedCode}:${index}`,
      undefined,
      source,
    );
  }
  // Caseload KSB sources are the authoritative completed evidence records. If
  // an older payload has no source detail, fall back to learner-plan activity
  // mappings so View remains useful instead of showing an empty modal.
  if (activities.length > 0) return activities;

  const detail = data.detail;
  if (!detail) return activities;
  for (const component of detail.components) {
    if (!(component.ksbMappings || []).some((mapping) => normalizeKsbCode(mapping.code) === normalizedCode)) continue;
    add(component.component, component.isQuiz ? 'quiz' : component.type, component.componentId || `${component.module}:${component.week}:${component.component}`, component.componentId);
  }
  for (const attempt of detail.quizAttempts) {
    if (!(attempt.ksbs || []).some((ksb) => normalizeKsbCode(ksb) === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === attempt.componentId || item.quizMeta?.quizId === attempt.quizId);
    add(attempt.componentTitle || component?.component || `Quiz ${attempt.quizId}`, 'quiz', attempt.componentId || component?.componentId || `quiz:${attempt.quizId}`);
  }
  for (const progress of detail.videoProgress || []) {
    if (!(progress.ksbs || []).some((ksb) => normalizeKsbCode(ksb) === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === progress.componentId);
    add(component?.component || 'Video', 'video', progress.componentId);
  }
  for (const progress of detail.componentProgress || []) {
    if (!(progress.ksbs || []).some((ksb) => normalizeKsbCode(ksb) === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === progress.componentId);
    add(progress.componentTitle || component?.component || progress.componentType, progress.componentType || component?.type, progress.componentId);
  }
  return activities;
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
    <div className={styles.ksbSummaryCard}>
      <i className={toneMap[tone]}><AppIcon className={icon} /></i>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function ReferenceAttendanceContent({ data }: { data: CoachLearnerCaseFileData }) {
  const attendance = data.attendance;
  const [attendanceSessions, setAttendanceSessions] = useState<AttendanceDetailSession[]>([]);
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState('all');
  const [attendanceMonth, setAttendanceMonth] = useState('all');
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [, setDetailsLoaded] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAttendanceSessions() {
      if (!attendance?.id || !attendance.hasAttendance) {
        setAttendanceSessions([]);
        setDetailsError(null);
        setDetailsLoading(false);
        setDetailsLoaded(false);
        return;
      }

      setDetailsLoading(true);
      setDetailsLoaded(false);
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
          setDetailsLoaded(true);
        }
      } catch (loadError) {
        if (!cancelled) {
          setAttendanceSessions([]);
          setDetailsLoaded(false);
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
  const summarySessions = data.attendanceSessionCount ?? attendance.sessions;
  const summaryPresent = data.attendancePresentCount ?? attendance.present;
  const summaryAbsent = data.attendanceAbsentCount ?? attendance.absent;
  const outstandingAbsences = summaryAbsent;
  const monthOptions = Array.from(new Set(attendanceSessions
    .map((session) => session.sessionDate?.slice(0, 7))
    .filter((month): month is string => Boolean(month))))
    .sort((left, right) => right.localeCompare(left));
  const normalizedSearch = attendanceSearch.trim().toLowerCase();
  const filteredSessions = attendanceSessions.filter((session) => {
    const resolvedStatus = session.catchupCompleted ? 'catchup' : session.status.toLowerCase();
    const matchesStatus = attendanceStatus === 'all' || resolvedStatus === attendanceStatus;
    const matchesMonth = attendanceMonth === 'all' || session.sessionDate?.startsWith(attendanceMonth);
    const matchesSearch = !normalizedSearch || [session.sessionTitle, session.sessionType, session.reason]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    return matchesStatus && matchesMonth && matchesSearch;
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <BigMetric value={formatAttendanceFraction(summaryPresent, summarySessions)} label="Attendance" tone="primary" />
        <BigMetric value={String(summarySessions ?? '--')} label="Total Sessions" tone="muted" />
        <BigMetric value={String(summaryPresent ?? '--')} label="Attended" tone="emerald" />
        <BigMetric value={String(outstandingAbsences ?? '--')} label="Absent" tone="red" />
        <BigMetric value={String(outstandingAbsences ?? '--')} label="Outstanding Absences" tone="red" />
      </div>
      <ReferencePanel title="Session History" icon="ri-table-line" tone="primary">
        {detailsLoading ? (
          <div className="p-2"><RowsSkeleton rows={3} avatar={false} /></div>
        ) : detailsError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800">{detailsError}</div>
        ) : attendanceSessions.length ? (
          <>
            <div className={styles.attendanceToolbar}>
              <label className={styles.attendanceSearch}>
                <span className="sr-only">Search sessions</span>
                <AppIcon className="ri-search-line" />
                <input value={attendanceSearch} onChange={(event) => setAttendanceSearch(event.target.value)} placeholder="Search session or reason" />
              </label>
              <label className={styles.attendanceFilter}>
                <span>Status</span>
                <select value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="present">Attended</option>
                  <option value="absent">Absent</option>
                  <option value="catchup">Catch-up completed</option>
                </select>
              </label>
              <label className={styles.attendanceFilter}>
                <span>Month</span>
                <select value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)}>
                  <option value="all">All dates</option>
                  {monthOptions.map((month) => <option key={month} value={month}>{formatAttendanceMonth(month)}</option>)}
                </select>
              </label>
            </div>
            <p className={styles.attendanceResults}>{filteredSessions.length} of {attendanceSessions.length} sessions</p>
            <div className={styles.attendanceTableScroll}>
              <table className={styles.attendanceTable}>
                <thead><tr><th>Session</th><th>Date</th><th>Attendance</th><th>Reason</th></tr></thead>
                <tbody>{filteredSessions.map((session, index) => (
                  <tr key={`${session.sessionId}-${session.sessionDate || index}-history`}>
                    <td><strong>{displayInline(session.sessionTitle)}</strong></td>
                    <td>{displayInline(session.sessionDateLabel, '—')}</td>
                    <td><span className={cn(styles.attendanceStatus, attendanceStatusClass(session))}>{attendanceStatusLabel(session)}</span></td>
                    <td>{attendanceReason(session)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {filteredSessions.length === 0 && <ProfileEmpty text="No sessions match the selected filters." />}
          </>
        ) : (
          <ProfileEmpty text="No session history is available for this learner yet." />
        )}
      </ReferencePanel>
    </div>
  );
}

function ReferenceReviewsContent({
  data,
  onOpen,
  requestedReviewId,
}: {
  data: CoachLearnerCaseFileData;
  onOpen: (item: CaseFileReviewMeeting) => void;
  requestedReviewId?: string;
}) {
  type ReviewFilter = 'all' | 'progress-review' | 'mcr' | 'completed' | 'upcoming';
  const pageSize = 10;
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [page, setPage] = useState(1);
  const reviewsLoading = data.reviewsLoading && data.reviewGroups.length === 0;
  const reviewItems = data.reviewGroups.flatMap(group => group.items);
  const isUpcoming = (item: CaseFileReviewMeeting) => !['completed', 'cancelled'].includes(item.status);
  const visibleItems = reviewItems.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'completed') return item.status === 'completed';
    if (filter === 'upcoming') return isUpcoming(item);
    return item.source === filter;
  });
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedItems = visibleItems.slice(pageStart, pageStart + pageSize);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter(pageNumber => totalPages <= 7 || pageNumber === 1 || pageNumber === totalPages || Math.abs(pageNumber - currentPage) <= 1);
  const paginationItems = pageNumbers.reduce<Array<number | 'ellipsis'>>((items, pageNumber, index) => {
    if (index > 0 && pageNumber - pageNumbers[index - 1] > 1) items.push('ellipsis');
    items.push(pageNumber);
    return items;
  }, []);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);
  const summaries = [
    ['Total Reviews', reviewItems.length],
    ['Progress Reviews', reviewItems.filter(item => item.source === 'progress-review').length],
    ['Monthly Coaching Meetings', reviewItems.filter(item => item.source === 'mcr').length],
    ['Completed', reviewItems.filter(item => item.status === 'completed').length],
    ['Upcoming', reviewItems.filter(isUpcoming).length],
  ] as const;
  const filters: Array<{ id: ReviewFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'progress-review', label: 'Progress Review' },
    { id: 'mcr', label: 'Monthly Coaching Meeting' },
    { id: 'completed', label: 'Completed' },
    { id: 'upcoming', label: 'Upcoming' },
  ];

  return (
    <div className={styles.stack}>
      {requestedReviewId ? <ImportedReviewHistory
        kind={data.kind}
        learnerId={data.enrolmentId || data.learnerId}
        category="reviews"
        reviewId={requestedReviewId}
      /> : null}
      {!requestedReviewId && <>
      {data.reviewGenerationIssues.map(issue => (
        <div key={issue.code} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900" role="status">
          <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-[18px]"></AppIcon>
          <div>
            <p className="text-[13px] font-semibold">Review schedule unavailable</p>
            <p className="mt-1 text-[12px] leading-5">{reviewGenerationIssueMessage(issue.code)}</p>
          </div>
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Review summary">
        {summaries.map(([label, value]) => <div key={label} className="rounded-xl border border-foreground-200/70 bg-white p-4 shadow-sm">
          <strong className="block text-2xl text-foreground-950">{value}</strong>
          <span className="mt-1 block text-xs font-semibold text-foreground-500">{label}</span>
        </div>)}
      </div>
      <ReferencePanel title="Review History" subtitle="Progress reviews and monthly coaching meetings for this learner" icon="ri-file-list-3-line" tone="primary">
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Review filters">
          {filters.map(option => <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => { setFilter(option.id); setPage(1); }}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', filter === option.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-foreground-200 bg-white text-foreground-700 hover:border-primary-300')}>
            {option.label}
          </button>)}
        </div>
        {reviewsLoading ? <div aria-label="Loading reviews"><RowsSkeleton rows={5} avatar={false} /></div> : reviewItems.length === 0
          ? <div className={styles.empty}><p>No reviews found for this learner.</p></div>
          : visibleItems.length === 0 ? <div className={styles.empty}><p>No reviews match this filter.</p></div>
          : <><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
            <thead><tr className="border-b border-foreground-200 text-foreground-500">
              {['Review Type', 'Planned Date', 'Completed Date', 'Status', 'Reviewer', 'Actions'].map(label => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}
            </tr></thead>
            <tbody>{paginatedItems.map(item => <tr key={item.id} className="border-b border-foreground-100 last:border-0">
              <td className="px-3 py-3 font-semibold text-foreground-900">{item.reviewTypeName}</td>
              <td className="px-3 py-3 text-foreground-700">{item.plannedDate}</td>
              <td className="px-3 py-3 text-foreground-700">{item.completedDate}</td>
              <td className="px-3 py-3"><StatusBadge status={item.status} label={item.statusLabel} size="sm" /></td>
              <td className="px-3 py-3 text-foreground-700">{item.reviewer}</td>
              <td className="px-3 py-3"><div className="flex flex-wrap gap-2">
                <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View</button>
                {item.hasForm ? <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View Form</button> : null}
                {item.hasTranscript ? <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View Transcript</button> : null}
                {item.hasAttendance ? <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View Attendance</button> : null}
              </div></td>
            </tr>)}</tbody>
          </table></div>
          {visibleItems.length > pageSize && <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-foreground-100 pt-4" aria-label="Review pagination">
            <p className="text-xs font-medium text-foreground-500">
              Showing {pageStart + 1}-{Math.min(pageStart + pageSize, visibleItems.length)} of {visibleItems.length} reviews
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}
                className="rounded-lg border border-foreground-200 bg-white px-3 py-1.5 text-xs font-semibold text-foreground-700 transition hover:border-primary-300 disabled:cursor-not-allowed disabled:opacity-45">
                Previous
              </button>
              {paginationItems.map((item, index) => item === 'ellipsis'
                ? <span key={`ellipsis-${index}`} className="px-1 text-xs text-foreground-400" aria-hidden="true">...</span>
                : <button key={item} type="button" aria-label={`Go to page ${item}`} aria-current={item === currentPage ? 'page' : undefined} onClick={() => setPage(item)}
                    className={cn('h-8 min-w-8 rounded-lg border px-2 text-xs font-semibold transition', item === currentPage ? 'border-primary-600 bg-primary-600 text-white' : 'border-foreground-200 bg-white text-foreground-700 hover:border-primary-300')}>
                    {item}
                  </button>)}
              <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}
                className="rounded-lg border border-foreground-200 bg-white px-3 py-1.5 text-xs font-semibold text-foreground-700 transition hover:border-primary-300 disabled:cursor-not-allowed disabled:opacity-45">
                Next
              </button>
            </div>
          </nav>}</>}
      </ReferencePanel>
      </>}
    </div>
  );
}

function AddLearnerReviewModal({
  data,
  onClose,
  onChanged,
}: {
  data: CoachLearnerCaseFileData;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [templates, setTemplates] = useState<LearnerAdditionReviewTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [reasonCode, setReasonCode] = useState<LearnerAdditionReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [scheduleNow, setScheduleNow] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleFormState>(EMPTY_REVIEW_SCHEDULE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTemplatesLoading(true);
    setError(null);
    fetchLearnerAdditionReviewTemplates(data.learnerId, controller.signal)
      .then(body => {
        setTemplates(body.templates || []);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTemplates([]);
        setError(err instanceof Error ? err.message : 'Unable to load Review templates for this learner.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setTemplatesLoading(false);
      });
    return () => controller.abort();
  }, [data.learnerId]);

  const canSubmit = Boolean(templateId && targetDate && (!scheduleNow || (schedule.date && schedule.time)));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const addition = await createLearnerReviewAddition({
        learnerId: data.learnerId,
        reviewTemplateId: templateId,
        targetDate,
        reasonCode,
        reason,
      });
      if (scheduleNow) {
        await scheduleCoachCalendarEvent(
          { id: addition.eventKey, eventKey: addition.eventKey, title: addition.reviewName, type: 'review', source: 'review', status: 'not-scheduled' },
          schedule,
        );
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add this Review.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-foreground-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="add-review-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-foreground-100 px-5 py-4">
          <div>
            <p id="add-review-title" className="text-[15px] font-bold text-foreground-950">Add Review</p>
            <p className="mt-1 text-[12px] text-foreground-500">{data.displayName} - {data.programme || 'No programme'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-400 transition hover:bg-background-100 hover:text-foreground-800 disabled:opacity-50" aria-label="Close">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <ScheduleFieldLabel>Review template</ScheduleFieldLabel>
            <select
              value={templateId}
              onChange={event => setTemplateId(event.target.value)}
              disabled={busy || templatesLoading || templates.length === 0}
              className="w-full rounded-lg border border-foreground-200 bg-background-50 px-3 py-2.5 text-[13px] font-semibold text-foreground-900 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
            >
              <option value="">
                {templatesLoading ? 'Loading templates...' : templates.length ? 'Select a Review template' : 'No enabled Review templates for this learner'}
              </option>
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}{template.reviewTypeName ? ` (${template.reviewTypeName})` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <ScheduleFieldLabel>Target date</ScheduleFieldLabel>
              <ModernDatePicker value={targetDate} onChange={setTargetDate} />
            </label>
            <label className="block">
              <ScheduleFieldLabel>Reason</ScheduleFieldLabel>
              <select
                value={reasonCode}
                onChange={event => setReasonCode(event.target.value as LearnerAdditionReasonCode | '')}
                disabled={busy}
                className="w-full rounded-lg border border-foreground-200 bg-background-50 px-3 py-2.5 text-[13px] font-semibold text-foreground-900 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
              >
                <option value="">No reason selected</option>
                <option value="additional-coaching">Additional coaching required</option>
                <option value="learner-request">Learner request</option>
                <option value="employer-request">Employer request</option>
                <option value="performance-concern">Performance concern</option>
                <option value="safeguarding-follow-up">Safeguarding follow-up</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          <label className="block">
            <ScheduleFieldLabel>Note</ScheduleFieldLabel>
            <textarea
              value={reason}
              onChange={event => setReason(event.target.value.slice(0, 1000))}
              disabled={busy}
              rows={3}
              placeholder="Add context for why this learner needs an additional Review..."
              className="w-full resize-none rounded-lg border border-foreground-200 bg-background-50 px-3 py-2.5 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
            />
            <span className="mt-1 block text-right text-[11px] text-foreground-400">{reason.length}/1000</span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-foreground-200 bg-background-50 p-3">
            <input
              type="checkbox"
              checked={scheduleNow}
              onChange={event => setScheduleNow(event.target.checked)}
              disabled={busy}
              className="mt-1 h-4 w-4 rounded border-foreground-300 text-primary-600 focus:ring-primary-200"
            />
            <span>
              <span className="block text-[13px] font-bold text-foreground-900">Schedule a Teams meeting now</span>
              <span className="mt-0.5 block text-[12px] text-foreground-500">Leave this off to add the Review as Not Scheduled.</span>
            </span>
          </label>

          {scheduleNow ? (
            <div className="grid gap-3 rounded-xl border border-primary-100 bg-primary-50/40 p-3 sm:grid-cols-3">
              <label className="block sm:col-span-1">
                <ScheduleFieldLabel>Meeting date</ScheduleFieldLabel>
                <ModernDatePicker value={schedule.date} onChange={value => setSchedule(current => ({ ...current, date: value }))} />
              </label>
              <label className="block">
                <ScheduleFieldLabel>Time</ScheduleFieldLabel>
                <ScheduleTimeInput value={schedule.time} onChange={value => setSchedule(current => ({ ...current, time: value }))} />
              </label>
              <label className="block">
                <ScheduleFieldLabel>Duration</ScheduleFieldLabel>
                <ModernDurationPicker value={schedule.durationMinutes} onChange={value => setSchedule(current => ({ ...current, durationMinutes: value }))} />
              </label>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{error}</div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-foreground-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-foreground-200 px-4 py-2.5 text-[13px] font-bold text-foreground-600 transition hover:bg-background-100 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={busy || !canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AppIcon className={busy ? 'ri-loader-4-line animate-spin' : scheduleNow ? 'ri-calendar-check-line' : 'ri-file-add-line'}></AppIcon>
            {busy ? 'Adding...' : scheduleNow ? 'Add & Schedule' : 'Add Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

function reviewGenerationIssueMessage(code: string) {
  if (code === 'missing_learner_start_date') {
    return 'Future reviews and monthly coaching meetings cannot be generated because the learner start date is missing. Existing scheduled records may still appear below.';
  }
  if (code === 'invalid_learner_start_date') {
    return 'Future reviews and monthly coaching meetings cannot be generated because the learner start date is invalid.';
  }
  if (code === 'missing_learner_enrolment') {
    return 'Future reviews and monthly coaching meetings cannot be generated because this learner is not linked to an enrolment record.';
  }
  if (code === 'missing_curriculum_programme') {
    return 'Review scheduling is unavailable because this learner is not linked to a Curriculum programme.';
  }
  if (code === 'no_enabled_review_templates') {
    return 'No enabled Review templates are configured for this learner\'s Curriculum programme.';
  }
  return 'The review schedule could not be generated for this learner. Check their enrolment and Curriculum configuration.';
}

function ReviewMeetingList({ items, itemLabel, onOpen }: { items: CaseFileReviewMeeting[]; itemLabel: 'review' | 'meeting'; onOpen: (item: CaseFileReviewMeeting) => void }) {
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? items : items.slice(0, 6);

  return (
    <div>
      {visibleItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className="flex w-full items-start gap-3 border-b border-foreground-100 py-4 text-left transition-colors last:border-0 hover:bg-background-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          aria-label={`View ${itemLabel}: ${item.title}`}
          onClick={() => onOpen(item)}
        >
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
          <span className="mt-2 flex h-8 w-8 shrink-0 items-center justify-center text-foreground-400" title={`View ${itemLabel}`}>
            <AppIcon className="ri-arrow-right-s-line text-lg"></AppIcon>
          </span>
        </button>
      ))}
      {items.length > 6 ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-primary-700 hover:text-primary-800"
          onClick={() => setShowAll(current => !current)}
        >
          <AppIcon className={showAll ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></AppIcon>
          {showAll ? 'Show fewer' : `Show all (${items.length})`}
        </button>
      ) : null}
    </div>
  );
}

function ReferencePanel({ title, subtitle, icon, tone, actions, children, className }: {
  title: string;
  subtitle?: string;
  icon: string;
  tone: 'primary' | 'emerald' | 'red' | 'muted';
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={cn(styles.panel, className)}>
    <header className={styles.panelHeader}>
      <div className={styles.panelHeading}>
        <span className={styles.panelIcon} data-tone={tone}><AppIcon className={icon} /></span>
        <div><h3 className={styles.panelTitle}>{title}</h3>{subtitle && <p className={styles.panelSubtitle}>{subtitle}</p>}</div>
      </div>
      {actions}
    </header>
    <div className={styles.panelBody}>{children}</div>
  </section>;
}

function ProfileInfo({ icon = 'ri-information-line', label, value }: { icon?: string; label: string; value?: string | null }) {
  return <div className={styles.info}><AppIcon className={icon} /><div className="min-w-0"><p className={styles.infoLabel}>{label}</p><p className={styles.infoValue}>{value && value !== '--' ? value : '--'}</p></div></div>;
}

function ProfileProgress({ label, value, tone, color }: { label: string; value: number | null; tone?: 'primary' | 'emerald' | 'amber' | 'striped'; color?: string }) {
  const resolvedTone = tone || (color?.includes('emerald') ? 'emerald' : color?.includes('amber') ? 'amber' : 'primary');
  return <div className={styles.progressRow}><div className={styles.progressMeta}><span>{label}</span><strong>{value === null ? '--' : `${Math.round(value)}%`}</strong></div><div className={cn(styles.track, resolvedTone === 'striped' && styles.striped)}><div className={styles.fill} data-tone={resolvedTone} style={{ width: `${value || 0}%` }} /></div></div>;
}

function BigMetric({ value, label, tone }: { value: string; label: string; tone: 'primary' | 'emerald' | 'red' | 'amber' | 'muted' }) {
  const color = { primary: 'text-primary-700', emerald: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', muted: 'text-foreground-700' }[tone];
  return <div className={styles.bigMetric}><p className={cn(styles.bigMetricValue, color)}>{value}</p><p className={styles.bigMetricLabel}>{label}</p></div>;
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

function formatAttendanceMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function formatCount(value: number | null) {
  return value === null ? '--' : String(Math.max(0, Math.round(value)));
}

function formatAttendanceFraction(present: number | null, sessions: number | null) {
  if (present === null || sessions === null) return '--';
  return `${formatCount(present)} / ${formatCount(sessions)}`;
}

function attendanceStatusLabel(session: AttendanceDetailSession) {
  if (session.catchupCompleted) return 'Catch-up';
  const status = String(session.status || '').trim().toLowerCase();
  if (status === 'present') return 'Present';
  if (status === 'late') return 'Late';
  if (status === 'absent') return 'Absent';
  return status ? status[0].toUpperCase() + status.slice(1) : '—';
}

function attendanceStatusClass(session: AttendanceDetailSession) {
  const status = String(session.status || '').trim().toLowerCase();
  if (session.catchupCompleted || status === 'present') return styles.attendanceStatusPositive;
  if (status === 'absent') return styles.attendanceStatusNegative;
  return styles.attendanceStatusNeutral;
}

function attendanceReason(session: AttendanceDetailSession) {
  const reason = String(session.reason || '').trim();
  if (reason && reason !== '--') return reason;
  return String(session.status || '').trim().toLowerCase() === 'absent' ? 'No reason provided' : '—';
}

function ProfileEmpty({ text }: { text: string }) {
  return <div className={styles.empty}><span>{text}</span></div>;
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

function initialsFromName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
