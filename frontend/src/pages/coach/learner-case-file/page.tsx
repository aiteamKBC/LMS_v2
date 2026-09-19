import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { fetchKsbProfile } from '@/api/curriculum';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { cn } from '@/lib/cn';
import { statusTone, toneStyle, type StatusTone } from '@/lib/statusTone';
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
  selectCaseFileOtjh,
  useCoachLearnerCaseFileData,
  type CaseFileActivityItem,
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
  { id: 'otjh', label: 'OTJH', icon: 'ri-time-line' },
  { id: 'ksbs', label: 'KSBs', icon: 'ri-award-line' },
  { id: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line' },
  { id: 'audit', label: 'Audit', icon: 'ri-file-search-line' },
  { id: 'activity', label: 'Activity', icon: 'ri-history-line' },
  { id: 'network', label: 'Network', icon: 'ri-user-heart-line' },
  { id: 'documents', label: 'Documents', icon: 'ri-folder-line' },
] as const;

type TabId = typeof CASE_FILE_TABS[number]['id'] | 'coach-notes';
type EvidencePreviewTarget = {
  title: string;
  activities: Array<{ title: string; type: string; componentId?: string }>;
};
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
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreviewTarget | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as LocationState;

  const requestedTab = searchParams.get('tab') || state.tab;
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

  useEffect(() => {
    if (CASE_FILE_TABS.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab as TabId);
    }
  }, [requestedTab]);

  const subtitle = buildSubtitle(data);
  const pageTitle = data?.displayName || learnerName || 'Learner case file';
  const pageSubtitle = subtitle || 'Live learner view for coaching support';
  const nextLiveSession = data?.upcomingSessions[0] || null;
  const headerOtjh = data ? selectCaseFileOtjh(data) : null;

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
        return <ReferenceOverviewContent data={data} onSchedule={() => navigate('/coach/timetable')} />;
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
          onChanged={refresh}
          onOpenNotes={() => setActiveTab('coach-notes')}
          onOpenMonthlyLogs={() => data.detail?.id && navigate(`/coach/monthly-logs/${data.detail.id}`)}
        />;
      case 'coach-notes':
        return <DocumentsTab data={data} />;
      case 'support':
        return <LearningPlanTab data={data} onOpenNotes={() => setActiveTab('coach-notes')} />;
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
        return <ReferenceOverviewContent data={data} onSchedule={() => navigate('/coach/timetable')} />;
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

          <div className={styles.metrics}>
              <CaseFileHeroMetric icon="ri-focus-3-line" label="Overall" value={formatPercent(data?.overallProgress ?? null)} />
              <CaseFileHeroMetric icon="ri-time-line" label="OTJH (Actual / Target)" value={headerOtjh ? formatFraction(headerOtjh.logged, headerOtjh.target) : '--'} />
              <CaseFileHeroMetric icon="ri-stack-line" label="KSB" value={formatPercent(data?.ksbProgress ?? null)} />
              <CaseFileHeroMetric icon="ri-group-line" label="Attendance" value={formatPercent(data?.attendanceRate ?? null)} />
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

