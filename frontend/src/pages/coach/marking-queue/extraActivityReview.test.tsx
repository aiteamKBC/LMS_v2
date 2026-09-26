import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoachMarkingReviewPage from '../marking-review/page';

const mocks = vi.hoisted(() => ({
  coachFetch: vi.fn(),
  fetchEvidence: vi.fn(),
  getEvidenceDownloadUrl: vi.fn(),
}));

vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));
vi.mock('@/api/evidence', () => ({
  fetchEvidence: mocks.fetchEvidence,
  getEvidenceDownloadUrl: mocks.getEvidenceDownloadUrl,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({
  useCoachIdentity: () => ({
    isInitialized: true,
    email: 'coach@example.test',
    name: 'Test Coach',
  }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const submission = {
  id: '00000000-0000-0000-0000-000000000001',
  learnerKind: 'apprenticeship',
  learnerId: '42',
  learner: 'Example Learner',
  initials: 'AH',
  programme: 'Customer Service Practitioner',
  activityType: 'extra_activity',
  activityId: 'activity-5',
  activityTitle: 'Stakeholder engagement reflection',
  module: 'Customer service excellence',
  week: 'Week 5',
  plannedOtjh: '4h',
  status: 'pending',
  learningReflection: 'I mapped the stakeholders and changed the communication cadence.',
  ksbCodes: ['K5', 'S6'],
  ksbWeights: { K5: 2, S6: 1 },
  ksbExplanations: { K5: 'Stakeholder knowledge', S6: 'Communication skill' },
  confidenceBefore: {},
  confidenceAfter: {},
  applicationType: 'Workplace project',
  applicationText: 'Used the approach during a customer service restructure.',
  evidenceFiles: [],
  evidenceConsentConfirmed: true,
  selectedBenefits: ['Efficiency'],
  benefitExplanation: 'Reduced duplicated updates.',
  actualTimeHours: '6h',
  completedDuringPaidHours: 'yes',
  dateCompleted: '2026-09-15',
  otjhConfirmed: true,
  signedDeclaration: true,
  qualityScore: 86,
  coachFeedback: null,
  reviewedBy: null,
  reviewedAt: null,
  submittedAt: '2026-09-15T10:00:00Z',
  submittedDisplay: '15/09/2026 11:00',
  elapsedDays: 3,
  isOverdue: false,
};

const summary = {
  totalItems: 1,
  activeLearners: 1,
  pendingItems: 1,
  acceptedItems: 0,
  referredItems: 0,
  overdueItems: 0,
  assignmentItems: 1,
  reflectionItems: 0,
};

function response(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, text: () => Promise.resolve(JSON.stringify(body)) });
}

beforeEach(() => {
  mocks.coachFetch.mockReset();
  mocks.fetchEvidence.mockReset().mockResolvedValue([]);
  mocks.getEvidenceDownloadUrl.mockReset();
});


afterEach(cleanup);
it.each([['accepted', 'Accept assignment and send feedback'], ['rejected', 'Refer back with feedback']])('reviews an extra activity with the existing %s workflow', async (decision, button) => {
  mocks.coachFetch.mockImplementation((url: string, options?: { method?: string }) => {
    if (options?.method === 'PATCH') return response({ id: submission.id, status: decision });
    if (url.endsWith('/ai-prompt')) return response({ prompt: 'Review evidence.', available: true });
    if (url.includes('?status=all')) return response({ items: [submission], summary });
    return response({ item: submission });
  });
  render(<MemoryRouter initialEntries={[`/coach/marking-queue/${submission.id}`]}><Routes>
    <Route path="/coach/marking-queue/:submissionId" element={<CoachMarkingReviewPage />} />
    <Route path="/coach/marking-queue" element={<p>Queue destination</p>} />
  </Routes></MemoryRouter>);
  await screen.findByRole('heading', { name: submission.activityTitle });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Review feedback'), 'Evidence reviewed for this extra activity.');
  await user.click(screen.getByRole('button', { name: button }));
  await screen.findByText('Queue destination');
  const call = mocks.coachFetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(call?.[1].body)).toMatchObject({ decision, feedback: 'Evidence reviewed for this extra activity.' });
});
