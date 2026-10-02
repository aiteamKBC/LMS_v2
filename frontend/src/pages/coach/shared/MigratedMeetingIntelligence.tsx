import { useCallback, useState } from 'react';
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
  'available': 'Available',
  'unavailable': 'Unavailable',
  'unknown': 'Unknown',
  'not-generated': 'Not generated',
  'failed': 'Generation failed',
  'ready': 'AI generated',
  'edited': 'Coach edited',
};

export function MigratedMeetingIntelligence({
  instanceId,
  family,
  status,
  viewAs,
  meetingLink,
}: {
  instanceId: string;
  family: string;
  status: string;
  viewAs: boolean;
  meetingLink?: string | null;
}) {
  const [intelligence, setIntelligence] = useState<CoachMeetingArtifactsResponse['intelligence']>();
  const [attendance, setAttendance] = useState<CoachMeetingArtifactsResponse['attendance']>();
  const fetchArtifacts = useCallback<typeof fetchMigratedReviewIntelligence>(
    (eventKey, signal, options) => fetchMigratedReviewIntelligence(eventKey, signal, options),
    [],
  );
  const saveSummary = useCallback<typeof saveMigratedMeetingSummary>(
    (eventKey, summary) => saveMigratedMeetingSummary(eventKey, summary),
    [],
  );
  const onArtifactsLoaded = useCallback((result: CoachMeetingArtifactsResponse) => {
    setIntelligence(result.intelligence);
    setAttendance(result.attendance);
  }, []);
  const canCheck = !viewAs && (status === 'scheduled' || status === 'in-progress');
  const canEdit = !viewAs && status === 'in-progress';

  return (
    <section aria-label="Meeting Intelligence" className="space-y-3 rounded-xl border border-primary-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-bold text-foreground-900">Meeting Intelligence</h2>
        <p className="text-xs text-foreground-500">Teams results are checked only when the coach selects Check Session.</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Meeting intelligence status">
        <span>Attendance: <strong>{statusLabel[intelligence?.attendanceStatus || 'not-checked']}</strong></span>
        <span>Recording: <strong>{statusLabel[intelligence?.recordingStatus || 'unknown']}</strong></span>
        <span>Transcript: <strong>{statusLabel[intelligence?.transcriptStatus || 'not-checked']}</strong></span>
        <span>AI Summary: <strong>{statusLabel[intelligence?.summaryStatus || 'not-generated']}</strong></span>
      </div>
      {viewAs ? <p className="text-xs text-amber-800">Admin view-as is read-only. Session checks and summary edits are unavailable.</p> : null}
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
        event={{ id: instanceId, eventKey: instanceId, source: family === 'aptem_mcm' ? 'mcr' : 'progress-review', meetingLink: meetingLink || undefined }}
        fetchArtifacts={fetchArtifacts}
        saveSummary={saveSummary}
        contentUrl={coachMeetingArtifactContentUrl}
        canCheck={canCheck}
        checkLabel="Check Session"
        canEditSummary={canEdit}
        hasTeamsMeeting
        allowContentAccess={!viewAs}
        onArtifactsLoaded={onArtifactsLoaded}
      />
    </section>
  );
}
