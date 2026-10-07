import { coachFetch } from '@/lib/coachFetch';

export interface BulkAttendanceDirectoryLearner {
  id: string;
  name: string;
  email: string;
  programme: string;
  group: string;
  endDate: string;
}

export async function fetchBulkAttendanceLearners(signal?: AbortSignal): Promise<BulkAttendanceDirectoryLearner[]> {
  const response = await coachFetch('/curriculum_api/curriculum/bulk-attendance/learners/', { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load the learner directory.');
  }
  if (!Array.isArray(payload.learners)) {
    throw new Error('The learner directory returned an invalid response.');
  }
  return payload.learners;
}
