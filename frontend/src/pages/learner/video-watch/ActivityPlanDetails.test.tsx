import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import type { LearnerKind } from '@/api/learnerDetail';
import type { JourneyComponent } from '@/utils/learnerJourney';
import { ActivityPlanDetails } from './ActivityPlanDetails';
import { ActivitySidebar } from './ActivitySidebar';
import { learningSchedule } from '@/api/learnerOverview';

vi.mock('@/api/learnerOverview', () => ({
  learningSchedule: { read: vi.fn().mockResolvedValue({ modules: [] }), peek: () => undefined },
}));

const response = (mode: string, extra = {}) => new Response(JSON.stringify({ mode, ...extra }));
const badge = (kind = 'commercial', learnerId = '12', componentType = 'live_session', hours: number | null = 2) =>
  <ActivityPlanDetails hours={hours} componentType={componentType} kind={kind} learnerId={learnerId} />;

beforeEach(() => {
  clearAllCachedResources();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response('live')));
  vi.mocked(learningSchedule.read).mockClear();
});
afterEach(() => {
  cleanup();
  clearAllCachedResources();
  vi.unstubAllGlobals();
});

describe('the required live-session activity for each learner', () => {
  it.each<[LearnerKind, string, string]>([
    ['commercial', 'live', 'Required: Live attendance'],
    ['commercial', 'lazy', 'Required: Recording'],
    ['apprenticeship', 'live', 'Required: Live attendance'],
    ['apprenticeship', 'lazy', 'Required: Recording'],
  ])('uses the active mode for %s learners (%s)', async (kind, mode, label) => {
    vi.mocked(fetch).mockResolvedValue(response(mode));
    render(badge(kind));
    expect(await screen.findByText(label)).toBeVisible();
    expect(screen.getByText('2h')).toBeVisible();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/learner_api/attendance/${kind}/12/mode/`,
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBeUndefined();
  });

  it('keeps live attendance required while a Recorded request is pending', async () => {
    vi.mocked(fetch).mockResolvedValue(response('live', { requestedMode: 'lazy', status: 'pending' }));
    render(badge());
    expect(await screen.findByText('Required: Live attendance')).toBeVisible();
    expect(screen.queryByText('Required: Recording')).not.toBeInTheDocument();
  });

  it.each(['reading', 'quiz', 'video', 'recording_placeholder'])('preserves the %s requirement without requesting attendance', type => {
    render(badge('commercial', '12', type));
    expect(screen.getByText('Required')).toBeVisible();
    expect(screen.getByText('2h')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not request a learner mode for unallocated sessions, personal learning, or missing learner context', () => {
    render(<>{badge('commercial', '12', 'live_session', 0)}
      {badge('commercial', 'pl.7.study.M1')}
      <ActivityPlanDetails hours={2} componentType="live_session" />
    </>);
    expect(screen.getAllByText('Required')).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows no guessed delivery requirement while loading or after an unavailable response', async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(done => { resolve = done; }));
    render(badge());
    expect(screen.getByText('Required')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/Required:/)).not.toBeInTheDocument();
    await act(async () => { resolve(new Response(JSON.stringify({ error: 'Access unavailable.' }), { status: 403 })); });
    expect(await screen.findByText('Attendance requirement unavailable.')).toBeVisible();
    expect(screen.getByText('Required')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText(/Required:/)).not.toBeInTheDocument();
  });

  it('does not treat a missing or invalid active mode as live attendance', async () => {
    vi.mocked(fetch).mockResolvedValue(response('unexpected', { requestedMode: 'lazy' }));
    render(badge());
    expect(await screen.findByText('Attendance requirement unavailable.')).toBeVisible();
    expect(screen.queryByText(/Required:/)).not.toBeInTheDocument();
  });

  it('keeps another learner\'s late response out of the current requirement', async () => {
    let resolvePrevious!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolvePrevious = done; }))
      .mockResolvedValueOnce(response('live'));
    const { rerender } = render(badge('commercial', '12'));
    rerender(badge('commercial', '13'));
    expect(await screen.findByText('Required: Live attendance')).toBeVisible();
    await act(async () => { resolvePrevious(response('lazy')); });
    expect(screen.queryByText('Required: Recording')).not.toBeInTheDocument();
    expect(screen.getByText('Required: Live attendance')).toBeVisible();
  });

  it('separates commercial and apprenticeship identities even with the same record id', async () => {
    vi.mocked(fetch).mockImplementation(async input => response(String(input).includes('/commercial/') ? 'lazy' : 'live'));
    const { rerender } = render(badge('commercial', '12'));
    expect(await screen.findByText('Required: Recording')).toBeVisible();
    rerender(badge('apprenticeship', '12'));
    expect(screen.queryByText('Required: Recording')).not.toBeInTheDocument();
    expect(await screen.findByText('Required: Live attendance')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes the label after the existing learner-read invalidation without any write', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response('live')).mockResolvedValueOnce(response('lazy'));
    render(badge());
    expect(await screen.findByText('Required: Live attendance')).toBeVisible();
    act(() => invalidateLearnerReads());
    expect(await screen.findByText('Required: Recording')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('shares the mode across the heading and both sidebar lists while retaining progress and catalogue dates', async () => {
    vi.mocked(fetch).mockResolvedValue(response('lazy'));
    const live: JourneyComponent = { componentId: 'LIVE', title: 'Current lecture', type: 'live_session', expectedOtjh: 2,
      liveSessionUrl: '/join/current' };
    const later = { ...live, componentId: 'LATER', title: 'Later lecture' };
    const completed = new Set(['LIVE']);
    render(<MemoryRouter>{badge()}
      <ActivitySidebar weekComponents={[live]} weekTitle="Week 1" moduleTitle="Synthetic module"
        attendanceLearner={{ kind: 'commercial', id: '12' }}
        weeks={[{ key: 'W1', week: 'Week 1', count: 1, completed: 1, active: true, components: [live] },
          { key: 'W2', week: 'Week 2', count: 1, completed: 0, active: false, components: [later] }]}
        completedIds={completed} currentComponentId="LIVE" routeFor={component => `/activity/${component.componentId}`} />
    </MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Required: Recording')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /^Week 2,/ }));
    const laterRow = screen.getByRole('button', { name: /Later lecture/ });
    expect(await within(laterRow).findByText('Required: Recording')).toBeVisible();
    expect(screen.getByText(/1 done/)).toBeVisible();
    expect(completed).toEqual(new Set(['LIVE']));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(learningSchedule.read).not.toHaveBeenCalled();
  });
});
