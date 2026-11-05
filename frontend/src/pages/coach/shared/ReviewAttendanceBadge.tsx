import { StatusBadge } from '@/components/ui/StatusBadge';
import type { CoachCalendarEvent } from './calendarEvents';

/** Attendance is a separate signal; the form keeps its original lifecycle. */
export function ReviewAttendanceBadge({ event }: { event: CoachCalendarEvent }) {
  if (!['scheduled', 'in-progress'].includes(event.status)) return null;
  switch (event.reviewAttendance) {
    case 'missed': return <div className="mt-1"><StatusBadge tone="critical" label="Learner missed" size="sm" /></div>;
    case 'pending': return <div className="mt-1"><StatusBadge tone="caution" label="Awaiting attendance report" size="sm" /></div>;
    case 'attended': return <div className="mt-1"><StatusBadge tone="positive" label="Learner attended" size="sm" /></div>;
    case 'unavailable': return <div className="mt-1"><StatusBadge tone="neutral" label="Attendance unavailable" size="sm" /></div>;
    default: return null;
  }
}
