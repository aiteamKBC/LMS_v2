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

/** Bytes as something readable at a glance — a coach checking a submission
 *  wants to know "is that a real document or an empty file", not the exact
 *  count. */
function fileSize(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [evidenceError, setEvidenceError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  // The marking policy for this submission: what the server holds, and what the
  // coach has it edited to. Kept apart so "Reset to default" has something to
  // reset to, and so the default path can post no prompt at all.
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [promptFile, setPromptFile] = useState('');
  const [promptKind, setPromptKind] = useState('');
  const [promptAvailable, setPromptAvailable] = useState(true);
  const [promptError, setPromptError] = useState('');

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
  // Whether the coach's prompt actually differs from the authored one. Computed
  // once, so the "Edited" badge and the request body cannot disagree: comparing
  // raw text in the badge made a cleared box read as an edit while the server
  // fell back to the file.
  const promptEdited = Boolean(prompt.trim()) && prompt.trim() !== defaultPrompt.trim();
  const promptCleared = !prompt.trim() && Boolean(defaultPrompt.trim());
  useEffect(() => {
    if (selected) {
      setFeedback(selected.coachFeedback ?? '');
    }
  }, [selected]);

  // The documents the learner handed in. Scoped by section_ref to this
  // activity, so it is the submission's own evidence rather than the learner's
  // whole portfolio. Read through the learner endpoints, which already admit
  // staff on GET (`learner_self_or_staff`) — the coach's own session is enough,
  // so no coach-side mirror of the evidence store is needed.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // Cleared first, or moving between submissions leaves the previous
    // learner's files on screen until the new fetch resolves.
    setEvidence([]);
    setEvidenceError('');
    fetchEvidence(selected.learnerKind, selected.learnerId, { sectionRef: selected.activityId })
      .then(records => {
        if (!cancelled) setEvidence(records);
      })
      .catch(loadError => {
        if (cancelled) return;
        // Kept separate from `error`: the feedback box is still usable, and a
        // failed file list must not read as a failed submission load.
        setEvidence([]);
        setEvidenceError(
          loadError instanceof Error ? loadError.message : 'The uploaded files could not be listed.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // The prompt this submission would be marked with. Which of the two applies
  // (assignment or reflection) is decided by the server from the same list the
  // generator uses, so the text shown here is the text that will run.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPromptError('');
    coachFetch(`${API_ENDPOINT}/${selected.id}/ai-prompt`)
      .then(async response => {
        const body = await response.text();
        let data: {
          prompt?: string;
          file?: string;
          kind?: string;
          available?: boolean;
          detail?: string;
          error?: string;
        } = {};
        try {
          data = body ? JSON.parse(body) : {};
        } catch {
          throw new Error(`The marking prompt could not be loaded (server error ${response.status}).`);
        }
        if (!response.ok) throw new Error(data.error || data.detail || 'The marking prompt could not be loaded.');
        if (cancelled) return;
        setDefaultPrompt(data.prompt || '');
        setPrompt(data.prompt || '');
        setPromptFile(data.file || '');
        setPromptKind(data.kind || '');
        setPromptAvailable(data.available !== false);
      })
      .catch(loadError => {
        if (cancelled) return;
        setPromptError(
          loadError instanceof Error ? loadError.message : 'The marking prompt could not be loaded.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  /** Open one uploaded document.
   *
   * The tab is opened *before* awaiting the URL. The download link is a
   * short-lived SAS token minted per request, so it has to be fetched — but a
   * window.open() after an await has lost the user-gesture context and is
   * blocked by Chrome and Safari, which looked like a dead button. So the tab
   * is claimed synchronously on the click and then pointed at the URL. */
  const openEvidence = async (record: EvidenceRecord) => {
    if (!selected || downloading) return;
    const tab = window.open('', '_blank');
    // Severed by hand rather than with the `noopener` feature flag: per spec
    // window.open() returns null whenever that flag is passed, so the handle
    // needed to navigate the tab would be thrown away and every click would
    // look like a blocked pop-up. Nulling `opener` gives the same protection
    // against the cross-origin (Azure) page reaching back into this one.
    if (tab) tab.opener = null;
    setDownloading(record.id);
    setEvidenceError('');
    try {
      const url = await getEvidenceDownloadUrl(selected.learnerKind, selected.learnerId, record.id);
      if (tab) tab.location.href = url;
      // A blocked pop-up would otherwise fail silently, leaving the coach
      // clicking a button that appears to do nothing.
      else setEvidenceError('Allow pop-ups for this site to open the document.');
    } catch (downloadError) {
      tab?.close();
      setEvidenceError(
        downloadError instanceof Error ? downloadError.message : 'The document could not be opened.',
      );
    } finally {
      setDownloading(null);
    }
  };

  // A draft, never a decision. The response only ever populates the textarea
  // below; the marking policy requires a qualified coach to review, edit and
  // decide, so nothing is saved until they press one of the buttons themselves.
  const generateAiFeedback = async () => {
    if (!selected || generating) return;
    setGenerating(true);
    setError('');
    setAiNotice('');
    try {
      // The prompt travels only when the coach has actually changed it, so the
      // default path stays byte-identical to what the server would have used on
      // its own and cannot be affected by whitespace drift in the textarea.
      const response = await coachFetch(`${API_ENDPOINT}/${selected.id}/ai-feedback`, {
        method: 'POST',
        ...(promptEdited
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: prompt.trim() }),
            }
          : {}),
      });
      const text = await response.text();
      // A server error returns an HTML page, not JSON, so parsing is guarded:
      // otherwise the coach is shown "Unexpected token '<'" instead of what
      // actually went wrong.
      let data: {
        feedback?: string;
        error?: string;
        detail?: string;
        meta?: { ksbCount?: number; epaFile?: string; promptSource?: string };
      } = {};
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
      // Which prompt produced the draft is worth stating: a coach returning to
      // this page should not have to guess whether they are reading the result
      // of the authored policy or of their own edit.
      const promptNote = data.meta?.promptSource === 'custom'
        ? ' from your edited prompt'
        : '';
      setAiNotice(
        `AI-assisted draft generated${promptNote} ${scope}`
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

                {/* What the learner uploaded. Above the metadata because for
                    an assignment the document *is* the submission — a coach
                    could previously see it was named but had no way to read it,
                    so the thing being marked was not on the marking page.

                    Shown for assignments, where a document is expected, and for
                    anything else only if a file actually exists: a reflection
                    review should not carry a permanent "no document uploaded"
                    line for something it never asked for. */}
                {(selected.activityType === 'assignment' || evidence.length > 0) && (
                <div className="mt-6 border-t border-foreground-100 pt-4">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                    Uploaded document{evidence.length === 1 ? '' : 's'}
                  </h4>
                  {evidence.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {evidence.map(record => {
                        // `status` is the malware-scan verdict from the upload
                        // pipeline, not the coach's decision. A file that has
                        // not cleared the scan is listed but not openable —
                        // hiding it would leave the coach believing nothing was
                        // handed in.
                        const scanned = record.status === 'approved';
                        const busy = downloading === record.id;
                        return (
                          <li
                            key={record.id}
                            className="flex flex-wrap items-center gap-3 rounded-lg border border-foreground-200 bg-background-50 p-3"
                          >
                            <AppIcon className="ri-file-text-line shrink-0 text-xl text-foreground-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-foreground-900">
                                {record.filename}
                              </p>
                              <p className="mt-0.5 text-xs text-foreground-500">
                                {[record.contentType, fileSize(record.sizeBytes)]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            {scanned ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void openEvidence(record)}
                                className="inline-flex shrink-0 items-center rounded-lg border border-primary-200 bg-primary-50 px-3.5 py-2 text-sm font-semibold text-primary-800 transition hover:bg-primary-100 disabled:opacity-50"
                              >
                                <AppIcon
                                  className={`mr-2 ${busy ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'}`}
                                />
                                {busy ? 'Opening…' : 'Download'}
                              </button>
                            ) : (
                              <span
                                className="shrink-0 rounded-full bg-background-100 px-3 py-1.5 text-xs font-semibold text-foreground-500"
                                title="Held until the virus scan clears this file."
                              >
                                {record.status === 'rejected' ? 'Failed virus scan' : 'Awaiting scan'}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-foreground-400">
                      {evidenceError
                        || 'The learner did not upload a document with this submission.'}
                    </p>
                  )}
                  {evidenceError && evidence.length > 0 && (
                    <p className="mt-2 text-xs font-semibold text-red-600">{evidenceError}</p>
                  )}
                </div>
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

              {/* The policy the AI marks against, shown and editable. It was
                  previously invisible: a coach could see the draft but not what
                  produced it, so there was no way to tell a weak draft from a
                  weak prompt. An edit here applies to the next generation on
                  this submission only — the authored .MD file is never written,
                  because that would change marking for every coach. */}
              <Panel className="order-2" padding="lg">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-foreground-950">Marking prompt</h3>
                    <p className="mt-2 text-base text-foreground-500">
                      {promptAvailable
                        ? `The ${promptKind === 'assignment' ? 'assignment marking' : 'reflection validation'} policy used to generate the draft below. Edit it to mark against different instructions.`
                        : 'No prompt file was found on the server, so nothing will be sent as policy unless you write one here.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {promptFile && (
                      <span className="rounded-full bg-background-100 px-3 py-1.5 text-xs font-mono font-semibold text-foreground-600">
                        {promptFile}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={!defaultPrompt || prompt === defaultPrompt}
                      onClick={() => setPrompt(defaultPrompt)}
                      className="inline-flex items-center rounded-lg border border-foreground-200 px-3.5 py-2 text-sm font-semibold text-foreground-600 transition hover:bg-background-100 disabled:opacity-40"
                    >
                      <AppIcon className="ri-restart-line mr-2" />
                      Reset to default
                    </button>
                  </div>
                </div>

                <textarea
                  value={prompt}
                  onChange={event => setPrompt(event.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="mt-5 w-full resize-y rounded-lg border border-foreground-200 bg-background-50 p-4 font-mono text-sm leading-6 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                  placeholder="Write the instructions the AI should mark against..."
                />

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-foreground-400">
                    The learner&apos;s evidence, the KSBs assigned to this activity and this
                    deployment&apos;s rules are added automatically — they do not need to be in the
                    prompt.
                  </p>
                  <span className="text-xs font-semibold text-foreground-400">
                    {prompt.length.toLocaleString()} characters
                  </span>
                </div>

                {promptEdited && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-amber-700">
                    <AppIcon className="ri-information-line mt-0.5 shrink-0" />
                    <span>
                      Edited. This applies to the next draft you generate for this submission only;
                      the saved {promptFile || 'prompt'} file is unchanged.
                    </span>
                  </p>
                )}
                {promptCleared && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-foreground-500">
                    <AppIcon className="ri-information-line mt-0.5 shrink-0" />
                    <span>Empty — the saved {promptFile || 'prompt'} will be used.</span>
                  </p>
                )}
                {promptError && (
                  <p className="mt-2 text-xs font-semibold text-red-600">{promptError}</p>
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
