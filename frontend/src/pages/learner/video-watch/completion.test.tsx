import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { submitComponentProgress, type ComponentProgressResponse } from '@/api/components';
import { startTimeTracking } from '@/api/timeTracking';
import { submitVideoProgress, type VideoProgressResponse } from '@/api/videos';
import { fetchEvidence } from '@/api/evidence';
import { loadLearningReflectionSubmission } from '@/api/reflectionSubmission';
import ComponentViewPage, { ComponentBody } from './page';
import { downloadReadingPdf } from './readingDownloads';

(globalThis as Record<string, unknown>).AppIcon = ({ className }: { className?: string }) => <i className={className} />;

const session = vi.hoisted(() => ({
  account: { role: 'learner' as 'learner' | 'admin' | 'staff', subjectType: 'learner', subjectId: 1 },
  isInitialized: true,
  outsideWorkingHours: true,
  holidayCalendarReady: true,
  holidays: [] as { start: string; end: string; label?: string }[],
}));

vi.mock('./readingDownloads', async () => ({
  ...await vi.importActual<typeof import('./readingDownloads')>('./readingDownloads'),
  downloadReadingPdf: vi.fn(),
}));

vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn() }));
vi.mock('@/api/components', () => ({ submitComponentProgress: vi.fn() }));
vi.mock('@/api/timeTracking', () => ({ startTimeTracking: vi.fn() }));
vi.mock('@/api/videos', () => ({ submitVideoProgress: vi.fn() }));
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn(), saveLearningReflectionSubmission: vi.fn() }));
vi.mock('@/api/evidence', () => ({
  fetchEvidence: vi.fn(), uploadEvidence: vi.fn(), getEvidenceDownloadUrl: vi.fn(), deleteEvidence: vi.fn(),
}));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: session.account }, isInitialized: session.isInitialized }) }));
vi.mock('@/hooks/useComponentAccessWindow', () => ({ useComponentAccessWindow: () => ({ open: true, outsideWorkingHours: session.outsideWorkingHours, holidays: session.holidays, holidayCalendarReady: session.holidayCalendarReady, currentTimeLabel: 'Sunday, 14:02 BST' }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children, pageSubtitle }: { children: ReactNode; pageSubtitle: string }) => <main><p>{pageSubtitle}</p>{children}</main> }));
vi.mock('./AssignmentSubmissionWizard', () => ({ AssignmentSubmissionWizard: () => null }));

const component = (id: string, weekId: string, date: string) => ({
  componentId: id, component: 'Live Session · Live Teams Session 1', type: 'live_session',
  module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId,
  sessionDate: date, sessionTime: '12:00', durationMinutes: 60,
  expectedOtjh: 2.5, reflectionRequired: false,
});
const first = component('C1', 'W1', '2026-10-22');
const second = component('C2', 'W2', '2026-10-29');
const empty = { ...first, componentId: 'EMPTY', component: 'Video · Recorded Session P1', type: 'video' };
const progress = { kind: 'component', componentId: 'C1', timeTaken: '00:20', submittedAt: '2026-09-13T12:58:12Z', passed: null };
const detail = (done = false) => ({
  modules: ['Marketing'],
  week: [{ module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId: 'W1' }, { module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId: 'W2' }],
  components: [first, empty, second], quizAttempts: [], videoProgress: [], componentProgress: done ? [progress] : [], ksbs: [],
}) as unknown as LearnerDetail;

function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
function mount(id = 'C1') {
  return render(<MemoryRouter initialEntries={[`/learner/component/apprenticeship/1/${id}`]}>
    <Location /><Routes><Route path="/learner/component/:kind/:id/:componentId" element={<ComponentViewPage />} /></Routes>
  </MemoryRouter>);
}

