import { useRef, useState } from 'react';
import { fetchMigratedReviewIntelligence, uploadMigratedSummaryTranscript } from '@/api/reviewInstances';
import type { CoachMeetingArtifactsResponse, MigratedSummaryBinding } from './calendarEvents';

export function MigratedSummaryActions({ instanceId, binding, editable, teamsAvailable, busy, unsaved,
  onResult, onBusyChange }: {
  instanceId: string;
  binding: MigratedSummaryBinding;
  editable: boolean;
  teamsAvailable: boolean;
  busy: boolean;
  unsaved: boolean;
  onResult: (result: CoachMeetingArtifactsResponse) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [action, setAction] = useState<'teams' | 'upload' | null>(null);
  const [error, setError] = useState('');
  const disabled = busy || unsaved || !!action;
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
        : await fetchMigratedReviewIntelligence(instanceId, undefined, { refresh: true });
      onResult(result);
      if (result.summaryBinding?.generationStatus === 'failed' || result.intelligence?.summaryStatus === 'failed') {
        setError('The transcript was processed, but the AI summary could not be generated. You can enter the answer manually.');
      } else if (result.summaryBinding?.generationStatus === 'unavailable' || result.summaryBinding?.status === 'summary-unavailable') {
        setError('No transcript was found for this meeting. Upload a transcript or enter the answer manually.');
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
    ? 'The transcript was processed, but the AI summary could not be generated. You can enter the answer manually.'
    : binding.generationStatus === 'unavailable'
      ? 'No transcript was found for this meeting. Upload a transcript or enter the answer manually.'
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
    {editable && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !teamsAvailable} onClick={() => void generate()}
          className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          {action === 'teams' ? 'Generating summary...' : 'Generate from Teams'}
        </button>
        <button type="button" disabled={disabled} onClick={() => fileInput.current?.click()}
          className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-xs font-bold text-primary-700 disabled:opacity-50">
          {action === 'upload' ? 'Uploading transcript and generating summary...' : 'Upload Transcript'}
        </button>
        <input ref={fileInput} type="file" accept=".vtt,.txt,text/vtt,text/plain" className="sr-only"
          aria-label="Select migrated review transcript" disabled={disabled}
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void generate(file);
          }} />
      </div>
      {!teamsAvailable && <p className="text-xs text-foreground-600">No synced Teams meeting is associated. You can upload a transcript instead.</p>}
      {unsaved && <p className="text-xs text-foreground-600">Save your draft before generating a summary so your edits are preserved.</p>}
    </>}
    {binding.suggestionSource && <p className="text-xs text-primary-800">Latest AI summary generated from {binding.suggestionSource === 'teams' ? 'Teams transcript' : 'uploaded transcript'}.</p>}
    {binding.transcriptTruncated && <p role="status" className="text-xs text-amber-800">The transcript exceeded the AI input limit. The summary covers only its initial portion; review it against the full transcript.</p>}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : message && <p role="status" className="text-xs text-primary-800">{message}</p>}
    {binding.summaryTooLong && binding.status !== 'summary-too-long' && <p role="status" className="text-xs text-amber-800">AI summary is longer than this field allows. Review and shorten it before saving.</p>}
    {editable && binding.suggestionText && (binding.replacementAvailable || binding.status === 'summary-too-long') && <details className="text-xs">
      <summary className="cursor-pointer font-semibold">View latest AI suggestion</summary>
      <p className="my-2">Copy and edit the suggestion manually if you want to use it. Your saved answer has been kept.</p>
      <textarea readOnly aria-label="Latest AI suggestion" value={binding.suggestionText} className="min-h-40 w-full rounded border bg-white p-2" />
    </details>}
  </div>;
}
