import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { cn } from '@/lib/cn';
import { EMPTY_VALUE } from '@/lib/format';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageTabs, PageTabsBar, type PageTabItem } from '@/components/ui/PageTabs';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pagination } from '@/components/ui/Pagination';
import { RowAction } from '@/components/ui/ActionRow';
import { LearnerIdentity } from '../shared/LearnerIdentity';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/marking-queue';

type QueueFilter = 'all' | 'pending' | 'overdue' | 'accepted' | 'referred';
type ReviewDecision = 'accepted' | 'referred';

interface MarkingSubmission {
  id: string;
  learnerKind: string;
  learnerId: string;
  learner: string;
  initials: string;
  programme: string;
  activityType: string;
  activityId: string;
  activityTitle: string;
  module: string;
  week: string;
  plannedOtjh: string;
  status: 'pending' | 'accepted' | 'referred' | string;
  learningReflection: string;
  ksbCodes: string[];
  ksbExplanations: Record<string, string>;
  confidenceBefore: Record<string, number>;
  confidenceAfter: Record<string, number>;
  applicationType: string;
  applicationText: string;
  evidenceFiles: string[];
  evidenceConsentConfirmed: boolean;
  selectedBenefits: string[];
  benefitExplanation: string;
  actualTimeHours: string;
  completedDuringPaidHours: string;
  dateCompleted: string | null;
  otjhConfirmed: boolean;
  signedDeclaration: boolean;
  qualityScore: number;
  coachFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  submittedDisplay: string;
  elapsedDays: number;
  isOverdue: boolean;
}

interface QueueSummary {
  totalItems: number;
  activeLearners: number;
  pendingItems: number;
  acceptedItems: number;
  referredItems: number;
  overdueItems: number;
  oldestSubmission: string;
  overdueThresholdDays: number;
}

interface QueuePagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

const EMPTY_SUMMARY: QueueSummary = {
  totalItems: 0,
  activeLearners: 0,
  pendingItems: 0,
  acceptedItems: 0,
  referredItems: 0,
  overdueItems: 0,
  oldestSubmission: '--',
  overdueThresholdDays: 7,
};

const EMPTY_PAGINATION: QueuePagination = {
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * Human labels for the statuses this queue and the review page can save.
 * `statusTone` already carries the colour (accepted → positive, partial /
 * referred → caution, escalated / rejected → critical); this only supplies
 * the words, which the shared tone table intentionally does not.
 */
function statusLabel(status: string): string {
  if (status === 'accepted') return 'Accepted';
  if (status === 'partial') return 'Partial award';
  if (status === 'referred') return 'Referred back';
  if (status === 'escalated') return 'Escalated';
  if (status === 'rejected') return 'Rejected';
  return 'Pending review';
}

const FILTER_TABS: PageTabItem[] = [
  { value: 'pending', label: 'Pending', tone: 'caution' },
  { value: 'overdue', label: 'Overdue', tone: 'critical' },
  { value: 'accepted', label: 'Accepted', tone: 'positive' },
  { value: 'referred', label: 'Referred', tone: 'caution' },
  { value: 'all', label: 'All' },
];

/** The bordered section inside the review drawer — built from the shared
 * Panel + SectionHeader rather than a one-off wrapper. */
function DetailPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <Panel>
      <SectionHeader title={title} icon={icon} />
      <div className="mt-3">{children}</div>
    </Panel>
  );
}