async function finish() {
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(session.account, { role: 'learner', subjectType: 'learner', subjectId: 1 });
  session.isInitialized = true;
  session.outsideWorkingHours = true;
  session.holidayCalendarReady = true;
  session.holidays = [];
  localStorage.clear();
  vi.mocked(fetchLearnerDetail).mockResolvedValue(detail());
  vi.mocked(startTimeTracking).mockResolvedValue({
    sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'visible_page',
  });
  vi.mocked(submitComponentProgress).mockResolvedValue({ record: progress } as unknown as ComponentProgressResponse);
  vi.mocked(fetchEvidence).mockResolvedValue([]);
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps direct audio tied to real playback events', () => {
  const onPlayingChange = vi.fn();
  const onEnded = vi.fn();
  render(<ComponentBody
    component={{ ...first, type: 'audio', audioUrl: 'https://example.test/podcast.mp3' } as never}
    contentKind="audio"
    parsed={null}
    title="Podcast"
    onDuration={vi.fn()}
    onProgress={vi.fn()}
    onPlayingChange={onPlayingChange}
    onEnded={onEnded}
    onUnsupported={vi.fn()}
  />);

  const audio = document.querySelector('audio')!;
  fireEvent.play(audio);
  expect(onPlayingChange).not.toHaveBeenCalled();
  fireEvent.playing(audio);
  expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  fireEvent.waiting(audio);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  fireEvent.playing(audio);
  expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  fireEvent.seeking(audio);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  fireEvent.pause(audio);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  fireEvent.ended(audio);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  expect(onEnded).toHaveBeenCalledOnce();
});

it('connects the content Upload evidence control to a mounted file input', async () => {
  const reading = { ...first, type: 'reading', component: 'Reading', content: '<p>Learning material</p>', description: 'Learning material' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);

  mount();

  const trigger = await screen.findByText('Upload evidence');
  const inputId = trigger.closest('label')?.htmlFor;
  expect(inputId).toBeTruthy();
  expect(document.getElementById(inputId!)).toBeInstanceOf(HTMLInputElement);
  expect(document.getElementById(inputId!)).not.toBeDisabled();
});

it.each([false, undefined])('offers reading downloads when downloadAllowed is %s', async (downloadAllowed) => {
  const reading = { ...first, type: 'reading', component: 'Reading',
    resourceUrl: '/learner_api/materials/reading.png', fileName: 'Reading material.png', downloadAllowed };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);
  mount();
  const download = await screen.findByRole('link', { name: 'Download original file' });
  expect(download).toHaveAttribute('href', reading.resourceUrl);
  expect(download).toHaveAttribute('download', reading.fileName);
  expect(submitComponentProgress).not.toHaveBeenCalled();
});

it('does not offer a reading file download without an attachment', async () => {
  const reading = { ...first, type: 'reading', component: 'Reading', contentHtml: '<p>Reading text without an attachment.</p>' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);
  mount();
  await screen.findByText('Read the material, then finish and reflect below.');
  expect(screen.queryByRole('link', { name: 'Download original file' })).not.toBeInTheDocument();
});

it('keeps slide deck downloads subject to the author setting', async () => {
  const slides = { ...first, type: 'powerpoint', component: 'Slides',
    resourceUrl: '/learner_api/materials/slide.png', fileName: 'Slide.png', downloadAllowed: false };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [slides] } as unknown as LearnerDetail);
  mount();
  await screen.findByText('Review the slide deck, then finish and reflect below.');
  expect(screen.queryByRole('link', { name: 'Download deck' })).not.toBeInTheDocument();
});

it('studies out of hours with no warning, no checkbox and no blocked Finish', async () => {
  session.outsideWorkingHours = true;
  session.holidayCalendarReady = false;   // the calendar no longer gates learning
  mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  expect(screen.queryByRole('checkbox', { name: /inside UK working hours/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/outside UK working hours/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/holiday calendar/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
});

it('submits without any working-hours declaration', async () => {
  session.outsideWorkingHours = false;
  mount();
  await finish();
  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({ declaredCompletedAt: null })));
  expect(vi.mocked(submitComponentProgress).mock.calls[0][3]).not.toHaveProperty('insideWorkingHoursConfirmed');
});

it('lets the learner open the existing reflection form when reflection is configured', async () => {
  session.outsideWorkingHours = false;
  const reflected = { ...first, reflectionRequired: true };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reflected] } as unknown as LearnerDetail);
  mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

  const choiceDialog = await screen.findByRole('dialog', { name: 'Do you want to complete a reflection?' });
  expect(choiceDialog).toBeVisible();
  expect(choiceDialog.parentElement).toHaveClass('fixed', 'inset-0', 'z-[100]');
  expect(choiceDialog.previousElementSibling).toHaveClass('absolute', 'inset-0', 'bg-black/40', 'backdrop-blur-[3px]');
  fireEvent.click(screen.getByRole('button', { name: 'Yes, add reflection' }));
  expect(await screen.findByText('My Learning Evidence and Reflection')).toBeVisible();
  expect(screen.queryByText('Before we finish…')).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
  fireEvent.click(screen.getByRole('button', { name: 'Close reflection' }));
  expect(screen.queryByText('My Learning Evidence and Reflection')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Finish' })).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
  expect(submitComponentProgress).not.toHaveBeenCalled();
});