function ReferenceOverviewContent({
  data,
  onSchedule,
}: {
  data: CoachLearnerCaseFileData;
  onSchedule: () => void;
}) {
  const activities = data.activityItems.slice(0, 6);
  const upcomingSessions = data.upcomingSessions;
  const otjh = selectCaseFileOtjh(data);
  return (
    <div className={styles.stack}>
      <div className={styles.overviewGrid}>
        <ReferencePanel title="Profile Snapshot" subtitle="Current progress and support context" icon="ri-user-line" tone="primary">
          <div className={styles.profileGrid}>
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
        </ReferencePanel>
        <ReferencePanel title="Progress Summary" subtitle="Current progress against key targets" icon="ri-bar-chart-box-line" tone="emerald">
          <div className={styles.progressStack}>
            <ProfileProgress label="Overall Progress" value={data.overallProgress} tone="primary" />
            <ProfileProgress label="OTJH Progress" value={otjh.progressPercent} tone="primary" />
            <ProfileProgress label="KSB Coverage" value={data.ksbProgress} tone="emerald" />
            <ProfileProgress label="Attendance" value={data.attendanceRate} tone="striped" />
          </div>
        </ReferencePanel>
        <ReferencePanel title="Recent Activity" subtitle="Latest updates, evidence and interactions" icon="ri-time-line" tone="muted">
          {activities.length === 0 ? <ProfileEmpty text="No recent activity yet. Activity such as evidence uploads, meeting notes and progress updates will appear here." /> : <div className={styles.activityList}>{activities.map((item) => (
            <div key={item.id} className={styles.activityRow}>
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', toneStyle(activityStatusTone(item.tone)).bg, toneStyle(activityStatusTone(item.tone)).text)}><AppIcon className="ri-history-line text-xs"></AppIcon></span>
              <div className="min-w-0 flex-1"><p className="text-[12px] font-bold text-foreground-800">{item.event}</p><p className="truncate text-[12px] text-foreground-400">{item.detail || 'No details available.'}</p></div>
              <span className="text-[12px] text-foreground-300">{item.date}</span>
            </div>
          ))}</div>}
        </ReferencePanel>
      </div>
      <ReferencePanel title="Upcoming Sessions & Reviews" subtitle="Scheduled coaching sessions, reviews and key dates" icon="ri-calendar-event-line" tone="primary"
        actions={<button type="button" className={styles.solidButton} onClick={onSchedule}><AppIcon className="ri-calendar-event-line" />Schedule session</button>}>
        {upcomingSessions.length === 0 ? <ProfileEmpty text="No upcoming sessions scheduled. Schedule a coaching session or review to keep this learner on track." /> : (
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

function ReferenceProgressContent({ data, onViewEvidence }: { data: CoachLearnerCaseFileData; onViewEvidence: (evidence: EvidencePreviewTarget) => void }) {
  const [activeKsbCategory, setActiveKsbCategory] = useState('All');
  const [ksbSearch, setKsbSearch] = useState('');
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
      <ReferencePanel title="KSB Detailed Breakdown" subtitle="View your KSB progress by category and track evidence coverage." icon="ri-stack-line" tone="primary">
        {fallbackKsbsLoading && ksbs.length === 0 ? <div className="p-2"><RowsSkeleton rows={4} avatar={false} /></div> : ksbs.length === 0 ? <ProfileEmpty text="No learner KSB snapshot or programme KSB framework is available yet." /> : (
          <div className="space-y-5">
            <div className={styles.ksbSummary}>
              <KsbOverviewCard icon="ri-stack-line" label="Total KSBs" value={String(ksbs.length)} tone="primary" />
              <KsbOverviewCard icon="ri-links-line" label="Evidence linked" value={String(linkedCount)} tone="emerald" />
              <KsbOverviewCard icon="ri-focus-3-line" label="Not evidenced" value={String(unlinkedCount)} tone="muted" />
            </div>

            <div>
              <p className="text-[12px] font-bold text-foreground-900">Coverage by category</p>
              <p className="mt-1 text-[11px] text-foreground-500">Each section shows how many KSBs are linked to learner evidence.</p>
              <div className={styles.coverageGrid}>
                {categorySummary.map((group) => (
                  <div key={group.category} className={styles.coverageCard}>
                    <div className={styles.coverageHead}>
                      <span className="inline-flex items-center gap-2"><AppIcon className={ksbCategoryIcon(group.category)} />{group.category}</span>
                      <span>{group.linked} / {group.total}</span>
                    </div>
                    <ProfileProgress label="" value={group.total ? Math.round((group.linked / group.total) * 100) : 0} tone={group.category === 'Behaviours' ? 'amber' : 'primary'} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ReferencePanel>

      <ReferencePanel title="KSB Browser" subtitle="Search and filter KSBs to review details and evidence coverage." icon="ri-file-list-3-line" tone="primary">
        <div className={styles.browserToolbar}>
          <label className={styles.search}>
            <span className="sr-only">Search KSBs</span>
            <AppIcon className="ri-search-line" />
            <input value={ksbSearch} onChange={(event) => setKsbSearch(event.target.value)} placeholder="Search KSBs by code, title or description..." />
          </label>
          <div className={styles.filterPills}>
            {['All', ...categoryOptions].map((category) => (
              <button key={category} type="button" className={cn(styles.filterPill, activeKsbCategory === category && styles.filterPillActive)} onClick={() => setActiveKsbCategory(category)}>
                {category} ({category === 'All' ? ksbs.length : categorySummary.find((group) => group.category === category)?.total || 0})
              </button>
            ))}
          </div>
        </div>
        {filteredKsbs.length === 0 ? <ProfileEmpty text="No KSBs matched the current filter." /> : (
          <div className={styles.tableScroll}>
            <table className={styles.ksbTable}>
              <thead><tr><th>KSB Code</th><th>Title</th><th>Category</th><th>Status</th><th>Evidence</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredKsbs.map((item) => (
                  <tr key={item.code}>
                    <td><strong>{item.code}</strong></td>
                    <td>{item.description}</td>
                    <td><StatusBadge tone={ksbCategoryTone(item.category)} label={item.category} size="sm" dot={false} /></td>
                    <td><StatusBadge tone={item.linked ? 'positive' : 'neutral'} label={item.linked ? 'Evidence linked' : 'Not evidenced'} size="sm" /></td>
                    <td>{item.linked ? 1 : 0}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.tableButton}
                        onClick={() => onViewEvidence({ title: item.description, activities: ksbLearningActivities(data, item.code) })}
                      >
                        View
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
        className="w-full max-w-sm rounded-xl border border-foreground-200/60 bg-background-50 p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="evidence-preview-title" className="mt-1 break-words text-sm font-semibold leading-5 text-foreground-900">{evidence.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close evidence" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700">
            <AppIcon className="ri-close-line" />
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {evidence.activities.length ? evidence.activities.map((activity, index) => (
            <button
              key={`${activity.title}-${activity.type}-${index}`}
              type="button"
              onClick={() => activity.type === 'Assignment' && activity.componentId && onOpenAssignment(activity.componentId)}
              className={`w-full rounded-lg border border-background-200 bg-background-100/50 p-3 text-left ${activity.type === 'Assignment' && activity.componentId ? 'cursor-pointer hover:border-primary-300 hover:bg-primary-50/40' : 'cursor-default'}`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{activity.type}</p>
              <p className="mt-1 break-words text-[12px] text-foreground-900">{activity.title}</p>
            </button>
          )) : <p className="text-[12px] text-foreground-500">No linked learning activity type is available.</p>}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-primary-700">Close</button>
        </div>
      </section>
    </div>
  );
}

function ksbLearningActivities(data: CoachLearnerCaseFileData, code: string): EvidencePreviewTarget['activities'] {
  const detail = data.detail;
  if (!detail) return [];
  const normalizedCode = code.trim().toUpperCase();
  const activities: EvidencePreviewTarget['activities'] = [];
  const seen = new Set<string>();
  const add = (title: string | null | undefined, type: string | null | undefined, key: string, componentId?: string | null) => {
    if (!title || seen.has(key)) return;
    seen.add(key);
    const normalizedType = String(type || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
    activities.push({
      title,
      componentId: componentId || undefined,
      type: normalizedType === 'live session' ? 'Live session'
        : normalizedType ? normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)
          : 'Activity type unavailable',
    });
  };
  for (const component of detail.components) {
    if (!(component.ksbMappings || []).some((mapping) => mapping.code.trim().toUpperCase() === normalizedCode)) continue;
    add(component.component, component.isQuiz ? 'quiz' : component.type, component.componentId || `${component.module}:${component.week}:${component.component}`, component.componentId);
  }
  for (const attempt of detail.quizAttempts) {
    if (!(attempt.ksbs || []).some((ksb) => ksb.trim().toUpperCase() === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === attempt.componentId || item.quizMeta?.quizId === attempt.quizId);
    add(attempt.componentTitle || component?.component || `Quiz ${attempt.quizId}`, 'quiz', attempt.componentId || component?.componentId || `quiz:${attempt.quizId}`);
  }
  for (const progress of detail.videoProgress || []) {
    if (!(progress.ksbs || []).some((ksb) => ksb.trim().toUpperCase() === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === progress.componentId);
    add(component?.component || 'Video', 'video', progress.componentId);
  }
  for (const progress of detail.componentProgress || []) {
    if (!(progress.ksbs || []).some((ksb) => ksb.trim().toUpperCase() === normalizedCode)) continue;
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

function ReferenceReviewsContent({
  data,
  onOpen,
  onChanged,
  onOpenNotes,
  onOpenMonthlyLogs,
}: {
  data: CoachLearnerCaseFileData;
  onOpen: (item: CaseFileReviewMeeting) => void;
  onChanged: () => void;
  onOpenNotes: () => void;
  onOpenMonthlyLogs: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const reviewsLoading = data.reviewsLoading && data.reviewGroups.length === 0;
  const reviewItems = data.reviewGroups.flatMap(group => group.items);
  const timeline = [
    { label: 'Progress Review', description: 'Formal progress review against programme goals and targets.', icon: 'ri-clipboard-line', match: (item: CaseFileReviewMeeting) => item.source === 'progress-review' },
    { label: 'Monthly Coaching Meeting', description: 'Regular coaching meeting to discuss progress, support needs and next steps.', icon: 'ri-group-line', match: (item: CaseFileReviewMeeting) => item.source === 'mcr' },
    { label: 'Catch-up', description: 'Additional meeting to address specific topics or concerns.', icon: 'ri-file-list-3-line', match: (item: CaseFileReviewMeeting) => item.source === 'catch-up' },
  ].map(entry => ({ ...entry, item: reviewItems.find(entry.match) }));

  return (
    <div className={styles.stack}>
      <ReferencePanel title="Reviews & Meetings" subtitle="Manage learner-specific reviews and coaching meetings from this case file." icon="ri-group-line" tone="primary"
        actions={<button type="button" onClick={() => setAddOpen(true)} className={styles.solidButton}><AppIcon className="ri-add-line" />Add Review</button>}>
        <span className="sr-only">Review and meeting controls</span>
      </ReferencePanel>
      {data.reviewGenerationIssues.map(issue => (
        <div key={issue.code} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900" role="status">
          <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-[18px]"></AppIcon>
          <div>
            <p className="text-[13px] font-semibold">Review schedule unavailable</p>
            <p className="mt-1 text-[12px] leading-5">{reviewGenerationIssueMessage(issue.code)}</p>
          </div>
        </div>
      ))}
      <div className={styles.reviewsGrid}>
        <ReferencePanel title="Review Timeline" subtitle="Key reviews and meetings for this learner" icon="ri-calendar-line" tone="primary">
          {reviewsLoading ? <RowsSkeleton rows={3} avatar={false} /> : <div className={styles.timeline}>
            {timeline.map(entry => <div key={entry.label} className={styles.timelineItem}>
              <span className={styles.timelineIcon}><AppIcon className={entry.icon} /></span>
              <div><strong>{entry.label}</strong><p>{entry.description}</p></div>
              <button type="button" disabled={!entry.item} className={styles.timelineStatus} onClick={() => entry.item && onOpen(entry.item)}>
                {entry.item?.statusLabel || 'Not scheduled'}
              </button>
            </div>)}
          </div>}
        </ReferencePanel>
        <ReferencePanel title="Quick Actions" subtitle="Common tasks for reviews and meetings" icon="ri-flashlight-line" tone="primary">
          <div className={styles.quickActions}>
            <button type="button" className={styles.quickAction} onClick={() => setAddOpen(true)}><AppIcon className="ri-calendar-line" /><span><strong>Schedule Review</strong><span>Add a progress review for this learner</span></span><AppIcon className="ri-arrow-right-s-line" /></button>
            <button type="button" className={styles.quickAction} onClick={onOpenNotes}><AppIcon className="ri-file-list-3-line" /><span><strong>Add Meeting Note</strong><span>Record notes from a coaching meeting</span></span><AppIcon className="ri-arrow-right-s-line" /></button>
            <button type="button" className={styles.quickAction} onClick={onOpenMonthlyLogs}><AppIcon className="ri-file-text-line" /><span><strong>View Monthly Logs</strong><span>See all monthly coaching logs</span></span><AppIcon className="ri-arrow-right-s-line" /></button>
          </div>
        </ReferencePanel>
      </div>
      <ReferencePanel title="Session History" subtitle="All reviews and coaching meetings for this learner" icon="ri-file-list-3-line" tone="primary">
        {reviewsLoading ? <RowsSkeleton rows={3} avatar={false} /> : reviewItems.length
          ? <ReviewMeetingList items={reviewItems} itemLabel="review" onOpen={onOpen} />
          : <div className={styles.empty}><div><AppIcon className="ri-file-list-3-line text-lg" /><p className="mt-2">No review or coaching meeting records are available yet.</p><button type="button" className={cn(styles.solidButton, 'mt-3')} onClick={() => setAddOpen(true)}>Create first review</button></div></div>}
      </ReferencePanel>
      {addOpen ? (
        <AddLearnerReviewModal
          data={data}
          onClose={() => setAddOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
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

function formatSessionTime(start?: string | null, end?: string | null) {
  const startLabel = displayInline(start);
  const endLabel = displayInline(end);
  return endLabel === '--' ? startLabel : `${startLabel} - ${endLabel}`;
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

function initialsFromName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
