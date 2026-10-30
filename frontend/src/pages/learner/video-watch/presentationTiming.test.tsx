import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fetchLearnerDetail, type LearnerDetail, type LearnerKind } from '@/api/learnerDetail';
import { submitComponentProgress } from '@/api/components';
import { startTimeTracking } from '@/api/timeTracking';
import { fetchEvidence } from '@/api/evidence';
import { fetchSlideDeck, type SlideDeck } from '@/api/slideDeck';
import ComponentViewPage from './page';

const pdf = vi.hoisted(() => ({ getPage: vi.fn(), cleanup: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 1, ...pdf }) }),
}));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn() }));
vi.mock('@/api/components', () => ({ submitComponentProgress: vi.fn() }));
vi.mock('@/api/timeTracking', () => ({ startTimeTracking: vi.fn(), resumeTimeTracking: vi.fn(), checkpointTimeTracking: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn() }));
vi.mock('@/api/slideDeck', () => ({ fetchSlideDeck: vi.fn() }));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({
  auth: { account: { role: 'learner', subjectType: 'learner', subjectId: 1 } }, isInitialized: true,
}) }));
vi.mock('@/hooks/useComponentAccessWindow', () => ({ useComponentAccessWindow: () => ({
  open: true, outsideWorkingHours: true, holidays: [], holidayCalendarReady: true,
}) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('./AssignmentSubmissionWizard', () => ({ AssignmentSubmissionWizard: () => null }));

const slides = (componentId = 'C1', extension = 'pdf') => ({
  componentId, component: `Presentation ${componentId}`, type: 'powerpoint',
  module: 'Marketing', moduleId: 'M1', week: 'Week 1', weekId: 'W1',
  resourceUrl: `/curriculum_api/curriculum/uploads/${componentId}.${extension}`,
  fileName: `${componentId}.${extension}`, description: 'Review the slides.', reflectionRequired: false,
});
function setComponents(...components: ReturnType<typeof slides>[]) {
  vi.mocked(fetchLearnerDetail).mockResolvedValue({
    modules: ['Marketing'], week: [{ module: 'Marketing', moduleId: 'M1', week: 'Week 1', weekId: 'W1' }],
    components, quizAttempts: [], videoProgress: [], componentProgress: [], ksbs: [],
  } as unknown as LearnerDetail);
}
function NextPresentation({ kind }: { kind: LearnerKind }) {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate(`/learner/component/${kind}/1/C2`)}>Open second presentation</button>
    <button onClick={() => navigate(`/learner/component/${kind}/1/C1`)}>Return to first presentation</button>
  </>;
}
function mount(kind: LearnerKind = 'apprenticeship') {
  return render(<MemoryRouter initialEntries={[`/learner/component/${kind}/1/C1`]}>
    <NextPresentation kind={kind} />
    <Routes><Route path="/learner/component/:kind/:id/:componentId" element={<ComponentViewPage />} /></Routes>
  </MemoryRouter>);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let now = 0;
function advanceTo(milliseconds: number) {
  now = milliseconds;
  fireEvent(document, new Event('visibilitychange'));
}
function expectSeconds(seconds: number) {
  expect(screen.getByRole('timer')).toHaveAccessibleName(
    `Time on this activity: 00 hours, 00 minutes, ${String(seconds).padStart(2, '0')} seconds`,
  );
}
const storageKey = 'learner_activity_timer:v1:apprenticeship:1:C1';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  pdf.getPage.mockResolvedValue({
    getViewport: () => ({ width: 800, height: 600 }), render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  });
  vi.mocked(startTimeTracking).mockResolvedValue({
    sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'visible_page',
  });
  vi.mocked(fetchEvidence).mockResolvedValue([]);
  vi.mocked(submitComponentProgress).mockResolvedValue({ record: { componentId: 'C1', timeTaken: '00:02' } } as Awaited<ReturnType<typeof submitComponentProgress>>);
  setComponents(slides());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['commercial', 'apprenticeship'] as const)('excludes PDF download and render time from the %s presentation timer and saved time', async kind => {
  const file = deferred<Response>();
  const rendered = deferred<void>();
  vi.mocked(fetch).mockReturnValue(file.promise);
  const renderPage = vi.fn(() => ({ promise: rendered.promise, cancel: vi.fn() }));
  pdf.getPage.mockResolvedValue({ getViewport: () => ({ width: 800, height: 600 }), render: renderPage });
  mount(kind);
  await screen.findByText('Loading PDF preview...');
  advanceTo(30000);
  expectSeconds(0);

  await act(async () => file.resolve(new Response(new Uint8Array([1]), { status: 200 })));
  await waitFor(() => expect(renderPage).toHaveBeenCalled());
  advanceTo(60000);
  expectSeconds(0);
  await act(async () => rendered.resolve());
  advanceTo(62000);
  expectSeconds(2);

  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith('C1', kind, '1', expect.objectContaining({
    timeTakenSeconds: 2, timeEntrySource: 'timer',
  })));
});

it.each(['download', 'render'])('keeps the presentation timer paused after a PDF %s failure', async failure => {
  if (failure === 'download') vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
  else pdf.getPage.mockRejectedValue(new Error('Could not render the slide'));
  const view = mount();
  await screen.findByText('Could not show this PDF inline.');
  advanceTo(60000);
  expectSeconds(0);
  view.unmount();
  expect(JSON.parse(localStorage.getItem(storageKey)!).elapsedSeconds).toBe(0);
});

it.each(['commercial', 'apprenticeship'] as const)('waits for PowerPoint slide images before counting for %s learners', async kind => {
  const deck = deferred<SlideDeck>();
  vi.mocked(fetchSlideDeck).mockReturnValue(deck.promise);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  setComponents(slides('C1', 'pptx'));
  mount(kind);
  await waitFor(() => expect(fetchSlideDeck).toHaveBeenCalled());
  advanceTo(30000);
  expectSeconds(0);
  await act(async () => deck.resolve({
    slideWidthPx: 800, slideHeightPx: 600, slideCount: 1,
    slides: [{ number: 1, layout: 'Blank', background: null, notes: '', shapes: [
      { kind: 'image', src: '/slide-image.png', alt: 'Slide content', x: 0, y: 0, w: 800, h: 600, rotation: null },
    ] }],
  }));
  advanceTo(60000);
  expectSeconds(0);
  fireEvent.load(screen.getByAltText('Slide content'));
  advanceTo(63000);
  expectSeconds(3);
});

it('preserves saved presentation time but waits for the preview again after reopening', async () => {
  setComponents(slides('C1', 'png'));
  const first = mount();
  fireEvent.load(await screen.findByAltText('Presentation C1'));
  advanceTo(5000);
  expectSeconds(5);
  first.unmount();
  expect(JSON.parse(localStorage.getItem(storageKey)!).elapsedSeconds).toBe(5);

  mount();
  const image = await screen.findByAltText('Presentation C1');
  advanceTo(35000);
  expectSeconds(5);
  fireEvent.load(image);
  advanceTo(37000);
  expectSeconds(7);
});

it('resumes saved time when a cached preview loads immediately as it appears', async () => {
  setComponents(slides('C1', 'png'));
  const first = mount();
  fireEvent.load(await screen.findByAltText('Presentation C1'));
  advanceTo(5000);
  expectSeconds(5);
  first.unmount();

  advanceTo(35000);
  const loaded = deferred<void>();
  const observer = new MutationObserver(() => {
    const image = document.querySelector('img[alt="Presentation C1"]');
    if (!image) return;
    observer.disconnect();
    fireEvent.load(image);
    advanceTo(37000);
    loaded.resolve();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    mount();
    await loaded.promise;
    expectSeconds(7);
    expect(JSON.parse(localStorage.getItem(storageKey)!).elapsedSeconds).toBe(7);
  } finally {
    observer.disconnect();
  }
});

it('waits for each presentation independently when navigating between activities', async () => {
  setComponents(slides('C1', 'png'), slides('C2', 'png'));
  mount();
  fireEvent.load(await screen.findByAltText('Presentation C1'));
  advanceTo(5000);
  expectSeconds(5);
  fireEvent.click(screen.getByRole('button', { name: 'Open second presentation' }));
  const second = await screen.findByAltText('Presentation C2');
  advanceTo(35000);
  expectSeconds(0);
  fireEvent.load(second);
  advanceTo(37000);
  expectSeconds(2);
  expect(JSON.parse(localStorage.getItem(storageKey)!).elapsedSeconds).toBe(5);
});

it('waits for a fresh preview when returning to a previously viewed presentation', async () => {
  setComponents(slides('C1', 'png'), slides('C2', 'png'));
  mount();
  fireEvent.load(await screen.findByAltText('Presentation C1'));
  advanceTo(5000);
  expectSeconds(5);
  fireEvent.click(screen.getByRole('button', { name: 'Open second presentation' }));
  await screen.findByAltText('Presentation C2');
  advanceTo(35000);
  expectSeconds(0);

  fireEvent.click(screen.getByRole('button', { name: 'Return to first presentation' }));
  const first = await screen.findByAltText('Presentation C1');
  advanceTo(65000);
  expectSeconds(5);
  fireEvent.load(first);
  advanceTo(67000);
  expectSeconds(7);
});

it('preserves the existing timer for a presentation without an attached file', async () => {
  setComponents({ ...slides(), resourceUrl: '', fileName: '' });
  await act(async () => { mount(); });
  await screen.findByRole('timer');
  advanceTo(5000);
  expectSeconds(5);
});
