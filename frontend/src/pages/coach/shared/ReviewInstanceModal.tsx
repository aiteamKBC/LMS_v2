import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ReviewFormRenderer, computeMissingRequiredFields, computeVisibleRequiredFields } from '@/components/reviews/ReviewFormRenderer';
import {
  completeReviewInstance,
  fetchReviewInstanceForm,
  flattenReviewFields,
  markReviewInstanceInProgressManually,
  saveReviewInstanceAnswers,
  signReviewInstance,
  type ManualInProgressReasonCode,
  type ReviewInstanceFormDefinition,
} from '@/api/reviewInstances';
import { ModalHeader, ModalShell } from './ModalHeader';
import { formatDateLabel } from './calendarEvents';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { useAuth } from '@/hooks/useAuth';

const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

const MANUAL_OVERRIDE_REASONS: { value: ManualInProgressReasonCode; label: string }[] = [
  { value: 'teams-link-issue', label: 'Teams link problem' },
  { value: 'graph-unavailable', label: 'Microsoft Graph unavailable' },
  { value: 'attendance-not-detected', label: "Attendance wasn't detected" },
  { value: 'meeting-held-outside-teams', label: 'Meeting held outside Teams' },
  { value: 'scheduler-delay', label: 'Sync/scheduler delay' },
  { value: 'other', label: 'Other' },
];

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
  onCompleted,
  onStatusChanged,
  showManualOverrideOnOpen = false,
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
  onCompleted: (status: string) => void;
  /** Keeps the parent calendar row in sync after a lifecycle change that
   *  does not close this modal, such as a manual scheduled -> in-progress
   *  override. */
  onStatusChanged?: (status: string) => void;
  showManualOverrideOnOpen?: boolean;
}) {
  const { auth } = useAuth();
  const [definition, setDefinition] = useState<ReviewInstanceFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [showManualOverride, setShowManualOverride] = useState(showManualOverrideOnOpen);
  const [manualReason, setManualReason] = useState<ManualInProgressReasonCode | ''>('');
  const [manualNote, setManualNote] = useState('');
  const [manualStartedAt, setManualStartedAt] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

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
  // Counted from the fields actually on screen, so a conditional question
  // hidden behind an unanswered case block is not silently counted as done.
  const requiredCount = useMemo(
    () => (definition ? computeVisibleRequiredFields(definition.sections, answers).size : 0),
    [definition, answers],
  );
  const answeredCount = requiredCount - missingFieldIds.size;

  const handleAnswerChange = (fieldId: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setShowErrors(false);
  };

  const saveDraft = async () => {
    if (!definition) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveReviewInstanceAnswers(definition.instance.id, answers);
      setDefinition(updated);
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
      await saveReviewInstanceAnswers(definition.instance.id, answers);
      const completed = await completeReviewInstance(definition.instance.id);
      onCompleted(completed.instance.status);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'This review cannot be completed yet.');
    } finally {
      setSaving(false);
    }
  };

  const confirmManualOverride = async () => {
    if (!definition || !manualReason) return;
    if (manualReason === 'other' && !manualNote.trim()) {
      setManualError('Add details when the reason is "Other".');
      return;
    }
    setManualBusy(true);
    setManualError(null);
    try {
      const updated = await markReviewInstanceInProgressManually(definition.instance.id, {
        reasonCode: manualReason,
        note: manualNote,
        startedAt: manualStartedAt ? new Date(manualStartedAt).toISOString() : undefined,
      });
      setDefinition(updated);
      onStatusChanged?.(updated.instance.status);
      setShowManualOverride(false);
      setManualReason('');
      setManualNote('');
      setManualStartedAt('');
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'This review cannot be marked in progress.');
    } finally {
      setManualBusy(false);
    }
  };

  const busy = saving || manualBusy;

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

            {definition.manualOverride ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">
                <AppIcon className="ri-flashlight-line mr-1.5"></AppIcon>
                <strong>Manually marked In Progress</strong> -- reason: {
                  MANUAL_OVERRIDE_REASONS.find((r) => r.value === definition.manualOverride?.reasonCode)?.label
                    || definition.manualOverride.reasonCode
                }
                {definition.manualOverride.note ? ` (${definition.manualOverride.note})` : ''}
                {' '}by {definition.manualOverride.changedBy}
                {definition.manualOverride.changedAt ? `, ${formatDateLabel(definition.manualOverride.changedAt)}` : ''}
                {definition.manualOverride.manualStartedAt ? ` · actual start: ${formatDateLabel(definition.manualOverride.manualStartedAt)}` : ''}
              </div>
            ) : null}

            {definition.instance.status === 'scheduled' && !showManualOverride ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-bold text-amber-900">Not yet in progress</p>
                  <p className="mt-0.5 text-[12px] text-amber-800">
                    This moves to "In Progress" automatically once Microsoft Teams confirms the coach or learner joined the meeting.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualOverride(true)}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-4 text-xs font-bold text-amber-800 shadow-sm transition hover:bg-amber-100"
                >
                  <AppIcon className="ri-flashlight-line"></AppIcon>Mark as In Progress
                </button>
              </div>
            ) : null}

            {definition.instance.status === 'scheduled' && showManualOverride ? (
              <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <div>
                  <p className="text-[13px] font-bold text-amber-900">Manually mark this review In Progress</p>
                  <p className="mt-0.5 text-[12px] text-amber-800">
                    Use this only when Microsoft Teams attendance cannot be confirmed automatically -- for example a Teams
                    link problem, a Microsoft Graph outage, or the meeting happening on another channel. This is an override,
                    not the normal path, and is recorded as a manual action.
                  </p>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-amber-900">Reason</span>
                  <select
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value as ManualInProgressReasonCode)}
                    className="h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-[13px] text-foreground-900 outline-none"
                  >
                    <option value="">Select a reason...</option>
                    {MANUAL_OVERRIDE_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>{reason.label}</option>
                    ))}
                  </select>
                </label>
                {manualReason === 'other' ? (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-amber-900">Details (required)</span>
                    <textarea
                      value={manualNote}
                      onChange={(e) => setManualNote(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-[13px] text-foreground-900 outline-none"
                      placeholder="What happened?"
                    />
                  </label>
                ) : null}
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-amber-900">Actual start time (optional)</span>
                  <input
                    type="datetime-local"
                    value={manualStartedAt}
                    onChange={(e) => setManualStartedAt(e.target.value)}
                    className="h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-[13px] text-foreground-900 outline-none sm:w-64"
                  />
                  <span className="mt-1 block text-[11px] text-amber-700">Leave blank to use the time you confirm this.</span>
                </label>
                {manualError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                    <AppIcon className="ri-error-warning-line mr-1.5"></AppIcon>{manualError}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowManualOverride(false); setManualError(null); }}
                    disabled={manualBusy}
                    className="h-9 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-amber-100 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmManualOverride}
                    disabled={manualBusy || !manualReason}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-60"
                  >
                    <AppIcon className={manualBusy ? 'ri-loader-4-line animate-spin' : 'ri-check-line'}></AppIcon>
                    Confirm
                  </button>
                </div>
              </div>
            ) : null}

            <ReviewFormRenderer
              sections={definition.sections}
              answers={answers}
              onAnswerChange={handleAnswerChange}
              errors={showErrors ? { missingFieldIds } : undefined}
              readOnly={definition.instance.status === 'completed'}
              openSectionId={openSectionId}
              onOpenSectionChange={setOpenSectionId}
            />
            {definition.signatures.advisor?.required && !definition.signatures.advisor.signed &&
              ['awaiting-signature', 'completed'].includes(definition.instance.status) ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <p className="mb-3 text-sm font-bold text-violet-950">Your coach signature is required</p>
                <SignaturePad
                  signatoryName={auth.user?.fullName || event.learner || 'Coach'}
                  onCommit={(signature) => {
                    void signReviewInstance(definition.instance.id, 'advisor', auth.user?.fullName || 'Coach', signature)
                      .then(setDefinition);
                  }}
                  onCancel={() => undefined}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{error}
          </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">Cancel</button>
        <div className="flex gap-2">
          <button type="button" onClick={saveDraft} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-background-300 bg-white px-5 text-xs font-bold text-foreground-700 shadow-sm transition hover:bg-background-100 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon>Save draft
          </button>
          <button type="button" onClick={complete} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
            {saving ? 'Saving...' : 'Complete review'}
          </button>
        </div>
      </footer>
    </ModalShell>
  );
}
