import type { AuthUser } from '@/api/auth';

export interface AbsenceNotification {
  id: string;
  text: string;
  createdAt: string;
  type: 'attendance';
  category: 'Attendance';
  link: string;
}

interface NotificationResponse {
  items: AbsenceNotification[];
}

interface CoachAbsenceResponse {
  items: Array<{
    id: string;
    learner: string;
    sessionTitle: string;
    reportedDate: string;
    recoveryMethod?: string;
  }>;
}

async function request<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include' });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : null;
  if (!response.ok) {
    const message = data && typeof data === 'object' && ('error' in data || 'detail' in data)
      ? String(('error' in data ? data.error : data.detail) || `Request failed (${response.status}).`)
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

function isCoachAccount(account: AuthUser) {
  return account.role === 'staff' && (
    account.access === 'coach'
    || account.accessNavRole === 'coach'
    || account.accesses?.includes('coach')
  );
}

export async function fetchAbsenceNotifications(account: AuthUser): Promise<AbsenceNotification[]> {
  if (account.role === 'employer') {
    const result = await request<NotificationResponse>(
      `/learner_api/employer-portal/${account.subjectId}/absence-notifications/`,
    );
    return result.items;
  }

  if (isCoachAccount(account)) {
    const result = await request<CoachAbsenceResponse>('/coach_api/coach/absence-reports');
    return result.items
      .filter(report => report.recoveryMethod === 'recorded')
      .map(report => ({
        id: `recorded-absence:${report.id}`,
        text: `${report.learner} reported they will miss ${report.sessionTitle} and watch the recording. Attendance will remain absent.`,
        createdAt: report.reportedDate,
        type: 'attendance' as const,
        category: 'Attendance' as const,
        link: '/coach/absence-reports',
      }));
  }

  return [];
}
