import * as React from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TimetablePage from './page';
import { coachFetch } from '@/lib/coachFetch';
import { bookMigratedReview, fetchReviewInstanceForm, rescheduleMigratedReview } from '@/api/reviewInstances';
import { installDialogTestSupport, personalSupportBooking } from '../shared/__tests__/importedBookingFixtures';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.invalid', name: 'Coach', isInitialized: true, isViewingAsCoach: false }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/api/reviewInstances', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), bookMigratedReview: vi.fn(), rescheduleMigratedReview: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('AppIcon', () => null);
  installDialogTestSupport();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([false, true])('uses the PSP appointment API from the calendar (scheduled=%s)', async scheduled => {
  const event = {
    id: 'imported-review:31', eventKey: 'imported-review:31', source: 'progress-review', type: 'review',
    reviewSource: 'aptem', importedReviewType: 'Personal Support Plan', title: 'Personal Support Plan',
    learner: 'Synthetic learner', learnerId: '31', status: scheduled ? 'scheduled' : 'not-scheduled',
    date: '2026-09-22', targetDate: '2026-09-22', year: 2026, month: 8, dayOfMonth: 22, dayOfWeek: 1,
    startHour: 10, endHour: 11, scheduledTime: scheduled ? '10:00' : null,
    scheduledDate: scheduled ? '2026-09-22' : null, calendarEventKey: scheduled ? 'imported-review:31' : null,
    priority: 'normal',
  };
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ events: [event] }), { status: 200 }));
  vi.mocked(fetchReviewInstanceForm).mockResolvedValue(personalSupportBooking(scheduled));
  vi.mocked(bookMigratedReview).mockResolvedValue(personalSupportBooking(true));
  vi.mocked(rescheduleMigratedReview).mockResolvedValue(personalSupportBooking(true));
  render(<MemoryRouter initialEntries={[{ pathname: '/coach/timetable', state: { focusEvent: {
    eventKey: event.eventKey, source: event.source, date: event.date,
  } } }]}><TimetablePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: scheduled ? 'Reschedule' : 'Schedule' }));
  expect(await screen.findByRole('heading', { name: `${scheduled ? 'Reschedule' : 'Schedule'} Personal Support Plan` })).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: scheduled ? 'Save new time' : 'Confirm booking' }));
  await waitFor(() => expect(scheduled ? rescheduleMigratedReview : bookMigratedReview).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: 'Reschedule' })).toBeVisible();
  expect(vi.mocked(coachFetch).mock.calls.some(([url]) => String(url).includes('/events/schedule'))).toBe(false);
});
