import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ReviewFormRenderer, computeMissingRequiredFields, computeVisibleRequiredFields } from '@/components/reviews/ReviewFormRenderer';
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { ReviewPdfDownload } from '@/components/reviews/ReviewPdfDownload';
import { ReviewProgressPanel } from '@/components/reviews/ReviewProgressPanel';
import {
  calculateReviewInstanceProgress,
  completeReviewInstance,
  downloadReviewInstancePdf,
  fetchPreviousReviewSession,
  fetchReviewInstanceForm,
  flattenReviewFields,
  generateReviewMeetingSummary,
  reopenReviewInstance,
  saveReviewInstanceAnswers,
  signReviewInstance,
  type PreviousReviewSession,
  type ReviewInstanceFormDefinition,
} from '@/api/reviewInstances';
import { ModalHeader, ModalShell } from './ModalHeader';
import { formatDateLabel } from './calendarEvents';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { useAuth } from '@/hooks/useAuth';

const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/** Review Types with a signed PDF export, by the Review Type's stable code --
 *  mirrors curriculum_api.review_pdf.EXPORTABLE_REVIEW_TYPES. */
const EXPORTABLE_REVIEW_TYPES = ['mcm', 'progress_review'];

function MeetingSummaryInlineEditor({
  fieldId,
  value,
  onChange,
  readOnly,
  invalid,
  busy,
  draftSaved,
  onExpand,
  expandButtonRef,
}: {
  fieldId: string;
  value: unknown;
  onChange: (value: string) => void;
  readOnly: boolean;
  invalid: boolean;
  busy: boolean;
  draftSaved: boolean;
  onExpand: () => void;
  expandButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const stringValue = typeof value === 'string' ? value : '';
  const helpId = `${fieldId}-meeting-summary-help`;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          ref={expandButtonRef}
          type="button"
          onClick={onExpand}
          disabled={busy}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-background-300 bg-white px-3 text-[12px] font-bold text-foreground-700 shadow-sm transition hover:border-primary-300 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60"
        >
          <AppIcon className="ri-expand-diagonal-line"></AppIcon>
          Expand editor
        </button>
      </div>
      <textarea
        aria-label="Meeting Summary"
        aria-describedby={helpId}
        aria-invalid={invalid || undefined}
        value={stringValue}
        onChange={(event) => onChange(event.target.value)}
        disabled={readOnly}
        className={`h-[360px] min-h-[280px] w-full resize-y rounded-xl border bg-white px-4 py-3.5 text-[15px] leading-7 text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200 disabled:cursor-not-allowed disabled:bg-background-100 ${invalid ? 'border-red-300' : 'border-background-300'}`}
      />
      <p id={helpId} role={draftSaved ? 'status' : undefined} className={`text-[12px] leading-5 ${draftSaved ? 'font-semibold text-emerald-700' : 'text-foreground-400'}`}>
        {draftSaved ? 'Draft saved.' : 'Review the summary and select Save draft to keep your changes.'}
      </p>
    </div>
  );
}

function ExpandedMeetingSummaryEditor({
  value,
  onChange,
  readOnly,
  invalid,
  draftSaved,
  onDone,
}: {
  value: unknown;
  onChange: (value: string) => void;
  readOnly: boolean;
  invalid: boolean;
  draftSaved: boolean;
  onDone: () => void;
}) {
  const surfaceRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const stringValue = typeof value === 'string' ? value : '';

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDone();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      surfaceRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])') || [],
    );
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section
      ref={surfaceRef}
      aria-labelledby="expanded-meeting-summary-title"
      className="flex h-[90vh] min-h-0 flex-col bg-background-50"
      onKeyDown={handleKeyDown}
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-background-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary-600">Monthly Coaching Meeting</p>
          <h2 id="expanded-meeting-summary-title" className="mt-1 text-xl font-bold text-foreground-900">Edit Meeting Summary</h2>
          <p className="mt-1 text-[13px] text-foreground-500">Changes remain in this Review until you return and select Save draft.</p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2"
        >
          <AppIcon className="ri-check-line"></AppIcon>
          Done editing
        </button>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-[900px] flex-1 flex-col gap-3 p-4 sm:p-6">
        <textarea
          ref={editorRef}
          aria-label="Expanded Meeting Summary"
          aria-invalid={invalid || undefined}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          disabled={readOnly}
          className={`min-h-[50vh] w-full flex-1 resize-none rounded-xl border bg-white px-4 py-4 text-[15px] leading-7 text-foreground-800 shadow-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200 disabled:cursor-not-allowed disabled:bg-background-100 ${invalid ? 'border-red-300' : 'border-background-300'}`}
        />
        <p role={draftSaved ? 'status' : undefined} className={`shrink-0 text-[12px] leading-5 ${draftSaved ? 'font-semibold text-emerald-700' : 'text-foreground-500'}`}>
          {draftSaved ? 'Draft saved.' : 'Review the summary and select Save draft after returning to the Review.'}
        </p>
      </div>
    </section>
  );
}

