import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

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

function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) {
    return <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700">Overdue</span>;
  }
  const style = status === 'accepted'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'partial'
      ? 'bg-blue-50 text-blue-700'
      : status === 'referred'
      ? 'bg-amber-50 text-amber-700'
      : status === 'escalated'
        ? 'bg-purple-50 text-purple-700'
        : status === 'rejected'
          ? 'bg-red-50 text-red-700'
      : 'bg-primary-50 text-primary-700';
  const label = status === 'accepted'
    ? 'Accepted'
    : status === 'partial'
      ? 'Partial award'
      : status === 'referred'
        ? 'Referred back'
        : status === 'escalated'
          ? 'Escalated'
          : status === 'rejected'
            ? 'Rejected'
            : 'Pending review';
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${style}`}>{label}</span>;
}

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-foreground-200 bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground-900">
        <AppIcon className={`${icon} text-primary-600`} /> {title}
      </h4>
      {children}
    </section>
  );
}

export default function CoachMarkingQueue() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MarkingSubmission[]>([]);
  const [summary, setSummary] = useState<QueueSummary>(EMPTY_SUMMARY);
  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [selected, setSelected] = useState<MarkingSubmission | null>(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(API_ENDPOINT);
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.detail || 'Unable to load the marking queue.');
      setItems(data.items || []);
      setSummary(data.summary || EMPTY_SUMMARY);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the marking queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const filtered = useMemo(() => items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'overdue') return item.isOverdue;
    if (filter === 'pending') return item.status === 'pending' || item.status === 'escalated';
    if (filter === 'accepted') return item.status === 'accepted' || item.status === 'partial';
    if (filter === 'referred') return item.status === 'referred' || item.status === 'rejected';
    return item.status === filter;
  }), [filter, items]);

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
      const response = await fetch(`${API_ENDPOINT}/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          feedback: feedback.trim(),
          reviewedBy: 'Med Maher',
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

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Marking Queue"
      pageSubtitle="Review learner reflections, evidence and OTJH"
      userName="Med Maher"
      userRole="Progress Coach"
    >
      <div className="space-y-5 p-4 md:p-6">
        <header className="overflow-hidden rounded-2xl bg-gradient-to-r from-[#120025] via-[#24004d] to-[#39106d] p-6 text-white shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="flex flex-1 items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                <AppIcon className="ri-file-list-3-line text-2xl" />
              </span>
              <div>
                <h1 className="text-xl font-bold">Learner Reflection Reviews</h1>
                <p className="mt-1 text-sm text-white/75">
                  Review complete learning submissions, validate KSB development and confirm OTJH.
                </p>
                <p className="mt-2 text-xs text-white/55">
                  Oldest pending submission: {summary.oldestSubmission}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Learners', summary.activeLearners, 'text-white'],
                ['Pending', summary.pendingItems, 'text-amber-300'],
                ['Overdue', summary.overdueItems, 'text-red-300'],
              ].map(([label, value, colour]) => (
                <div key={String(label)} className="min-w-24 rounded-xl bg-white/10 px-4 py-3 text-center">
                  <p className={`text-2xl font-bold ${colour}`}>{value}</p>
                  <p className="text-[9px] font-medium uppercase tracking-wider text-white/60">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl bg-background-100 p-1">
            {(['pending', 'overdue', 'accepted', 'referred', 'all'] as QueueFilter[]).map(key => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold capitalize transition-colors ${
                  filter === key ? 'bg-white text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'
                }`}
              >
                {key} <span className="ml-1 opacity-60">({filterCounts[key]})</span>
              </button>
            ))}
          </div>
          <button onClick={() => void loadQueue()} className="inline-flex items-center gap-2 rounded-xl border border-foreground-200 bg-white px-4 py-2 text-xs font-semibold text-foreground-700">
            <AppIcon className="ri-refresh-line" /> Refresh
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-foreground-200 bg-white">
          <div className="hidden grid-cols-[1.3fr_1.5fr_1.2fr_0.8fr_0.7fr_0.6fr] gap-4 border-b border-foreground-200 bg-background-100/60 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-400 md:grid">
            <span>Learner</span><span>Activity</span><span>Module / Week</span>
            <span>Submitted</span><span>Status</span><span className="text-right">Action</span>
          </div>
          {loading ? (
            <div className="p-16 text-center text-sm text-foreground-400"><AppIcon className="ri-loader-4-line mr-2 animate-spin" />Loading submissions...</div>
          ) : error && !selected ? (
            <div className="p-16 text-center text-sm text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <AppIcon className="ri-checkbox-circle-line text-3xl text-emerald-500" />
              <p className="mt-2 text-sm font-semibold text-foreground-700">No submissions in this view</p>
            </div>
          ) : (
            <div className="divide-y divide-foreground-100">
              {filtered.map(item => (
                <div key={item.id} className="grid gap-3 px-5 py-4 transition-colors hover:bg-background-100/40 md:grid-cols-[1.3fr_1.5fr_1.2fr_0.8fr_0.7fr_0.6fr] md:items-center md:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">{item.initials}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground-900">{item.learner}</p>
                      <p className="truncate text-[11px] text-foreground-400">{item.programme || '--'}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground-800">{item.activityTitle || item.activityId}</p>
                    <p className="text-[11px] capitalize text-foreground-400">{item.activityType} · Quality {item.qualityScore}/100</p>
                  </div>
                  <p className="truncate text-xs text-foreground-500">{[item.module, item.week].filter(Boolean).join(' · ') || '--'}</p>
                  <div>
                    <p className="text-xs text-foreground-600">{item.submittedDisplay}</p>
                    <p className={`text-[10px] ${item.isOverdue ? 'font-semibold text-red-600' : 'text-foreground-400'}`}>{item.elapsedDays} day(s)</p>
                  </div>
                  <div><StatusBadge status={item.status} overdue={item.isOverdue} /></div>
                  <div className="text-right">
                    <button onClick={() => navigate(`/coach/marking-queue/${item.id}`)} className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700">
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Close review" className="absolute inset-0 bg-foreground-950/45" onClick={() => setSelected(null)} />
          <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-foreground-200 bg-[#f7fbff] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-foreground-200 bg-[#f7fbff]/95 px-6 py-5 backdrop-blur">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-primary-700">{selected.activityType} submission</p>
                <h2 className="mt-1 text-xl font-bold text-foreground-950">{selected.learner}</h2>
                <p className="mt-1 text-xs text-foreground-500">{selected.activityTitle} · {selected.submittedDisplay}</p>
              </div>
              <button onClick={() => setSelected(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-background-100 text-foreground-600"><AppIcon className="ri-close-line text-xl" /></button>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Quality', `${selected.qualityScore}/100`],
                  ['KSBs', selected.ksbCodes.length],
                  ['Actual OTJH', `${selected.actualTimeHours || '--'}h`],
                  ['Status', selected.status],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-foreground-200 bg-white p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold capitalize text-foreground-900">{value}</p>
                  </div>
                ))}
              </div>

              <DetailSection title="Learning reflection" icon="ri-book-open-line">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.learningReflection}</p>
              </DetailSection>

              <DetailSection title="KSB development" icon="ri-links-line">
                <div className="space-y-3">
                  {selected.ksbCodes.map(code => (
                    <div key={code} className="rounded-xl bg-background-100 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="text-sm text-primary-700">{code}</strong>
                        <span className="text-xs text-foreground-500">
                          Confidence {selected.confidenceBefore[code] || 1}/5 → {selected.confidenceAfter[code] || 1}/5
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-foreground-600">{selected.ksbExplanations[code] || 'No explanation provided.'}</p>
                    </div>
                  ))}
                </div>
              </DetailSection>

              <DetailSection title="Workplace application" icon="ri-briefcase-line">
                <p className="text-xs font-semibold capitalize text-primary-700">{(selected.applicationType || '').replaceAll('-', ' ')}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.applicationText}</p>
              </DetailSection>

              <DetailSection title="Evidence" icon="ri-attachment-2">
                {selected.evidenceFiles.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.evidenceFiles.map(file => <span key={file} className="rounded-lg bg-background-100 px-3 py-2 text-xs text-foreground-700"><AppIcon className="ri-file-line mr-1" />{file}</span>)}
                  </div>
                ) : <p className="text-sm text-foreground-400">No evidence file was attached.</p>}
                <p className={`mt-3 text-xs ${selected.evidenceConsentConfirmed ? 'text-emerald-700' : 'text-foreground-400'}`}>
                  <AppIcon className={selected.evidenceConsentConfirmed ? 'ri-checkbox-circle-line' : 'ri-information-line'} /> Evidence consent {selected.evidenceConsentConfirmed ? 'confirmed' : 'not required'}
                </p>
              </DetailSection>

              <DetailSection title="Employer benefit" icon="ri-building-line">
                <div className="flex flex-wrap gap-2">
                  {selected.selectedBenefits.map(benefit => <span key={benefit} className="rounded-full bg-primary-50 px-3 py-1 text-xs text-primary-700">{benefit}</span>)}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.benefitExplanation}</p>
              </DetailSection>

              <DetailSection title="OTJH declaration" icon="ri-time-line">
                <div className="grid grid-cols-2 gap-3 text-xs text-foreground-600 sm:grid-cols-3">
                  <p><span className="block text-foreground-400">Planned</span>{selected.plannedOtjh || '--'}</p>
                  <p><span className="block text-foreground-400">Actual</span>{selected.actualTimeHours || '--'} hours</p>
                  <p><span className="block text-foreground-400">Date completed</span>{selected.dateCompleted || '--'}</p>
                  <p><span className="block text-foreground-400">Paid hours</span><span className="capitalize">{selected.completedDuringPaidHours || '--'}</span></p>
                  <p><span className="block text-foreground-400">OTJH confirmed</span>{selected.otjhConfirmed ? 'Yes' : 'No'}</p>
                  <p><span className="block text-foreground-400">Signed</span>{selected.signedDeclaration ? 'Yes' : 'No'}</p>
                </div>
              </DetailSection>

              <section className="rounded-2xl border border-primary-200 bg-primary-50/40 p-4">
                <h4 className="text-sm font-semibold text-foreground-900">Coach feedback</h4>
                <textarea
                  value={feedback}
                  onChange={event => setFeedback(event.target.value)}
                  rows={4}
                  placeholder="Add feedback for the learner. Feedback is required when referring work back."
                  className="mt-3 w-full resize-none rounded-xl border border-foreground-200 bg-white p-3 text-sm focus:border-primary-400 focus:outline-none"
                />
                {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button disabled={reviewing} onClick={() => void submitDecision('referred')} className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700 disabled:opacity-50">
                    <AppIcon className="ri-arrow-go-back-line mr-1" /> Refer back
                  </button>
                  <button disabled={reviewing} onClick={() => void submitDecision('accepted')} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    <AppIcon className={reviewing ? 'ri-loader-4-line mr-1 animate-spin' : 'ri-checkbox-circle-line mr-1'} /> Accept submission
                  </button>
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </WorkspaceShell>
  );
}
