import { StrictMode, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subjectRequest, type SubjectMaterial } from '@/api/studentActivity';
import { StudentMaterial } from './StudentMaterial';

vi.mock('@/api/studentActivity', () => ({ subjectRequest: vi.fn() }));
vi.mock('../video-watch/page', () => ({ InlineAttachmentPreview: () => <div>Document preview</div> }));

const material = (changes: Partial<SubjectMaterial> = {}): SubjectMaterial => ({
  title: 'Synthetic activity', reading_html: '<p>Reading content</p>', media: [], quiz: null,
  has_reading: true, available: true, source_live: false, persistence_ready: true,
  can_attempt: true, csrf_token: 'synthetic-csrf', completed: false, history: [],
  historical: { score: null, maximum_score: null, passed: null, attempt_number: null, status: null, answers: [] },
  ...changes,
});
const timing = { trackingToken: 'synthetic-token', startedAt: '2026-10-30T10:00:00Z', countingMode: 'visible_page' };
const requests = vi.mocked(subjectRequest);
const starts = () => requests.mock.calls.filter(([url, options]) => url.endsWith('/attempts/') && options?.method === 'POST');
const submissions = () => requests.mock.calls.filter(([url, options]) => url.endsWith('/draft/') && options?.method === 'POST');
function respond(data = material()) {
  requests.mockImplementation(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    if (options?.method !== 'POST') return data as T;
    if (url.endsWith('/attempts/')) return { attempt_id: 'draft', definition: {}, timing } as T;
    return { completed: true, passed: null, score_percent: null, study_time: { verifiedSeconds: 0, selectedSeconds: 1800, timeEntrySource: 'input' } } as T;
  });
}
function activity(learnerId = '9', props: Partial<ComponentProps<typeof StudentMaterial>> = {}) {
  return <StudentMaterial kind="commercial" learnerId={learnerId} groupId={50} activityId={60} {...props} />;
}
const finishReady = async () => waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());

beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); respond(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('legacy activities use the native time controls', () => {
  it.each(['commercial', 'apprenticeship'])('starts once under StrictMode and saves only after Finish (%s)', async kind => {
    render(<StrictMode>{activity('9', { kind })}</StrictMode>);
    await finishReady();
    expect(screen.queryByRole('button', { name: /Start activity|Start quiz/ })).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('Time on this activity: 00 hours, 00 minutes, 00 seconds');
    expect(screen.getByLabelText('Hours spent')).toBeEnabled();
    expect(starts()).toHaveLength(1);
    expect(submissions()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByText('Activity completed.');
    expect(submissions()).toHaveLength(1);
    expect(JSON.parse(submissions()[0][1]!.body as string)).toMatchObject({ trackingToken: 'synthetic-token', timeTakenSeconds: 0 });
  });

  it.each(['video', 'audio', 'pdf', 'document', 'embed'])('starts timing for %s content without a Start button', async kind => {
    respond(material({ reading_html: '', has_reading: false, media: [{ kind, title: 'Synthetic media', url: 'https://example.org/material', can_embed: false }] }));
    render(activity());
    await finishReady();
    expect(starts()).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open material in a new tab' })).toBeVisible();
  });

  it('confirms manual time, restores it after reopening and keeps the same attempt', async () => {
    const view = render(activity());
    await finishReady();
    fireEvent.change(screen.getByLabelText('Minutes spent'), { target: { value: '30' } });
    view.unmount();
    render(activity());
    await finishReady();
    expect(screen.getByLabelText('Minutes spent')).toHaveValue('30');
    expect(starts()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('0 hours and 30 minutes');
    expect(submissions()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Edit time' }));
    await finishReady();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm time' }));
    await screen.findByText('Activity completed.');
    expect(JSON.parse(submissions()[0][1]!.body as string)).toMatchObject({ timeTakenSeconds: 1800, timeEntrySource: 'input' });
    expect(screen.getByText('Study time saved: 00:30:00')).toBeVisible();
  });

  it('clears a manual correction to use the timer again', async () => {
    render(activity());
    await finishReady();
    fireEvent.change(screen.getByLabelText('Minutes spent'), { target: { value: '30' } });
    fireEvent.keyDown(screen.getByLabelText('Minutes spent'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByText('Activity completed.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(JSON.parse(submissions()[0][1]!.body as string)).not.toHaveProperty('timeEntrySource');
  });

  it.each([
    { readOnly: true }, { completed: true }, { reviewQuiz: true },
  ])('does not create attempts in review/completed views (%j)', async props => {
    render(activity('9', props));
    await screen.findByText('Reading content');
    expect(starts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it.each([
    { can_attempt: false }, { persistence_ready: false }, { available: false },
  ])('respects server restrictions before automatically starting (%j)', async restriction => {
    respond(material(restriction));
    render(activity());
    expect(await screen.findByRole('button', { name: 'Finish' })).toBeDisabled();
    expect(starts()).toHaveLength(0);
  });

  it('waits until a retained activity panel is shown before starting', async () => {
    const view = render(<div hidden>{activity()}</div>);
    await screen.findByText('Reading content');
    expect(starts()).toHaveLength(0);
    view.rerender(<div>{activity()}</div>);
    await finishReady();
    expect(starts()).toHaveLength(1);
  });

  it('shows a failed automatic start and retries only when requested', async () => {
    requests.mockResolvedValueOnce(material()).mockRejectedValueOnce(new Error('Timing unavailable'));
    render(activity());
    expect(await screen.findByRole('alert')).toHaveTextContent('Timing unavailable');
    expect(starts()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry activity' }));
    await finishReady();
    expect(starts()).toHaveLength(2);
  });

  it('shares a pending start across reopening without duplicating attempts', async () => {
    let resolve!: (value: unknown) => void;
    requests.mockResolvedValueOnce(material()).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = render(activity());
    await waitFor(() => expect(starts()).toHaveLength(1));
    first.unmount();
    render(activity());
    await screen.findByText('Reading content');
    await act(async () => resolve({ attempt_id: 'draft', definition: {}, timing }));
    await finishReady();
    expect(starts()).toHaveLength(1);
  });

  it('cancels pending manual submission when switching learner identity', async () => {
    const view = render(activity());
    await finishReady();
    fireEvent.change(screen.getByLabelText('Minutes spent'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByRole('alertdialog');
    view.rerender(activity('10'));
    await finishReady();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Minutes spent')).toHaveValue('');
    expect(submissions()).toHaveLength(0);
    expect(starts().map(([url]) => url)).toEqual([
      '/learner_api/student-activity/commercial/9/50/60/attempts/',
      '/learner_api/student-activity/commercial/10/50/60/attempts/',
    ]);
  });
});
