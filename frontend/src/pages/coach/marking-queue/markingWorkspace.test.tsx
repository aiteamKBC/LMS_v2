import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CoachMarkingQueue from './page';
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
  learnerKind: 'apprentice',
  learnerId: '42',
  learner: 'Amelia Hughes',
  initials: 'AH',
  programme: 'Customer Service Practitioner',
  activityType: 'assignment',
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

describe('coach marking workspace', () => {
  it('renders real queue data as review cards and opens the selected submission', async () => {
    mocks.coachFetch.mockImplementation(() => response({
      items: [submission],
      summary,
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    }));

    render(
      <MemoryRouter initialEntries={['/coach/marking-queue']}>
        <Routes>
          <Route path="/coach/marking-queue" element={<CoachMarkingQueue />} />
          <Route path="/coach/marking-queue/:submissionId" element={<p>Review destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Pending submissions' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Stakeholder engagement reflection' })).toBeInTheDocument();
    expect(screen.getByText('K5')).toBeInTheDocument();
    expect(screen.getByText('Quality 86%')).toBeInTheDocument();
    expect(screen.queryByText('AI 86%')).not.toBeInTheDocument();
    expect(mocks.coachFetch).toHaveBeenCalledWith(expect.stringContaining('status=pending'));
    expect(mocks.coachFetch).toHaveBeenCalledWith(expect.stringContaining('kind=assignment'));

    fireEvent.click(screen.getByRole('button', { name: /Review/i }));
    expect(screen.getByText('Review destination')).toBeInTheDocument();
  });

  it('keeps AI drafting and the final coach decision connected to their existing endpoints', async () => {
    mocks.coachFetch.mockImplementation((url: string, options?: { method?: string; body?: unknown }) => {
      if (url.endsWith('/ai-feedback')) return response({ feedback: 'AI draft for coach review.', meta: { ksbCount: 2 } });
      if (url.endsWith('/ai-prompt')) return response({ prompt: 'Check evidence against KSBs.', file: 'assignment.md', kind: 'assignment', available: true });
      if (options?.method === 'PATCH') return response({ id: submission.id, status: 'accepted' });
      if (url.includes('?status=all')) return response({ items: [submission], summary });
      return response({ item: submission });
    });

    render(
      <MemoryRouter initialEntries={[`/coach/marking-queue/${submission.id}`]}>
        <Routes>
          <Route path="/coach/marking-queue/:submissionId" element={<CoachMarkingReviewPage />} />
          <Route path="/coach/marking-queue" element={<p>Queue destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Monthly marking workspace' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Stakeholder engagement reflection' })).toBeInTheDocument();
    expect(screen.getByText('I mapped the stakeholders and changed the communication cadence.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    const feedback = await screen.findByPlaceholderText('Write clear, actionable feedback for the learner…');
    await waitFor(() => expect(feedback).toHaveValue('AI draft for coach review.'));
    expect(mocks.coachFetch).toHaveBeenCalledWith(`${'/coach_api/coach/marking-queue'}/${submission.id}/ai-feedback`, { method: 'POST' });

    fireEvent.click(screen.getByRole('button', { name: 'Accept and send feedback' }));
    await waitFor(() => expect(screen.getByText('Queue destination')).toBeInTheDocument());
    const patchCall = mocks.coachFetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patchCall?.[0]).toBe(`/coach_api/coach/marking-queue/${submission.id}`);
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      decision: 'accepted',
      feedback: 'AI draft for coach review.',
      reviewedBy: 'Test Coach',
    });
  });
});
