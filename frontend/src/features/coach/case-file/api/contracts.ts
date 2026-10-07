import type { LearnerMetrics } from '@/api/learnerMetrics';
import type { LearnerAttendance } from '@/api/learnerAttendance';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import type { LearnerKind } from '@/api/learnerDetail';

export type CaseFileProfile = {
  learner: {
    id: string;
    name: string | null;
    email: string | null;
    programme: string | null;
    group: string | null;
    employer: string | null;
    status: string | null;
    startDate: string | null;
    plannedEndDate: string | null;
    enrolmentId: string | null;
    aptemId: string | null;
    learnerType: LearnerKind;
  };
};

export type CaseFileHeaderSummary = {
  metrics: LearnerMetrics | null;
  attendance: LearnerAttendance | null;
  nextSession: CoachCalendarEvent | null;
  reviews: CoachCalendarEvent[] | null;
  errors: Partial<Record<'metrics' | 'attendance' | 'nextSession' | 'reviews', string>>;
};
