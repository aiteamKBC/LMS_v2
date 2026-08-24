import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchEvidence, getEvidenceDownloadUrl, type EvidenceRecord } from '@/api/evidence';
import { PanelSkeleton } from '@/components/feature/Skeletons';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { PageTabs } from '@/components/ui/PageTabs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { statusTone } from '@/lib/statusTone';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/marking-queue';

interface Submission {
  id: string;
  learnerKind: LearnerKind;
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
  status: string;
  learningReflection: string;
  ksbCodes: string[];
  ksbWeights: Record<string, number>;
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
  submittedDisplay: string;
}

type ReviewTab = 'overview' | 'learning' | 'evidence';
type ReviewDecision = 'accepted' | 'partial' | 'referred' | 'escalated' | 'rejected';

function statusLabel(status: string) {
  if (status === 'accepted') return 'Accepted';
  if (status === 'partial') return 'Partially awarded';
  if (status === 'referred') return 'Referred back';
  if (status === 'escalated') return 'Escalated';
  if (status === 'rejected') return 'Rejected';
  return 'Pending review';
}

function formatFileSize(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A bordered detail section inside the review page — Panel + SectionHeader
 * standing in for what used to be a one-off wrapper repeated per section. */
function ReviewBlock({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <Panel>
      <SectionHeader title={title} icon={icon} />
      <div className="mt-3">{children}</div>
    </Panel>
  );
}

export default function CoachMarkingReviewPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [items, setItems] = useState<Submission[]>([]);
  const [feedback, setFeedback] = useState('');
  const [tab, setTab] = useState<ReviewTab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceRecord[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!coach.isInitialized) return;
    setLoading(true);
    setError('');
    if (!coach.email) {
      setItems([]);
      setError('Coach access is required to load submissions.');
      setLoading(false);
      return;
    }
    try {
      const response = await coachFetch(`${API_ENDPOINT}/${submissionId}`);
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.detail || 'Unable to load submissions.');
      setItems(data.item ? [data.item] : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load submissions.');
    } finally {
      setLoading(false);
    }
  }, [coach.email, coach.isInitialized, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.find(item => item.id === submissionId) || null,
    [items, submissionId],
  );
  const submissionEvidenceRecords = useMemo(() => {
    if (!selected?.evidenceFiles.length) return [];
    const submittedNames = new Set(selected.evidenceFiles);
    const seenNames = new Set<string>();
    return evidenceRecords.filter(record => {
      if (!submittedNames.has(record.filename) || seenNames.has(record.filename)) return false;
      seenNames.add(record.filename);
      return true;
    });
  }, [evidenceRecords, selected]);

  useEffect(() => {
    if (selected) {
      setFeedback(selected.coachFeedback ?? '');
    }
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setEvidenceRecords([]);
      return;
    }

    let cancelled = false;
    setEvidenceRecords([]);
    setEvidenceLoading(true);
    setEvidenceError('');
    fetchEvidence(selected.learnerKind, selected.learnerId, { sectionRef: selected.activityId })
      .then(records => {
        if (!cancelled) setEvidenceRecords(records);
      })
      .catch(loadError => {
        if (!cancelled) {
          setEvidenceRecords([]);
          setEvidenceError(loadError instanceof Error ? loadError.message : 'Could not load the uploaded evidence.');
        }
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const openEvidence = async (record: EvidenceRecord) => {
    if (record.status !== 'approved' || openingEvidenceId) return;
    setOpeningEvidenceId(record.id);
    setEvidenceError('');
    try {
      const url = await getEvidenceDownloadUrl(selected!.learnerKind, selected!.learnerId, record.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (openError) {
      setEvidenceError(openError instanceof Error ? openError.message : 'Could not open the uploaded file.');
    } finally {
      setOpeningEvidenceId(null);
    }
  };

  const saveDecision = async (decision: ReviewDecision) => {
    if (!selected || saving) return;
    if (decision !== 'accepted' && !feedback.trim()) {
      setError('Add feedback explaining the reason for this decision.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await coachFetch(`${API_ENDPOINT}/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, feedback: feedback.trim(), reviewedBy: coach.name }),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.detail || 'The review could not be saved.');
      navigate('/coach/marking-queue');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The review could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const suggestion = selected
    ? selected.qualityScore === 100
      ? `The learner completed all required sections and claimed ${selected.ksbCodes.length} mapped KSBs. Review the explanations and evidence before accepting the submission.`
      : `The learner's quality score is ${selected.qualityScore}/100. Check the incomplete or weak sections before making a final decision.`
    : '';
  const unresolvedEvidenceFiles = selected
    ? selected.evidenceFiles.filter(name => !submissionEvidenceRecords.some(record => record.filename === name))
    : [];
  const mappedKsbWeight = selected
    ? Object.values(selected.ksbWeights || {}).reduce((total, weight) => total + Number(weight || 0), 0)
    : 0;

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Submission Review"
      pageSubtitle="Review, adjust and validate learner evidence"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <PageContainer>
        <PageHeader
          icon="ri-sparkling-line"
          title="Review, adjust, validate"
          description="AI-assisted suggestions are clearly labelled. The coach retains final professional judgement on every decision."
          backTo={{ to: '/coach/marking-queue', label: 'Back to Marking Queue' }}
        />

        {loading ? (
          <PanelSkeleton lines={6} />
        ) : error && !selected ? (
          <EmptyState
            variant="error"
            title="Unable to load this submission"
            description={error}
            action={<EmptyStateAction label="Retry" icon="ri-refresh-line" onClick={() => void load()} />}
          />
        ) : !selected ? (
          <EmptyState
            variant="empty"
            icon="ri-file-search-line"
            title="Submission not found"
            description="This submission may already have been reviewed, or the link is out of date."
            action={
              <EmptyStateAction
                label="Back to Marking Queue"
                icon="ri-arrow-left-line"
                onClick={() => navigate('/coach/marking-queue')}
              />
            }
          />
        ) : (
          <div className="grid items-start gap-7 lg:grid-cols-[330px_minmax(0,1fr)]">
            <aside className="space-y-3">
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => navigate(`/coach/marking-queue/${item.id}`)}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    item.id === selected.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-foreground-200 bg-background-50 hover:border-primary-200'
                  }`}
                >
                  <p className="text-base font-semibold text-foreground-900">{item.learner}</p>
                  <p className="mt-1.5 truncate text-sm text-foreground-500">{item.activityTitle}</p>
                  <span className="mt-4 inline-flex rounded-full bg-background-100 px-2.5 py-1 text-xs font-semibold text-foreground-600">
                    Quality {item.qualityScore}%
                  </span>
                </button>
              ))}
            </aside>

            <main className="flex min-w-0 flex-col gap-6">
              <Panel className="order-1" padding="lg">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">{selected.activityType} submission</p>
                    <h3 className="mt-1 text-sm font-heading font-bold text-foreground-900">{selected.activityTitle}</h3>
                    <p className="mt-2 text-base text-foreground-500">
                      {selected.learner} · {[selected.module, selected.week].filter(Boolean).join(' · ')} · Submitted {selected.submittedDisplay}
                    </p>
                  </div>
                  <StatusBadge status={selected.status} label={statusLabel(selected.status)} size="sm" className="w-fit" />
                </div>

                <div className="mt-5">
                  <p className="text-sm font-semibold uppercase tracking-wider text-foreground-400">KSBs claimed by learner</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.ksbCodes.map(code => (
                      <span key={code} className="inline-flex items-center gap-2 rounded-lg bg-primary-50 px-3.5 py-1.5 text-sm font-semibold text-primary-800">
                        {code}
                        <span className="rounded-md bg-background-50 px-1.5 py-0.5 text-[12px] text-primary-600 shadow-sm">
                          {selected.ksbWeights?.[code] ?? 0}% weight
                        </span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Quality score" value={`${selected.qualityScore}/100`} />
                  <MetricCard label="Mapped KSB weight" value={`${mappedKsbWeight}%`} />
                  <MetricCard label="Actual OTJH" value={`${selected.actualTimeHours || '0'}h`} />
                  <MetricCard
                    label="Marking status"
                    value={statusLabel(selected.status)}
                    tone={statusTone(selected.status)}
                  />
                </div>

                <div className="mt-6 rounded-lg border border-primary-200 bg-primary-50/40 p-5">
                  <p className="text-sm font-semibold text-primary-700"><AppIcon className="ri-sparkling-line mr-2" />AI-assisted suggestion · requires coach validation</p>
                  <p className="mt-4 text-base leading-7 text-foreground-800"><strong>Submission summary:</strong> {suggestion}</p>
                  <p className="mt-3 text-base leading-7 text-foreground-800">
                    <strong>Suggested action:</strong> Review the KSB explanations, workplace application and uploaded evidence, then accept or request resubmission.
                  </p>
                </div>
              </Panel>

              <Panel className="order-2" padding="lg">
                <div className="mb-5">
                  <h3 className="text-lg font-bold text-foreground-950">Full submission details</h3>
                  <p className="mt-1 text-sm text-foreground-500">Review the learner’s responses and supporting evidence before finalising your decision.</p>
                </div>
                <PageTabs
                  label="View submission sections"
                  value={tab}
                  onChange={(next) => setTab(next as ReviewTab)}
                  items={[
                    { value: 'overview', label: 'Overview' },
                    { value: 'learning', label: 'Learning & KSBs' },
                    { value: 'evidence', label: 'Evidence & OTJH' },
                  ]}
                />

                {tab === 'overview' && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <ReviewBlock title="Workplace application" icon="ri-briefcase-line">
                      <p className="text-xs font-semibold capitalize text-primary-700">{selected.applicationType}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.applicationText}</p>
                    </ReviewBlock>
                    <ReviewBlock title="Employer benefit" icon="ri-building-line">
                      <div className="flex flex-wrap gap-1.5">
                        {selected.selectedBenefits.map(benefit => <span key={benefit} className="rounded-full bg-primary-50 px-2.5 py-1 text-[12px] text-primary-700">{benefit}</span>)}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.benefitExplanation}</p>
                    </ReviewBlock>
                  </div>
                )}

                {tab === 'learning' && (
                  <div className="mt-5 space-y-4">
                    <ReviewBlock title="Learning reflection" icon="ri-book-open-line">
                      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.learningReflection}</p>
                    </ReviewBlock>
                    {selected.ksbCodes.map(code => (
                      <ReviewBlock key={code} title={code} icon="ri-links-line">
                        <p className="mb-2 text-xs font-bold text-primary-700">{selected.ksbWeights?.[code] ?? 0}% curriculum weight</p>
                        <p className="text-xs font-semibold text-foreground-500">Confidence {selected.confidenceBefore[code] || 1}/5 → {selected.confidenceAfter[code] || 1}/5</p>
                        <p className="mt-2 text-sm leading-6 text-foreground-700">{selected.ksbExplanations[code]}</p>
                      </ReviewBlock>
                    ))}
                  </div>
                )}

                {tab === 'evidence' && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <ReviewBlock title="Uploaded evidence" icon="ri-attachment-2">
                      {evidenceLoading && (
                        <div className="flex items-center gap-2 rounded-lg bg-background-100 px-3 py-3 text-xs text-foreground-500">
                          <AppIcon className="ri-loader-4-line animate-spin" /> Loading uploaded evidence...
                        </div>
                      )}
                      {!evidenceLoading && submissionEvidenceRecords.map(record => {
                        const canOpen = record.status === 'approved';
                        const isOpening = openingEvidenceId === record.id;
                        return (
                          <button
                            type="button"
                            key={record.id}
                            disabled={!canOpen || isOpening}
                            onClick={() => void openEvidence(record)}
                            className={`mb-2 flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition ${
                              canOpen
                                ? 'border-primary-100 bg-primary-50/50 hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm'
                                : 'cursor-not-allowed border-foreground-100 bg-background-100 opacity-70'
                            }`}
                          >
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${canOpen ? 'bg-background-50 text-primary-700 shadow-sm' : 'bg-background-200 text-foreground-400'}`}>
                              <AppIcon className={isOpening ? 'ri-loader-4-line animate-spin' : 'ri-file-line'} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold text-foreground-800">{record.filename}</span>
                              <span className="mt-0.5 block text-[12px] text-foreground-400">
                                {[formatFileSize(record.sizeBytes), canOpen ? 'Ready to view' : record.status === 'pending' ? 'Security scan in progress' : 'File unavailable'].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            {canOpen && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-background-50 px-2.5 py-1.5 text-[12px] font-bold text-primary-700 shadow-sm">
                                View <AppIcon className="ri-external-link-line" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {!evidenceLoading && unresolvedEvidenceFiles.map(file => (
                        <div key={file} className="mb-2 flex items-center gap-3 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-50 text-amber-600 shadow-sm"><AppIcon className="ri-file-warning-line" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-foreground-800">{file}</span>
                            <span className="mt-0.5 block text-[12px] text-amber-700">The file record could not be found.</span>
                          </span>
                        </div>
                      ))}
                      {!evidenceLoading && !submissionEvidenceRecords.length && !unresolvedEvidenceFiles.length && (
                        <p className="text-sm text-foreground-400">No file uploaded.</p>
                      )}
                      {evidenceError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{evidenceError}</p>}
                      <p className="mt-2 text-xs text-emerald-700">{selected.evidenceConsentConfirmed ? 'Consent confirmed' : 'No consent confirmation required'}</p>
                    </ReviewBlock>
                    <ReviewBlock title="OTJH declaration" icon="ri-time-line">
                      <dl className="grid grid-cols-2 gap-3 text-xs">
                        <div><dt className="text-foreground-400">Planned</dt><dd className="font-semibold">{selected.plannedOtjh}</dd></div>
                        <div><dt className="text-foreground-400">Actual</dt><dd className="font-semibold">{selected.actualTimeHours}h</dd></div>
                        <div><dt className="text-foreground-400">Date</dt><dd className="font-semibold">{selected.dateCompleted}</dd></div>
                        <div><dt className="text-foreground-400">Paid hours</dt><dd className="font-semibold capitalize">{selected.completedDuringPaidHours}</dd></div>
                        <div><dt className="text-foreground-400">Confirmed</dt><dd className="font-semibold">{selected.otjhConfirmed ? 'Yes' : 'No'}</dd></div>
                        <div><dt className="text-foreground-400">Signed</dt><dd className="font-semibold">{selected.signedDeclaration ? 'Yes' : 'No'}</dd></div>
                      </dl>
                    </ReviewBlock>
                  </div>
                )}
              </Panel>

              <Panel className="order-3" padding="lg">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <h3 className="text-lg font-bold text-foreground-950">Your feedback to learner</h3>
                    <p className="mt-2 text-base text-foreground-500">
                      {selected.coachFeedback
                        ? 'This feedback was loaded from the learner submission record.'
                        : 'No coach feedback has been recorded yet.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-background-100 px-3 py-1.5 text-xs font-semibold text-foreground-700">
                      Marking status: {statusLabel(selected.status)}
                    </span>
                    {selected.reviewedBy && (
                      <span className="rounded-full bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700">
                        Reviewed by {selected.reviewedBy}
                      </span>
                    )}
                  </div>
                </div>
                <textarea
                  value={feedback}
                  onChange={event => setFeedback(event.target.value)}
                  rows={7}
                  className="mt-6 w-full resize-none rounded-lg border border-foreground-200 p-4 text-base leading-7 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                  placeholder="Write clear, actionable coach feedback for the learner..."
                />
                {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button disabled={saving} onClick={() => void saveDecision('accepted')} className="rounded-lg bg-primary-900 px-5 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-50">
                    <AppIcon className="ri-check-line mr-2" />Accept &amp; award KSBs
                  </button>
                  <button disabled={saving} onClick={() => void saveDecision('partial')} className="rounded-lg border border-foreground-200 bg-background-50 px-5 py-3 text-base font-semibold text-foreground-800 shadow-sm disabled:opacity-50">
                    <AppIcon className="ri-edit-line mr-2" />Partial award
                  </button>
                  <button disabled={saving} onClick={() => void saveDecision('referred')} className="rounded-lg border border-foreground-200 bg-background-50 px-5 py-3 text-base font-semibold text-foreground-800 shadow-sm disabled:opacity-50">
                    <AppIcon className="ri-arrow-go-back-line mr-2" />Request resubmission
                  </button>
                  <button disabled={saving} onClick={() => void saveDecision('escalated')} className="rounded-lg border border-foreground-200 bg-background-50 px-5 py-3 text-base font-semibold text-foreground-800 shadow-sm disabled:opacity-50">
                    <AppIcon className="ri-shield-line mr-2" />Escalate
                  </button>
                  <button disabled={saving} onClick={() => void saveDecision('rejected')} className="rounded-lg px-4 py-3 text-base font-semibold text-red-600 disabled:opacity-50">
                    <AppIcon className="ri-close-line mr-2" />Reject
                  </button>
                </div>
                <p className="mt-4 text-xs text-foreground-400">
                  Every decision is audit-trailed with feedback, reviewer and timestamp.
                </p>
              </Panel>
            </main>
          </div>
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}
