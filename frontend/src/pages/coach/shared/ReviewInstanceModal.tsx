import { initialReviewBookingDate, initialReviewBookingDuration } from './importedReviewBooking';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { ReviewFormRenderer } from '@/components/reviews/ReviewFormRenderer';
import { computeMissingRequiredFields, computeVisibleRequiredFields } from "@/components/reviews/ReviewFormRenderer.helpers";
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { ReviewPdfDownload } from '@/components/reviews/ReviewPdfDownload';
import { MigratedReviewHistory } from '@/components/reviews/MigratedReviewHistory';
import { ReviewProgressPanel } from '@/components/reviews/ReviewProgressPanel';
import { renderImportedSection } from '@/pages/learner/reviews/imported/renderImportedSection';
import { hasImportedProgress } from '@/pages/learner/reviews/imported/presentation';
import { ImportedValue } from '@/pages/learner/reviews/imported/ImportedReviewSection';
import {
  adoptMigratedReviewBooking,
  bookMigratedReview,
  fetchCoachReviewSlots,
  rescheduleMigratedReview,
  calculateReviewInstanceProgress,
  calculateMigratedReviewProgress,
  completeReviewInstance,
  completeMigratedReview,
  downloadReviewInstancePdf,
  fetchPreviousReviewSession,
  fetchReviewInstanceForm,
  flattenReviewFields,
  generateReviewMeetingSummary,
  initializeMigratedReview,
  reopenReviewInstance,
  reopenMigratedReview,
  downloadMigratedReviewRevision,
  saveReviewInstanceAnswers,
  signReviewInstance,
  signMigratedReviewAsCoach,
  startMigratedReview,
  submitMigratedReview,
  type PreviousReviewSession,
  type ReviewInstanceFormDefinition,
  type ReviewReopenReasonCode,
} from '@/api/reviewInstances';
import { ModalHeader, ModalShell } from './ModalHeader';
import { formatDateLabel } from './calendarEvents';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { useAuth } from "@/hooks/useAuth";
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { useImportedMeetingJoin } from './useImportedMeetingJoin';
import { MigratedMeetingIntelligence } from './MigratedMeetingIntelligence';
import { MigratedSummaryActions } from './MigratedSummaryActions';
import type { CoachMeetingArtifactsResponse } from './calendarEvents';
import { adoptExistingMigratedMeeting, canInitializeMigratedReview } from './importedReviewBooking';

const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/** Review Types with a signed PDF export, by the Review Type's stable code --
 *  mirrors curriculum_api.review_pdf.EXPORTABLE_REVIEW_TYPES. */
const EXPORTABLE_REVIEW_TYPES = ['mcm', 'aptem_mcm', 'progress_review'];

