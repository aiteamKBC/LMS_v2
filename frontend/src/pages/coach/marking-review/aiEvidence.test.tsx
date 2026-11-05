import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CoachMarkingReviewPage from './page';
import { coachFetch } from '@/lib/coachFetch';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.invalid', name: 'Test Coach' }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn().mockResolvedValue([]), getEvidenceDownloadUrl: vi.fn() }));

beforeEach(() => vi.stubGlobal('AppIcon', () => null));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function review(activityType: string, evidenceFiles?: { filename: string; readable: boolean }[], failure = false) {
  const item = { id: 'submission-1', learnerKind: 'apprenticeship', learnerId: '17', learner: 'Synthetic Learner',
    activityType, activityId: 'COMP-1', activityTitle: 'Submitted coursework', status: 'pending', version: 1,
    ksbCodes: [], ksbExplanations: {}, confidenceBefore: {}, confidenceAfter: {}, selectedBenefits: [],
    learningReflection: 'Typed learner response.', qualityScore: 100 };
  vi.mocked(coachFetch).mockImplementation(async url => {
    const path = String(url);
    if (path.endsWith('/ai-feedback')) {
      return new Response(JSON.stringify(failure ? { error: 'The uploaded evidence could not be loaded. Please try again.' }
        : { feedback: 'Draft grounded in the uploaded document.', meta: { ksbCount: 1, evidenceFiles } }), { status: failure ? 502 : 200 });
    }
    if (path.endsWith('/ai-prompt')) return new Response(JSON.stringify({ available: true, prompt: 'Original criteria', kind: activityType === 'assignment' ? 'assignment' : 'reflection' }));
    if (path.includes('?status=all')) return new Response(JSON.stringify({ items: [], summary: {} }));
    return new Response(JSON.stringify({ item }));
  });
  render(<MemoryRouter initialEntries={['/coach/marking-queue/submission-1']}>
    <Routes><Route path='/coach/marking-queue/:submissionId' element={<CoachMarkingReviewPage />} /></Routes>
  </MemoryRouter>);
}

it.each(['assignment', 'video'])('shows readable and unreadable evidence for %s drafts without saving a decision', async activityType => {
  review(activityType, [{ filename: 'report.docx', readable: true }, { filename: 'scan.pdf', readable: false }]);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate AI draft' }));
  await screen.findByText(/Readable text extracted from 1 of 2 uploaded files/);
  expect(screen.getByText(/Could not read: scan.pdf. Review these files separately/)).toBeInTheDocument();
  expect(screen.getByLabelText('Review feedback')).toHaveValue('Draft grounded in the uploaded document.');
  expect(vi.mocked(coachFetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/marking-queue/submission-1/ai-feedback', { method: 'POST' });
});

it('preserves draft generation when no evidence metadata is returned', async () => {
  review('assignment');
  fireEvent.click(await screen.findByRole('button', { name: 'Generate AI draft' }));
  await screen.findByText(/AI-assisted draft generated against 1 assigned KSB/);
  expect(screen.queryByText(/Readable text extracted/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Review feedback')).toHaveValue('Draft grounded in the uploaded document.');
});

it('retains unsaved feedback when evidence cannot be loaded', async () => {
  review('video', [], true);
  const button = await screen.findByRole('button', { name: 'Generate AI draft' });
  fireEvent.change(screen.getByLabelText('Review feedback'), { target: { value: 'Existing coach feedback' } });
  fireEvent.click(button);
  await screen.findByText('The uploaded evidence could not be loaded. Please try again.');
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.getByLabelText('Review feedback')).toHaveValue('Existing coach feedback');
  expect(screen.queryByText(/AI-assisted draft generated/)).not.toBeInTheDocument();
});
