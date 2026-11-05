import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { EvidenceRecord } from '@/api/evidence';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { ReflectionWindow } from '@/components/feature/ReflectionWindow';
import EvidencePage from './page';

const mocks = vi.hoisted(() => ({
  identity: { kind: 'apprenticeship', id: 'synthetic-1' },
  loadReflection: vi.fn(), saveReflection: vi.fn(),
}));
vi.mock('@/hooks/useMyLearner', () => ({ useResolvedLearner: () => mocks.identity }));
vi.mock('@/hooks/useLearnerDetailParam', () => ({ useLearnerDetailParam: () => ({ real: null, loadError: null, refresh: vi.fn() }) }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: false, showReadOnlyNotice: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: mocks.loadReflection, saveLearningReflectionSubmission: mocks.saveReflection }));
vi.mock('@/api/reflectionVoice', () => ({ proofreadLearningReflection: vi.fn(), transcribeVoiceReflection: vi.fn() }));

let records: EvidenceRecord[];
const uploadedAt = '2026-04-30T23:30:00Z'; // 1 May in the LMS business timezone.
const storedFile = (): EvidenceRecord => ({
  id: 'evidence-1', filename: 'Workplace report.pdf', contentType: 'application/pdf', sizeBytes: 20,
  status: 'approved', scanResult: 'clean', sectionRef: 'reading-1', uploadedAt,
  trainingPlanDetails: { moduleTitle: 'Marketing', weekTitle: 'L2: Strategy', componentId: 'reading-1', componentTitle: 'Business value', componentType: 'reading' },
  canDelete: true, markingStatus: '',
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const evidenceReads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === `/learner_api/evidence/${mocks.identity.kind}/${mocks.identity.id}/`);
const historyReads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/historical/'));

function show(children: ReactNode = <EvidencePage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(children, { wrapper: ({ children }) => <QueryClientProvider client={client}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider> });
}

beforeEach(() => {
  records = [];
  mocks.identity = { kind: 'apprenticeship', id: 'synthetic-1' };
  vi.clearAllMocks();
  clearAllCachedResources();
  localStorage.clear();
  mocks.loadReflection.mockResolvedValue(null);
  mocks.saveReflection.mockResolvedValue({ status: 'draft' });
  vi.stubGlobal('AppIcon', () => <i />);
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/upload/')) {
      const form = init?.body as FormData;
      const file = form.get('file') as File;
      const record = { ...storedFile(), filename: file.name, sectionRef: String(form.get('section_ref')),
        trainingPlanDetails: JSON.parse(String(form.get('training_plan_details'))) };
      records.push(record);
      return json({ id: record.id, filename: file.name, status: 'approved', scanResult: 'clean', sectionRef: record.sectionRef }, 201);
    }
    if (url.includes('/historical/')) return json({ items: [] });
    if (url === `/learner_api/evidence/${mocks.identity.kind}/${mocks.identity.id}/`) return json({ results: records });
    throw new Error(`Unexpected test request: ${url}`);
  }));
});

afterEach(() => { cleanup(); clearAllCachedResources(); localStorage.clear(); vi.unstubAllGlobals(); });

it.each([
  ['commercial', 'reading', 'reading-1'],
  ['apprenticeship', 'quiz', 'quiz-1'],
] as const)('shows a %s %s upload in the open library before reflection submission', async (kind, noun, sectionRef) => {
  mocks.identity.kind = kind;
  const onSubmit = vi.fn();
  const view = show(<><EvidencePage /><ReflectionWindow
    learnerKind={kind} learnerId="synthetic-1" evidenceSectionRef={sectionRef} noun={noun}
    learnerKsbs={[]} autoKsbs={[]} elapsedSeconds={60} plannedTimeLabel="30m"
    submitting={false} submitError={null} onSubmit={onSubmit}
    moduleLabel="Marketing" weekLabel="L2: Strategy" activityTitle="Business value"
  /></>);
  await screen.findByText('No evidence found yet');
  fireEvent.click(screen.getByRole('button', { name: 'Evidence' }));
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await waitFor(() => expect(input.closest('fieldset')).not.toBeDisabled());
  fireEvent.change(input, { target: { files: [new File(['workplace evidence'], 'Workplace report.pdf', { type: 'application/pdf' })] } });
  const file = await screen.findByRole('button', { name: 'Open evidence: Workplace report.pdf' });
  expect(within(file).getByText('Uploaded 01/05/2026')).toBeVisible();
  expect(within(file).getByText('Draft')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'May 2026 evidence' })).getByRole('region', { name: 'Business value component' })).toContainElement(file);
  expect(records[0].sectionRef).toBe(sectionRef);
  expect(records[0].trainingPlanDetails).toMatchObject({ componentId: sectionRef, componentType: noun, moduleTitle: 'Marketing', weekTitle: 'L2: Strategy' });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(historyReads()).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload/'))).toHaveLength(1);
  view.unmount();
  show();
  expect(await screen.findByRole('button', { name: 'Open evidence: Workplace report.pdf' })).toHaveTextContent('Uploaded 01/05/2026');
});

it.each(['focus', 'visibilitychange'])('refreshes uploads from another tab on %s without reloading previous evidence', async event => {
  show();
  await screen.findByText('No evidence found yet');
  records.push(storedFile());
  fireEvent(event === 'focus' ? window : document, new Event(event));
  const file = await screen.findByRole('button', { name: 'Open evidence: Workplace report.pdf' });
  expect(file).toHaveTextContent('Uploaded 01/05/2026');
  expect(evidenceReads()).toHaveLength(2);
  expect(historyReads()).toHaveLength(1);
  fireEvent.click(file);
  expect(screen.getByText('Uploaded on')).toBeVisible();
});

it('ignores hidden-tab visibility events and removes refresh listeners on unmount', async () => {
  const view = show();
  await screen.findByText('No evidence found yet');
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => {});
  expect(evidenceReads()).toHaveLength(1);
  hidden.mockRestore();
  view.unmount();
  fireEvent(window, new Event('focus'));
  expect(evidenceReads()).toHaveLength(1);
});

it('keeps existing files visible if refreshing fails and recovers on retry', async () => {
  records.push(storedFile());
  show();
  await screen.findByRole('button', { name: 'Open evidence: Workplace report.pdf' });
  vi.mocked(fetch).mockResolvedValueOnce(json({ error: 'Could not refresh evidence.' }, 400));
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText('Could not refresh evidence.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Open evidence: Workplace report.pdf' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByText('Could not refresh evidence.')).not.toBeInTheDocument());
  expect(screen.getAllByRole('button', { name: 'Open evidence: Workplace report.pdf' })).toHaveLength(1);
});

it('does not show another learner’s files when an older refresh finishes late', async () => {
  records.push(storedFile());
  const view = show();
  await screen.findByRole('button', { name: 'Open evidence: Workplace report.pdf' });
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(evidenceReads()).toHaveLength(2));
  mocks.identity = { kind: 'commercial', id: 'synthetic-2' };
  records = [];
  view.rerender(<EvidencePage />);
  await screen.findByText('No evidence found yet');
  await act(async () => finish(json({ results: [storedFile()] })));
  expect(screen.queryByRole('button', { name: 'Open evidence: Workplace report.pdf' })).not.toBeInTheDocument();
});
