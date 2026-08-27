export interface TutorLearnerModule {
  id: string;
  name: string;
}

export interface TutorLearnerApi {
  id: number;
  name: string;
  email: string;
  programme: string;
  cohort: string;
  group: string;
  modules: TutorLearnerModule[];
  progress: number;
  attendance: number;
  evidenceSubmitted: number;
  evidenceRequired: number;
  lastActive: string;
  riskLevel: 'low' | 'medium' | 'high';
  ksbStatus: string;
  ksbCompleted: number;
  ksbTarget: number;
  otjhHours: number;
  otjhTarget: number;
}

interface TutorLearnersResponse {
  learners?: TutorLearnerApi[];
  error?: string;
}

export async function fetchTutorLearners(moduleIds: string[], signal?: AbortSignal): Promise<TutorLearnerApi[]> {
  const query = new URLSearchParams();
  moduleIds.forEach(moduleId => query.append('moduleIds', moduleId));
  const response = await fetch(`/learner_api/tutor-learners/?${query.toString()}`, {
    signal,
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  const payload = (await response.json().catch(() => null)) as TutorLearnersResponse | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'Unable to load learners.');
  }

  return Array.isArray(payload?.learners) ? payload.learners : [];
}
