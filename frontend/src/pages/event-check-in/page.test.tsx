import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { eventCheckInApi } from '@/api/eventCheckIn';
import EventCheckInPage from './page';

vi.mock('@/api/eventCheckIn', () => ({ eventCheckInApi: { event: vi.fn(), submit: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('opens a token-scoped attendance form without asking the visitor to sign in', async () => {
  vi.mocked(eventCheckInApi.event).mockResolvedValue({
    event: { title: 'Leadership Day', date: '25 Oct 2026', time: '09:00 - 16:00', location: 'London', state: 'open', opensAt: null, closesAt: null },
  });
  render(<MemoryRouter initialEntries={['/event-check-in#token=event-token']}><EventCheckInPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Leadership Day' })).toBeVisible();
  expect(screen.getByLabelText('Full name')).toBeVisible();
  expect(screen.getByLabelText('Email address')).toBeVisible();
  expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  expect(eventCheckInApi.event).toHaveBeenCalledWith('event-token');
});

it('shows the server-controlled closed state instead of the attendance fields', async () => {
  vi.mocked(eventCheckInApi.event).mockResolvedValue({
    event: { title: 'Past Event', date: '20 Oct 2026', time: '09:00 - 16:00', location: 'Kent', state: 'closed', opensAt: null, closesAt: null },
  });
  render(<MemoryRouter initialEntries={['/event-check-in#token=event-token']}><EventCheckInPage /></MemoryRouter>);
  expect(await screen.findByText('Check-in for this event has closed.')).toBeVisible();
  expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
});
