import { useEffect, useId, useRef, useState } from 'react';
import { fetchMigratedReviewIntelligence, uploadMigratedSummaryTranscript } from '@/api/reviewInstances';
import type { CoachMeetingArtifactsResponse, MigratedSummaryBinding } from './calendarEvents';

function bindingRevision(instanceId: string, binding: MigratedSummaryBinding) {
  return JSON.stringify([instanceId, binding.fieldKey, binding.generationStatus, binding.generationAttemptedAt,
    binding.generatedAt, binding.generationError?.requestId]);
}

export function MigratedSummaryActions({ instanceId, binding, editable, showActions = editable, teamsAvailable, busy, unsaved,
  onResult, onBusyChange }: {
  instanceId: string;
  binding: MigratedSummaryBinding;
  editable: boolean;
  showActions?: boolean;
  teamsAvailable: boolean;
  busy: boolean;
  unsaved: boolean;
  onResult: (result: CoachMeetingArtifactsResponse) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const actionHelpId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [action, setAction] = useState<'teams' | 'upload' | null>(null);
  const [error, setError] = useState('');
  const completedRevision = useRef<string | undefined>(undefined);
  const currentRevision = bindingRevision(instanceId, binding);
  // A successful Check Session can update this field from another control.
  // Keep transport/validation errors local to their attempt, not to the mounted form.
  useEffect(() => {
    // Applying this action's own response must keep its precise transport error.
    if (completedRevision.current !== currentRevision) setError('');
  }, [currentRevision]);
  const failureMessage = (value?: MigratedSummaryBinding['generationError']) => value
    ? `${value.message} Your saved answer is unchanged. Reference: ${value.requestId}`
    : 'The transcript was processed, but the AI summary could not be generated. You can enter the answer manually.';
  const disabled = !editable || busy || unsaved || !!action;
  const generate = async (file?: File) => {
    if (!editable || disabled || running.current || (!file && !teamsAvailable)) return;
    setError('');
    if (file && (!/\.(vtt|txt)$/i.test(file.name) || file.size === 0 || file.size > 5 * 1024 * 1024)) {
      setError('Select a non-empty .vtt or .txt transcript no larger than 5 MB.');
      return;
    }
    running.current = true;
    setAction(file ? 'upload' : 'teams');
    onBusyChange(true);
    try {
      // The field button and Check Session share the dedicated migrated route.
      const result = file ? await uploadMigratedSummaryTranscript(instanceId, file)
        : await fetchMigratedReviewIntelligence(instanceId, undefined, { refresh: true, generateSummary: true });
      completedRevision.current = result.summaryBinding ? bindingRevision(instanceId, result.summaryBinding) : undefined;
      onResult(result);
      if ((result.summaryBinding?.generationStatus ?? result.intelligence?.summaryStatus) === 'failed') {
        setError(failureMessage(result.summaryBinding?.generationError ?? result.intelligence?.generationError ?? undefined));
      } else if (result.intelligence?.transcriptStatus === 'available'
        && (result.intelligence.summaryStatus === 'pending' || result.summaryBinding?.status === 'summary-pending')) {
        setError('The saved Teams transcript is available, but the summary was not generated. Retry Generate from Teams or enter the answer manually.');
      } else if (result.intelligence?.transcriptStatus === 'available'
        && result.summaryBinding?.generationStatus === 'unavailable') {
        setError(result.summaryBinding.message
          || 'A saved Teams transcript is available, but it could not be used for this summary. Check Session for details; your answer is unchanged.');
      } else if (result.summaryBinding?.generationStatus === 'unavailable' || result.summaryBinding?.status === 'summary-unavailable') {
        setError(result.intelligence?.errorCodes?.includes('TRANSCRIPT_INCOMPLETE')
          ? 'The complete Teams transcript is not available yet. Retry Check Session or upload the complete transcript. Your saved answer is unchanged.'
          : result.intelligence?.errorCodes?.includes('TRANSCRIPT_FETCH_FAILED')
            ? 'The Teams transcript could not be fetched. Retry, or upload the correct transcript. Your saved answer is unchanged.'
            : 'No transcript was found for this meeting. Upload a transcript or enter the answer manually.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The transcript could not be processed. You can enter the answer manually.');
    } finally {
      running.current = false;
      setAction(null);
      onBusyChange(false);
    }
  };
  const message = binding.generationStatus === 'failed'
    ? failureMessage(binding.generationError)
    : binding.status === 'summary-pending'
      ? 'The saved Teams transcript is available. Use Generate from Teams to create an editable summary.'
      : binding.generationStatus === 'unavailable'
      ? binding.message || 'No transcript is available for summary generation. Check Session for details, upload a transcript, or enter the answer manually.'
      : binding.status === 'summary-too-long'
        ? 'AI summary is longer than this field allows. Review and shorten it before saving.'
        : binding.status === 'populated'
          ? 'AI summary added to the form. Review and edit it before submission.'
          : binding.replacementAvailable
            ? 'AI summary generated. Your existing answer was preserved.'
            : binding.state === 'COACH_CLEARED' ? 'Your cleared Meeting Summary answer has been kept.'
              : binding.state === 'COACH_EDITED' || binding.state === 'AI_POPULATED_UNEDITED'
                ? 'Your existing Meeting Summary answer has been kept.' : '';
  return <div className="mb-3 space-y-2 rounded-lg border border-primary-100 bg-primary-50 p-3">
    <span className="text-xs font-bold text-primary-900">AI Meeting Summary</span>
    <p className="text-xs text-foreground-600">Generate from the linked Teams transcript or upload a .vtt or .txt transcript. You can also type your answer. The saved form answer is used in the completed review and PDF.</p>
    {showActions && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !teamsAvailable} onClick={() => void generate()}
          aria-describedby={!editable ? actionHelpId : undefined}
          className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          {action === 'teams' ? 'Generating summary...' : 'Generate from Teams'}
        </button>
        <button type="button" disabled={disabled} onClick={() => { if (!disabled) fileInput.current?.click(); }}
          aria-describedby={!editable ? actionHelpId : undefined}
          className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-xs font-bold text-primary-700 disabled:opacity-50">
          {action === 'upload' ? 'Uploading transcript and generating summary...' : 'Upload Transcript'}
        </button>
        {editable && <input ref={fileInput} type="file" accept=".vtt,.txt,text/vtt,text/plain" className="sr-only"
          aria-label="Select migrated review transcript" disabled={disabled}
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void generate(file);
          }} />}
      </div>
      {!editable && <p id={actionHelpId} className="text-xs text-foreground-600">Available to the assigned Coach only.</p>}
      {editable && !teamsAvailable && <p className="text-xs text-foreground-600">No synced Teams meeting is associated. You can upload a transcript instead.</p>}
      {editable && unsaved && <p className="text-xs text-foreground-600">Save your draft before generating a summary so your edits are preserved.</p>}
    </>}
    {binding.suggestionSource && <p className="text-xs text-primary-800">Latest AI summary generated from {binding.suggestionSource === 'teams' ? 'Teams transcript' : 'uploaded transcript'}.</p>}
    {binding.provisional && <p role="status" className="text-xs text-amber-800">Provisional AI summary: the saved Teams transcript may be partial. Review and edit the answer before saving.</p>}
    {binding.transcriptTruncated && <p role="status" className="text-xs text-amber-800">The transcript exceeded the AI input limit. The summary covers only its initial portion; review it against the full transcript.</p>}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : message && <p
      role={binding.generationStatus === 'failed' || binding.generationStatus === 'unavailable' ? 'alert' : 'status'}
      className={binding.generationStatus === 'failed' ? 'text-xs text-red-700' : 'text-xs text-primary-800'}>{message}</p>}
    {binding.summaryTooLong && binding.status !== 'summary-too-long' && <p role="status" className="text-xs text-amber-800">AI summary is longer than this field allows. Review and shorten it before saving.</p>}
    {editable && binding.suggestionText && (binding.replacementAvailable || binding.status === 'summary-too-long') && <details className="text-xs">
      <summary className="cursor-pointer font-semibold">View latest AI suggestion</summary>
      <p className="my-2">Copy and edit the suggestion manually if you want to use it. Your saved answer has been kept.</p>
      <textarea readOnly aria-label="Latest AI suggestion" value={binding.suggestionText} className="min-h-40 w-full rounded border bg-white p-2" />
    </details>}
  </div>;
}
