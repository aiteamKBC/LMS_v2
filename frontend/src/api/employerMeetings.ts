export type EmployerTeamsMeeting = {
  id: string; title: string; startsAt: string; endsAt: string;
  scheduledDate: string; scheduledTime: string; endTime: string;
  joinUrl: string; coachName: string;
  learners: { id: string; kind: 'apprenticeship' | 'commercial'; name: string }[];
};
export type EmployerTeamsMeetings = {
  meetings: EmployerTeamsMeeting[];
  status: 'ready' | 'partial' | 'error';
};
export async function fetchEmployerTeamsMeetings(employerId: string, signal: AbortSignal): Promise<EmployerTeamsMeetings> {
  const response = await fetch(`/learner_api/employer-portal/${encodeURIComponent(employerId)}/meetings/`, { credentials: 'include', signal });
  if (!response.ok) throw new Error('Teams invitations could not be loaded.');
  const payload = await response.json() as EmployerTeamsMeetings;
  if (!Array.isArray(payload.meetings) || !['ready', 'partial', 'error'].includes(payload.status)) {
    throw new Error('Teams invitations could not be loaded.');
  }
  return payload;
}
