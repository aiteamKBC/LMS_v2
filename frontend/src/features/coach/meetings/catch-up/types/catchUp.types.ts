import type { CoachCalendarEvent } from '../../shared/types/meeting.types';

export interface CatchUpRequestRow {
  id: string;
  learner: string;
  lecture?: string;
  booking: CoachCalendarEvent;
}

export interface CatchUpSchedulingCandidate {
  id: string;
  learnerId: string;
  learner: string;
  lecture: string;
  lectureDate: string;
  programme?: string;
}