it('lets the learner finish configured reflection content without a reflection', async () => {
  session.outsideWorkingHours = false;
  const reflected = { ...first, reflectionRequired: true };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reflected, second] } as unknown as LearnerDetail);
  mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'No, finish without reflection' }));

  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith(
    'C1', 'apprenticeship', '1', expect.objectContaining({ feedback: '', ksbs: [], skipReflection: true }),
  ));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Completed'));
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Next activity:/ }));
  expect(screen.getByTestId('location')).toHaveTextContent('/C2');
});

it('keeps reflection optional for tutor-validated activities', async () => {
  session.outsideWorkingHours = false;
  const validated = { ...first, reflectionRequired: true, tutorValidationRequired: true };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [validated] } as unknown as LearnerDetail);
  mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

  expect(await screen.findByRole('dialog', { name: 'Do you want to complete a reflection?' })).toBeVisible();
  expect(screen.queryByText('My Learning Evidence and Reflection')).not.toBeInTheDocument();
});

it('cancels the reflection choice without completing or navigating', async () => {
  session.outsideWorkingHours = false;
  const reflected = { ...first, reflectionRequired: true };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reflected] } as unknown as LearnerDetail);
  mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('dialog', { name: 'Do you want to complete a reflection?' })).not.toBeInTheDocument();
  expect(submitComponentProgress).not.toHaveBeenCalled();
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
});

it('guards a double No click from creating duplicate completion requests', async () => {
  session.outsideWorkingHours = false;
  const reflected = { ...first, reflectionRequired: true };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reflected] } as unknown as LearnerDetail);
  let resolveCompletion: ((value: Awaited<ReturnType<typeof submitComponentProgress>>) => void) | undefined;
  vi.mocked(submitComponentProgress).mockImplementationOnce(() => new Promise((resolve) => { resolveCompletion = resolve; }));
  mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  const noButton = await screen.findByRole('button', { name: 'No, finish without reflection' });
  fireEvent.click(noButton);
  fireEvent.click(noButton);

  expect(submitComponentProgress).toHaveBeenCalledTimes(1);
  resolveCompletion?.({ record: { componentId: 'C1', timeTaken: '00:20' } } as Awaited<ReturnType<typeof submitComponentProgress>>);
});

async function openReadingConfirmation() {
  const reading = { ...first, type: 'reading', component: 'Reading', content: '<p>Learning material</p>', description: 'Learning material' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
  await screen.findByRole('button', { name: 'Confirm' });
}

it('accepts hours and minutes entered in the completion popup and submits manual time', async () => {
  await openReadingConfirmation();
  fireEvent.click(screen.getByRole('button', { name: /Input/ }));
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  const hours = screen.getAllByLabelText('Hours spent').at(-1)!;
  const minutes = screen.getAllByLabelText('Minutes spent').at(-1)!;
  fireEvent.change(hours, { target: { value: '1' } });
  fireEvent.change(minutes, { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({
    timeTakenSeconds: 5400, timeEntrySource: 'input',
  })));
});

it('rejects zero manual time and allows returning to the timer', async () => {
  await openReadingConfirmation();
  fireEvent.click(screen.getByRole('button', { name: /Input/ }));
  fireEvent.change(screen.getAllByLabelText('Hours spent').at(-1)!, { target: { value: '0' } });
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Timer/ }));
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({ timeEntrySource: 'timer' })));
});

it('opens and completes the selected learner activity for an admin using the real permission hook', async () => {
  Object.assign(session.account, { role: 'admin', subjectType: 'staff', subjectId: 999 });
  mount();
  await finish();
  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(screen.queryByText('You are viewing this learner read-only')).not.toBeInTheDocument();
  expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({ timeTakenSeconds: 1200 }));
  expect(session.account.role).toBe('admin');
  expect(session.account.subjectId).toBe(999);
});

