import type { CoachCalendarEvent } from '../../shared/types/meeting.types';

export interface CatchUpRequestRow {
  id: string;
  learner: string;
  lecture?: string;
  booking: CoachCalendarEvent;
}

