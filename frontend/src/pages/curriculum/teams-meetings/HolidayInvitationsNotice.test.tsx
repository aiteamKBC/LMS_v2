import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumHolidayInvitationNotice } from '@/lib/curriculumApi';
import { HolidayInvitationsNotice } from './HolidayInvitationsNotice';
import { CompactSchedulePreview } from '../shared/entities/sessionShiftPreview';
import { buildHolidayShiftPlan } from '../shared/entities/sessionShiftPreview.helpers';

const notice: CurriculumHolidayInvitationNotice = {
  code: 'existing_holiday_invitations', timeZone: 'Europe/London', invitationCount: 1,
  invitations: [{ occurrenceId: 'OCC-SYNTHETIC', scheduledStart: '2026-12-16T12:00:00Z',
    localDate: '2026-12-16', weekStart: '2026-12-14', weekEnd: '2026-12-20', holidayLabels: ['Winter closure'] }],
};

describe('Holiday invitation guidance', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['America/Los_Angeles', 'Pacific/Auckland'])('keeps the calendar date for a viewer in %s', zone => {
    vi.stubEnv('TZ', zone);
    render(<HolidayInvitationsNotice notice={notice} />);
    expect(screen.getByText('16 Dec 2026')).toBeInTheDocument();
  });

  it('shows concise guidance with dates behind an accessible disclosure', () => {
    render(<HolidayInvitationsNotice notice={notice} />);
    expect(screen.getByRole('note')).toHaveTextContent('Existing holiday invitations retained');
    expect(screen.getByText(/Keep the holiday arrangements already communicated/)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Invitations in holiday weeks', hidden: true })).not.toBeVisible();
    fireEvent.click(screen.getByText('View affected invitations (1)'));
    expect(screen.getByRole('list', { name: 'Invitations in holiday weeks' })).toBeVisible();
    expect(screen.getByText(/An invitation does not confirm that teaching is scheduled/)).toBeVisible();
    expect(screen.getByText(/New live sessions continue to follow/)).toBeVisible();
    expect(screen.getByText(/Europe\/London/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps form values when the guidance is opened and closed', () => {
    render(<><label>Unsaved subject<input defaultValue="Synthetic module title" /></label><HolidayInvitationsNotice notice={notice} /></>);
    const input = screen.getByRole('textbox', { name: 'Unsaved subject' });
    fireEvent.change(input, { target: { value: 'Retain this edit' } });
    fireEvent.click(screen.getByText('View affected invitations (1)'));
    fireEvent.click(screen.getByText('View affected invitations (1)'));
    expect(input).toHaveValue('Retain this edit');
  });

  it('renders nothing for a new or unaffected calendar', () => {
    const { container, rerender } = render(<HolidayInvitationsNotice />);
    expect(container).toBeEmptyDOMElement();
    rerender(<HolidayInvitationsNotice notice={{ ...notice, invitations: [], invitationCount: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('distinguishes an unreadable notice from a calendar without clashes', () => {
    render(<HolidayInvitationsNotice unavailable />);
    expect(screen.getByRole('note')).toHaveTextContent('Holiday invitation guidance unavailable');
    expect(screen.queryByText('Existing holiday invitations retained')).not.toBeInTheDocument();
  });

  it('does not describe a retained invitation as confirmation of teaching', () => {
    const session = { date: '2026-12-23', skippedHolidays: ['Winter closure'] };
    const occurrences = [{ session, plannedUtc: '2026-12-23T12:00:00Z', durationMinutes: 120,
      shift: buildHolidayShiftPlan([session]).shifts[0] }];
    const original = JSON.stringify(occurrences);
    const { rerender } = render(<CompactSchedulePreview occurrences={occurrences} />);
    expect(screen.getByText(/It runs as planned/)).toBeInTheDocument();
    rerender(<CompactSchedulePreview occurrences={occurrences} holidayInvitationsRetained />);
    expect(screen.queryByText(/It runs as planned/)).not.toBeInTheDocument();
    expect(screen.getByText(/Follow the published holiday arrangements and any approved teaching exception/)).toBeInTheDocument();
    expect(JSON.stringify(occurrences)).toBe(original);
  });
});
