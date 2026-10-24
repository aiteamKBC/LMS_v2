import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import CoachMeetingDetail from './page';

const api = vi.hoisted(() => ({
  events: vi.fn(), form: vi.fn(), intelligence: vi.fn(), generic: vi.fn(),
  coach: { email: 'coach@example.invalid', name: 'Coach Example', isInitialized: true, isViewingAsCoach: false },
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => api.coach }));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents: api.events,
  fetchCoachMeetingArtifacts: api.generic,
}));
vi.mock('@/api/reviewInstances', () => ({
  fetchReviewInstanceForm: api.form,
  fetchMigratedReviewIntelligence: api.intelligence,
  saveMigratedMeetingSummary: vi.fn(),
  initializeMigratedReview: vi.fn(), bookMigratedReview: vi.fn(), rescheduleMigratedReview: vi.fn(),
  openReviewInstanceForEvent: vi.fn(), markReviewInstanceInProgressManually: vi.fn(),
}));

const id = 'imported-review:synthetic-check';
const result = {
  artifacts: [], errors: [],
  intelligence: { attendanceStatus: 'not-checked', recordingStatus: 'unknown', transcriptStatus: 'pending', summaryStatus: 'not-generated', errorCodes: [] },
  summaryBinding: { fieldKey: 'recap', status: 'summary-unavailable', answer: '' },
};

function arrange(family = 'aptem_mcm', title = 'Monthly Coaching Meeting', status = 'scheduled') {
  api.events.mockResolvedValue({ owner: { name: 'Coach Example' }, events: [{
    id, eventKey: id, reviewSource: 'aptem', source: family === 'aptem_mcm' ? 'mcr' : 'progress-review',
    type: family === 'aptem_mcm' ? 'coaching' : 'review', title, importedReviewType: title,
    learner: 'Synthetic learner', learnerId: '42', status,
    scheduledDate: '2099-10-22', scheduledTime: '10:00', targetDate: '2099-10-22',
    durationMinutes: 60, meetingLink: 'https://example.invalid/meeting',
  }] });
  api.form.mockResolvedValue({
    source: 'aptem', migratedForm: true, formAvailable: true,
    instance: { id, learnerId: 42, status }, localStatus: status,
    template: { reviewTypeCode: family }, summaryBinding: result.summaryBinding,
    booking: { eventKey: id, booked: true, syncState: 'synced', meetingLink: 'https://example.invalid/meeting' },
  });
}

function mount(progressReview = false) {
  return render(<MemoryRouter initialEntries={[`/coach/${progressReview ? 'progress-reviews' : 'meetings'}/${encodeURIComponent(id)}`]}>
    <Routes>
      <Route path="/coach/meetings/:eventKey" element={<CoachMeetingDetail />} />
      <Route path="/coach/progress-reviews/:eventKey" element={<CoachMeetingDetail />} />
    </Routes>
  </MemoryRouter>);
}

function ChangeMeeting() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/coach/meetings/imported-review%3Anext')}>Next meeting</button>;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.coach.isViewingAsCoach = false;
  api.intelligence.mockResolvedValue(result);
  api.generic.mockResolvedValue({ artifacts: [], errors: [] });
});
afterEach(cleanup);

