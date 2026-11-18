import { readLearnerJson } from './learnerRead';

export interface FeedbackFinding {
  id: number;
  formId: number;
  formTitle: string;
  formType: string;
  title: string;
  category: string;
  severity: 'Critical' | 'Major';
  classification: 'negative' | 'neutral';
  status: 'Open' | 'In Progress' | 'Resolved';
  raisedBy: string;
  respondent: string;
  groupName: string;
  submittedAt: string | null;
  score: number | null;
  version: number;
  actionPlan: string;
  owner: string;
  dueDate: string | null;
  updatedBy: string;
  updatedAt: string | null;
}

export type FeedbackFindingPatch = {
  expectedVersion: number;
  status?: 'In Progress' | 'Resolved';
  actionPlan?: string;
  owner?: string;
  dueDate?: string | null;
};

export const qaFindingsApi = {
  list: () => readLearnerJson<{ findings: FeedbackFinding[] }>('/qms_api/feedback-findings/', { force: true }),
  update: async (id: number, patch: FeedbackFindingPatch): Promise<FeedbackFinding> => {
    const tokenResponse = await fetch('/engagement_api/feedback/csrf/', { credentials: 'include' });
    const tokenBody = await tokenResponse.json().catch(() => ({})) as { csrfToken?: string; error?: string };
    if (!tokenResponse.ok || !tokenBody.csrfToken) throw new Error(tokenBody.error || 'Unable to verify the request.');
    const response = await fetch(`/qms_api/feedback-findings/${id}/`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': tokenBody.csrfToken },
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => ({})) as { finding?: FeedbackFinding; error?: string };
    if (!response.ok || !body.finding) throw new Error(body.error || `Could not update finding (${response.status}).`);
    return body.finding;
  },
};
