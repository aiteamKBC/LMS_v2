import type { AbsenceReport } from '@/mocks/absence-reports';
import { coachFetch } from '@/lib/coachFetch';
import { fetchCoachCalendarEvents } from '../../shared/api/meetingApi';
import type { CoachCalendarEvent } from '../../shared/types/meeting.types';
import type { CatchUpRequestRow } from '../types/catchUp.types';

const ABSENCE_REPORTS_ENDPOINT = '/coach_api/coach/absence-reports';
const BOOKED_STATUSES = new Set<CoachCalendarEvent['status']>(['scheduled', 'in-progress', 'completed']);

export async function fetchCoachCatchUpQueue(signal: AbortSignal): Promise<{ rows: CatchUpRequestRow[]; warning: string }> {
  const [calendarData, absenceResult] = await Promise.all([
    fetchCoachCalendarEvents(signal),
    coachFetch(ABSENCE_REPORTS_ENDPOINT, { signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
      return data as { items?: AbsenceReport[] };
    }).then(
      data => ({ data, warning: '' }),
      () => ({ data: { items: [] as AbsenceReport[] }, warning: 'Missed lecture details could not be loaded.' }),
    ),
  ]);
  const lectureByEventKey = new Map(
    (absenceResult.data.items || [])
      .filter(report => report.recoveryMethod === 'catch-up' && report.catchupEventKey)
      .map(report => [report.catchupEventKey as string, report.sessionTitle]),
  );
  const rows = (calendarData.events || [])
    .filter(event => event.source === 'catch-up' && BOOKED_STATUSES.has(event.status))
    .map((booking): CatchUpRequestRow => {
      const id = booking.eventKey || booking.id;
      return { id, learner: booking.learner || booking.email || 'Unknown learner', lecture: lectureByEventKey.get(id), booking };
    });
  return { rows, warning: absenceResult.warning };
}