export default function CoachMarkingQueue() {
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [items, setItems] = useState<MarkingSubmission[]>([]);
  const [summary, setSummary] = useState<QueueSummary>(EMPTY_SUMMARY);
  const [pagination, setPagination] = useState<QueuePagination>(EMPTY_PAGINATION);
  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MarkingSubmission | null>(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');

  const loadQueue = useCallback(async () => {
    if (!coach.isInitialized) return;
    setLoading(true);
    setError('');
    if (!coach.email) {
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setError('Coach access is required to load the marking queue.');
      setLoading(false);
      return;
    }
    try {
      const query = new URLSearchParams({ status: filter, page: String(page), page_size: '25' });
      const response = await coachFetch(`${API_ENDPOINT}?${query}`);
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.detail || 'Unable to load the marking queue.');
      setItems(data.items || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setPagination(data.pagination || EMPTY_PAGINATION);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the marking queue.');
    } finally {
      setLoading(false);
    }
  }, [coach.email, coach.isInitialized, filter, page]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const filtered = useMemo(() => items, [items]);

  const openReview = (item: MarkingSubmission) => {
    setSelected(item);
    setFeedback(item.coachFeedback || '');
    setError('');
  };

  const submitDecision = async (decision: ReviewDecision) => {
    if (!selected || reviewing) return;
    if (decision === 'referred' && !feedback.trim()) {
      setError('Add feedback explaining what the learner needs to improve.');
      return;
    }
    setReviewing(true);
    setError('');
    try {
      const response = await coachFetch(`${API_ENDPOINT}/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          feedback: feedback.trim(),
          reviewedBy: coach.name,
        }),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.detail || 'The review could not be saved.');
      setSelected(null);
      await loadQueue();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The review could not be saved.');
    } finally {
      setReviewing(false);
    }
  };

  const filterCounts: Record<QueueFilter, number> = {
    all: summary.totalItems,
    pending: summary.pendingItems,
    overdue: summary.overdueItems,
    accepted: summary.acceptedItems,
    referred: summary.referredItems,
  };

  const columns: DataColumn<MarkingSubmission>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'min-w-[200px]',
      render: (row) => (
        <LearnerIdentity name={row.learner} programme={row.programme} tone={row.isOverdue ? 'critical' : 'neutral'} />
      ),
    },
    {
      key: 'activity',
      label: 'Activity',
      widthClass: 'min-w-[220px]',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground-800">{row.activityTitle || row.activityId}</p>
          <p className="truncate text-[12px] capitalize text-foreground-400">
            {row.activityType} &middot; Quality {row.qualityScore}/100
          </p>
        </div>
      ),
    },
    {
      key: 'module',
      label: 'Module / Week',
      render: (row) => (
        <span className="text-[13px] text-foreground-600">
          {[row.module, row.week].filter(Boolean).join(' · ') || EMPTY_VALUE}
        </span>
      ),
    },
    {
      key: 'submitted',
      label: 'Submitted',
      render: (row) => (
        <div>
          <p className="text-[13px] text-foreground-700">{row.submittedDisplay}</p>
          <p className={cn('text-[12px]', row.isOverdue ? 'font-semibold text-red-700' : 'text-foreground-400')}>
            {row.elapsedDays} day(s)
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        row.isOverdue
          ? <StatusBadge tone="critical" label="Overdue" size="sm" />
          : <StatusBadge status={row.status} label={statusLabel(row.status)} size="sm" />
      ),
    },
    {
      key: 'action',
      label: '',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={() => navigate(`/coach/marking-queue/${row.id}`)}
          className="rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-primary-700"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Marking Queue"
      pageSubtitle="Review learner reflections, evidence and OTJH"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <PageContainer>
        <PageHeader
          icon="ri-file-list-3-line"
          title="Marking Queue"
          description="Review complete learning submissions, validate KSB development and confirm OTJH."
        />

        <PageTabsBar actions={<RowAction label="Refresh" icon="ri-refresh-line" onClick={() => void loadQueue()} />}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to="/coach/caseload"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-foreground-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-600 transition hover:border-foreground-300 hover:text-foreground-900"
            >
              Active learners
              <span className="inline-flex min-w-[20px] justify-center rounded bg-background-100 px-1 py-0.5 text-[12px] font-bold tabular-nums text-foreground-500">
                {summary.activeLearners}
              </span>
            </Link>
            <PageTabs
              label="Filter submissions by status"
              value={filter}
              onChange={(next) => { setFilter(next as QueueFilter); setPage(1); }}
              items={FILTER_TABS.map((tab) => ({ ...tab, count: filterCounts[tab.value as QueueFilter] }))}
            />
          </div>
        </PageTabsBar>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          stickyFirstColumn
          minWidthClass="min-w-[900px]"
          caption="Submissions awaiting or already marked in the coach's queue"
          loading={loading ? <RowsSkeleton rows={6} className="p-4" /> : undefined}
          empty={
            error && !selected ? (
              <EmptyState
                variant="error"
                title="Unable to load the marking queue"
                description={error}
                action={<EmptyStateAction label="Retry" icon="ri-refresh-line" onClick={() => void loadQueue()} />}
              />
            ) : (
              <EmptyState
                variant="empty"
                icon="ri-checkbox-circle-line"
                title="No submissions in this view"
                description="Nothing is waiting in this filter right now."
              />
            )
          }
        />

        {pagination.totalPages > 1 && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={setPage}
            noun="submission(s)"
          />
        )}
      </PageContainer>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Close review" className="absolute inset-0 bg-foreground-950/45" onClick={() => setSelected(null)} />
          <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-foreground-200 bg-background-50 shadow-sm">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-foreground-200 bg-background-50/95 px-6 py-5 backdrop-blur">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-widest text-primary-700">{selected.activityType} submission</p>
                <h2 className="mt-1 text-xl font-bold text-foreground-950">{selected.learner}</h2>
                <p className="mt-1 text-[12px] text-foreground-500">{selected.activityTitle} &middot; {selected.submittedDisplay}</p>
              </div>
              <button onClick={() => setSelected(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-background-100 text-foreground-600"><AppIcon className="ri-close-line text-xl" /></button>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Quality', `${selected.qualityScore}/100`],
                  ['KSBs', selected.ksbCodes.length],
                  ['Actual OTJH', `${selected.actualTimeHours || '--'}h`],
                  ['Status', statusLabel(selected.status)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-foreground-200 bg-background-50 p-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground-900">{value}</p>
                  </div>
                ))}
              </div>

              <DetailPanel title="Learning reflection" icon="ri-book-open-line">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.learningReflection}</p>
              </DetailPanel>

              <DetailPanel title="KSB development" icon="ri-links-line">
                <div className="space-y-3">
                  {selected.ksbCodes.map(code => (
                    <div key={code} className="rounded-lg bg-background-100 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="text-sm text-primary-700">{code}</strong>
                        <span className="text-[12px] text-foreground-500">
                          Confidence {selected.confidenceBefore[code] || 1}/5 &rarr; {selected.confidenceAfter[code] || 1}/5
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-foreground-600">{selected.ksbExplanations[code] || 'No explanation provided.'}</p>
                    </div>
                  ))}
                </div>
              </DetailPanel>

              <DetailPanel title="Workplace application" icon="ri-briefcase-line">
                <p className="text-xs font-semibold capitalize text-primary-700">{(selected.applicationType || '').replaceAll('-', ' ')}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.applicationText}</p>
              </DetailPanel>

              <DetailPanel title="Evidence" icon="ri-attachment-2">
                {selected.evidenceFiles.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.evidenceFiles.map(file => <span key={file} className="rounded-lg bg-background-100 px-3 py-2 text-xs text-foreground-700"><AppIcon className="ri-file-line mr-1" />{file}</span>)}
                  </div>
                ) : <p className="text-sm text-foreground-400">No evidence file was attached.</p>}
                <p className={`mt-3 text-xs ${selected.evidenceConsentConfirmed ? 'text-emerald-700' : 'text-foreground-400'}`}>
                  <AppIcon className={selected.evidenceConsentConfirmed ? 'ri-checkbox-circle-line' : 'ri-information-line'} /> Evidence consent {selected.evidenceConsentConfirmed ? 'confirmed' : 'not required'}
                </p>
              </DetailPanel>

              <DetailPanel title="Employer benefit" icon="ri-building-line">
                <div className="flex flex-wrap gap-2">
                  {selected.selectedBenefits.map(benefit => <span key={benefit} className="rounded-full bg-primary-50 px-3 py-1 text-xs text-primary-700">{benefit}</span>)}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.benefitExplanation}</p>
              </DetailPanel>

              <DetailPanel title="OTJH declaration" icon="ri-time-line">
                <div className="grid grid-cols-2 gap-3 text-xs text-foreground-600 sm:grid-cols-3">
                  <p><span className="block text-foreground-400">Planned</span>{selected.plannedOtjh || '--'}</p>
                  <p><span className="block text-foreground-400">Actual</span>{selected.actualTimeHours || '--'} hours</p>
                  <p><span className="block text-foreground-400">Date completed</span>{selected.dateCompleted || '--'}</p>
                  <p><span className="block text-foreground-400">Paid hours</span><span className="capitalize">{selected.completedDuringPaidHours || '--'}</span></p>
                  <p><span className="block text-foreground-400">OTJH confirmed</span>{selected.otjhConfirmed ? 'Yes' : 'No'}</p>
                  <p><span className="block text-foreground-400">Signed</span>{selected.signedDeclaration ? 'Yes' : 'No'}</p>
                </div>
              </DetailPanel>

              <Panel className="border-primary-200 bg-primary-50/40">
                <h4 className="text-sm font-semibold text-foreground-900">Coach feedback</h4>
                <textarea
                  value={feedback}
                  onChange={event => setFeedback(event.target.value)}
                  rows={4}
                  placeholder="Add feedback for the learner. Feedback is required when referring work back."
                  className="mt-3 w-full resize-none rounded-lg border border-foreground-200 bg-background-50 p-3 text-sm focus:border-primary-400 focus:outline-none"
                />
                {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button disabled={reviewing} onClick={() => void submitDecision('referred')} className="rounded-lg border border-amber-300 bg-background-50 px-4 py-2.5 text-sm font-semibold text-amber-700 disabled:opacity-50">
                    <AppIcon className="ri-arrow-go-back-line mr-1" /> Refer back
                  </button>
                  <button disabled={reviewing} onClick={() => void submitDecision('accepted')} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    <AppIcon className={reviewing ? 'ri-loader-4-line mr-1 animate-spin' : 'ri-checkbox-circle-line mr-1'} /> Accept submission
                  </button>
                </div>
              </Panel>
            </div>
          </aside>
        </div>
      )}
    </WorkspaceShell>
  );
}