function MeetingSummaryInlineEditor({
  fieldId,
  label = 'Meeting Summary',
  maxLength,
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
  label?: string;
  maxLength?: number;
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
        aria-label={label}
        aria-describedby={helpId}
        aria-invalid={invalid || undefined}
        value={stringValue}
        maxLength={maxLength}
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
  reviewLabel,
  maxLength,
  value,
  onChange,
  readOnly,
  invalid,
  draftSaved,
  onDone,
}: {
  reviewLabel: string;
  maxLength?: number;
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
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary-600">{reviewLabel}</p>
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
          maxLength={maxLength}
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
export function ReviewInstanceModal(props: Omit<Parameters<typeof ReviewInstanceContent>[0], 'coachIdentity'>) {
  const coachIdentity = useCoachIdentity();
  // Async form callbacks belong to this review and coach, even across step changes.
  return <ReviewInstanceContent key={`${props.instanceId}:${coachIdentity.email}:${coachIdentity.isViewingAsCoach}`}
    {...props} coachIdentity={coachIdentity} />;
}

function ReviewInstanceContent({
  event,
  instanceId,
  onClose,
  onStatusChanged,
  presentation = 'modal',
  coachIdentity,
}: {
  /** Only what the header shows -- deliberately structural so the timetable,
   *  meetings and progress-review pages can each pass their own event type. */
  event?: { learner?: string | null; programme?: string | null };
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
  coachIdentity: ReturnType<typeof useCoachIdentity>;
}) {
  const { auth } = useAuth();
  const isViewingAsCoach = coachIdentity.isViewingAsCoach;
  const [definition, setDefinition] = useState<ReviewInstanceFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const answersRef = useRef<Record<string, unknown>>({});
  const savedAnswersRef = useRef<Record<string, unknown>>({});
  const editedFieldsRef = useRef(new Set<string>());
  const progressRequestRef = useRef(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [generatingMigratedSummary, setGeneratingMigratedSummary] = useState(false);
  const [migratedIntelligenceRevision, setMigratedIntelligenceRevision] = useState(0);
  const reviewActive = useRef(true);
  useEffect(() => {
    reviewActive.current = true;
    return () => { reviewActive.current = false; };
  }, []);
  const onMigratedCheckComplete = useCallback((result: CoachMeetingArtifactsResponse) => {
    if (!reviewActive.current) return;
    if (result.event?.status === 'in-progress') {
      setDefinition(current => current ? { ...current, localStatus: 'in-progress',
        instance: { ...current.instance, status: 'in-progress' } } : current);
      onStatusChanged?.('in-progress');
    }
    if (result.progressVersion) {
      setDefinition((current) => current ? { ...current, progressVersion: result.progressVersion } : current);
    }
    if (!result.answerVersion || !result.reviewAnswers) return;
    const stored = result.reviewAnswers;
    const local = answersRef.current;
    const previous = savedAnswersRef.current;
    const merged = { ...stored };
    // Preserve any local input made while the request was starting. Only
    // server values replace fields that the coach has not changed locally.
    for (const key of new Set([...Object.keys(previous), ...Object.keys(local)])) {
      if (local[key] !== previous[key] || (key in local) !== (key in previous)) {
        if (key in local) merged[key] = local[key];
        else delete merged[key];
      }
    }
    savedAnswersRef.current = stored;
    answersRef.current = merged;
    setAnswers(merged);
    setDefinition(current => current ? { ...current, answerVersion: result.answerVersion, summaryBinding: result.summaryBinding } : current);
  }, [onStatusChanged]);
  const onMigratedSummaryComplete = useCallback((result: CoachMeetingArtifactsResponse) => {
    if (!reviewActive.current) return;
    onMigratedCheckComplete(result);
    // A field-level Teams check also refreshes attendance/artifacts. Reload the
    // panel's local snapshot without another Graph or AI request.
    if (result.intelligence) setMigratedIntelligenceRevision(value => value + 1);
  }, [onMigratedCheckComplete]);
  const [loading, setLoading] = useState(true);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const [initializationRetry, setInitializationRetry] = useState(0);
  const initializationAttemptsRef = useRef(new Map<string, ReturnType<typeof initializeMigratedReview>>());
  const [saving, setSaving] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('09:00');
  const [bookingDuration, setBookingDuration] = useState(60);
  const [bookingTimes, setBookingTimes] = useState<string[]>([]);
  const [bookingAvailabilityLoading, setBookingAvailabilityLoading] = useState(false);
  const [bookingAvailabilityError, setBookingAvailabilityError] = useState('');
  const [bookingAvailabilityRetry, setBookingAvailabilityRetry] = useState(0);
  const bookingInFlightRef = useRef(false);
  const [reopening, setReopening] = useState(false);
  const [showReopenConfirmation, setShowReopenConfirmation] = useState(false);
  const [reopenReason, setReopenReason] = useState<ReviewReopenReasonCode>('correction-required');
  const [reopenNote, setReopenNote] = useState('');
  const signatureSaveInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const joinMeeting = useImportedMeetingJoin({
    contextKey: `${coachIdentity.email}:${isViewingAsCoach}:${instanceId}`, readOnly: isViewingAsCoach,
    onError: setError,
    onStarted: (_event, updated) => {
      setDefinition(current => current ? {
        ...current, localStatus: 'in-progress', instance: { ...current.instance, status: 'in-progress' },
        // Advance the answer version only when the server proves the same
        // saved work. Keep unsaved editor values and concurrent-edit conflicts.
        ...(current.bookingAdoptionVersion && current.bookingAdoptionVersion === updated.bookingAdoptionVersion
          ? { answerVersion: updated.answerVersion } : {}),
      } : current);
      onStatusChanged?.('in-progress');
    },
  });
  const joinImportedBooking = () => {
    if (!definition?.booking) return;
    joinMeeting({ eventKey: definition.instance.id, calendarEventKey: definition.booking.eventKey,
      reviewSource: 'aptem', status: definition.localStatus || definition.instance.status,
      scheduledDate: definition.booking.scheduledDate, scheduledTime: definition.booking.scheduledTime,
      meetingLink: definition.booking.meetingLink }, false);
  };
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
  const previousSessionRequestRef = useRef<AbortController | null>(null);
  const expandSummaryButtonRef = useRef<HTMLButtonElement>(null);
  const transcriptUploadRef = useRef<HTMLInputElement>(null);
  const restoreExpandFocusRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    setInitializationFailed(false);
    setDefinition(null);
    setShowReopenConfirmation(false);
    setReopenReason('correction-required');
    setReopenNote('');
    previousSessionRequestRef.current?.abort();
    previousSessionRequestRef.current = null;
    setPreviousSession(null);
    setPreviousSessionLoading(false);
    setPreviousSessionOpen(false);
    setPreviousSessionError(null);
    if (!coachIdentity.isInitialized) {
      return () => {
        active = false;
        controller.abort();
      };
    }
    const load = async () => {
      try {
        let data = await fetchReviewInstanceForm(instanceId, controller.signal);
        if (!active) return;
        // Opening an eligible review prepares its form for the assigned coach.
        // Keep the server eligibility gate and reuse an attempt during effect replay.
        if (!isViewingAsCoach && canInitializeMigratedReview(data)) {
          const attemptKey = `${coachIdentity.email}:${instanceId}:${initializationRetry}`;
          let attempt = initializationAttemptsRef.current.get(attemptKey);
          if (!attempt) {
            attempt = initializeMigratedReview(data.instance.id);
            initializationAttemptsRef.current.set(attemptKey, attempt);
          }
          try {
            // Initialization returns the complete authorized form. Show it
            // immediately instead of making a second read a prerequisite.
            const initialized = await attempt;
            if (!active) return;
            if (!initialized?.migratedForm || !initialized.formAvailable || initialized.summaryOnly) {
              throw new Error('The migrated form was not available after initialization.');
            }
            data = initialized;
          } catch (err) {
            if (!active) return;
            setInitializationFailed(true);
            setError(err instanceof Error ? `Unable to initialize this migrated review: ${err.message}` : 'Unable to initialize this migrated review.');
          }
        }
        try {
          data = await adoptExistingMigratedMeeting(data, { viewingAsCoach: isViewingAsCoach, signal: controller.signal });
        } catch (err) {
          if (!active || isAbortError(err)) return;
          setError(err instanceof Error ? err.message : 'Unable to link the existing meeting. Retry below.');
        }
        if (!active) return;
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
        savedAnswersRef.current = { ...initialAnswers };
        editedFieldsRef.current.clear();
        setAnswers(initialAnswers);
        setOpenSectionId(data.sections.find((s) => s.enabled)?.id || '');
      } catch (err) {
        // A superseded request (React 18 double-invokes this effect in dev,
        // and a new instanceId aborts the previous one) is not a real load
        // failure -- only a genuinely failed fetch should surface here.
        if (!active || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : 'Unable to load this review.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
      previousSessionRequestRef.current?.abort();
      previousSessionRequestRef.current = null;
    };
  }, [instanceId, initializationRetry, coachIdentity.email, coachIdentity.isInitialized, isViewingAsCoach]);

  useEffect(() => {
    let active = true;
    setBookingTimes([]);
    setBookingAvailabilityError('');
    if (!bookingOpen || !definition || definition.booking?.canAttach || !bookingDate
        || !Number.isInteger(bookingDuration) || bookingDuration < 15 || bookingDuration > 480) {
      setBookingAvailabilityLoading(false);
      return;
    }
    const controller = new AbortController();
    setBookingAvailabilityLoading(true);
    void fetchCoachReviewSlots(definition.instance.learnerId, bookingDate, bookingDuration, {
      excludeEventKey: definition.booking?.canReschedule ? definition.booking.eventKey || undefined : undefined,
      signal: controller.signal,
    }).then(times => {
      if (!active) return;
      setBookingTimes(times);
      setBookingTime(current => current && times.includes(current) ? current : '');
    }).catch(reason => {
      if (active) setBookingAvailabilityError(reason instanceof Error
        ? reason.message : 'Could not check the coach calendar. Retry before booking.');
    }).finally(() => { if (active) setBookingAvailabilityLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [bookingOpen, definition, bookingDate, bookingDuration, bookingAvailabilityRetry]);

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
  const isMigratedTemplatePreview = definition?.source === 'aptem' && Boolean(definition.previewOnly);
  const migratedSummaryBinding = useMemo(() => {
    if (definition?.migratedForm) return definition.summaryBinding;
    if (!isMigratedTemplatePreview || !definition) return undefined;
    // Previews have no overlay/provenance yet. Derive display-only binding
    // metadata from the actual rendered definition, never from a field label.
    const fields = flattenReviewFields(definition.sections).filter(field => field.configuration?.semanticKey === 'meeting_summary');
    const field = fields.length === 1 ? fields[0] : undefined;
    return field && ['text', 'text_multiline'].includes(field.fieldType)
      && definition.sections.some(section => section.enabled && section.fields.some(item => item.id === field.id))
      ? { fieldKey: field.id } : undefined;
  }, [definition, isMigratedTemplatePreview]);
  // Counted from the fields actually on screen, so a conditional question
  // hidden behind an unanswered case block is not silently counted as done.
  const requiredCount = useMemo(
    () => (definition ? computeVisibleRequiredFields(definition.sections, answers).size : 0),
    [definition, answers],
  );
  const answeredCount = requiredCount - missingFieldIds.size;
  const isImportedReadOnly = Boolean(definition?.readOnly);
  const templateSyncConflict = definition?.templateSync?.status === 'conflict';
  const isSummaryOnly = Boolean(definition?.summaryOnly);
  const canInitializeMigrated = definition ? canInitializeMigratedReview(definition) : false;
  const isSignatureStage = definition ? ['awaiting-signature', 'completed'].includes(definition.instance.status) : false;
  const isHistoricalPdfAvailable = Boolean(definition?.source === 'aptem' && definition.pdf?.available);
  const advisorSignature = definition?.signatures.advisor;
  const advisorSignaturePending = Boolean(
    definition
    && advisorSignature?.required
    && !advisorSignature.signed
    && isSignatureStage,
  );
  const advisorSignatureSaved = Boolean(definition && advisorSignature?.required && advisorSignature.signed);
  const requiredSignatures = definition ? Object.values(definition.signatures).filter(state => state.required) : [];
  const personalSupportForm = Boolean(definition?.migratedForm && definition.template.reviewTypeCode === 'aptem_psp');
  const signatureFreePersonalSupport = personalSupportForm && requiredSignatures.length === 0;
  const allRequiredSignaturesSaved = requiredSignatures.length > 0 && requiredSignatures.every(state => state.signed);
  const waitingForOtherSignatures = Boolean(
    definition
    && !signatureFreePersonalSupport
    && definition.instance.status === 'awaiting-signature'
    && requiredSignatures.length > 0
    && !advisorSignaturePending
    && !allRequiredSignaturesSaved,
  );
  const formReadOnly = isViewingAsCoach || isImportedReadOnly || isSignatureStage || templateSyncConflict;
  // PSP appointments can be managed while their imported form remains read-only.
  const independentBooking = definition?.source === 'aptem' && definition.booking?.formRequired === false;
  const hasImportedBooking = Boolean(definition?.migratedForm || independentBooking);
  const bookingReadOnly = independentBooking
    ? Boolean(isViewingAsCoach || definition?.previewOnly || templateSyncConflict || definition?.booking?.conflict
      || isSignatureStage || definition?.instance.completedAt
      || ['in-progress', 'awaiting-signature', 'completed', 'cancelled'].includes(
        definition?.booking?.status || definition?.localStatus || definition?.instance.status || ''))
    : formReadOnly;
  const displayedReviewStatus = independentBooking
    ? definition?.booking?.status || definition?.localStatus || definition?.instance.status
    : definition?.localStatus;
  // Admin previews can show the action without an initialized overlay. The
  // separate execution gate still requires the assigned coach and eligibility.
  const showMigratedCoachActions = Boolean(isViewingAsCoach && definition && !templateSyncConflict
    && (definition.migratedForm || isMigratedTemplatePreview)
    && ['not-scheduled', 'scheduled', 'in-progress'].includes(definition.instance.status));
  const showMigratedSummaryActions = Boolean(isViewingAsCoach && !templateSyncConflict && !isSignatureStage
    && (isMigratedTemplatePreview || (definition?.migratedForm
      && ['scheduled', 'in-progress'].includes(definition.instance.status))));
  const hasUnsavedMigratedAnswers = Boolean(definition?.migratedForm && (
    editedFieldsRef.current.size > 0 || JSON.stringify(answers) !== JSON.stringify(savedAnswersRef.current)
  ));

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
    if (formReadOnly || (checkingSession && !generatingMigratedSummary)) return;
    if (definition?.migratedForm) editedFieldsRef.current.add(fieldId);
    setAnswers((current) => {
      const next = { ...current, [fieldId]: value };
      if (definition?.migratedForm && current[fieldId] !== value) {
        const findField = (fields: typeof definition.sections[number]['fields']): typeof fields[number] | undefined => {
          for (const field of fields) {
            if (field.id === fieldId) return field;
            const nested = findField([...(field.yesFields || []), ...(field.noFields || [])]);
            if (nested) return nested;
          }
          return undefined;
        };
        const clearChildren = (fields: typeof definition.sections[number]['fields']) => {
          for (const field of fields) {
            delete next[field.id];
            clearChildren(field.yesFields || []);
            clearChildren(field.noFields || []);
          }
        };
        const changedField = definition.sections.map(section => findField(section.fields)).find(Boolean);
        if (changedField?.fieldType === 'boolean_case_block') {
          clearChildren(changedField.yesFields || []);
          clearChildren(changedField.noFields || []);
        }
      }
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
    if (!definition || isViewingAsCoach) return;
    const summaryValueAtSave = meetingSummaryFieldId ? answers[meetingSummaryFieldId] : undefined;
    setSaving(true);
    setError(null);
    try {
      const updated = definition.migratedForm && definition.answerVersion
        ? await saveReviewInstanceAnswers(definition.instance.id, answers, { answerVersion: definition.answerVersion, editedFields: [...editedFieldsRef.current] })
        : await saveReviewInstanceAnswers(definition.instance.id, answers);
      savedAnswersRef.current = { ...answers };
      for (const key of editedFieldsRef.current) {
        if (answersRef.current[key] === answers[key]) editedFieldsRef.current.delete(key);
      }
      setDefinition(updated);
      if (personalSupportForm) onStatusChanged?.(updated.instance.status);
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
    if (!definition || isViewingAsCoach) return;
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
      const completed = definition.migratedForm
        ? await submitMigratedReview(definition.instance.id, answers, ...(definition.answerVersion ? [{ answerVersion: definition.answerVersion, editedFields: [...editedFieldsRef.current] }] : []))
        : await completeReviewInstance(definition.instance.id, answers);
      setDefinition(completed);
      onStatusChanged?.(completed.instance.status);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'This review cannot be completed yet.');
    } finally {
      setSaving(false);
    }
  };

  const finalizeMigrated = async () => {
    if (!definition?.migratedForm || isViewingAsCoach || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await completeMigratedReview(definition.instance.id, definition.reviewRevision);
      setDefinition(updated);
      onStatusChanged?.(updated.instance.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the migrated review.');
    } finally {
      setSaving(false);
    }
  };

  const startMigrated = async () => {
    if (!definition?.migratedForm || isViewingAsCoach) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await startMigratedReview(definition.instance.id);
      setDefinition(updated);
      onStatusChanged?.(updated.localStatus || updated.instance.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start this migrated review.');
    } finally {
      setSaving(false);
    }
  };

  const bookMigrated = async () => {
    if (!definition || !hasImportedBooking || !(definition.booking?.canBook || definition.booking?.canAttach || definition.booking?.canReschedule) || bookingReadOnly || bookingInFlightRef.current) return;
    if (!definition.booking.canAttach && (bookingAvailabilityLoading || bookingAvailabilityError
        || !bookingTimes.includes(bookingTime))) {
      setError(bookingAvailabilityError || 'Choose an available UK time before booking.');
      return;
    }
    bookingInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (definition.booking.canAttach && !definition.bookingAdoptionVersion) {
        throw new Error('Reopen this review before linking the meeting. Your unsaved text has been kept on screen.');
      }
      const slot = {
        scheduledDate: definition.booking.canAttach ? definition.booking.scheduledDate || '' : bookingDate,
        scheduledTime: definition.booking.canAttach ? definition.booking.scheduledTime || '' : bookingTime,
        durationMinutes: definition.booking.canAttach ? definition.booking.durationMinutes || 60 : bookingDuration,
        timezoneOffsetMinutes: (12 - Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${definition.booking.canAttach ? definition.booking.scheduledDate || '' : bookingDate}T12:00:00Z`)))) * 60,
      };
      const updated = definition.booking.canAttach
        ? await adoptMigratedReviewBooking(definition.instance.id, undefined, definition.bookingAdoptionVersion)
        : definition.booking.canReschedule
        ? await rescheduleMigratedReview(definition.instance.id, slot, definition.booking)
        : await bookMigratedReview(definition.instance.id, slot);
      // Adoption checks the saved content under lock, so its returned version
      // is safe for the existing draft. Rescheduling does not make that check.
      // Local answers and savedAnswersRef remain untouched in both cases.
      setDefinition(current => definition.booking?.canReschedule && current ? {
        ...current, booking: updated.booking, localStatus: updated.localStatus,
        readOnly: updated.readOnly, instance: { ...current.instance, status: updated.instance.status },
      } : updated);
      setBookingOpen(false);
      onStatusChanged?.(updated.booking?.status || updated.localStatus || updated.instance.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to book this migrated review.');
    } finally {
      bookingInFlightRef.current = false;
      setSaving(false);
    }
  };

  const reopen = async () => {
    if (!definition || definition.canReopen === false || reopening || isViewingAsCoach) return;
    setReopening(true);
    setError(null);
    try {
      const updated = definition.migratedForm
        ? await reopenMigratedReview(definition.instance.id, {
          reasonCode: reopenReason, note: reopenNote, answerVersion: definition.answerVersion,
        })
        : await reopenReviewInstance(definition.instance.id, {
        reasonCode: 'correction-required',
        note: 'Reopened for correction; all required signatures must be collected again.',
      });
      setDefinition(updated);
      setShowReopenConfirmation(false);
      setReopenNote('');
      onStatusChanged?.(updated.instance.status);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'This review cannot be reopened.');
    } finally {
      setReopening(false);
    }
  };

  const generateMeetingSummary = async (transcript?: File) => {
    if (!definition || isViewingAsCoach || generatingSummary || uploadingTranscript || isSignatureStage) return;
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
    if (!definition || calculating || isViewingAsCoach) return;
    const migratedVersion = definition.answerVersion || definition.progressVersion;
    if (definition.source === 'aptem' && (progressRequestRef.current || !definition.migratedForm
      || !definition.canCalculateProgress || !migratedVersion
      || saving || checkingSession || generatingSummary || uploadingTranscript || reopening)) return;
    progressRequestRef.current = true;
    setCalculating(true);
    setError(null);
    try {
      const updated = definition.source === 'aptem'
        ? await calculateMigratedReviewProgress(definition.instance.id, migratedVersion!)
        : await calculateReviewInstanceProgress(definition.instance.id);
      // Progress writes never save answers. Keep local text and edited-field
      // tracking, while accepting the new overlay/answer version.
      if (definition.source === 'aptem') {
        setDefinition(current => current?.instance.id === updated.instance.id ? updated : current);
      } else {
        setDefinition(updated);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Progress could not be calculated.');
    } finally {
      progressRequestRef.current = false;
      setCalculating(false);
    }
  };

  const loadPreviousSession = async () => {
    if (!definition || previousSessionRequestRef.current) return;
    const controller = new AbortController();
    previousSessionRequestRef.current = controller;
    setPreviousSessionLoading(true);
    setPreviousSessionError(null);
    try {
      const previous = await fetchPreviousReviewSession(definition.instance.id, controller.signal);
      if (controller.signal.aborted || previousSessionRequestRef.current !== controller) return;
      setPreviousSession(previous);
      setPreviousSessionOpen(previous.available);
    } catch (err) {
      if (controller.signal.aborted || previousSessionRequestRef.current !== controller || isAbortError(err)) return;
      setPreviousSession(null);
      setPreviousSessionOpen(false);
      setPreviousSessionError(err instanceof Error ? err.message : 'Unable to load the previous session.');
    } finally {
      if (previousSessionRequestRef.current === controller) {
        previousSessionRequestRef.current = null;
        setPreviousSessionLoading(false);
      }
    }
  };

  const busy = saving || calculating || generatingSummary || uploadingTranscript || reopening || checkingSession;
  const pageMode = presentation === 'page';
  const headingLabel = definition ? reviewTypeLabel(definition) : '';
  const reviewName = definition
    ? `${definition.template.name}${definition.instance.occurrenceNumber == null ? '' : ` #${definition.instance.occurrenceNumber}`}`
    : '';
  // A present backend field is authoritative. Route state only labels older
  // responses that do not include identity metadata yet.
  const learnerLabel = definition?.learnerName === undefined
    ? event?.learner?.trim() || 'Learner unavailable'
    : definition.learnerName?.trim() || 'Learner unavailable';
  const programmeLabel = definition?.programme === undefined
    ? event?.programme?.trim() || 'Programme unavailable'
    : definition.programme?.trim() || 'Programme unavailable';
  const previousOccurrenceNumber = definition && typeof definition.instance.occurrenceNumber === 'number'
    ? definition.instance.occurrenceNumber - 1
    : null;
  const hasPreviousOccurrence = previousOccurrenceNumber !== null && previousOccurrenceNumber >= 1;
  const hasImportedPreviousContext = definition?.source === 'aptem'
    && (definition.migratedForm || ['aptem_mcm', 'aptem_progress_review'].includes(definition.template.reviewTypeCode || ''));

  if (expandedSummaryFieldId && meetingSummaryField) {
    return (
      <ModalShell busy={busy} onClose={closeExpandedSummary}>
        <ExpandedMeetingSummaryEditor
          reviewLabel={headingLabel}
          maxLength={meetingSummaryField.configuration?.migrated === true ? 4000 : undefined}
          value={answers[expandedSummaryFieldId]}
          onChange={(value) => handleAnswerChange(expandedSummaryFieldId, value)}
          readOnly={formReadOnly || (checkingSession && !generatingMigratedSummary)}
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
                {definition ? (definition.source === 'aptem' && definition.instance.occurrenceNumber == null ? reviewName : `${headingLabel} #${definition.instance.occurrenceNumber}`) : 'Loading review...'}
              </h1>
              <p className="mt-1 text-[13px] text-white/60">{isViewingAsCoach
                ? 'Admin view-as mode is read-only.'
                : initializationFailed
                ? 'The review form could not be opened. Use Retry below.'
                : canInitializeMigrated
                ? 'Open the approved form to begin this review.'
                : definition?.migratedForm
                ? 'Work through the review form and save your answers.'
                : independentBooking
                ? 'Manage the meeting booking and read the saved review summary.'
                : isSummaryOnly
                ? 'Read the saved review summary.'
                : 'Work through each Curriculum-defined step, then save or complete the review.'}</p>
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
          title={definition ? `${learnerLabel} · ${reviewName}` : 'Loading review...'}
          subtitle={isViewingAsCoach
            ? 'Admin view-as mode is read-only.'
            : initializationFailed
            ? 'The review form could not be opened. Use Retry below.'
            : definition?.migratedForm || canInitializeMigrated
            ? 'Work through the review form and save your answers.'
            : independentBooking
            ? 'Manage the meeting booking and read the saved review summary.'
            : 'Complete the Curriculum-defined review before closing it.'}
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
            {definition.source === 'aptem' && (definition.previewOnly || definition.migratedPreviewError
              || definition.noApprovedMigratedTemplate || isViewingAsCoach || initializationFailed
              || canInitializeMigrated || isSummaryOnly) ? (
              <section className="rounded-2xl border border-primary-200 bg-primary-50 p-4" aria-label="Review information">
                <p className="text-sm font-bold text-primary-950">Review information</p>
                <p className="mt-1 text-xs leading-5 text-primary-900">{definition.previewOnly
                  ? 'Read-only preview of the approved review form.'
                  : definition.migratedPreviewError
                  ? 'The approved review form could not be previewed.'
                  : definition.noApprovedMigratedTemplate
                  ? 'No approved review form is configured for this programme and review type.'
                  : isViewingAsCoach
                  ? 'This review is read-only in admin view-as mode.'
                  : initializationFailed
                  ? 'The approved review form could not be loaded. Retry to open it.'
                  : canInitializeMigrated
                  ? 'An approved form is available to begin this review.'
                  : 'This review has a summary only; no section details are available.'}</p>
              </section>
            ) : definition.source !== 'aptem' && isSignatureStage && !isViewingAsCoach && !definition.migratedForm ? (
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
            {isViewingAsCoach ? (
              <section role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {definition.previewOnly
                  ? 'Read-only preview. The approved review form is shown for reference. Sign in as the assigned coach to complete this review.'
                  : definition.migratedPreviewError
                  ? 'The approved review form could not be previewed. Ask an administrator to check the template definition.'
                  : definition.noApprovedMigratedTemplate
                  ? 'No approved review form is configured for this programme and review type.'
                  : canInitializeMigrated
                  ? 'This review has an approved form, but admin view-as mode is read-only. Open the learner as the assigned coach to begin and complete the form.'
                  : 'Admin view-as mode is read-only. Open the learner as the assigned coach to change this review.'}
              </section>
            ) : null}
            {definition.migratedForm && definition.canReopen !== false && isSignatureStage && !isViewingAsCoach && (
              <section aria-label="Reopen review" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="font-semibold text-amber-950">Correct this review</p>
                <p className="mt-1 text-sm text-amber-900">{signatureFreePersonalSupport ? 'Reopen the form to correct its answers. Previous versions are retained.' : 'Reopen the form and collect new signatures. Previous versions are retained. Recorded hours and Monthly Log signatures stay unchanged.'}</p>
                <button type="button" disabled={busy} onClick={() => setShowReopenConfirmation(true)}
                  className="mt-3 min-h-11 rounded-lg bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Reopen review</button>
              </section>
            )}
            {definition.migratedForm && (
              <MigratedReviewHistory entries={definition.reopenHistory} signatureFree={signatureFreePersonalSupport}
                onDownload={number => downloadMigratedReviewRevision(definition.instance.id, number)} />
            )}
            {initializationFailed && !isViewingAsCoach ? (
              <button type="button" onClick={() => {
                setInitializationRetry((current) => current + 1);
              }} disabled={busy}
                className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                Retry loading form
              </button>
            ) : null}
            {hasImportedBooking && definition.booking?.booked ? (
              <section aria-label="Migrated review meeting" className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm">
                <p className="font-semibold text-primary-900">Meeting booked in LMS</p>
                <p className="mt-1 text-primary-800">{definition.booking.scheduledDate} at {definition.booking.scheduledTime} · {definition.booking.durationMinutes} minutes</p>
                {definition.booking.meetingLink ? <a href={definition.booking.meetingLink} onClick={joinImportedBooking} onAuxClick={e => { if (e.button === 1) joinImportedBooking(); }} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-primary-700 underline">Join Teams</a> : null}
              </section>
            ) : null}
            {definition.migratedForm && !personalSupportForm && definition.booking?.eventKey && definition.booking.syncState === 'synced' ? (
              <MigratedMeetingIntelligence
                key={`${definition.instance.id}:${migratedIntelligenceRevision}`}
                instanceId={definition.instance.id}
                resourceContextKey={JSON.stringify([definition.booking.eventKey, definition.booking.scheduledDate, definition.booking.scheduledTime, definition.booking.durationMinutes])}
                family={definition.template.reviewTypeCode || ''}
                status={definition.localStatus || ''}
                viewAs={isViewingAsCoach}
                readOnly={templateSyncConflict}
                meetingLink={definition.booking.meetingLink}
                bound={Boolean(meetingSummaryFieldId)}
                savedBinding={definition.summaryBinding}
                checkBlocked={hasUnsavedMigratedAnswers || busy || templateSyncConflict}
                onCheckComplete={onMigratedCheckComplete}
                onCheckingChange={setCheckingSession}
              />
            ) : null}
            {definition.migratedForm && definition.booking?.canAttach && !formReadOnly ? (
              <button type="button" onClick={() => { void bookMigrated(); }} disabled={busy} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Retry linking meeting</button>
            ) : null}
            {hasImportedBooking && definition.booking?.conflict ? (
              <p role="alert" className="text-sm text-red-700">This review has a conflicting calendar association. Ask an administrator to resolve it before booking.</p>
            ) : null}
            {hasImportedBooking && (definition.booking?.canBook || definition.booking?.canReschedule) && !bookingReadOnly ? (
              <section aria-label={definition.booking.canReschedule ? 'Reschedule migrated review meeting' : 'Book migrated review meeting'} className="rounded-xl border border-primary-200 bg-white p-4">
                {!bookingOpen ? <button type="button" onClick={() => { setBookingDate(initialReviewBookingDate(definition, definition.template.reviewTypeCode === 'aptem_mcm' || definition.template.name.toLowerCase().includes('monthly coaching'))); setBookingTime(definition.booking?.scheduledTime || ''); setBookingDuration(initialReviewBookingDuration(definition)); setBookingOpen(true); }} disabled={busy} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{definition.booking.canReschedule ? 'Reschedule' : 'Book Meeting'}</button> : (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs font-semibold">Date<input aria-label="Meeting date" type="date" required value={bookingDate} onChange={(event) => { setBookingDate(event.target.value); setBookingTime(''); }} className="mt-1 block rounded-lg border px-3 py-2" /></label>
                    <label className="text-xs font-semibold">Time · UK time (Europe/London)<select aria-label="Meeting time" required value={bookingTime} disabled={bookingAvailabilityLoading || Boolean(bookingAvailabilityError) || !bookingTimes.length} onChange={(event) => setBookingTime(event.target.value)} className="mt-1 block rounded-lg border px-3 py-2">
                      <option value="">{bookingAvailabilityLoading ? 'Checking availability…' : 'Select an available time'}</option>
                      {bookingTimes.map(value => <option key={value} value={value}>{value}</option>)}
                    </select></label>
                    <label className="text-xs font-semibold">Minutes<input aria-label="Meeting duration" type="number" min={15} max={480} value={bookingDuration} onChange={(event) => { setBookingDuration(Number(event.target.value)); setBookingTime(''); }} className="mt-1 block w-24 rounded-lg border px-3 py-2" /></label>
                    <button type="button" onClick={() => { void bookMigrated(); }} disabled={busy || !bookingDate || !bookingTime || bookingDuration < 15 || bookingDuration > 480 || bookingAvailabilityLoading || Boolean(bookingAvailabilityError) || !bookingTimes.includes(bookingTime)} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving...' : definition.booking.canReschedule ? 'Save new time' : 'Confirm booking'}</button>
                    {bookingAvailabilityLoading && <p role="status" className="w-full text-sm text-foreground-600">Checking coach working hours and calendar…</p>}
                    {bookingAvailabilityError && <p role="alert" className="w-full text-sm text-red-700">{bookingAvailabilityError} <button type="button" onClick={() => setBookingAvailabilityRetry(value => value + 1)} className="font-semibold underline">Retry</button></p>}
                    {!bookingAvailabilityLoading && !bookingAvailabilityError && !bookingTimes.length && <p role="status" className="w-full text-sm text-foreground-600">{bookingDate ? 'No available times fit this duration. Choose another date or duration.' : 'No permitted date is available in the supported booking calendar. Choose a supported date or contact your programme team.'}</p>}
                    <button type="button" onClick={() => setBookingOpen(false)} disabled={busy} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
                  </div>
                )}
              </section>
            ) : null}
            {definition.migratedForm && !personalSupportForm && definition.localStatus === 'scheduled' && definition.booking?.booked && !formReadOnly ? (
              <button type="button" onClick={() => { void startMigrated(); }} disabled={busy}
                className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                Start migrated review (optional)
              </button>
            ) : null}
            {personalSupportForm && !formReadOnly ? (
              <p className="text-sm text-primary-800">{signatureFreePersonalSupport ? 'Save your answers to complete this Personal Support Plan once all required questions are answered.' : 'Save all required answers to send this Personal Support Plan for the selected signatures.'}</p>
            ) : null}
            {definition.migratedForm && !personalSupportForm && definition.localStatus === 'not-scheduled' && !isViewingAsCoach ? (
              <p className="text-sm text-amber-800">This form can be saved as a draft. Starting the review requires a scheduled state.</p>
            ) : null}
            {definition.migratedForm && definition.fieldWarnings?.length ? (
              <p role="status" className="text-sm text-amber-800">
                {definition.fieldWarnings.length} field type(s) are unverified and use text entry.
              </p>
            ) : null}
            {showReopenConfirmation && !isViewingAsCoach ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/50 p-4" role="presentation">
                <div role="dialog" aria-modal="true" aria-labelledby="reopen-confirmation-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      if (!reopening) setShowReopenConfirmation(false);
                    }
                    if (event.key !== 'Tab') return;
                    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
                    const first = controls[0];
                    const last = controls[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) {
                      event.preventDefault(); last?.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                      event.preventDefault(); first?.focus();
                    }
                  }}>
                  <div className="flex items-start gap-3">
                    <AppIcon className="ri-error-warning-line mt-0.5 text-xl text-amber-600" />
                    <div>
                      <h2 id="reopen-confirmation-title" className="text-base font-bold text-foreground-900">{definition.migratedForm && definition.instance.status !== 'completed' ? 'Reopen this Review for corrections?' : 'Edit this completed Review?'}</h2>
                      <p className="mt-2 text-sm leading-6 text-foreground-600">{signatureFreePersonalSupport ? 'The completed version is retained in the review history. Save the corrected answers to complete the Personal Support Plan again.' : personalSupportForm ? 'Reopening retains the previous version and clears the current signatures. Save the corrected answers, then collect the selected signatures again.' : 'Reopening will clear the current signatures after recording an audit snapshot. Everyone must sign this Review again before it can be completed.'}</p>
                      {definition.migratedForm && !personalSupportForm && <p className="mt-2 text-sm text-foreground-600">The old signed PDF is retained. Recorded hours and Monthly Log signatures will not change.</p>}
                    </div>
                  </div>
                  {definition.migratedForm && <div className="mt-4 space-y-3">
                    <label className="block text-sm font-semibold">Reason
                      <select autoFocus value={reopenReason} onChange={event => setReopenReason(event.target.value as ReviewReopenReasonCode)}
                        disabled={reopening} className="mt-1 block min-h-11 w-full rounded-lg border border-background-300 bg-white p-2">
                        <option value="correction-required">Correction required</option>
                        <option value="incorrect-answer">Incorrect answer</option>
                        {!signatureFreePersonalSupport && <option value="signature-error">Signature error</option>}
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="block text-sm font-semibold">Correction details {reopenReason === 'other' ? '(required)' : '(optional)'}
                      <textarea value={reopenNote} onChange={event => setReopenNote(event.target.value)} maxLength={2000}
                        disabled={reopening} rows={3} className="mt-1 block w-full rounded-lg border border-background-300 p-2" />
                    </label>
                  </div>}
                  {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={() => setShowReopenConfirmation(false)} disabled={reopening} className="h-10 rounded-lg border border-background-300 bg-white px-4 text-xs font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-60">Cancel</button>
                    <button type="button" onClick={() => { void reopen(); }} disabled={reopening || (definition.migratedForm && reopenReason === 'other' && !reopenNote.trim())} className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"><AppIcon className={reopening ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} />{reopening ? 'Reopening...' : 'OK'}</button>
                  </div>
                </div>
              </div>
            ) : null}
            {templateSyncConflict ? (
              <section role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {definition.templateSync?.message || 'This review template has changed and cannot be safely synchronized. Your saved answers are unchanged. Ask a template administrator to correct it, then reopen this review.'}
              </section>
            ) : null}
            <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/80 px-4 py-3 text-[13px] leading-5 text-primary-800 shadow-sm">
              <AppIcon className="ri-information-line mt-0.5 shrink-0 text-primary-600"></AppIcon>
              <span>{isViewingAsCoach
                ? 'You can read this review in admin view-as mode. Changes must be made from the assigned Coach account.'
                : initializationFailed
                ? 'The review form could not be opened. Retry to load it. Saved information is unchanged.'
                : personalSupportForm
                ? isImportedReadOnly
                  ? definition.instance.status === 'awaiting-signature' ? 'Submitted answers are locked while the selected parties sign this Personal Support Plan.' : 'This completed Personal Support Plan is read-only.'
                  : signatureFreePersonalSupport ? 'Save your answers. The plan completes when all required questions are answered.' : 'Save all required answers to send this Personal Support Plan for the selected signatures.'
                : canInitializeMigrated
                ? 'An approved form is available to start this review. Its questions can update until you submit it for signatures.'
                : isSummaryOnly
                ? 'The saved summary remains available for reference, but there is no form to edit or complete.'
                : templateSyncConflict
                ? 'Saved answers remain available for reference while the template conflict is resolved.'
                : isImportedReadOnly
                ? definition.migratedForm
                  ? definition.instance.status === 'completed' ? 'This completed review is read-only. Its saved answers and signatures are shown below.' : 'Submitted answers are locked while the required parties sign this review.'
                  : 'These historical review answers are read-only and cannot be changed here.'
                : definition.migratedForm ? 'Save your answers as a draft, then submit the review when it is ready for signatures.'
                : `These answers are saved to this ${definition.template.name} and follow the sections/questions configured in Curriculum.`}</span>
            </div>

            {hasImportedBooking || definition.previewOnly || canInitializeMigrated ? (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-foreground-600">
                <span>Review status: <strong>{displayedReviewStatus ? displayedReviewStatus.replaceAll('-', ' ') : 'Not started'}</strong></span>
              </div>
            ) : null}

            <div className="grid gap-3 rounded-2xl border border-background-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Learner', learnerLabel],
                ['Programme', programmeLabel],
                ['Review', reviewName],
                ['Target date', formatDateLabel(definition.instance.targetDate)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[#f7f5fc] px-4 py-3.5 ring-1 ring-inset ring-primary-100/70">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-400">{label}</p>
                  <p className="mt-1.5 truncate text-[13px] font-bold text-foreground-900" title={value}>{value}</p>
                </div>
              ))}
            </div>

            {hasPreviousOccurrence || hasImportedPreviousContext ? (
              <section aria-label="Previous session context" className="rounded-2xl border border-primary-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600">Previous session context</p>
                    <h2 className="mt-1 text-sm font-bold text-foreground-900">
                      {hasPreviousOccurrence ? `${headingLabel} #${previousOccurrenceNumber}` : 'Previous meeting'}
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
                        {previousSession.review?.name || headingLabel}
                        {previousSession.instance?.occurrenceNumber != null ? ` #${previousSession.instance.occurrenceNumber}` : ''}
                      </span>
                      {previousSession.instance?.targetDate ? <span>{formatDateLabel(previousSession.instance.targetDate)}</span> : null}
                      {previousSession.instance?.status ? <span className="capitalize">{previousSession.instance.status.replaceAll('-', ' ')}</span> : null}
                      {hasImportedPreviousContext && previousSession.instance?.id ? (
                        <Link
                          to={`/coach/review-instances/${encodeURIComponent(previousSession.instance.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-primary-700 underline underline-offset-2"
                        >
                          Open previous review in a new tab
                        </Link>
                      ) : null}
                    </div>

                    {previousSession.summaryText ? (
                      <div className="rounded-xl border border-primary-100 bg-primary-50/70 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary-700">Saved summary</p>
                        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-foreground-700">{previousSession.summaryText}</p>
                      </div>
                    ) : (
                      <p className="text-[12px] text-foreground-600">No saved meeting summary is available for this session.</p>
                    )}

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

            {definition.instance.status === 'scheduled' && !definition.migratedForm ? (
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
            {['progress_review', 'aptem_progress_review'].includes(definition.template.reviewTypeCode || '')
              && !(definition.source === 'aptem' && definition.readOnly && !definition.migratedForm
                && (definition.instance.status === 'completed' || definition.sections.some(section => section.historicalPresentation))
                && !definition.progressSnapshot && hasImportedProgress(definition.sections)) ? (
              <ReviewProgressPanel
                snapshot={definition.progressSnapshot}
                ragHistory={definition.ragHistory}
                showCalculateAction={showMigratedCoachActions ? true : undefined}
                canCalculate={!isViewingAsCoach && !isSignatureStage && (definition.source !== 'aptem'
                  || Boolean(definition.migratedForm && definition.canCalculateProgress
                    && (definition.answerVersion || definition.progressVersion)))}
                calculating={calculating}
                disabled={Boolean(definition.migratedForm && busy)}
                onCalculate={() => { void calculateProgress(); }}
              />
            ) : null}

            <ReviewFormRenderer
              sections={definition.source === 'aptem' && !definition.migratedForm && definition.progressSnapshot
                ? definition.sections.filter((section) => section.title.trim().toLocaleLowerCase() !== 'learning progress')
                : definition.sections}
              answers={answers}
              onAnswerChange={handleAnswerChange}
              errors={showErrors ? { missingFieldIds } : undefined}
              readOnly={formReadOnly || (checkingSession && !generatingMigratedSummary)}
              renderSectionContent={definition.source === 'aptem'
                ? (section, renderFields) => renderImportedSection(section, answers, renderFields, (field) => (
                  // Retain editable inputs, local continuation/preview controls,
                  // accessible table headers, and the existing summary actions.
                  field.configuration?.semanticKey === 'meeting_summary'
                  || (field.fieldType !== 'title_description' && !formReadOnly)
                  || field.configuration?.imported !== true
                  || Boolean(field.configuration?.importedTable)
                )) : undefined}
              openSectionId={openSectionId}
              onOpenSectionChange={setOpenSectionId}
              renderFieldAddon={(field) => field.configuration?.semanticKey === 'meeting_summary' ? (
                definition.migratedForm || isMigratedTemplatePreview ? (migratedSummaryBinding?.fieldKey === field.id ? <MigratedSummaryActions
                  instanceId={definition.instance.id} binding={migratedSummaryBinding}
                  editable={!isMigratedTemplatePreview && !formReadOnly && ['scheduled', 'in-progress'].includes(definition.instance.status)}
                  showActions={showMigratedSummaryActions ? true : undefined}
                  teamsAvailable={Boolean(definition.booking?.booked && definition.booking.syncState === 'synced'
                    && !definition.booking.conflict && definition.booking.eventKey)}
                  busy={busy} unsaved={hasUnsavedMigratedAnswers} onResult={onMigratedSummaryComplete}
                  onBusyChange={setCheckingSession} onGenerationBusyChange={setGeneratingMigratedSummary}
                  onApplySuggestion={(text) => handleAnswerChange(field.id, text)}
                /> : null) :
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
                    {pendingSummaryReplacement && !formReadOnly ? (
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
              renderFieldInput={(field, context) => field.configuration?.semanticKey === 'meeting_summary' && (
                definition.source !== 'aptem' || definition.migratedForm || isMigratedTemplatePreview
              ) ? (
                <MeetingSummaryInlineEditor
                  fieldId={field.id}
                  label={definition.source === 'aptem' ? field.title : 'Meeting Summary'}
                  maxLength={field.configuration?.migrated === true ? 4000 : undefined}
                  value={context.value}
                  onChange={(value) => context.onChange(value)}
                  readOnly={context.readOnly}
                  invalid={context.invalid}
                  busy={busy}
                  draftSaved={summaryDraftSaved}
                  onExpand={() => setExpandedSummaryFieldId(field.id)}
                  expandButtonRef={expandSummaryButtonRef}
                />
              ) : definition.source === 'aptem' && field.configuration?.imported === true && context.readOnly
                ? <ImportedValue value={context.value} label={field.title} fieldType={field.fieldType} />
                : undefined}
              variant={pageMode ? 'steps' : 'accordion'}
            />
            {advisorSignaturePending && !isViewingAsCoach ? (
              <section aria-label="Review signature step" tabIndex={-1} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <h3 className="mb-3 text-sm font-bold text-violet-950">Coach signature required</h3>
                {auth.user?.fullName ? (
                  <fieldset disabled={saving} className="min-w-0 border-0 p-0">
                    <SignaturePad
                      signatoryName={auth.user.fullName}
                      onCommit={(signature) => {
                        if (signatureSaveInFlightRef.current || isViewingAsCoach) return;
                        signatureSaveInFlightRef.current = true;
                        setSaving(true);
                        setError(null);
                        return (definition.migratedForm
                          ? signMigratedReviewAsCoach(definition.instance.id, signature, definition.reviewRevision)
                          : signReviewInstance(definition.instance.id, 'advisor', auth.user?.fullName || 'Coach', signature))
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
                Coach signature saved.
              </div>
            ) : null}
            {waitingForOtherSignatures ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm font-semibold text-violet-900">
                Your part is complete. The review is waiting for the remaining required signatures.
              </div>
            ) : null}
            {definition.instance.status === 'completed' ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Review completed{definition.migratedForm && definition.instance.completedAt
                  ? ` on ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(definition.instance.completedAt))} (Europe/London)`
                  : ''}
              </div>
            ) : null}
            {/* The signed-PDF export and the full signature summary (coach +
                learner + any other configured party) belong to the Review
                Types that have a signed export -- identified by the Review
                Type's stable code, never by name/title -- and reuse the exact
                same components/API the learner side already uses, reading the
                same signatures/pdf-availability this same fetch already
                returned. */}
            {(definition.migratedForm && isSignatureStage) || (!definition.migratedForm && (isHistoricalPdfAvailable || (EXPORTABLE_REVIEW_TYPES.includes(definition.template.reviewTypeCode || '') && isSignatureStage))) ? (
              <>
                {!signatureFreePersonalSupport && (definition.migratedForm || !isHistoricalPdfAvailable) && <ReviewSignatures signatures={definition.signatures} />}
                {definition.migratedForm && definition.localStatus === 'awaiting-signature' && allRequiredSignaturesSaved && !isViewingAsCoach ? (
                  <button type="button" onClick={() => { void finalizeMigrated(); }} disabled={busy} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Complete review</button>
                ) : null}
                {(definition.source !== 'aptem' || definition.instance.status === 'completed') && <ReviewPdfDownload
                  label={personalSupportForm ? 'Download PDF' : undefined}
                  availability={definition.migratedForm
                    ? { available: definition.instance.status === 'completed', reason: 'Available after completion.' }
                    : definition.pdf}
                  onDownload={() => downloadReviewInstancePdf(definition.instance.id)}
                />}
              </>
            ) : null}
          </>
        ) : null}

        {error && !showReopenConfirmation ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{error}
          </div>
        ) : null}
      </div>

      <footer className={pageMode ? 'sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-3 rounded-b-3xl border-t border-background-200 bg-white/95 px-5 py-4 shadow-[0_-8px_24px_rgba(31,24,51,0.08)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-8' : 'flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7'}>
        <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">{pageMode ? 'Back' : 'Cancel'}</button>
        {!formReadOnly ? <div className="flex gap-2">
          <button type="button" onClick={saveDraft} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-background-300 bg-white px-5 text-xs font-bold text-foreground-700 shadow-sm transition hover:bg-background-100 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon>{personalSupportForm ? missingFieldIds.size ? 'Save draft' : signatureFreePersonalSupport ? 'Save & complete' : 'Save & send for signatures' : 'Save draft'}
          </button>
          {!personalSupportForm && (!definition?.migratedForm || definition.localStatus === 'scheduled' || definition.localStatus === 'in-progress') ? <button type="button" onClick={complete} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
            {saving ? 'Saving...' : definition?.migratedForm ? 'Submit Review' : requiredSignatures.length ? 'Send for signatures' : 'Complete review'}
          </button> : null}
        </div> : null}
      </footer>
    </>
  );

  if (pageMode) {
    return <div className="mx-auto w-full max-w-[1500px] overflow-hidden rounded-3xl border border-background-200 bg-white shadow-[0_18px_50px_rgba(44,24,78,0.08)]">{content}</div>;
  }

  return <ModalShell busy={busy} onClose={onClose}>{content}</ModalShell>;
}
