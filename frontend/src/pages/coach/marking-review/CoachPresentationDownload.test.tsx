import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { downloadSavedPresentation } from '@/features/coach/marking/api/presentationDownload';
import { coachFetch } from '@/lib/coachFetch';
import { CoachPresentationDownload } from './CoachPresentationDownload';
import CoachMarkingReviewPage from './page';

vi.mock('@/features/coach/marking/api/presentationDownload', () => ({ downloadSavedPresentation: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn().mockResolvedValue([]), getEvidenceDownloadUrl: vi.fn() }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.test', name: 'Coach' }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const props = { scope: 'official' as const, submissionId: 'saved-submission', submittedAt: '2026-10-28T09:00:00Z' };
const file = () => ({ blob: new Blob(['synthetic presentation']), filename: 'saved.pptx' });
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(downloadSavedPresentation).mockReset().mockResolvedValue(file());
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue('blob:synthetic-presentation'), revokeObjectURL: vi.fn() }));
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('downloads the returned file via a temporary link and releases the blob URL', async () => {
  vi.useFakeTimers();
  render(<CoachPresentationDownload {...props} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download presentation' })); });
  expect(screen.getByRole('status')).toHaveTextContent('Presentation download started.');
  expect(click).toHaveBeenCalledOnce();
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(document.querySelector('a[download]')).toBeNull();
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-presentation');
});

it('prevents duplicate downloads while the response is pending', async () => {
  let finish!: (result: ReturnType<typeof file>) => void;
  vi.mocked(downloadSavedPresentation).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CoachPresentationDownload {...props} />);
  const button = screen.getByRole('button', { name: 'Download presentation' });
  fireEvent.click(button); fireEvent.click(button);
  expect(downloadSavedPresentation).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Downloading presentation…' })).toBeDisabled();
  await act(async () => { finish(file()); });
  expect(screen.getByRole('button', { name: 'Download presentation' })).toBeEnabled();
});

it('shows an unavailable presentation without reporting success and supports retry', async () => {
  vi.mocked(downloadSavedPresentation).mockRejectedValueOnce(new Error('No presentation was saved with this submission.'));
  render(<CoachPresentationDownload {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download presentation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No presentation was saved');
  expect(click).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Download presentation' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Presentation download started.');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('aborts a request on leaving and never downloads the old learner response afterward', async () => {
  let finish!: (result: ReturnType<typeof file>) => void;
  vi.mocked(downloadSavedPresentation).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CoachPresentationDownload {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download presentation' }));
  const signal = vi.mocked(downloadSavedPresentation).mock.calls[0][0].signal;
  view.unmount(); expect(signal?.aborted).toBe(true);
  await act(async () => { finish(file()); });
  expect(click).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

const item = { id: 'saved-submission', learnerKind: 'apprenticeship', learnerId: '7', learner: 'Synthetic learner',
  activityType: 'assignment', activityId: 'C1', activityTitle: 'Saved coursework', programme: 'Programme', status: 'pending',
  version: 7, submittedAt: props.submittedAt, submittedDisplay: '28/10/2026', ksbCodes: [], ksbExplanations: {},
  confidenceBefore: {}, confidenceAfter: {}, selectedBenefits: [], qualityScore: 100, reviewedAt: null, dateCompleted: null,
  learningReflection: 'Saved learner reflection.' };
function review(scope: 'official' | 'personal', activityType = 'assignment') {
  vi.mocked(coachFetch).mockImplementation(async url => {
    const path = String(url);
    const body = path.endsWith('/evidence') ? { results: [] } : path.endsWith('/ai-prompt') ? { available: false }
      : path.includes('?status=all') ? { items: [], summary: {} } : { item: { ...item, activityType } };
    return new Response(JSON.stringify(body));
  });
  render(<MemoryRouter initialEntries={[`/coach/marking-queue/saved-submission${scope === 'personal' ? '?scope=personal' : ''}`]}>
    <Routes><Route path="/coach/marking-queue/:submissionId" element={<CoachMarkingReviewPage />} /></Routes>
  </MemoryRouter>);
}

it.each(['official', 'personal'] as const)('offers the presentation in the %s review and preserves unsaved feedback', async scope => {
  review(scope);
  const button = await screen.findByRole('button', { name: 'Download presentation' });
  fireEvent.change(screen.getByLabelText('Review feedback'), { target: { value: 'Unsaved coach feedback stays here.' } });
  fireEvent.click(button);
  await screen.findByRole('status');
  expect(downloadSavedPresentation).toHaveBeenCalledWith(expect.objectContaining({ scope, submissionId: item.id, submittedAt: props.submittedAt, version: 7 }));
  expect(screen.getByLabelText('Review feedback')).toHaveValue('Unsaved coach feedback stays here.');
  expect(vi.mocked(coachFetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
});

it('keeps ordinary reflection reviews free of assignment presentation actions', async () => {
  review('official', 'video');
  await screen.findByRole('heading', { name: 'Saved coursework' });
  expect(screen.queryByRole('button', { name: 'Download presentation' })).toBeNull();
  expect(downloadSavedPresentation).not.toHaveBeenCalled();
});
