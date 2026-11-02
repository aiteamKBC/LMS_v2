import * as React from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
