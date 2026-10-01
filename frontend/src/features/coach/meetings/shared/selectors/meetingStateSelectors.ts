import type { CoachCalendarEvent, CoachCalendarStatus } from '../types/meeting.types';

export type MeetingStateBucket = 'not-scheduled' | 'scheduled' | 'confirmed' | 'in-progress' | 'completed' | 'other';

/** Presentation classification only. It deliberately does not normalize or mutate server status. */
export function selectMeetingState(status: CoachCalendarStatus): MeetingStateBucket {
  if (status === 'not-scheduled' || status === 'pending') return 'not-scheduled';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'confirmed') return 'confirmed';
  if (status === 'in-progress') return 'in-progress';
  if (status === 'completed') return 'completed';
  return 'other';
}

export function selectStableMeetingIdentity(event: Pick<CoachCalendarEvent, 'eventKey' | 'id'>) {
  return event.eventKey || event.id;
}

