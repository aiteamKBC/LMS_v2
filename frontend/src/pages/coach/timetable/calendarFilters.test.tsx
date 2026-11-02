import * as React from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TimetablePage from './page';
import { coachFetch } from '@/lib/coachFetch';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.invalid', name: 'Coach', isInitialized: true }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

const imported = (id: string, importedReviewType: string, day = 2, status = 'scheduled') => ({
  id, eventKey: id, title: `Conversation ${id}`, importedReviewType,
  reviewSource: 'aptem', source: importedReviewType === 'Monthly Coaching Meeting' ? 'mcr' : 'progress-review',
  type: 'review', learner: 'Synthetic learner', learnerId: '31', status, priority: 'normal',
  date: `2026-11-${String(day).padStart(2, '0')}`, year: 2026, month: 10, dayOfMonth: day,
  dayOfWeek: day - 2, startHour: 10, endHour: 11, scheduledTime: '10:00',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 2, 8));
  vi.stubGlobal('React', React);
  vi.stubGlobal('AppIcon', () => null);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected unmocked request'); }));
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ events: [
    imported('monthly-open', 'Monthly Coaching Meeting'),
    imported('monthly-done', 'Monthly Coaching Meeting', 3, 'completed'),
    imported('support', 'Personal Support Plan'),
    imported('progress', 'Progress Review', 4),
    { ...imported('next-month', 'Progress Review (+ Skills Radar)'), date: '2026-12-02', month: 11 },
  ] }), { status: 200 }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('combines imported type, status, search and visible-period filters with matching counts', async () => {
  render(<MemoryRouter><TimetablePage /></MemoryRouter>);
  const sources = within(await screen.findByRole('group', { name: 'Source filters' }));
  const statuses = within(screen.getByRole('group', { name: 'Status filters' }));
  fireEvent.click(await sources.findByTitle('Monthly Coaching Meeting (2)'));
  expect(statuses.getByTitle('All (2)')).toBeVisible();
  expect(statuses.getByTitle('Completed (1)')).toBeVisible();
  expect(screen.queryByTitle('Conversation support')).not.toBeInTheDocument();
  fireEvent.click(statuses.getByTitle('Completed (1)'));
  expect(screen.getByTitle('Conversation monthly-done')).toBeVisible();
  expect(screen.queryByTitle('Conversation monthly-open')).not.toBeInTheDocument();
  fireEvent.click(statuses.getByTitle('All (2)'));
  fireEvent.click(sources.getByTitle('All Sources (4)'));
  fireEvent.change(screen.getByPlaceholderText('Search events or learner names...'), { target: { value: 'Personal Support Plan' } });
  expect(sources.getByTitle('All Sources (1)')).toBeVisible();
  expect(screen.getByTitle('Conversation support')).toBeVisible();
  expect(sources.getByTitle('Monthly Coaching Meeting (0)')).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Search events or learner names...'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Day' }));
  expect(sources.getByTitle('All Sources (2)')).toBeVisible();
  expect(sources.getByTitle('Monthly Coaching Meeting (1)')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Week' }));
  expect(sources.getByTitle('All Sources (4)')).toBeVisible();
  expect(sources.getByTitle('Progress Review (+ Skills Radar) (0)')).toBeVisible();
});

