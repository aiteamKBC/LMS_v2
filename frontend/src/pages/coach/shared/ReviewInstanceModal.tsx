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
  fetchReviewInstanceForm,
  flattenReviewFields,
  generateReviewMeetingSummary,
  saveReviewInstanceAnswers,
  signReviewInstance,
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
}) {
  const { auth } = useAuth();
  const [definition, setDefinition] = useState<ReviewInstanceFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const answersRef = useRef<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const signatureSaveInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState('');
  const [pendingSummaryReplacement, setPendingSummaryReplacement] = useState('');
  const [summaryDraftSaved, setSummaryDraftSaved] = useState(false);
  const [expandedSummaryFieldId, setExpandedSummaryFieldId] = useState<string | null>(null);
  const expandSummaryButtonRef = useRef<HTMLButtonElement>(null);
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
        setSummaryDraftSaved(false);
        setExpandedSummaryFieldId(null);
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

  const generateMeetingSummary = async () => {
    if (!definition || generatingSummary || isSignatureStage) return;
    setGeneratingSummary(true);
    setError(null);
    try {
      const { meetingSummarySource: source } = await generateReviewMeetingSummary(definition.instance.id);
      setDefinition(current => current ? { ...current, meetingSummarySource: source } : current);
      const currentText = typeof answers[source.fieldId] === 'string' ? String(answers[source.fieldId]).trim() : '';
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
      setGeneratingSummary(false);
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

  const busy = saving || calculating || generatingSummary;

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

  return (
    <ModalShell busy={busy} onClose={onClose}>
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

      <div className="flex-1 space-y-3 overflow-y-auto bg-background-100 p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground-400">
            <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>Loading review...
          </div>
        ) : null}

        {!loading && definition ? (
          <>
            <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-[13px] leading-5 text-primary-800">
              <AppIcon className="ri-information-line mr-2"></AppIcon>
              These answers are saved to this {definition.template.name} and follow the sections/questions configured in Curriculum.
            </div>

            <div className="grid gap-3 rounded-2xl border border-background-200 bg-background-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Learner', event.learner || 'Unknown learner'],
                ['Programme', event.programme || '--'],
                ['Review', `${definition.template.name} #${definition.instance.occurrenceNumber}`],
                ['Target date', formatDateLabel(definition.instance.targetDate)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-background-100 px-3.5 py-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
                  <p className="mt-1 text-[13px] font-bold text-foreground-800">{value}</p>
                </div>
              ))}
            </div>

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
                        <p className="mt-0.5 text-[12px] leading-5 text-primary-700">Generate a draft from the linked Teams transcript, then review and edit it before saving. It is not saved automatically.</p>
                      </div>
                      {!formReadOnly ? (
                        <button
                          type="button"
                          onClick={() => { void generateMeetingSummary(); }}
                          disabled={busy}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
                        >
                          <AppIcon className={generatingSummary ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-2-line'}></AppIcon>
                          {generatingSummary ? 'Generating...' : 'Generate from Teams'}
                        </button>
                      ) : null}
                    </div>
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

      <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">Cancel</button>
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
    </ModalShell>
  );
}
