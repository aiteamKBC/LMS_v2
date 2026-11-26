import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CoachCalendarEvent } from '../../shared/calendarEvents';
import { MeetingActionsMenu } from './MeetingActionsMenu';

const loadLinks = vi.hoisted(() => vi.fn());
vi.mock('../../shared/reviewAttendanceLinks', () => ({ reviewAttendanceLinks: loadLinks }));

const event = {
  eventKey: 'review:21:template:1', source: 'mcr', status: 'in-progress', reviewInstanceId: 'instance-21',
} as CoachCalendarEvent;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it.each([false, true])('shows native Reschedule only when the server allows it (%s)', async allowed => {
  loadLinks.mockResolvedValue({ canReschedule: allowed });
  render(<MeetingActionsMenu learner="Example learner" event={event} actions={[
    { label: 'View details', icon: 'ri-eye-line', onSelect: vi.fn() },
    { label: 'Reschedule', icon: 'ri-calendar-line', onSelect: vi.fn() },
  ]} />);
  await act(async () => { await loadLinks.mock.results[0].value; });
  await screen.findByRole('button', { name: 'More actions for Example learner' });
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Example learner' }));
  if (allowed) expect(await screen.findByRole('menuitem', { name: 'Reschedule' })).toBeVisible();
  else expect(screen.queryByRole('menuitem', { name: 'Reschedule' })).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'View details' })).toBeVisible();
});