it('shows all six of today\'s imported MCMs in the same filter as native bookings', async () => {
  const today = ['completed', 'ended', 'completed', 'completed', 'completed', 'scheduled']
    .map((status, index) => ({
      ...imported(`today-${index}`, 'Monthly Coaching Meeting', 2, status === 'ended' ? 'scheduled' : status),
      meetingOutcome: status === 'ended' ? 'ended' : undefined,
      startHour: 9 + index, endHour: 10 + index,
    }));
  const native = [3, 6].map(day => ({
    ...imported(`native-${day}`, 'Monthly Coaching Meeting', day),
    importedReviewType: undefined, reviewSource: undefined,
    reviewTypeId: 'REVT-MCM', reviewTypeCode: 'mcm',
    reviewTypeName: 'Monthly Coaching Meeting', reviewTypeIsSystem: true,
  }));
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({
    events: [...today, ...native, imported('different-type', 'Personal Support Plan')],
  }), { status: 200 }));
  render(<MemoryRouter><TimetablePage /></MemoryRouter>);
  const sources = within(await screen.findByRole('group', { name: 'Source filters' }));
  const statuses = within(screen.getByRole('group', { name: 'Status filters' }));
  const monthly = await sources.findByTitle('Monthly Coaching Meeting (8)');
  expect(sources.getAllByRole('button', { name: /Monthly Coaching Meeting/ })).toHaveLength(1);
  fireEvent.click(monthly);
  expect(statuses.getByTitle('All (8)')).toBeVisible();
  expect(statuses.getByTitle('Completed (4)')).toBeVisible();
  expect(statuses.getByTitle('Scheduled (3)')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Show all 6 events for 2 November 2026' }));
  const day = within(document.getElementById('coach-day-events-2026-11-02')!);
  today.forEach(event => expect(day.getByTitle(event.title)).toBeVisible());
  expect(screen.queryByTitle('Conversation different-type')).not.toBeInTheDocument();
  fireEvent.click(statuses.getByTitle('Completed (4)'));
  expect(day.getAllByTitle(/Conversation today-/)).toHaveLength(4);
  fireEvent.click(statuses.getByTitle('All (8)'));
  fireEvent.click(screen.getByRole('button', { name: 'Day' }));
  expect(sources.getByTitle('Monthly Coaching Meeting (6)')).toHaveAttribute('aria-pressed', 'true');
  expect(statuses.getByTitle('All (6)')).toBeVisible();
  expect(vi.mocked(coachFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('matches Ended and Completed filters to displayed outcomes for every meeting source', async () => {
  const sourcesToCheck = [
    ['mcr', 'Monthly Coaching Meeting'], ['progress-review', 'Progress Review'],
    ['review', 'Personal Support Plan'], ['live-session', 'Live Sessions'],
    ['catch-up', 'Catch-up'], ['student-support', 'Support'],
  ];
  const events = sourcesToCheck.flatMap(([source, label]) => ['ended', 'completed', null].map((outcome, index) => ({
    ...imported(`${source}-${index}`, label), source,
    importedReviewType: ['mcr', 'progress-review', 'review'].includes(source) ? label : undefined,
    type: source === 'live-session' ? 'live-session' : 'coaching',
    status: index === 0 ? 'in-progress' : 'scheduled', meetingOutcome: outcome,
    scheduledDate: '2026-11-02', scheduledTime: '10:00', durationMinutes: 60,
  })));
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ events }), { status: 200 }));
  render(<MemoryRouter><TimetablePage /></MemoryRouter>);
  const sources = within(await screen.findByRole('group', { name: 'Source filters' }));
  const statuses = within(screen.getByRole('group', { name: 'Status filters' }));
  await sources.findByTitle('All Sources (18)');
  expect(statuses.getByTitle('Ended (6)')).toBeVisible();
  expect(statuses.getByTitle('Completed (6)')).toBeVisible();
  expect(statuses.getByTitle('Scheduled (6)')).toBeVisible();
  expect(statuses.getByTitle('In Progress (0)')).toBeVisible();
  const day = within(document.getElementById('coach-day-events-2026-11-02')!);
  for (const [source, label] of sourcesToCheck) {
    fireEvent.click(sources.getByTitle(`${label} (3)`));
    for (const [status, index] of [['Ended', 0], ['Completed', 1], ['Scheduled', 2]] as const) {
      fireEvent.click(statuses.getByTitle(`${status} (1)`));
      expect(day.getAllByTitle(/Conversation/)).toHaveLength(1);
      expect(day.getByTitle(`Conversation ${source}-${index}`)).toBeVisible();
    }
    fireEvent.click(statuses.getByTitle('All (3)'));
  }
});

it('keeps custom review classification when native bookings are outside the visible month', async () => {
  const importedSupport = imported('imported-support', 'Personal Support Plan');
  const nativeSupport = {
    ...imported('native-support', 'Personal Support Plan'), importedReviewType: undefined,
    reviewTypeId: 'PSP', reviewTypeName: 'Personal Support Plan',
    date: '2026-12-02', month: 11,
  };
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ events: [
    importedSupport, nativeSupport, imported('gateway', 'Gateway Review'),
  ] }), { status: 200 }));
  render(<MemoryRouter><TimetablePage /></MemoryRouter>);
  const sources = within(await screen.findByRole('group', { name: 'Source filters' }));
  fireEvent.click(await sources.findByTitle('Personal Support Plan (1)'));
  expect(sources.getAllByRole('button', { name: /Personal Support Plan/ })).toHaveLength(1);
  expect(screen.getByTitle('Conversation imported-support')).toBeVisible();
  expect(screen.queryByTitle('Conversation gateway')).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search events or learner names...'), { target: { value: 'imported-support' } });
  expect(sources.getByTitle('Personal Support Plan (1)')).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Search events or learner names...'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
  expect(sources.getByTitle('Personal Support Plan (1)')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTitle('Conversation native-support')).toBeVisible();
});

