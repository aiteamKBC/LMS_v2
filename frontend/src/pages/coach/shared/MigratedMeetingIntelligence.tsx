import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMigratedReviewIntelligence, saveMigratedMeetingSummary } from '@/api/reviewInstances';
import type { CoachMeetingArtifactsResponse } from './calendarEvents';
import { coachMeetingArtifactContentUrl } from './calendarEvents';
import { CoachMeetingArtifactsPanel } from './CoachMeetingArtifactsPanel';
import { formatSystemTimestamp } from '@/lib/format';

const statusLabel: Record<string, string> = {
  'not-checked': 'Not checked',
  'not-available': 'Not available',
  'fetch-failed': 'Fetch failed',
  'pending': 'Pending; check again later',
  'incomplete': 'Incomplete; check again later',
  'available': 'Available',
  'unavailable': 'Unavailable',
  'unknown': 'Unknown',
  'not-generated': 'Not generated',
  'failed': 'Generation failed',
  'ready': 'AI generated',
  'edited': 'Coach edited',
};

export function MigratedMeetingIntelligence(props: Parameters<typeof MigratedMeetingIntelligenceContent>[0]) {
  // Drop saved resources and outstanding callbacks when their authority/booking
  // changes, even if the selected source Review ID stays the same.
  return <MigratedMeetingIntelligenceContent key={JSON.stringify([
    props.instanceId, props.family, props.viewAs, props.readOnly, props.meetingLink, props.resourceContextKey,
  ])} {...props} />;
}