it('keeps an ordinary staff preview read-only without starting or saving learner progress', async () => {
  Object.assign(session.account, { role: 'staff', subjectType: 'staff', subjectId: 999 });
  mount();
  expect(await screen.findByText('You are viewing this learner read-only')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  expect(startTimeTracking).not.toHaveBeenCalled();
  expect(submitComponentProgress).not.toHaveBeenCalled();
});

it('keeps the saved completion visible and asks before moving to the next same-named activity', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce(detail()).mockResolvedValue(detail(true));
  mount();
  await finish();

  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(screen.getByRole('status')).toHaveTextContent('00:20');
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
  expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  expect(screen.getByText(/Locked activities have no learning content/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Recorded Session P1/ })).toBeDisabled();
  expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({ timeTakenSeconds: 1200 }));
  expect(startTimeTracking).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: /Next activity:.*Week 2/ }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/C2'));
  expect(await screen.findByRole('button', { name: 'Finish' })).toBeDisabled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText(/1 done/)).not.toBeInTheDocument();
});

it('restores completion on reopening and expands only the selected repeated week', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValue(detail(true));
  mount();
  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(startTimeTracking).not.toHaveBeenCalled();
  const weekOne = screen.getByRole('button', { name: /^Week 1 · Marketing Week/ });
  const weekTwo = screen.getByRole('button', { name: /^Week 2 · Marketing Week/ });
  fireEvent.click(weekTwo);
  expect(weekTwo).toHaveAttribute('aria-expanded', 'true');
  expect(weekOne).toHaveAttribute('aria-expanded', 'false');
  expect(within(weekOne).getByText('Current')).toBeInTheDocument();
  expect(within(weekTwo).queryByText('Current')).not.toBeInTheDocument();
  fireEvent.click(weekOne);
  expect(weekOne).toHaveAttribute('aria-expanded', 'true');
  expect(weekTwo).toHaveAttribute('aria-expanded', 'false');
});

it('retains a successful save when reloading the activity list fails', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce(detail()).mockRejectedValue(new Error('Network error'));
  mount();
  await finish();
  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(await screen.findByRole('alert')).toHaveTextContent('Your completion was saved');
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  expect(submitComponentProgress).toHaveBeenCalledTimes(1);
});

it('keeps a failed save open for retry without marking it complete', async () => {
  vi.mocked(submitComponentProgress).mockRejectedValue(new Error('Could not save progress'));
  mount();
  await finish();
  expect(await screen.findByText('Could not save progress')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
});

it('offers both downloads when the original PDF is linked inside the reading', async () => {
  const reading = { ...first, type: 'reading', component: 'Reading',
    contentHtml: '<p>Source text</p><a href="/learner_api/materials/topic.pdf">Topic reading (PDF)</a>' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);
  mount();
  const original = await screen.findByRole('link', { name: 'Download original file' });
  expect(original).toHaveAttribute('href', '/learner_api/materials/topic.pdf');
  expect(original).toHaveAttribute('download', 'topic.pdf');
  expect(screen.getByRole('button', { name: 'Download highlighted reading' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Download reading as PDF' }));
  await waitFor(() => expect(downloadReadingPdf).toHaveBeenCalledWith('Reading', reading.contentHtml));
  expect(submitComponentProgress).not.toHaveBeenCalled();
});

it('shows a PDF error and allows retry without completing the activity', async () => {
  vi.mocked(downloadReadingPdf).mockRejectedValueOnce(new Error('Could not prepare PDF'));
  const reading = { ...first, type: 'reading', component: 'Reading', contentHtml: '<p>Source text</p>' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Download reading as PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not prepare PDF');
  expect(screen.getByRole('button', { name: 'Download reading as PDF' })).toBeEnabled();
  expect(submitComponentProgress).not.toHaveBeenCalled();
});

it('prevents duplicate PDF requests while preparing the file', async () => {
  let resolvePdf: (() => void) | undefined;
  vi.mocked(downloadReadingPdf).mockImplementationOnce(() => new Promise<void>(resolve => { resolvePdf = resolve; }));
  const reading = { ...first, type: 'reading', component: 'Reading', contentHtml: '<p>Source text</p>' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Download reading as PDF' }));
  const pending = screen.getByRole('button', { name: 'Preparing PDF…' });
  expect(pending).toBeDisabled();
  fireEvent.click(pending);
  expect(downloadReadingPdf).toHaveBeenCalledTimes(1);
  resolvePdf?.();
  await screen.findByRole('button', { name: 'Download reading as PDF' });
});


it.each(['podcast', 'audio'])('saves five minutes of muted background %s, excluding loading and buffering', async (type) => {
  const audioComponent = { ...first, type, component: 'Podcast', audioUrl: 'https://example.test/lesson.mp3' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [audioComponent] } as unknown as LearnerDetail);
  vi.mocked(startTimeTracking).mockResolvedValue({
    sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'active_playback',
  });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let visibility: 'visible' | 'hidden' = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const { container } = mount();
  await screen.findByText('Listen, then finish and reflect below.');
  const audio = container.querySelector('audio')!;
  audio.muted = true;
  fireEvent.play(audio);
  now += 60000; // Waiting for the first playable media frame is not study time.
  fireEvent.playing(audio);
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  now += 120000; // No interval callback: simulate the browser throttling this tab.
  fireEvent.waiting(audio);
  now += 120000;
  fireEvent.playing(audio);
  now += 180000;
  fireEvent.pause(audio);
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm' });
  expect(screen.getAllByText('00:05:00').length).toBeGreaterThan(0);
  fireEvent.click(confirm);
  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({
    timeTakenSeconds: 300, timeEntrySource: 'timer', trackingToken: 'token',
  })));
  expect(startTimeTracking).toHaveBeenCalledWith('component', 'C1', 'apprenticeship', '1', 'active_playback');
});


it('preserves a saved audio session and flushes the last seconds when leaving the page', async () => {
  const key = 'learner_activity_timer:v1:apprenticeship:1:C1';
  const savedSession = { sessionId: 'OLD', trackingToken: 'old-token', startedAt: new Date(Date.now() - 600000).toISOString(), countingMode: 'visible_page' };
  localStorage.setItem(key, JSON.stringify({ elapsedSeconds: 300, session: savedSession }));
  const audioComponent = { ...first, type: 'podcast', component: 'Podcast', audioUrl: 'https://example.test/lesson.mp3' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [audioComponent] } as unknown as LearnerDetail);
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { container, unmount } = mount();
  await screen.findByRole('timer', { name: 'Time on this activity: 00 hours, 05 minutes, 00 seconds' });
  expect(startTimeTracking).not.toHaveBeenCalled();
  now = 60000;
  fireEvent.playing(container.querySelector('audio')!);
  now += 12000;
  unmount();
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ elapsedSeconds: 312, session: savedSession });
});