const crowdedDay = (month = 10) => Array.from({ length: 5 }, (_, index) => ({
  ...imported(`overflow-${month}-${index}`, 'Monthly Coaching Meeting', 3, index < 3 ? 'scheduled' : 'completed'),
  date: `2026-${String(month + 1).padStart(2, '0')}-03`, month,
  startHour: index === 4 ? 21 : 9 + index, endHour: index === 4 ? 22 : 10 + index,
}));

function mockCrowdedCalendar() {
  vi.mocked(coachFetch).mockImplementation(async () => new Response(JSON.stringify({ events: [
    ...crowdedDay(), ...crowdedDay(11),
    imported('another-day', 'Monthly Coaching Meeting', 2),
    imported('other-source', 'Personal Support Plan', 3),
  ] }), { status: 200 }));
}

async function showMonthlyMeetings() {
  render(<MemoryRouter><TimetablePage /></MemoryRouter>);
  const sources = within(await screen.findByRole('group', { name: 'Source filters' }));
  fireEvent.click(await sources.findByTitle('Monthly Coaching Meeting (6)'));
  return screen.findByRole('button', { name: 'Show all 5 events for 3 November 2026' });
}

it('expands and collapses hidden month events and opens their existing preview without booking', async () => {
  mockCrowdedCalendar();
  const user = userEvent.setup();
  const more = await showMonthlyMeetings();
  const list = within(document.getElementById(more.getAttribute('aria-controls')!)!);
  expect(more).toHaveTextContent('+2 more');
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(list.getAllByRole('button', { expanded: false })).toHaveLength(1);
  expect(list.queryByTitle('Conversation overflow-10-4')).not.toBeInTheDocument();
  await user.click(more);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(list.getAllByRole('button')).toHaveLength(6); // Five events plus collapse.
  expect(list.queryByTitle('Conversation other-source')).not.toBeInTheDocument();
  expect(list.queryByTitle('Conversation another-day')).not.toBeInTheDocument();
  await user.click(list.getByTitle('Conversation overflow-10-4'));
  expect(screen.getByRole('dialog', { name: 'Conversation overflow-10-4' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Close event details' }));
  await user.click(screen.getByRole('button', { name: 'Show fewer events for 3 November 2026' }));
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(list.getAllByRole('button')).toHaveLength(4);
  expect(list.queryByTitle('Conversation overflow-10-4')).not.toBeInTheDocument();
  expect(vi.mocked(coachFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it.each(['{Enter}', ' '])('supports keyboard expansion with %j and keeps status/search filters', async key => {
  mockCrowdedCalendar();
  const user = userEvent.setup();
  const more = await showMonthlyMeetings();
  more.focus();
  await user.keyboard(key);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(more).toHaveFocus();
  const list = within(document.getElementById(more.getAttribute('aria-controls')!)!);
  const statuses = within(screen.getByRole('group', { name: 'Status filters' }));
  await user.click(statuses.getByTitle('Scheduled (4)'));
  expect(list.queryByTitle('Conversation overflow-10-4')).not.toBeInTheDocument();
  expect(list.getAllByRole('button')).toHaveLength(3);
  await user.click(statuses.getByTitle('All (6)'));
  expect(list.getByTitle('Conversation overflow-10-4')).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Search events or learner names...'), { target: { value: 'overflow-10-4' } });
  expect(list.getAllByRole('button')).toHaveLength(1);
  expect(list.getByTitle('Conversation overflow-10-4')).toBeVisible();
});

it('keeps expansion scoped to the full date when navigating months', async () => {
  mockCrowdedCalendar();
  const user = userEvent.setup();
  await user.click(await showMonthlyMeetings());
  await user.click(screen.getByRole('button', { name: 'Next period' }));
  const december = screen.getByRole('button', { name: 'Show all 5 events for 3 December 2026' });
  expect(december).toHaveAttribute('aria-expanded', 'false');
  expect(within(document.getElementById(december.getAttribute('aria-controls')!)!).queryByTitle('Conversation overflow-11-4')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Previous period' }));
  expect(screen.getByRole('button', { name: 'Show fewer events for 3 November 2026' })).toHaveAttribute('aria-expanded', 'true');
});