function reviewTypeLabel(definition: ReviewInstanceFormDefinition) {
  if (definition.template.reviewTypeCode === 'mcm') return 'Monthly Coaching Meeting';
  if (definition.template.reviewTypeCode === 'progress_review') return 'Progress Review';
  return definition.template.name;
}

/**
 * The generic "open a Curriculum-driven Review" screen -- what a coach sees
 * when they open ANY Review instance (Monthly Coaching Meeting, Progress
 * Review, or any future Review Curriculum creates), instead of a
 * per-Review-type hard-coded form. The header always shows the Review's
 * live Curriculum name (`definition.template.name`), never a fixed string.
 *
 * Deliberately does not touch scheduling/Teams/calendar state -- this modal
 * only reads/writes the Review's own answers via the review instance API;
 * the calendar event it was opened from is untouched here.
 */
export function ReviewInstanceModal({
  event,
  instanceId,
  onClose,
  onStatusChanged,
  presentation = 'modal',
}: {
  /** Only what the header shows -- deliberately structural so the timetable,
   *  meetings and progress-review pages can each pass their own event type. */
  event: { learner?: string | null; programme?: string | null };
  instanceId: string;
  onClose: () => void;
  /** Called with the instance's resulting status after a successful
   *  "Complete review" -- 'awaiting-signature' when the Curriculum template
   *  requires a signature, 'completed' when it requires none. Callers mirror
   *  this onto their own CoachCalendarEvent state rather than assuming which
   *  one it landed on. */
  onCompleted?: (status: string) => void;
  /** Keeps the parent calendar row in sync after a lifecycle change that
   *  does not close this modal, such as a manual scheduled -> in-progress
   *  override. */
  onStatusChanged?: (status: string) => void;
  /** Page mode reuses the same form lifecycle without modal chrome. */
  presentation?: 'modal' | 'page';
}) {
  const { auth } = useAuth();
  const [definition, setDefinition] = useState<ReviewInstanceFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const answersRef = useRef<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [showReopenConfirmation, setShowReopenConfirmation] = useState(false);
  const signatureSaveInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [uploadingTranscript, setUploadingTranscript] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState('');
  const [summaryNotice, setSummaryNotice] = useState('');
  const [pendingSummaryReplacement, setPendingSummaryReplacement] = useState('');
  const [summaryDraftSaved, setSummaryDraftSaved] = useState(false);
  const [expandedSummaryFieldId, setExpandedSummaryFieldId] = useState<string | null>(null);
  const [previousSession, setPreviousSession] = useState<PreviousReviewSession | null>(null);
  const [previousSessionLoading, setPreviousSessionLoading] = useState(false);
  const [previousSessionOpen, setPreviousSessionOpen] = useState(false);
  const [previousSessionError, setPreviousSessionError] = useState<string | null>(null);
  const expandSummaryButtonRef = useRef<HTMLButtonElement>(null);
  const transcriptUploadRef = useRef<HTMLInputElement>(null);
  const restoreExpandFocusRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchReviewInstanceForm(instanceId, controller.signal)
      .then((data) => {
        setDefinition(data);
        const initialAnswers: Record<string, unknown> = {};
        for (const field of flattenReviewFields(data.sections)) {
          if (field.answer !== undefined && field.answer !== null) initialAnswers[field.id] = field.answer;
        }
        const source = data.meetingSummarySource;
        const hasFormalAnswer = Boolean(
          source && Object.prototype.hasOwnProperty.call(initialAnswers, source.fieldId),
        );
        if (
          source
          && ['ready', 'edited'].includes(source.status)
          && source.summaryText
          && !['awaiting-signature', 'completed'].includes(data.instance.status)
          && !hasFormalAnswer
        ) {
          // Suggestion only: it enters local editor state but is not a formal
          // Review answer until the coach deliberately saves/submits it.
          initialAnswers[source.fieldId] = source.summaryText;
          setSummaryMessage('The stored AI suggestion has been loaded for review. Save the draft to make it part of this Review.');
        } else if (source?.message) {
          setSummaryMessage(source.message);
        } else {
          setSummaryMessage('');
        }
        setPendingSummaryReplacement('');
        // Caveats describe one generated result, so a freshly loaded Review
        // must not inherit the previous one's.
        setSummaryNotice('');
        setSummaryDraftSaved(false);
        setExpandedSummaryFieldId(null);
        setPreviousSession(null);
        setPreviousSessionOpen(false);
        setPreviousSessionError(null);
        answersRef.current = initialAnswers;
        setAnswers(initialAnswers);
        setOpenSectionId(data.sections.find((s) => s.enabled)?.id || '');
      })
      .catch((err) => {
        // A superseded request (React 18 double-invokes this effect in dev,
        // and a new instanceId aborts the previous one) is not a real load
        // failure -- only a genuinely failed fetch should surface here.
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : 'Unable to load this review.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [instanceId]);

  const missingFieldIds = useMemo(
    () => (definition ? computeMissingRequiredFields(definition.sections, answers) : new Set<string>()),
    [definition, answers],
  );
  const meetingSummaryField = useMemo(
    () => definition
      ? flattenReviewFields(definition.sections).find(
        (field) => field.configuration?.semanticKey === 'meeting_summary',
      )
      : undefined,
    [definition],
  );
  const meetingSummaryFieldId = meetingSummaryField?.id;
  // Counted from the fields actually on screen, so a conditional question
  // hidden behind an unanswered case block is not silently counted as done.
  const requiredCount = useMemo(
    () => (definition ? computeVisibleRequiredFields(definition.sections, answers).size : 0),
    [definition, answers],
  );
  const answeredCount = requiredCount - missingFieldIds.size;
  const isSignatureStage = definition ? ['awaiting-signature', 'completed'].includes(definition.instance.status) : false;
  const advisorSignature = definition?.signatures.advisor;
  const advisorSignaturePending = Boolean(
    definition
    && advisorSignature?.required
    && !advisorSignature.signed
    && isSignatureStage,
  );
  const advisorSignatureSaved = Boolean(definition && advisorSignature?.required && advisorSignature.signed);
  const requiredSignatures = definition ? Object.values(definition.signatures).filter(state => state.required) : [];
  const allRequiredSignaturesSaved = requiredSignatures.length > 0 && requiredSignatures.every(state => state.signed);
  const waitingForOtherSignatures = Boolean(
    definition
    && isSignatureStage
    && !advisorSignaturePending
    && !allRequiredSignaturesSaved,
  );
  const formReadOnly = isSignatureStage;

  useEffect(() => {
    if (expandedSummaryFieldId || !restoreExpandFocusRef.current) return;
    restoreExpandFocusRef.current = false;
    expandSummaryButtonRef.current?.focus();
  }, [expandedSummaryFieldId]);

  const closeExpandedSummary = () => {
    restoreExpandFocusRef.current = true;
    setExpandedSummaryFieldId(null);
  };

  const handleAnswerChange = (fieldId: string, value: unknown) => {
    if (formReadOnly) return;
    setAnswers((current) => {
      const next = { ...current, [fieldId]: value };
      answersRef.current = next;
      return next;
    });
    if (fieldId === meetingSummaryFieldId) {
      setPendingSummaryReplacement('');
      setSummaryDraftSaved(false);
    }
    setShowErrors(false);
  };

  const saveDraft = async () => {
    if (!definition) return;
    const summaryValueAtSave = meetingSummaryFieldId ? answers[meetingSummaryFieldId] : undefined;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveReviewInstanceAnswers(definition.instance.id, answers);
      setDefinition(updated);
      if (meetingSummaryFieldId) {
        const savedCurrentSummary = answersRef.current[meetingSummaryFieldId] === summaryValueAtSave;
        setSummaryDraftSaved(savedCurrentSummary);
        if (savedCurrentSummary) setSummaryMessage('');
      }
    } catch (err) {
      // A request cancelled mid-flight (e.g. a dev-server reload, or the
      // modal closing) is not a real save failure -- nothing for the coach
      // to act on, so it should not surface as an error banner.
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Unable to save this review.');
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    if (!definition) return;
    if (missingFieldIds.size > 0) {
      setShowErrors(true);
      const containsMissingField = (fields: typeof definition.sections[number]['fields']): boolean => (
        fields.some((field) => missingFieldIds.has(field.id) ||
          containsMissingField(field.yesFields || []) || containsMissingField(field.noFields || []))
      );
      const firstMissingSection = definition.sections.find((section) => containsMissingField(section.fields));
      if (firstMissingSection) setOpenSectionId(firstMissingSection.id);
      setError('Please complete every required field before finishing the review.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const completed = await completeReviewInstance(definition.instance.id, answers);
      setDefinition(completed);
      onStatusChanged?.(completed.instance.status);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'This review cannot be completed yet.');
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    if (!definition || reopening) return;
    setReopening(true);
    setError(null);
    try {
      const updated = await reopenReviewInstance(definition.instance.id, {
        reasonCode: 'correction-required',
        note: 'Reopened for correction; all required signatures must be collected again.',
      });
      setDefinition(updated);
      setShowReopenConfirmation(false);
      onStatusChanged?.(updated.instance.status);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'This review cannot be reopened.');
    } finally {
      setReopening(false);
    }
  };

  const generateMeetingSummary = async (transcript?: File) => {
    if (!definition || generatingSummary || uploadingTranscript || isSignatureStage) return;
    if (transcript) setUploadingTranscript(true);
    else setGeneratingSummary(true);
    setError(null);
    try {
      const { meetingSummarySource: source } = await generateReviewMeetingSummary(definition.instance.id, transcript);
      setDefinition(current => current ? { ...current, meetingSummarySource: source } : current);
      const currentText = typeof answers[source.fieldId] === 'string' ? String(answers[source.fieldId]).trim() : '';
      // A server message alongside a generated summary is a caveat about that
      // summary -- currently, a transcript too long to be covered in full. It
      // is held separately from the step instruction below so that replacing
      // or saving the text cannot scroll it away and leave a partial recap
      // looking like a complete one.
      setSummaryNotice(source.summaryText ? (source.message || '').trim() : '');
      if (!source.summaryText) {
        setSummaryMessage(source.message || 'No generated Meeting Summary is available yet.');
      } else if (currentText && currentText !== source.summaryText.trim()) {
        setPendingSummaryReplacement(source.summaryText);
        setSummaryMessage('A generated summary is available. Confirm before replacing the text currently in the editor.');
      } else {
        setAnswers(current => {
          const next = { ...current, [source.fieldId]: source.summaryText };
          answersRef.current = next;
          return next;
        });
        setPendingSummaryReplacement('');
        setSummaryDraftSaved(false);
        setSummaryMessage('The generated summary is ready for review. Save the draft when you are satisfied with it.');
      }
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'The Meeting Summary could not be generated.');
    } finally {
      if (transcript) setUploadingTranscript(false);
      else setGeneratingSummary(false);
    }
  };

  /** Calculating is an explicit action and never happens on load, reload or
   *  reopen -- the snapshot below is whatever the backend already stored. */
  const calculateProgress = async () => {
    if (!definition || calculating) return;
    setCalculating(true);
    setError(null);
    try {
      setDefinition(await calculateReviewInstanceProgress(definition.instance.id));
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Progress could not be calculated.');
    } finally {
      setCalculating(false);
    }
  };

  const loadPreviousSession = async () => {
    if (!definition || previousSessionLoading) return;
    setPreviousSessionLoading(true);
    setPreviousSessionError(null);
    try {
      const previous = await fetchPreviousReviewSession(definition.instance.id);
      setPreviousSession(previous);
      setPreviousSessionOpen(previous.available);
    } catch (err) {
      if (isAbortError(err)) return;
      setPreviousSessionError(err instanceof Error ? err.message : 'Unable to load the previous session.');
    } finally {
      setPreviousSessionLoading(false);
    }
  };

  const busy = saving || calculating || generatingSummary || uploadingTranscript || reopening;
  const pageMode = presentation === 'page';
  const headingLabel = definition ? reviewTypeLabel(definition) : '';
  const previousOccurrenceNumber = definition && typeof definition.instance.occurrenceNumber === 'number'
    ? definition.instance.occurrenceNumber - 1
    : null;
  const hasPreviousOccurrence = previousOccurrenceNumber !== null && previousOccurrenceNumber >= 1;

  if (expandedSummaryFieldId && meetingSummaryField) {
    return (
      <ModalShell busy={busy} onClose={closeExpandedSummary}>
        <ExpandedMeetingSummaryEditor
          value={answers[expandedSummaryFieldId]}
          onChange={(value) => handleAnswerChange(expandedSummaryFieldId, value)}
          readOnly={formReadOnly}
          invalid={showErrors && missingFieldIds.has(expandedSummaryFieldId)}
          draftSaved={summaryDraftSaved}
          onDone={closeExpandedSummary}
        />
      </ModalShell>
    );
  }

  const content = (
    <>
      {pageMode ? (
        <header className="rounded-t-3xl border-b border-white/10 bg-gradient-to-br from-[#10021f] via-primary-950 to-[#35105e] px-5 py-6 text-white sm:px-8 sm:py-7">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="mb-5 inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            <AppIcon className="ri-arrow-left-line"></AppIcon>Back to reviews
          </button>
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-lg text-secondary-200 shadow-inner shadow-white/5">
              <AppIcon className="ri-chat-check-line"></AppIcon>
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-secondary-200">Complete review</p>
              <h1 className="mt-1 max-w-4xl text-xl font-bold leading-tight text-white sm:text-2xl lg:text-[28px]">
                {definition ? `${headingLabel} #${definition.instance.occurrenceNumber}` : 'Loading review...'}
              </h1>
              <p className="mt-1 text-[13px] text-white/60">Work through each Curriculum-defined step, then save or complete the review.</p>
            </div>
          </div>
          {requiredCount ? (
            <div className="mt-5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-secondary-300 transition-all" style={{ width: `${Math.round((answeredCount / requiredCount) * 100)}%` }} />
              </div>
              <span className="text-[12px] font-bold text-white/70">{answeredCount}/{requiredCount} answered</span>
            </div>
          ) : null}
        </header>
      ) : (
        <ModalHeader
          eyebrow="Complete review"
          icon="ri-chat-check-line"
          title={definition ? `${event.learner || 'Learner'} · ${definition.template.name} #${definition.instance.occurrenceNumber}` : 'Loading review...'}
          subtitle="Complete the Curriculum-defined review before closing it."
          busy={busy}
          onClose={onClose}
          progressPercent={requiredCount ? Math.round((answeredCount / requiredCount) * 100) : undefined}
          progressLabel={requiredCount ? `${answeredCount}/${requiredCount} answered` : undefined}
        />
      )}

      <div className={pageMode ? 'space-y-5 bg-[#f8f7fc] p-4 sm:p-6 lg:p-8' : 'flex-1 space-y-3 overflow-y-auto bg-background-100 p-4 sm:p-6'}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground-400">
            <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>Loading review...
          </div>
        ) : null}

        {!loading && definition ? (
          <>
            {isSignatureStage ? (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-label="Edit completed review">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-amber-950">This Review is read-only</p>
                    <p className="mt-1 text-xs leading-5 text-amber-900">Select Edit to reopen the same Review for correction. Existing signatures will be recorded in the audit history and cleared before editing.</p>
                  </div>
                  <button type="button" onClick={() => setShowReopenConfirmation(true)} disabled={busy} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60">
                      <AppIcon className="ri-edit-2-line" />Edit
                  </button>
                </div>
              </section>
            ) : null}
            {showReopenConfirmation ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/50 p-4" role="presentation">
                <div role="dialog" aria-modal="true" aria-labelledby="reopen-confirmation-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex items-start gap-3">
                    <AppIcon className="ri-error-warning-line mt-0.5 text-xl text-amber-600" />
                    <div>
                      <h2 id="reopen-confirmation-title" className="text-base font-bold text-foreground-900">Edit this completed Review?</h2>
                      <p className="mt-2 text-sm leading-6 text-foreground-600">Reopening will clear the current signatures after recording an audit snapshot. Everyone must sign this Review again before it can be completed.</p>
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={() => setShowReopenConfirmation(false)} disabled={reopening} className="h-10 rounded-lg border border-background-300 bg-white px-4 text-xs font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-60">Cancel</button>
                    <button type="button" onClick={() => { void reopen(); }} disabled={reopening} className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"><AppIcon className={reopening ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} />{reopening ? 'Reopening...' : 'OK'}</button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/80 px-4 py-3 text-[13px] leading-5 text-primary-800 shadow-sm">
              <AppIcon className="ri-information-line mt-0.5 shrink-0 text-primary-600"></AppIcon>
              <span>These answers are saved to this {definition.template.name} and follow the sections/questions configured in Curriculum.</span>
            </div>

            <div className="grid gap-3 rounded-2xl border border-background-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Learner', event.learner || 'Unknown learner'],
                ['Programme', event.programme || '--'],
                ['Review', `${definition.template.name} #${definition.instance.occurrenceNumber}`],
                ['Target date', formatDateLabel(definition.instance.targetDate)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[#f7f5fc] px-4 py-3.5 ring-1 ring-inset ring-primary-100/70">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-400">{label}</p>
                  <p className="mt-1.5 truncate text-[13px] font-bold text-foreground-900" title={value}>{value}</p>
                </div>
              ))}
            </div>

            {hasPreviousOccurrence ? (
              <section aria-label="Previous session context" className="rounded-2xl border border-primary-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600">Previous session context</p>
                    <h2 className="mt-1 text-sm font-bold text-foreground-900">
                      {headingLabel} #{previousOccurrenceNumber}
                    </h2>
                    <p className="mt-1 text-[12px] leading-5 text-foreground-500">
                      Review the previous session&apos;s saved summary and transcript before completing this one.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void loadPreviousSession(); }}
                    disabled={previousSessionLoading}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary-300 bg-primary-50 px-3 text-[12px] font-bold text-primary-700 shadow-sm transition hover:bg-primary-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <AppIcon className={previousSessionLoading ? 'ri-loader-4-line animate-spin' : 'ri-history-line'} />
                    {previousSessionLoading ? 'Loading previous session...' : previousSessionOpen ? 'Refresh previous session' : 'View previous session'}
                  </button>
                </div>

                {previousSessionError ? (
                  <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
                    {previousSessionError}
                  </p>
                ) : null}

                {previousSession && !previousSession.available ? (
                  <p className="mt-3 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[12px] text-foreground-600">
                    {previousSession.reason || 'No previous session is available yet.'}
                  </p>
                ) : null}

                {previousSession?.available && previousSessionOpen ? (
                  <div className="mt-4 space-y-3 border-t border-background-200 pt-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-foreground-500">
                      <span className="font-semibold text-foreground-700">
                        {previousSession.review?.name || headingLabel} #{previousSession.instance?.occurrenceNumber ?? previousOccurrenceNumber}
                      </span>
                      {previousSession.instance?.targetDate ? <span>{formatDateLabel(previousSession.instance.targetDate)}</span> : null}
                      {previousSession.instance?.status ? <span className="capitalize">{previousSession.instance.status.replaceAll('-', ' ')}</span> : null}
                    </div>

                    {previousSession.summaryText ? (
                      <div className="rounded-xl border border-primary-100 bg-primary-50/70 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary-700">Saved summary</p>
                        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-foreground-700">{previousSession.summaryText}</p>
                      </div>
                    ) : null}

                    {previousSession.transcriptAvailable ? (
                      <details open className="rounded-xl border border-background-200 bg-background-50 p-3">
                        <summary className="cursor-pointer text-[12px] font-bold text-foreground-800">Session transcript</summary>
                        <pre aria-label="Previous session transcript" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-background-200 bg-white p-3 text-[12px] leading-5 text-foreground-700">{previousSession.transcriptText}</pre>
                        {previousSession.transcriptTruncated ? (
                          <p className="mt-2 text-[11px] leading-5 text-amber-700">This transcript is truncated to keep the review responsive.</p>
                        ) : null}
                      </details>
                    ) : (
                      <p className="rounded-xl border border-background-200 bg-background-50 px-3 py-2 text-[12px] text-foreground-600">
                        No stored transcript is available for this session.
                      </p>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            {definition.instance.status === 'scheduled' ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-bold text-amber-900">Not yet in progress</p>
                  <p className="mt-0.5 text-[12px] text-amber-800">
                    Start the review from the meeting actions before completing this form.
                  </p>
                </div>
              </div>
            ) : null}

            {/* The Learning Progress area belongs to the canonical Progress
                Review type only -- identified by the Review Type's stable
                code, never by the template's name. Calculating is locked once
                the review reaches the signature step, so the figures a party
                signs cannot move afterwards. */}
            {definition.template.reviewTypeCode === 'progress_review' ? (
              <ReviewProgressPanel
                snapshot={definition.progressSnapshot}
                ragHistory={definition.ragHistory}
                canCalculate={!isSignatureStage}
                calculating={calculating}
                onCalculate={() => { void calculateProgress(); }}
              />
            ) : null}

            <ReviewFormRenderer
              sections={definition.sections}
              answers={answers}
              onAnswerChange={handleAnswerChange}
              errors={showErrors ? { missingFieldIds } : undefined}
              readOnly={formReadOnly}
              openSectionId={openSectionId}
              onOpenSectionChange={setOpenSectionId}
              renderFieldAddon={(field) => field.configuration?.semanticKey === 'meeting_summary' ? (
                <div className="mb-3 space-y-3">
                  <p className="text-[13px] leading-5 text-foreground-500">
                    Review and finalise the meeting summary before sending the Review for signatures.
                  </p>
                  <div className="space-y-2 rounded-xl border border-primary-100 bg-primary-50 p-3 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[12px] font-bold text-primary-900">AI Meeting Summary</p>
                        <p className="mt-0.5 text-[12px] leading-5 text-primary-700">Generate a draft from the linked Teams transcript, or upload a .vtt transcript if the meeting was held outside Teams, then review and edit it before saving. It is not saved automatically.</p>
                      </div>
                      {!formReadOnly ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={transcriptUploadRef}
                            type="file"
                            accept=".vtt,text/vtt"
                            aria-label="Select .vtt transcript"
                            className="sr-only"
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              event.currentTarget.value = '';
                              if (!file) return;
                              if (!file.name.toLowerCase().endsWith('.vtt')) {
                                setError('Upload a WebVTT transcript with a .vtt file extension.');
                                return;
                              }
                              void generateMeetingSummary(file);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => transcriptUploadRef.current?.click()}
                            disabled={busy}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-300 bg-white px-3 text-[12px] font-bold text-primary-700 shadow-sm transition hover:bg-primary-100 disabled:opacity-60"
                          >
                            <AppIcon className={uploadingTranscript ? 'ri-loader-4-line animate-spin' : 'ri-upload-2-line'}></AppIcon>
                            {uploadingTranscript ? 'Uploading & generating...' : 'Upload .vtt & Generate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void generateMeetingSummary(); }}
                            disabled={busy}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
                          >
                            <AppIcon className={generatingSummary ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-2-line'}></AppIcon>
                            {generatingSummary ? 'Generating...' : 'Generate from Teams'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {summaryNotice ? (
                      <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-4 font-bold text-amber-800">{summaryNotice}</p>
                    ) : null}
                    {summaryMessage ? (
                      <p role={definition.meetingSummarySource?.status === 'failed' ? 'alert' : 'status'} className="text-[11px] leading-4 text-primary-800">{summaryMessage}</p>
                    ) : null}
                    {pendingSummaryReplacement ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAnswers(current => {
                              const next = { ...current, [field.id]: pendingSummaryReplacement };
                              answersRef.current = next;
                              return next;
                            });
                            setPendingSummaryReplacement('');
                            setSummaryDraftSaved(false);
                            setSummaryMessage('The generated summary replaced the editor text. Review it before saving.');
                          }}
                          className="h-8 rounded-lg bg-amber-600 px-3 text-[11px] font-bold text-white"
                        >
                          Replace with generated summary
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingSummaryReplacement('');
                            // The generated text was discarded, so its caveat
                            // no longer describes anything on screen.
                            setSummaryNotice('');
                            setSummaryMessage('The current editor text was kept.');
                          }}
                          className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-bold text-amber-800"
                        >
                          Keep current text
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              renderFieldInput={(field, context) => field.configuration?.semanticKey === 'meeting_summary' ? (
                <MeetingSummaryInlineEditor
                  fieldId={field.id}
                  value={context.value}
                  onChange={(value) => context.onChange(value)}
                  readOnly={context.readOnly}
                  invalid={context.invalid}
                  busy={busy}
                  draftSaved={summaryDraftSaved}
                  onExpand={() => setExpandedSummaryFieldId(field.id)}
                  expandButtonRef={expandSummaryButtonRef}
                />
              ) : undefined}
              variant={pageMode ? 'steps' : 'accordion'}
            />
            {advisorSignaturePending ? (
              <section aria-label="Review signature step" tabIndex={-1} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <h3 className="mb-3 text-sm font-bold text-violet-950">Your coach signature is required</h3>
                {auth.user?.fullName ? (
                  <fieldset disabled={saving} className="min-w-0 border-0 p-0">
                    <SignaturePad
                      signatoryName={auth.user.fullName}
                      onCommit={(signature) => {
                        if (signatureSaveInFlightRef.current) return;
                        signatureSaveInFlightRef.current = true;
                        setSaving(true);
                        setError(null);
                        void signReviewInstance(definition.instance.id, 'advisor', auth.user?.fullName || 'Coach', signature)
                          .then((updated) => {
                            setDefinition(updated);
                            onStatusChanged?.(updated.instance.status);
                          })
                          .catch((err) => {
                            if (isAbortError(err)) return;
                            setError(err instanceof Error ? err.message : 'Unable to save your signature.');
                          })
                          .finally(() => {
                            signatureSaveInFlightRef.current = false;
                            setSaving(false);
                          });
                      }}
                      onCancel={() => undefined}
                    />
                  </fieldset>
                ) : (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    Your account has no name on record, so this cannot be signed.
                  </p>
                )}
              </section>
            ) : null}
            {advisorSignatureSaved ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Your coach signature has been saved.
              </div>
            ) : null}
            {waitingForOtherSignatures ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm font-semibold text-violet-900">
                Your part is complete. The review is waiting for the remaining required signatures.
              </div>
            ) : null}
            {definition.instance.status === 'completed' ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Review completed
              </div>
            ) : null}
            {/* The signed-PDF export and the full signature summary (coach +
                learner + any other configured party) belong to the Review
                Types that have a signed export -- identified by the Review
                Type's stable code, never by name/title -- and reuse the exact
                same components/API the learner side already uses, reading the
                same signatures/pdf-availability this same fetch already
                returned. */}
            {EXPORTABLE_REVIEW_TYPES.includes(definition.template.reviewTypeCode || '') && isSignatureStage ? (
              <>
                <ReviewSignatures signatures={definition.signatures} />
                <ReviewPdfDownload
                  availability={definition.pdf}
                  onDownload={() => downloadReviewInstancePdf(definition.instance.id)}
                />
              </>
            ) : null}
          </>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{error}
          </div>
        ) : null}
      </div>

      <footer className={pageMode ? 'sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-3 rounded-b-3xl border-t border-background-200 bg-white/95 px-5 py-4 shadow-[0_-8px_24px_rgba(31,24,51,0.08)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-8' : 'flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7'}>
        <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">{pageMode ? 'Back' : 'Cancel'}</button>
        {!isSignatureStage ? <div className="flex gap-2">
          <button type="button" onClick={saveDraft} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-background-300 bg-white px-5 text-xs font-bold text-foreground-700 shadow-sm transition hover:bg-background-100 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon>Save draft
          </button>
          <button type="button" onClick={complete} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
            {saving ? 'Saving...' : requiredSignatures.length ? 'Send for signatures' : 'Complete review'}
          </button>
        </div> : null}
      </footer>
    </>
  );

  if (pageMode) {
    return <div className="mx-auto w-full max-w-[1500px] overflow-hidden rounded-3xl border border-background-200 bg-white shadow-[0_18px_50px_rgba(44,24,78,0.08)]">{content}</div>;
  }

  return <ModalShell busy={busy} onClose={onClose}>{content}</ModalShell>;
}
