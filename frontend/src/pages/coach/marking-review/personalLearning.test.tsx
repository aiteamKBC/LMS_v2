import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CoachMarkingReviewPage from './page';
import CoachMarkingQueue from '../marking-queue/page';
import { coachFetch } from '@/lib/coachFetch';
import { fetchEvidence } from '@/api/evidence';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.invalid', name: 'Course Coach' }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn().mockResolvedValue([]), getEvidenceDownloadUrl: vi.fn() }));

const item = { id: 'sub-1', learnerKind: 'commercial', learnerId: 'pl.7.study.MOD-A', learner: 'Synthetic Admin',
  activityType: 'assignment', activityId: 'C1', activityTitle: 'Coursework', module: 'Module A', week: 'Week 1',
  status: 'pending', version: 7, ksbCodes: [], confidenceBefore: {}, confidenceAfter: {}, ksbExplanations: {},
  selectedBenefits: [], evidenceFiles: [], qualityScore: 100, submittedDisplay: '18/09/2026',
  contentSections: [{ label: 'Assignment answer', text: 'The complete personal assignment answer.' }] };

beforeEach(() => {
  vi.stubGlobal('AppIcon', () => null);
  vi.mocked(coachFetch).mockImplementation(async (url, init) => {
    const path = String(url);
    if (init?.method === 'PATCH') return new Response(JSON.stringify({ status: 'accepted' }));
    if (path.endsWith('/evidence')) return new Response(JSON.stringify({ results: [] }));
    if (path.endsWith('/sub-1')) return new Response(JSON.stringify({ item }));
    return new Response(JSON.stringify({ items: [item], summary: { totalItems: 1, assignmentItems: 1, reflectionItems: 0, activeLearners: 1 },
      pagination: { page: 1, totalPages: 1, totalItems: 1, pageSize: 25 } }));
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function review() {
  render(<MemoryRouter initialEntries={['/coach/marking-queue/sub-1?scope=personal']}><Routes>
    <Route path="/coach/marking-queue/:submissionId" element={<CoachMarkingReviewPage />} />
    <Route path="/coach/marking-queue" element={<div>Returned to personal queue</div>} />
  </Routes></MemoryRouter>);
}

describe('personal coursework review', () => {
  it('shows the complete answer and saves a versioned decision to the personal endpoint', async () => {
    review();
    expect(await screen.findByText('The complete personal assignment answer.')).toBeVisible();
    expect(fetchEvidence).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Generate AI feedback/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Review feedback'), { target: { value: 'Accepted with clear evidence.' } });
    expect(screen.getByLabelText('Review feedback')).toHaveValue('Accepted with clear evidence.');
    fireEvent.click(screen.getByRole('button', { name: /Accept assignment/ }));
    await screen.findByText('Returned to personal queue');
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/personal-marking/sub-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ decision: 'accepted', feedback: 'Accepted with clear evidence.', reviewedBy: 'Course Coach', version: 7 }),
    }));
  });

  it('requires feedback before returning work and retains a failed review for retry', async () => {
    review();
    await screen.findByText('The complete personal assignment answer.');
    fireEvent.click(screen.getByRole('button', { name: 'Return for improvement' }));
    expect(screen.getByText('Write feedback for the learner before sending this decision.')).toBeVisible();
    expect(vi.mocked(coachFetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    vi.mocked(coachFetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'This submission changed. Reload it before saving your review.' }), { status: 400 }));
    fireEvent.change(screen.getByLabelText('Review feedback'), { target: { value: 'Explain the example.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return for improvement' }));
    expect(await screen.findByText(/This submission changed/)).toBeVisible();
    expect(screen.getByLabelText('Review feedback')).toHaveValue('Explain the example.');
  });

  it('keeps official and personal queues separate and carries scope into the review link', async () => {
    render(<MemoryRouter initialEntries={['/coach/marking-queue']}><Routes>
      <Route path="/coach/marking-queue" element={<CoachMarkingQueue />} />
      <Route path="/coach/marking-queue/:submissionId" element={<CoachMarkingReviewPage />} />
    </Routes></MemoryRouter>);
    await waitFor(() => expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/coach_api/coach/marking-queue?')));
    fireEvent.click(screen.getByRole('button', { name: 'Personal learning' }));
    await waitFor(() => expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/coach_api/coach/personal-marking?')));
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    await screen.findByText('The complete personal assignment answer.');
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/personal-marking/sub-1');
  });

  it('ignores an old queue response after switching to personal learning', async () => {
    let resolveOld!: (response: Response) => void;
    vi.mocked(coachFetch).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    render(<MemoryRouter initialEntries={['/coach/marking-queue']}><CoachMarkingQueue /></MemoryRouter>);
    await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Personal learning' }));
    await screen.findByText('Synthetic Admin');
    await act(async () => resolveOld(new Response(JSON.stringify({ items: [{ ...item, learner: 'Stale official learner' }] }))));
    expect(screen.queryByText('Stale official learner')).not.toBeInTheDocument();
    expect(screen.getByText('Synthetic Admin')).toBeVisible();
  });
});
