import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventEmailManager } from './EventEmailManager';

vi.mock('./EventEmailEditor', () => ({
  EventEmailEditor: ({ purpose }: { purpose: string }) => <div>{purpose} editor</div>,
}));

const event = {
  id: '17', title: 'Leadership workshop', description: '', date: '3 Oct 2026',
  time: '10:00', location: 'Main Hall', organizer: 'Staff', type: 'offline' as const,
  eventDate: '2026-10-03', startTime: '10:00', endTime: '12:00',
  attendees: 0, status: 'upcoming' as const,
};

describe('EventEmailManager', () => {
  it('keeps RSVP and feedback email copy in one standalone event dialog', () => {
    render(<EventEmailManager event={event} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Event email settings' })).toBeInTheDocument();
    expect(screen.getByText('event_rsvp editor')).toBeVisible();
    expect(screen.getByText('post_event editor')).not.toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: /Post-event feedback/ }));

    expect(screen.getByText('event_rsvp editor')).not.toBeVisible();
    expect(screen.getByText('post_event editor')).toBeVisible();
  });
});
