import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import type { LearnerKind } from '@/api/learnerDetail';
import { PanelSkeleton } from '@/components/feature/Skeletons';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';

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

type ReviewDecision = 'accepted' | 'rejected';

function statusLabel(status: string) {
  if (status === 'accepted') return 'Accepted';
  if (status === 'partial') return 'Partially awarded';
  if (status === 'referred') return 'Referred back';
  if (status === 'escalated') return 'Escalated';
  if (status === 'rejected') return 'Rejected';
  return 'Pending review';
}

export default function CoachMarkingReviewPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [items, setItems] = useState<Submission[]>([]);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const [error, setError] = useState('');

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
  useEffect(() => {
    if (selected) {
      setFeedback(selected.coachFeedback ?? '');
    }
  }, [selected]);

  // A draft, never a decision. The response only ever populates the textarea
  // below; the marking policy requires a qualified coach to review, edit and
  // decide, so nothing is saved until they press one of the buttons themselves.
  const generateAiFeedback = async () => {
    if (!selected || generating) return;
    setGenerating(true);
    setError('');
    setAiNotice('');
    try {
      const response = await coachFetch(`${API_ENDPOINT}/${selected.id}/ai-feedback`, { method: 'POST' });
      const text = await response.text();
      // A server error returns an HTML page, not JSON, so parsing is guarded:
      // otherwise the coach is shown "Unexpected token '<'" instead of what
      // actually went wrong.
      let data: { feedback?: string; error?: string; detail?: string; meta?: { ksbCount?: number; epaFile?: string } } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          response.ok
            ? 'The server returned an unreadable response.'
            : `The draft could not be generated (server error ${response.status}).`,
        );
      }
      if (!response.ok) throw new Error(data.error || data.detail || 'The draft could not be generated.');
      setFeedback(data.feedback || '');
      // Said plainly rather than left for the coach to notice: with no KSBs on
      // the activity there is nothing authoritative to map against, so the
      // draft cannot verify any -- which is worth knowing before reading it.
      const ksbCount = data.meta?.ksbCount ?? 0;
      const epaFile = data.meta?.epaFile;
      const scope = ksbCount > 0
        ? `against the ${ksbCount} KSB${ksbCount === 1 ? '' : 's'} assigned to this activity`
        : 'but no KSBs are assigned to this activity, so none could be verified';
      setAiNotice(
        `AI-assisted draft generated ${scope}`
        + (epaFile ? `, using ${epaFile}` : '')
        + '. Review and edit before deciding.',
      );
    } catch (aiError) {
      setError(aiError instanceof Error ? aiError.message : 'The draft could not be generated.');
    } finally {
      setGenerating(false);
    }
  };

  const saveDecision = async (decision: ReviewDecision) => {
    if (!selected || saving) return;
    // Required for both decisions, not just rejection: each button says it
    // sends feedback, so accepting with an empty box would quietly send the
    // learner nothing.
    if (!feedback.trim()) {
      setError('Write feedback for the learner before sending this decision.');
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
      // A server error returns HTML, not JSON — parse defensively so the coach
      // is told the status rather than shown a parser complaint.
      let data: { detail?: string; error?: string; fields?: Record<string, string[] | string> } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`The review could not be saved (server error ${response.status}).`);
      }
      if (!response.ok) {
        // A validation failure names the field it rejected; surfacing it beats
        // "could not be saved", which leaves the coach guessing which part of
        // their decision the server refused.
        const fieldMessages = Object.entries(data.fields ?? {})
          .map(([field, message]) => `${field}: ${Array.isArray(message) ? message.join(' ') : message}`)
          .join('; ');
        throw new Error(fieldMessages || data.detail || data.error || 'The review could not be saved.');
      }
      navigate('/coach/marking-queue');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The review could not be saved.');
    } finally {
      setSaving(false);
    }
  };

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
              {/* What the learner actually wrote, above the decision. A coach
                  validating a reflection had no way to read it on this page —
                  only an empty feedback box — so the judgement they were being
                  asked to make was not in front of them. */}
              <Panel className="order-1" padding="lg">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold text-foreground-950">
                    {selected.activityType === 'assignment'
                      ? "The learner's submission"
                      : "The learner's reflection"}
                  </h3>
                  <span className="text-xs font-semibold text-foreground-400">
                    {[selected.activityTitle, selected.module, selected.week].filter(Boolean).join(' · ')}
                  </span>
                </div>

                {selected.learningReflection ? (
                  <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-foreground-800">
                    {selected.learningReflection}
                  </p>
                ) : (
                  <p className="mt-4 text-base text-foreground-400">
                    The learner did not write a reflection for this activity.
                  </p>
                )}

                <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-foreground-100 pt-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                      Workplace application
                    </dt>
                    <dd className="mt-1 text-sm text-foreground-700">
                      {[selected.applicationType, selected.applicationText].filter(Boolean).join(' — ') || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                      Employer benefits
                    </dt>
                    <dd className="mt-1 text-sm text-foreground-700">
                      {selected.selectedBenefits?.length
                        ? selected.selectedBenefits.join(', ')
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                      Time · planned vs recorded
                    </dt>
                    {/* Side by side because the gap is the thing worth seeing:
                        a fifteen-minute video logged as three hours is what a
                        coach is checking for. */}
                    <dd className="mt-1 text-sm text-foreground-700">
                      {selected.plannedOtjh || '—'} planned · {selected.actualTimeHours || '—'} recorded
                    </dd>
                  </div>
                </dl>
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
                    <button
                      type="button"
                      disabled={generating || saving}
                      onClick={() => void generateAiFeedback()}
                      className="inline-flex items-center rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-800 shadow-sm transition hover:bg-primary-100 disabled:opacity-50"
                    >
                      <AppIcon className={`mr-2 ${generating ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-line'}`} />
                      {generating ? 'Generating draft…' : 'Generate AI feedback'}
                    </button>
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
                {aiNotice && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-primary-700">
                    <AppIcon className="ri-sparkling-line mt-0.5 shrink-0" />
                    <span>{aiNotice}</span>
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button disabled={saving} onClick={() => void saveDecision('accepted')} className="rounded-lg bg-primary-900 px-5 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-50">
                    <AppIcon className="ri-check-line mr-2" />Accept assignment and send feedback
                  </button>
                  <button disabled={saving} onClick={() => void saveDecision('rejected')} className="rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-base font-semibold text-red-700 shadow-sm disabled:opacity-50">
                    <AppIcon className="ri-close-line mr-2" />Reject assignment and send feedback
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
