import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HistoricalAssignmentPage from './HistoricalAssignmentPage';
import { loadLearningReflectionSubmission } from '@/api/reflectionSubmission';

const { resolvedUrl } = vi.hoisted(() => ({ resolvedUrl: vi.fn() }));
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../video-watch/AssignmentSubmissionWizard', () => ({ AssignmentSubmissionWizard: (props: { historicalReadOnly: boolean; title: string; evidenceFiles: unknown[]; resolveEvidenceUrl: (file: unknown) => Promise<string> }) =>
  <div data-testid="historical-template">{props.historicalReadOnly ? 'Read only' : 'Editable'}: {props.title}; {props.evidenceFiles.length} files
    <button onClick={() => props.resolveEvidenceUrl(props.evidenceFiles[0]).then(resolvedUrl)}>Open first file</button>
  </div> }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
function mount() {
  return render(<MemoryRouter initialEntries={['/learner/historical-assignment/commercial/125/aptem%3A92%3Aevidence%3A20128']}><Routes>
    <Route path="/learner/historical-assignment/:kind/:id/:activityId" element={<HistoricalAssignmentPage />} />
  </Routes></MemoryRouter>);
}

it('loads Word bytes through the authenticated backend instead of an Azure browser fetch', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({
    submissionOrigin: 'classified_legacy', activityTitle: 'Original.docx', status: 'accepted',
    legacyAssignment: { aptemLearnerId: 92, componentId: 14499, evidenceIds: [20128], documents: [
      { evidenceId: 20128, part: 'file', name: 'Original.docx' },
    ] },
  } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
  mount();
  fireEvent.click(await screen.findByText('Open first file'));
  await waitFor(() => expect(resolvedUrl).toHaveBeenCalledOnce());
  const url = new URL(resolvedUrl.mock.calls[0][0], 'http://localhost');
  expect(url.pathname).toBe('/learner_api/reflection/assignment/legacy-document/20128/');
  expect(url.searchParams.get('delivery')).toBe('content');
  expect(url.searchParams.get('learnerId')).toBe('125');
  expect(url.searchParams.get('activityId')).toBe('aptem:92:evidence:20128');
});

it('uses the read-only template without requiring an assigned curriculum component', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({
    submissionOrigin: 'classified_legacy', activityTitle: 'June report', learnerName: 'Mohamed Elmasry', status: 'accepted',
    submittedAt: '2026-01-04T17:50:06Z', dateCompleted: '2025-06-20',
    legacyAssignment: { aptemLearnerId: 92, componentId: 14499, evidenceIds: [20128], sourceStatus: 'Accepted', documents: [
      { evidenceId: 20128, part: 'file', name: 'June report.pdf' },
      { evidenceId: 20128, part: 'report', name: 'Assessment report.pdf' },
    ] },
  } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
  mount();
  expect(await screen.findByTestId('historical-template')).toHaveTextContent('Read only: June report; 2 files');
  expect(loadLearningReflectionSubmission).toHaveBeenCalledWith({ learnerKind: 'commercial', learnerId: '125', activityType: 'assignment', activityId: 'aptem:92:evidence:20128' });
  expect(screen.getByText('← Back to assignments')).toHaveAttribute('href', '/learner/my-learning/commercial/125?tab=assignments');
});

it('does not open a blank editable form when the import does not exist', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(null);
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Historical assignment not found.');
  expect(screen.queryByTestId('historical-template')).toBeNull();
});
