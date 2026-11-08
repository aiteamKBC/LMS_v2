import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { officialHoursPresentation, hoursText } from './officialHoursPresentation';
import { OverviewTab } from './components/OverviewTab';
import { OtjhBody } from '@/components/feature/RealOtjhView';
import type { LearnerMetrics } from '@/api/learnerMetrics';

const metrics = (planned: unknown, actual: unknown = 120) => ({
  otjh: { planned, actual, historical: 576, new: 20 },
  ksb: { total: 1, completed: 1, percent: 100, status: 'ready', codes: [] },
  programme: { total: 1, completed: 1, percent: 100, status: 'ready' },
}) as LearnerMetrics;

// Components are presentational here; any accidental request fails locally.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));

describe('official Progress availability', () => {
  it.each([null, 0, -1, undefined, NaN, Infinity, '288'])('guards planned %s without fabricated success', planned => {
    const data = metrics(planned);
    const state = officialHoursPresentation(data, false, null);
    render(<MemoryRouter><OverviewTab real={null} realLoading={false} metrics={data}
      officialHours={state} auditOtjhPlanned={400} auditOtjhActual={20} onNavigateTab={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Hours comparison unavailable')).toBeVisible();
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    const card = screen.getByRole('button', { name: /OTJ Hours/ });
    expect(within(card).getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(card).toHaveTextContent('Official Planned Hours');
    expect(card).not.toHaveTextContent('400');
  });
  it.each([[120, 42], [0, 0]])('retains actual %s and percentage %s', (actual, percent) => {
    const data = metrics(288, actual);
    render(<MemoryRouter><OverviewTab real={null} realLoading={false} metrics={data}
      officialHours={officialHoursPresentation(data, false, null)} onNavigateTab={vi.fn()} /></MemoryRouter>);
    expect(within(screen.getByRole('button', { name: /OTJ Hours/ })).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(percent));
    expect(screen.getByText(/Official Planned Hours 288/)).toBeVisible();
  });
  it.each([null, undefined, -1, NaN])('guards unavailable actual %s independently', actual => {
    const state = officialHoursPresentation({ otjh: { planned: 288, actual } }, false, null);
    expect(state.comparable).toBe(false);
    expect(hoursText(state, 'planned', String)).toBe('288');
    expect(hoursText(state, 'actual', String)).toBe('Unavailable');
  });
  it('distinguishes null, missing, invalid and valid zero', () => {
    expect(officialHoursPresentation(metrics(null), false, null).planned.state).toBe('null');
    expect(officialHoursPresentation({ otjh: { actual: 120 } }, false, null).planned.state).toBe('missing');
    expect(officialHoursPresentation(metrics(-1), false, null).planned.state).toBe('invalid');
    expect(hoursText(officialHoursPresentation(metrics(0), false, null), 'planned', String)).toBe('0');
  });
  it.each([null, {}, { otjh: null }, { otjh: 'bad' }])('handles malformed payload %j', data => {
    expect(officialHoursPresentation(data, false, null).comparable).toBe(false);
  });
  it.each([[true, null, 'pending'], [false, 'Failed', 'error']])('suppresses stale success on request state', (loading, error, request) => {
    const state = officialHoursPresentation(metrics(288), Boolean(loading), error);
    expect(state.request).toBe(request);
    expect(state.comparable).toBe(false);
    render(<OtjhBody real={null} loading={false} showHero={false} metrics={null} officialHours={state} />);
    expect(screen.getByText('Official Planned Hours')).toBeVisible();
    expect(screen.getByText('Recorded scope')).toBeVisible();
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
    expect(screen.queryByText(/0% of plan/)).not.toBeInTheDocument();
    expect(screen.queryByText('Current target')).not.toBeInTheDocument();
  });
});


describe('scoped OTJ values', () => {
  it.each([[288, '288.00 h'], [null, 'Not set'], [0, '0.00 h'], [-1, 'Unavailable']])('renders official %s independently of actual', (planned, text) => {
    const data = metrics(planned);
    render(<OtjhBody real={null} loading={false} showHero={false} metrics={data} officialHours={officialHoursPresentation(data, false, null)} />);
    expect(screen.getByText(String(text))).toBeVisible();
    expect(screen.getByText('120.00 h')).toBeVisible();
  });
  it('preserves KSB attention when hours are unavailable', () => {
    const data = metrics(null); data.ksb.codes = [{ code: 'K1', completed: 0, total: 1, percent: 0 }];
    render(<MemoryRouter><OverviewTab real={null} realLoading={false} metrics={data} officialHours={officialHoursPresentation(data, false, null)} onNavigateTab={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('1 KSB not started yet')).toBeVisible();
    expect(screen.getByText('1 of 1 points achieved')).toBeVisible();
  });
});
