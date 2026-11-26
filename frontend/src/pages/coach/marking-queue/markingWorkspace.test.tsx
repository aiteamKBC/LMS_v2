import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Accept assignment and send feedback' }));
    await waitFor(() => expect(screen.getByText('Queue destination')).toBeInTheDocument());
    const patchCall = mocks.coachFetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patchCall?.[0]).toBe(`/coach_api/coach/marking-queue/${submission.id}`);
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      decision: 'accepted',
      feedback: 'AI draft for coach review.',
      reviewedBy: 'Test Coach',
    });
  });

  it('lists only assignment submissions, with no reflection or type tabs', async () => {
    mocks.coachFetch.mockImplementation(() => response({
      items: [submission],
      summary,
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    }));

    render(
      <MemoryRouter initialEntries={['/coach/marking-queue']}>
        <Routes>
          <Route path="/coach/marking-queue" element={<CoachMarkingQueue />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Stakeholder engagement reflection' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Submission type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reflections/ })).not.toBeInTheDocument();
    for (const [url] of mocks.coachFetch.mock.calls) expect(String(url)).toContain('kind=assignment');
  });

  it('reviews a monthly report in assignment, reflection and feedback tabs with one decision', async () => {
    const monthly = {
      ...submission,
      monthlySections: {
        assignment: [
          { step: 2, title: 'Assignment answer', entries: [{ label: 'Assignment answer', text: 'The budget came from quotations.', format: 'text' }] },
          { step: 3, title: 'Evidence & cross-referencing', entries: [] },
          { step: 4, title: 'KSBs & hours claimed', entries: [{ label: 'Hours claimed', text: '6', format: 'value' }] },
        ],
        reflection: [
          { step: 5, title: 'Full-month reflection', entries: [{ label: 'How does the learning fit together?', text: 'It connected budgeting with risk.', format: 'text' }] },
          { step: 6, title: 'Impact & employer benefit', entries: [] },
          { step: 7, title: 'Action plan & EPA', entries: [] },
          { step: 8, title: 'Coaching & presentation', entries: [] },
        ],
      },
    };
    mocks.coachFetch.mockImplementation((url: string, options?: { method?: string; body?: unknown }) => {
      if (url.endsWith('/ai-feedback')) return response({ feedback: 'Whole report draft.', meta: {} });
      if (url.endsWith('/ai-prompt')) return response({ prompt: 'Mark the report.', file: 'AI_marking_prompt.MD', kind: 'assignment', available: true });
      if (options?.method === 'PATCH') return response({ id: submission.id, status: 'accepted' });
      if (url.includes('?status=all')) return response({ items: [monthly], summary });
      return response({ item: monthly });
    });

    render(
      <MemoryRouter initialEntries={[`/coach/marking-queue/${submission.id}`]}>
        <Routes>
          <Route path="/coach/marking-queue/:submissionId" element={<CoachMarkingReviewPage />} />
          <Route path="/coach/marking-queue" element={<p>Queue destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    const main = await screen.findByRole('tablist', { name: 'Monthly report' });
    expect(within(main).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Assignment, KSBs & evidenceSteps 2–4', 'ReflectionSteps 5–8', 'FeedbackWhole report',
    ]);
    // The old Submission / Evidence & KSBs / Progress history tabs are gone for a monthly report.
    expect(screen.queryByRole('tab', { name: 'Progress history' })).not.toBeInTheDocument();

    // Assignment tab: one sub-tab per step, step 2 first. No decision here.
    const assignmentSteps = screen.getByRole('tablist', { name: 'Assignment, KSBs & evidence steps' });
    expect(within(assignmentSteps).getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByText('The budget came from quotations.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate AI draft' })).not.toBeInTheDocument();
    fireEvent.click(within(assignmentSteps).getByRole('tab', { name: /Evidence & cross-referencing/ }));
    expect(screen.getByText('Uploaded evidence')).toBeInTheDocument();

    fireEvent.click(within(main).getByRole('tab', { name: /Reflection/ }));
    const reflectionSteps = screen.getByRole('tablist', { name: 'Reflection steps' });
    expect(within(reflectionSteps).getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByText('It connected budgeting with risk.')).toBeInTheDocument();
    expect(screen.queryByText('The budget came from quotations.')).not.toBeInTheDocument();

    fireEvent.click(within(main).getByRole('tab', { name: /Feedback/ }));
    expect(screen.getByText(/cover the whole monthly report/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    const feedback = await screen.findByPlaceholderText('Write clear, actionable feedback for the learner…');
    await waitFor(() => expect(feedback).toHaveValue('Whole report draft.'));
    expect(mocks.coachFetch).toHaveBeenCalledWith(`/coach_api/coach/marking-queue/${submission.id}/ai-feedback`, { method: 'POST' });

    fireEvent.click(screen.getByRole('button', { name: 'Accept assignment and send feedback' }));
    await waitFor(() => expect(screen.getByText('Queue destination')).toBeInTheDocument());
    const patchCall = mocks.coachFetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patchCall?.[0]).toBe(`/coach_api/coach/marking-queue/${submission.id}`);
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      decision: 'accepted',
      feedback: 'Whole report draft.',
      reviewedBy: 'Test Coach',
    });
  });
});
