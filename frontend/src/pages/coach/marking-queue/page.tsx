<<<<<<< HEAD
import { useState } from 'react';
=======
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;
<<<<<<< HEAD

const MARKING_QUEUE = [
  { id: 'mk-1', learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', module: 'Marketing Planning', title: 'Workplace Reflection — Segmentation', type: 'Reflection', submitted: '8 Jun 2026', due: '15 Jun 2026', wordCount: 1250, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-2', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', module: 'Data Analysis', title: 'Data Cleaning Report', type: 'Report', submitted: '7 Jun 2026', due: '14 Jun 2026', wordCount: 2800, status: 'pending' as const, priority: 'high' as const },
  { id: 'mk-3', learner: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', module: 'Financial Accounting', title: 'Month-end Reconciliation', type: 'Workplace Evidence', submitted: '6 Jun 2026', due: '13 Jun 2026', wordCount: 800, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-4', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', module: 'Digital Channels', title: 'Social Media Campaign Results', type: 'Campaign Evidence', submitted: '5 Jun 2026', due: '12 Jun 2026', wordCount: 1500, status: 'in-progress' as const, priority: 'normal' as const },
  { id: 'mk-5', learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', module: 'Risk Management', title: 'Project Risk Register', type: 'Project Evidence', submitted: '4 Jun 2026', due: '11 Jun 2026', wordCount: 2200, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-6', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', module: 'Business Admin', title: 'Meeting Minutes — Board Prep', type: 'Workplace Evidence', submitted: '3 Jun 2026', due: '10 Jun 2026', wordCount: 600, status: 'pending' as const, priority: 'low' as const },
  { id: 'mk-7', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', module: 'Software Development', title: 'Code Review Documentation', type: 'Documentation', submitted: '2 Jun 2026', due: '9 Jun 2026', wordCount: 1800, status: 'pending' as const, priority: 'normal' as const },
  { id: 'mk-8', learner: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', module: 'HR Induction', title: 'Initial Assessment Reflection', type: 'Reflection', submitted: '1 Jun 2026', due: '8 Jun 2026', wordCount: 1000, status: 'pending' as const, priority: 'low' as const },
  { id: 'mk-9', learner: 'Oliver Thompson', initials: 'OT', programme: 'Business Admin L3', module: 'Business Communication', title: 'Email Portfolio', type: 'Portfolio', submitted: '31 May 2026', due: '7 Jun 2026', wordCount: 900, status: 'overdue' as const, priority: 'high' as const },
  { id: 'mk-10', learner: 'Grace Liu', initials: 'GL', programme: 'Data Analyst L4', module: 'Data Analysis', title: 'SQL Query Report', type: 'Report', submitted: '30 May 2026', due: '6 Jun 2026', wordCount: 1600, status: 'overdue' as const, priority: 'high' as const },
  { id: 'mk-11', learner: 'Isla Morgan', initials: 'IM', programme: 'Business Admin L3', module: 'Business Admin', title: 'Project Plan Document', type: 'Documentation', submitted: '29 May 2026', due: '5 Jun 2026', wordCount: 2000, status: 'overdue' as const, priority: 'normal' as const },
  { id: 'mk-12', learner: 'Harper Singh', initials: 'HS', programme: 'Accountancy L3', module: 'Financial Accounting', title: 'Budget Variance Analysis', type: 'Report', submitted: '28 May 2026', due: '4 Jun 2026', wordCount: 2400, status: 'overdue' as const, priority: 'high' as const },
];

export default function CoachMarkingQueue() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'in-progress'>('all');

  const filtered = MARKING_QUEUE.filter(m => filter === 'all' || m.status === filter);
  const pending = MARKING_QUEUE.filter(m => m.status === 'pending').length;
  const overdue = MARKING_QUEUE.filter(m => m.status === 'overdue').length;
  const inProgress = MARKING_QUEUE.filter(m => m.status === 'in-progress').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Marking Queue" pageSubtitle="Review and mark learner assignments and evidence" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
=======
const API_ENDPOINT = '/api/coach/marking-queue';
const MISSING_VALUE = '--';

type FilterKey = 'all' | 'pending' | 'overdue' | 'accepted' | 'referred';

interface MarkingQueueItem {
  id: string;
  learnerId: string;
  learner: string;
  initials: string;
  email?: string | null;
  programme?: string | null;
  group?: string | null;
  status?: string | null;
  enrollmentStatus?: string;
  isOnBreak?: boolean;
  pendingEvidence: number;
  acceptedEvidence: number;
  referredEvidence: number;
  totalEvidence: number;
  elapsedDays: number;
  isOverdue: boolean;
  lastSubmission?: string | null;
  lastSubmissionIso?: string | null;
  startDate?: string | null;
  module?: string | null;
  title?: string | null;
  type?: string | null;
  due?: string | null;
  words?: number | null;
}

interface MarkingQueueSummary {
  caseloadLearners: number;
  queueLearners: number;
  activeLearners: number;
  queueActiveLearners: number;
  onBreakLearners: number;
  queueOnBreakLearners: number;
  pendingItems: number;
  overdueLearners: number;
  overdueItems: number;
  inProgressItems: number | null;
  acceptedEvidence: number;
  referredEvidence: number;
  totalEvidence: number;
  oldestSubmission: string;
  overdueThresholdDays: number;
  unavailableFields?: string[];
}

interface MarkingQueueResponse {
  summary?: MarkingQueueSummary;
  items?: MarkingQueueItem[];
}

const EMPTY_SUMMARY: MarkingQueueSummary = {
  caseloadLearners: 0,
  queueLearners: 0,
  activeLearners: 0,
  queueActiveLearners: 0,
  onBreakLearners: 0,
  queueOnBreakLearners: 0,
  pendingItems: 0,
  overdueLearners: 0,
  overdueItems: 0,
  inProgressItems: null,
  acceptedEvidence: 0,
  referredEvidence: 0,
  totalEvidence: 0,
  oldestSubmission: MISSING_VALUE,
  overdueThresholdDays: 7,
  unavailableFields: [],
};

function displayValue(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return MISSING_VALUE;
  return String(value);
}

function StatusPill({ item }: { item: MarkingQueueItem }) {
  if (item.isOnBreak) {
    return (
      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/70">
        On Break
      </span>
    );
  }

  return (
    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
      {displayValue(item.status)}
    </span>
  );
}

function StatBox({ label, value, tone = 'white' }: { label: string; value: string; tone?: 'white' | 'amber' | 'red' }) {
  const valueClass = tone === 'amber' ? 'text-amber-300' : tone === 'red' ? 'text-red-300' : 'text-white';

  return (
    <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center min-w-[78px]">
      <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
      <p className="text-[10px] text-white/70 uppercase tracking-wide">{label}</p>
    </div>
  );
}

export default function CoachMarkingQueue() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [items, setItems] = useState<MarkingQueueItem[]>([]);
  const [summary, setSummary] = useState<MarkingQueueSummary>(EMPTY_SUMMARY);
  const [selectedItem, setSelectedItem] = useState<MarkingQueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadQueue() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(API_ENDPOINT);
        if (!response.ok) throw new Error(`Request failed with ${response.status}`);
        const data: MarkingQueueResponse = await response.json();
        if (cancelled) return;
        setItems(data.items || []);
        setSummary(data.summary || EMPTY_SUMMARY);
      } catch (err) {
        if (!cancelled) {
          setItems([]);
          setSummary(EMPTY_SUMMARY);
          setError(err instanceof Error ? err.message : 'Unable to load marking queue data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadQueue();
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingLearners = useMemo(() => items.filter(item => item.pendingEvidence > 0), [items]);
  const overdueLearners = useMemo(() => items.filter(item => item.isOverdue), [items]);
  const acceptedLearners = useMemo(() => items.filter(item => item.acceptedEvidence > 0), [items]);
  const referredLearners = useMemo(() => items.filter(item => item.referredEvidence > 0), [items]);

  const filtered = useMemo(() => {
    if (filter === 'pending') return pendingLearners;
    if (filter === 'overdue') return overdueLearners;
    if (filter === 'accepted') return acceptedLearners;
    if (filter === 'referred') return referredLearners;
    return items;
  }, [acceptedLearners, filter, items, overdueLearners, pendingLearners, referredLearners]);

  const handleReview = (item: MarkingQueueItem) => {
    setSelectedItem(item);
  };

  const openLearnerEvidence = (item: MarkingQueueItem) => {
    navigate(`/coach/learner-case-file?id=${encodeURIComponent(item.learnerId)}&tab=evidence`, {
      state: { learnerId: item.learnerId, learnerName: item.learner, tab: 'evidence' },
    });
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Marking Queue" pageSubtitle="Review learner evidence pending marking" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-edit-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Marking Queue</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
<<<<<<< HEAD
                <strong>{pending} pending</strong> items, {overdue} overdue, {inProgress} in progress. Oldest submission: 28 May 2026.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{MARKING_QUEUE.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{pending}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{overdue}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Overdue</p>
              </div>
=======
                <strong>{summary.pendingItems} pending evidence</strong> across {summary.queueLearners} queue learners from {summary.activeLearners} active learners.
                {' '}{summary.overdueItems} overdue evidence across {summary.overdueLearners} learners by {summary.overdueThresholdDays}+ days.
                {' '}Oldest submission: {displayValue(summary.oldestSubmission)}.
                {(summary.queueOnBreakLearners || 0) > 0 ? ` ${summary.queueOnBreakLearners} queue learner(s) on break are shown but flagged.` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <StatBox label="Active Learners" value={displayValue(summary.activeLearners)} />
              <StatBox label="Pending" value={displayValue(summary.pendingItems)} tone="amber" />
              <StatBox label="Overdue Evidence" value={displayValue(summary.overdueItems)} tone="red" />
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            </div>
          </div>
        </div>

<<<<<<< HEAD
        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>All <span className="text-[10px] opacity-60">({MARKING_QUEUE.length})</span></button>
          <button onClick={() => setFilter('pending')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'pending' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Pending <span className="text-[10px] opacity-60">({pending})</span></button>
          <button onClick={() => setFilter('overdue')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'overdue' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Overdue <span className="text-[10px] opacity-60">({overdue})</span></button>
          <button onClick={() => setFilter('in-progress')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'in-progress' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>In Progress <span className="text-[10px] opacity-60">({inProgress})</span></button>
        </div>

        {/* Marking Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span>Module</span>
            <span>Title</span>
            <span>Type</span>
            <span className="text-center">Submitted</span>
            <span className="text-center">Due</span>
            <span className="text-center">Words</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(item => (
              <div key={item.id} className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${item.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'}`}>{item.initials}</div>
                  <div>
                    <p className="text-[12px] font-medium text-foreground-900">{item.learner}</p>
                    <p className="text-[10px] text-foreground-400">{item.programme}</p>
                  </div>
                </div>
                <span className="text-[11px] text-foreground-500">{item.module}</span>
                <span className="text-[11px] font-medium text-foreground-700 truncate">{item.title}</span>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500 w-fit">{item.type}</span>
                <span className={`text-[11px] text-center ${item.status === 'overdue' ? 'text-red-600 font-medium' : 'text-foreground-500'}`}>{item.submitted}</span>
                <span className="text-[11px] text-foreground-500 text-center">{item.due}</span>
                <span className="text-[11px] text-foreground-500 text-center">{item.wordCount}</span>
                <div className="text-center">
                  <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Mark</button>
=======
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Queue <span className="text-[10px] opacity-60">({summary.queueLearners})</span></button>
          <button onClick={() => setFilter('pending')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'pending' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Pending <span className="text-[10px] opacity-60">({pendingLearners.length})</span></button>
          <button onClick={() => setFilter('overdue')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'overdue' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Overdue <span className="text-[10px] opacity-60">({summary.overdueLearners})</span></button>
          <button onClick={() => setFilter('accepted')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'accepted' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Accepted <span className="text-[10px] opacity-60">({acceptedLearners.length})</span></button>
          <button onClick={() => setFilter('referred')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'referred' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Referred <span className="text-[10px] opacity-60">({referredLearners.length})</span></button>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1.5fr_0.7fr_0.7fr_0.7fr_0.9fr_0.7fr_0.7fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span>Group</span>
            <span className="text-center">Pending</span>
            <span className="text-center">Accepted</span>
            <span className="text-center">Referred</span>
            <span className="text-center">Last Submitted</span>
            <span className="text-center">Elapsed</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {loading && (
              <div className="px-4 py-14 text-center text-sm text-foreground-400">Loading live marking queue...</div>
            )}
            {!loading && error && (
              <div className="px-4 py-14 text-center">
                <div className="inline-flex flex-col items-center gap-2 text-red-600">
                  <i className="ri-error-warning-line text-2xl"></i>
                  <span className="text-sm font-semibold">Unable to load live marking queue.</span>
                  <span className="text-xs text-foreground-400">{error}</span>
                </div>
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-4 py-14 text-center text-sm text-foreground-400">
                No learners match this filter.
              </div>
            )}
            {!loading && !error && filtered.map(item => (
              <div key={`${item.id}-${item.email}`} className="grid grid-cols-[1.5fr_1.5fr_0.7fr_0.7fr_0.7fr_0.9fr_0.7fr_0.7fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${item.isOverdue ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'}`}>{item.initials}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-[12px] font-medium text-foreground-900 truncate">{item.learner}</p>
                      {item.isOnBreak && <StatusPill item={item} />}
                    </div>
                    <p className="text-[10px] text-foreground-400 truncate">{displayValue(item.programme)}</p>
                  </div>
                </div>
                <span className="text-[11px] text-foreground-500 truncate">{displayValue(item.group)}</span>
                <span className={`text-[11px] text-center font-semibold ${item.pendingEvidence > 0 ? 'text-amber-600' : 'text-foreground-400'}`}>{item.pendingEvidence}</span>
                <span className="text-[11px] text-foreground-500 text-center">{item.acceptedEvidence}</span>
                <span className={`text-[11px] text-center ${item.referredEvidence > 0 ? 'text-red-600 font-semibold' : 'text-foreground-500'}`}>{item.referredEvidence}</span>
                <span className="text-[11px] text-foreground-500 text-center">{displayValue(item.lastSubmission)}</span>
                <span className={`text-[11px] text-center font-semibold ${item.isOverdue ? 'text-red-600' : 'text-foreground-500'}`}>{item.elapsedDays}d</span>
                <div className="text-center">
                  <button onClick={() => handleReview(item)} className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Review</button>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                </div>
              </div>
            ))}
          </div>
        </div>
<<<<<<< HEAD
      </div>
    </WorkspaceShell>
  );
}
=======

        <div className="rounded-xl border border-foreground-200/60 bg-background-50 px-4 py-3 text-[11px] text-foreground-400">
          Fields not available in the current source table are treated as {MISSING_VALUE}: module, title, type, due date, and word count.
        </div>
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close review panel"
            className="absolute inset-0 bg-foreground-950/35 backdrop-blur-[1px] cursor-default"
            onClick={() => setSelectedItem(null)}
          />
          <aside className="relative h-full w-full max-w-[520px] bg-background-50 shadow-2xl border-l border-foreground-200 overflow-y-auto">
            <div className="sticky top-0 z-10 bg-background-50/95 backdrop-blur-sm border-b border-foreground-200 px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Evidence Review</p>
                <h3 className="text-lg font-heading font-bold text-foreground-900">{selectedItem.learner}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="w-9 h-9 rounded-full bg-background-100 text-foreground-500 hover:bg-background-200 hover:text-foreground-800 transition-smooth cursor-pointer"
                aria-label="Close"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-5 flex items-start gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0 ${selectedItem.isOverdue ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'}`}>
                  {selectedItem.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-heading font-bold text-foreground-900">{selectedItem.learner}</h4>
                    <StatusPill item={selectedItem} />
                    {selectedItem.isOverdue && (
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200/70">
                        Overdue
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-foreground-500 truncate">{displayValue(selectedItem.email)}</p>
                  <p className="mt-1 text-[12px] text-foreground-500">{displayValue(selectedItem.programme)}</p>
                  <p className="mt-1 text-[12px] text-foreground-400">{displayValue(selectedItem.group)}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Pending</p>
                  <p className="mt-2 text-2xl font-bold text-amber-700">{selectedItem.pendingEvidence}</p>
                </div>
                <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-4">
                  <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Accepted</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-700">{selectedItem.acceptedEvidence}</p>
                </div>
                <div className="rounded-xl border border-red-200/70 bg-red-50/60 p-4">
                  <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wider">Referred</p>
                  <p className="mt-2 text-2xl font-bold text-red-700">{selectedItem.referredEvidence}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-5 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-foreground-500">Last submitted</span>
                  <span className="text-[13px] font-semibold text-foreground-900">{displayValue(selectedItem.lastSubmission)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-foreground-500">Elapsed</span>
                  <span className={`text-[13px] font-semibold ${selectedItem.isOverdue ? 'text-red-600' : 'text-foreground-900'}`}>
                    {selectedItem.elapsedDays}d
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => openLearnerEvidence(selectedItem)}
                  className="flex-1 px-4 py-3 rounded-xl bg-primary-500 text-white text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer"
                >
                  <i className="ri-folder-upload-line mr-1.5"></i>
                  Open Evidence Tab
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="px-4 py-3 rounded-xl border border-foreground-200 text-foreground-700 text-[13px] font-semibold hover:bg-background-100 transition-smooth cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </WorkspaceShell>
  );
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