describe('one migrated session check from review details and form', () => {
  it.each([true, false])('uses the authoritative stored form key even when it differs from the event key (hint=%s)', async hasHint => {
    arrange();
    const events = await api.events();
    const form = await api.form();
    const formKey = 'imported-review:407';
    api.events.mockResolvedValue({ ...events, events: [{ ...events.events[0], ...(hasHint ? { formEventKey: formKey } : {}) }] });
    api.form.mockResolvedValue({ ...form, instance: { ...form.instance, id: formKey } });
    mount();
    const check = await screen.findByRole('button', { name: 'Check Session' });
    await waitFor(() => expect(check).toBeEnabled());
    expect(api.form).toHaveBeenLastCalledWith(hasHint ? formKey : id, expect.any(AbortSignal));
    expect(api.intelligence).toHaveBeenLastCalledWith(formKey, expect.any(AbortSignal), { refresh: false });
    fireEvent.click(check);
    await waitFor(() => expect(api.intelligence).toHaveBeenLastCalledWith(formKey, undefined, { refresh: true }));
    expect(api.generic).not.toHaveBeenCalled();
  });

  it('ignores an old form response after navigating to a different meeting', async () => {
    arrange();
    const events = await api.events();
    const form = await api.form();
    api.form.mockClear();
    let resolveOld!: (value: unknown) => void;
    api.form.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    render(<MemoryRouter initialEntries={[`/coach/meetings/${encodeURIComponent(id)}`]}>
      <ChangeMeeting /><Routes><Route path="/coach/meetings/:eventKey" element={<CoachMeetingDetail />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => expect(api.form).toHaveBeenCalledWith(id, expect.any(AbortSignal)));
    const next = 'imported-review:next';
    api.events.mockResolvedValue({ ...events, events: [{ ...events.events[0], id: next, eventKey: next }] });
    api.form.mockResolvedValue({ ...form, instance: { ...form.instance, id: next } });
    fireEvent.click(screen.getByRole('button', { name: 'Next meeting' }));
    await screen.findByRole('button', { name: 'Check Session' });
    await act(async () => { resolveOld(form); });
    expect(api.intelligence.mock.calls.every(call => call[0] === next)).toBe(true);
    expect(api.form.mock.calls[0][1].aborted).toBe(true);
  });
  it.each([
    ['aptem_mcm', 'Monthly Coaching Meeting'],
    ['aptem_progress_review', 'Progress Review'],
    ['aptem_progress_review', 'Progress Review + Skills Radar'],
  ])('uses the form endpoint and saved summary for %s / %s', async (family, title) => {
    arrange(family, title);
    mount(family !== 'aptem_mcm');
    const button = await screen.findByRole('button', { name: 'Check Session' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(api.intelligence).toHaveBeenCalledExactlyOnceWith(id, expect.any(AbortSignal), { refresh: false });
    api.intelligence.mockResolvedValue({ ...result,
      summaryBinding: { fieldKey: 'recap', state: 'COACH_EDITED', answer: 'Saved coach summary' },
      meetingSummary: { summary: { overview: 'Old AI summary' }, status: 'ready' },
    });
    fireEvent.click(button);
    expect(await screen.findByText('Saved coach summary')).toBeVisible();
    expect(api.intelligence).toHaveBeenLastCalledWith(id, undefined, { refresh: true });
    expect(screen.queryByText('Old AI summary')).not.toBeInTheDocument();
    expect(api.generic).not.toHaveBeenCalled();
  });

  it('allows an explicit retry when Teams has not prepared the ended-session report', async () => {
    arrange();
    mount();
    const button = await screen.findByRole('button', { name: 'Check Session' });
    await waitFor(() => expect(button).toBeEnabled());
    api.intelligence.mockRejectedValueOnce(new Error('Teams has not confirmed that this session has ended yet.'));
    fireEvent.click(button);
    expect(await screen.findByText('Teams has not confirmed that this session has ended yet.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Check Session' }));
    await waitFor(() => expect(api.intelligence).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText('Teams has not confirmed that this session has ended yet.')).not.toBeInTheDocument());
    expect(api.generic).not.toHaveBeenCalled();
  });

  it('keeps admin view-as read-only', async () => {
    arrange();
    api.coach.isViewingAsCoach = true;
    mount();
    const button = await screen.findByRole('button', { name: 'Check Session' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.intelligence).toHaveBeenCalledOnce());
    expect(api.intelligence.mock.calls[0][2]).toEqual({ refresh: false });
    expect(api.generic).not.toHaveBeenCalled();
  });

  it.each(['completed', 'awaiting-signature'])('shows stored results only for %s reviews', async status => {
    arrange('aptem_mcm', 'Monthly Coaching Meeting', status);
    mount();
    await screen.findByRole('region', { name: 'Meeting Intelligence' });
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.intelligence).toHaveBeenCalledOnce());
    expect(api.generic).not.toHaveBeenCalled();
  });

  it('does not fall back to the generic write path if the review cannot load', async () => {
    arrange();
    api.form.mockRejectedValue(new Error('Review unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Review unavailable');
    expect(api.generic).not.toHaveBeenCalled();
    expect(api.intelligence).not.toHaveBeenCalled();
  });

  it('keeps native meetings on their existing artifacts endpoint', async () => {
    arrange();
    api.events.mockResolvedValue({ events: [{ id, eventKey: id, source: 'progress-review', type: 'review',
      status: 'scheduled', reviewSource: 'curriculum', meetingLink: 'https://example.invalid/native' }] });
    mount(true);
    const button = await screen.findByRole('button', { name: 'Check Teams' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(api.generic).toHaveBeenLastCalledWith(id, undefined, { refresh: true }));
    expect(api.intelligence).not.toHaveBeenCalled();
  });

  it('keeps imported PSP on explicit Check Teams without MCM/PR summary actions', async () => {
    arrange('aptem_psp', 'Personal Support Plan');
    mount(true);
    const button = await screen.findByRole('button', { name: 'Check Teams' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(api.generic).toHaveBeenCalledExactlyOnceWith(id, expect.any(AbortSignal), { refresh: false });
    fireEvent.click(button);
    await waitFor(() => expect(api.generic).toHaveBeenLastCalledWith(id, undefined, { refresh: true }));
    expect(api.generic).toHaveBeenCalledTimes(2);
    expect(api.intelligence).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Transcript' })).not.toBeInTheDocument();
  });
});