it.each([
  { source: 'timer', seconds: 300, clock: '00:05:00', savedClock: '05:00' },
  { source: 'input', seconds: 2400, clock: '00:40:00', savedClock: '40:00' },
])('shows the chosen $source duration in confirmation, saved completion and after reopening', async ({ source, seconds, clock, savedClock }) => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const reading = { ...first, type: 'reading', component: 'Reading', expectedOtjh: 14, contentHtml: '<p>Learning material</p>' };
  const pending = { ...detail(), components: [reading] } as LearnerDetail;
  const savedRecord = { ...progress, timeTaken: savedClock, reportedTime: `${seconds / 60} minutes` };
  const saved = { ...pending, componentProgress: [savedRecord] } as unknown as LearnerDetail;
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce(pending).mockResolvedValue(saved);
  vi.mocked(submitComponentProgress).mockResolvedValue({ record: savedRecord } as unknown as ComponentProgressResponse);
  localStorage.setItem('learner_activity_timer:v1:apprenticeship:1:C1', JSON.stringify({
    elapsedSeconds: 300,
    session: { sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'visible_page' },
  }));
  const { unmount } = mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '40' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  await screen.findByRole('button', { name: 'Confirm' });
  fireEvent.click(screen.getByRole('button', { name: source === 'timer' ? /Timer/ : /Input/ }));
  expect(screen.getByText('Save time').parentElement).toHaveTextContent(clock);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({
    timeTakenSeconds: seconds, timeEntrySource: source, reportedTime: `${seconds / 60} minutes`, plannedOtjh: '14h',
  })));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(clock));
  unmount();
  mount();
  expect(await screen.findByRole('status')).toHaveTextContent(clock);
  expect(submitComponentProgress).toHaveBeenCalledTimes(1);
});

it('carries selected input time into the reflection instead of its fourteen planned hours', async () => {
  const reading = { ...first, type: 'reading', component: 'Reading', expectedOtjh: 14, reflectionRequired: true, contentHtml: '<p>Learning material</p>' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [reading] } as unknown as LearnerDetail);
  mount();
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '40' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Yes, add reflection' }));
  fireEvent.click(await screen.findByRole('button', { name: 'OTJH' }));
  expect(screen.getByLabelText('Selected activity time')).toHaveValue('00:40:00');
  expect(screen.queryByLabelText('Actual time spent (hours)')).not.toBeInTheDocument();
});