function MigratedMeetingIntelligenceContent({
  instanceId,
  family,
  status,
  viewAs,
  readOnly = false,
  meetingLink,
  bound = false,
  checkBlocked = false,
  onCheckComplete,
  onCheckingChange,
  savedBinding,
  showBoundSummary = false,
}: {
  instanceId: string;
  family: string;
  status: string;
  viewAs: boolean;
  readOnly?: boolean;
  meetingLink?: string | null;
  bound?: boolean;
  checkBlocked?: boolean;
  onCheckComplete?: (result: CoachMeetingArtifactsResponse) => void;
  onCheckingChange?: (checking: boolean) => void;
  savedBinding?: CoachMeetingArtifactsResponse['summaryBinding'];
  showBoundSummary?: boolean;
  resourceContextKey?: string;
}) {
  const [intelligence, setIntelligence] = useState<CoachMeetingArtifactsResponse['intelligence']>();
  const [attendance, setAttendance] = useState<CoachMeetingArtifactsResponse['attendance']>();
  const [binding, setBinding] = useState<CoachMeetingArtifactsResponse['summaryBinding']>();
  const [appointment, setAppointment] = useState<CoachMeetingArtifactsResponse['event']>();
  useEffect(() => { if (savedBinding) setBinding(savedBinding); }, [savedBinding]);
  const handlers = useRef({ onCheckComplete, onCheckingChange });
  const requestGeneration = useRef(0);
  useEffect(() => {
    return () => { requestGeneration.current += 1; };
  }, [instanceId, viewAs]);
  useEffect(() => { handlers.current = { onCheckComplete, onCheckingChange }; }, [onCheckComplete, onCheckingChange]);
  const fetchArtifacts = useCallback<typeof fetchMigratedReviewIntelligence>(
    async (eventKey, signal, options) => {
      const generation = requestGeneration.current;
      if (options?.refresh) handlers.current.onCheckingChange?.(true);
      try {
        const result = await fetchMigratedReviewIntelligence(eventKey, signal, options);
        if (generation !== requestGeneration.current) throw new DOMException('Review changed', 'AbortError');
        if (options?.refresh) handlers.current.onCheckComplete?.(result);
        return result;
      } catch (error) {
        if (generation !== requestGeneration.current) throw new DOMException('Review changed', 'AbortError');
        const failure = error as { status?: number; code?: string } | null;
        if ([401, 403, 404].includes(failure?.status || 0)
            || (failure?.status === 409 && !['MEETING_END_NOT_CONFIRMED', 'SUMMARY_IN_PROGRESS', 'SUMMARY_SUPERSEDED'].includes(failure.code || ''))) {
          setIntelligence(undefined);
          setAttendance(undefined);
          setBinding(undefined);
          setAppointment(undefined);
        }
        throw error;
      } finally {
        if (options?.refresh && generation === requestGeneration.current) handlers.current.onCheckingChange?.(false);
      }
    },
    [],
  );
  const saveSummary = useCallback<typeof saveMigratedMeetingSummary>(
    async (eventKey, summary) => {
      const generation = requestGeneration.current;
      const result = await saveMigratedMeetingSummary(eventKey, summary);
      if (generation !== requestGeneration.current) throw new DOMException('Review changed', 'AbortError');
      handlers.current.onCheckComplete?.({ ...result, artifacts: [] });
      return result;
    },
    [],
  );
  const onArtifactsLoaded = useCallback((result: CoachMeetingArtifactsResponse) => {
    setIntelligence(result.intelligence);
    setAttendance(result.attendance);
    setBinding(result.summaryBinding);
    setAppointment(result.event);
  }, []);
  const mapped = bound || Boolean(binding?.fieldKey);
  const canCheck = !viewAs && !readOnly && !checkBlocked && (status === 'scheduled' || status === 'in-progress');
  const canEdit = !mapped && !viewAs && !readOnly && (status === 'scheduled' || status === 'in-progress');

  return (
    <section aria-label="Meeting Intelligence" className="space-y-3 rounded-xl border border-primary-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-bold text-foreground-900">Meeting Intelligence</h2>
        <p className="text-xs text-foreground-500">{mapped
          ? 'Check Session refreshes Teams results. Generate from Teams at the Meeting Summary question uses the same check.'
          : 'Check Session refreshes attendance, recordings, transcripts and the AI summary from Teams.'}</p>
        <p className="mt-1 text-xs text-foreground-500">Check for available Teams resources. Attendance, recordings and transcripts may become available at different times. AI generation has separate eligibility checks.</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Meeting intelligence status">
        <span>Attendance: <strong>{statusLabel[intelligence?.attendanceStatus || 'not-checked']}</strong></span>
        <span>Recording metadata: <strong>{statusLabel[intelligence?.recordingStatus || 'unknown']}</strong></span>
        <span>Transcript: <strong>{statusLabel[intelligence?.transcriptStatus || 'not-checked']}</strong></span>
        <span>AI Summary: <strong>{statusLabel[intelligence?.summaryStatus === 'pending' ? 'pending' : binding?.generationStatus || intelligence?.summaryStatus || 'not-generated']}</strong></span>
      </div>
      {appointment?.scheduledDate && appointment.scheduledTime ? (
        <p className="text-xs text-foreground-600">Planned appointment: {appointment.scheduledDate} at {appointment.scheduledTime}</p>
      ) : null}
      {intelligence?.meetingEndStatus === 'pending' && intelligence.lastCheckedAt ? (
        <p role="status" className="text-xs text-foreground-600">Teams resources were checked. Eligible resources, if available, were saved. AI summary generation remains pending until the actual call completion can be verified. The planned appointment end does not confirm that a call ended.</p>
      ) : null}
      {intelligence?.meetingEndStatus === 'scheduled-end-reached' ? (
        <p className="text-xs text-foreground-500">The planned appointment end has passed. Actual call completion still needs an associated ended attendance report before AI generation.</p>
      ) : null}
      {viewAs ? <p className="text-xs text-amber-800">Admin view-as is read-only. Session checks and summary edits are unavailable.</p> : null}
      {checkBlocked && !viewAs && !readOnly ? <p className="text-xs text-foreground-500">Save your draft and wait for any current action to finish before checking the session.</p> : null}
      {binding?.status === 'no-binding' && <p className="text-xs text-foreground-500">This review has no AI Meeting Summary question. Session checks keep intelligence separate from form answers.</p>}
      {binding?.status === 'invalid-binding' && <p role="alert" className="text-xs text-amber-800">{binding.message}</p>}
      {mapped && <div role="status" className="text-xs text-foreground-600">
        {binding?.status === 'summary-too-long'
          ? 'AI summary is longer than this field allows. Review and shorten it before saving.'
          : binding?.state === 'COACH_CLEARED'
            ? 'Your cleared Meeting Summary answer has been kept.'
            : binding?.state === 'COACH_EDITED'
              ? 'Your Meeting Summary answer has been kept.'
              : binding?.state === 'AI_POPULATED_UNEDITED'
                ? 'The AI summary is saved in the review form. Review and edit it before submission. Further checks keep this answer.'
                : 'Check Session can fill the Meeting Summary question once. You can also type the answer yourself.'}
      </div>}
      {showBoundSummary && mapped && <div className="rounded-lg bg-background-50 p-3 text-xs">
        <h3 className="font-bold">Meeting Summary</h3>
        <p className="mt-2 whitespace-pre-wrap">{typeof binding?.answer === 'string' && binding.answer
          ? binding.answer : 'No Meeting Summary answer is saved yet.'}</p>
        <p className="mt-2 text-foreground-500">Open the review form to edit this answer.</p>
      </div>}
      {!bound && binding?.status === 'summary-too-long' && binding.suggestionText && <details className="text-xs">
        <summary className="cursor-pointer font-semibold">View full AI suggestion to shorten</summary>
        <textarea aria-label="Full AI suggestion" readOnly value={binding.suggestionText} className="mt-2 min-h-48 w-full rounded border p-2" />
      </details>}
      {status === 'completed' || status === 'awaiting-signature' ? <p className="text-xs text-foreground-500">This review's meeting intelligence is read-only.</p> : null}
      {intelligence?.errorCodes?.length ? (
        <p role="status" className="text-xs text-amber-800">{intelligence.errorCodes.join(', ')}</p>
      ) : null}
      {attendance?.reports?.length ? (
        <div aria-label="Meeting Attendance" className="rounded-lg bg-background-50 p-3 text-xs">
          <h3 className="font-bold">Meeting Attendance</h3>
          {attendance.reports.map(report => {
            const start = report.meetingStartDateTime ? new Date(report.meetingStartDateTime) : null;
            const end = report.meetingEndDateTime ? new Date(report.meetingEndDateTime) : null;
            const minutes = start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
              ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : null;
            return <div key={report.id} className="mt-2">
              <p>Actual session: {report.meetingStartDateTime ? formatSystemTimestamp(report.meetingStartDateTime, { dateStyle: 'short', timeStyle: 'short' }) : 'Unknown'} to {report.meetingEndDateTime ? formatSystemTimestamp(report.meetingEndDateTime, { dateStyle: 'short', timeStyle: 'short' }) : 'Unknown'}{minutes !== null ? ` (${minutes} minutes)` : ''}; {report.totalParticipantCount} participants</p>
              {report.records.map((person, index) => <p key={`${person.id}-${index}`}>
                {person.displayName || person.email || 'Unknown participant'}{person.email ? ` (${person.email})` : ''}: {Math.round(person.totalAttendanceSeconds / 60)} minutes
                {person.intervals?.length ? `; joined ${person.intervals[0].joinDateTime ? formatSystemTimestamp(person.intervals[0].joinDateTime, { timeStyle: 'short' }) : 'unknown'}, left ${person.intervals[person.intervals.length - 1].leaveDateTime ? formatSystemTimestamp(person.intervals[person.intervals.length - 1].leaveDateTime!, { timeStyle: 'short' }) : 'unknown'}` : ''}
              </p>)}
            </div>;
          })}
        </div>
      ) : null}
      <CoachMeetingArtifactsPanel
        key={`${instanceId}:${viewAs}`}
        event={{ id: instanceId, eventKey: instanceId, source: family === 'aptem_mcm' ? 'mcr' : 'progress-review', meetingLink: meetingLink || undefined }}
        fetchArtifacts={fetchArtifacts}
        saveSummary={saveSummary}
        contentUrl={coachMeetingArtifactContentUrl}
        canCheck={canCheck}
        showCheckAction={canCheck || (viewAs && !readOnly && (status === 'scheduled' || status === 'in-progress'))}
        checkLabel="Check Session"
        canEditSummary={canEdit}
        showMeetingSummary={!mapped}
        hasTeamsMeeting
        allowContentAccess={!viewAs}
        onArtifactsLoaded={onArtifactsLoaded}
        preserveResourcesOnRefreshError
      />
    </section>
  );
}