it('freezes reading on refresh and resumes the saved seconds only after the reading loads again', async () => {
  const events = vi.spyOn(window, 'addEventListener');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const key = 'learner_activity_timer:v1:apprenticeship:1:C1';
  const savedSession = { sessionId: 'READING', trackingToken: 'reading-token', startedAt: new Date().toISOString(), countingMode: 'visible_page' };
  localStorage.setItem(key, JSON.stringify({ elapsedSeconds: 31, session: savedSession }));
  const reading = { ...first, type: 'reading', component: 'Reading', contentHtml: '<p>Synthetic reading content</p>' };
  const readingDetail = { ...detail(), components: [reading] } as unknown as LearnerDetail;
  vi.mocked(fetchLearnerDetail).mockResolvedValue(readingDetail);
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { unmount } = mount();
  await screen.findByRole('timer', { name: 'Time on this activity: 00 hours, 00 minutes, 31 seconds' });
  await waitFor(() => expect(events).toHaveBeenCalledWith('beforeunload', expect.any(Function)));
  now = 2000;
  act(() => window.dispatchEvent(new Event('beforeunload')));
  expect(JSON.parse(localStorage.getItem(key)!).elapsedSeconds).toBe(33);
  now = 32000;
  act(() => window.dispatchEvent(new Event('pagehide')));
  unmount();
  expect(JSON.parse(localStorage.getItem(key)!).elapsedSeconds).toBe(33);

  let resolveReading!: (value: LearnerDetail) => void;
  vi.mocked(fetchLearnerDetail).mockImplementationOnce(() => new Promise(resolve => { resolveReading = resolve; }));
  mount();
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  now = 62000;
  expect(JSON.parse(localStorage.getItem(key)!).elapsedSeconds).toBe(33);
  await act(async () => resolveReading(readingDetail));
  await screen.findByRole('timer', { name: 'Time on this activity: 00 hours, 00 minutes, 33 seconds' });
  now = 64000;
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({
    timeTakenSeconds: 35, timeEntrySource: 'timer', trackingToken: 'reading-token',
  })));
});


it.each(['timer', 'input'])('excludes muted video time while preserving the selected %s duration on save', async (source) => {
  const videoComponent = { ...first, type: 'video', component: 'Video lesson', videoUrl: 'https://example.test/lesson.mp4' };
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ ...detail(), components: [videoComponent] } as unknown as LearnerDetail);
  vi.mocked(startTimeTracking).mockResolvedValue({
    sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'active_playback',
  });
  const seconds = source === 'timer' ? 5 : 2400;
  const savedClock = source === 'timer' ? '00:05' : '40:00';
  vi.mocked(submitVideoProgress).mockResolvedValue({
    record: { ...progress, kind: 'video', timeTaken: savedClock, claimedSeconds: seconds },
  } as unknown as VideoProgressResponse);
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let visibility: 'visible' | 'hidden' = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const { container } = mount();
  await screen.findByRole('button', { name: 'Finish' });
  const video = container.querySelector('video')!;
  video.muted = true;
  fireEvent.playing(video);
  now += 60000;
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  video.muted = false;
  fireEvent.volumeChange(video);
  now += 2000;
  video.muted = true;
  fireEvent.volumeChange(video);
  expect(screen.getByRole('timer')).toHaveAccessibleName('Time on this activity: 00 hours, 00 minutes, 02 seconds');
  now += 120000;
  video.volume = 0;
  video.muted = false;
  fireEvent.volumeChange(video);
  now += 60000;
  video.volume = 0.5;
  fireEvent.volumeChange(video);
  now += 3000;
  fireEvent.pause(video);
  expect(screen.getByRole('timer')).toHaveAccessibleName('Time on this activity: 00 hours, 00 minutes, 05 seconds');
  expect(JSON.parse(localStorage.getItem('learner_activity_timer:v1:apprenticeship:1:C1')!).elapsedSeconds).toBe(5);
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  if (source === 'input') fireEvent.change(screen.getByLabelText('Minutes spent'), { target: { value: '40' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm' });
  expect(screen.getByText('Save time').parentElement).toHaveTextContent(source === 'timer' ? '00:00:05' : '00:40:00');
  fireEvent.click(confirm);
  await waitFor(() => expect(submitVideoProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({
    timeTakenSeconds: seconds, timeEntrySource: source, trackingToken: 'token', reportedTime: `${seconds / 60} minutes`,
  })));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(source === 'timer' ? '00:00:05' : '00:40:00'));
});
