import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModuleSessionSchedulePreview, teamsCalendarOccurrences } from '../createCalendarForm';
import { calendarReviewHtml } from '../calendarReview';
import { pairHeldDates } from '../calendarTime';

// Ten Thursdays at 09:00 Cairo, 3 Sept – 5 Nov 2026. Teams holds nine of them:
// 1 Oct (a holiday week) was never booked, so Teams runs 3 Sept – 24 Sept and
// 8 Oct – 5 Nov. Synthetic module; the dates mirror the reported calendar.
const thursdays = ['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01',
  '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05'];
const row = {
  catalogueId: 'MOD-PAIR', name: 'Synthetic module', durationMinutes: 120, timeZone: 'Africa/Cairo',
  plannedStarts: [] as string[], teamsStarts: [] as string[],
  sessions: thursdays.map((date, index) => ({ date, startTime: '09:00', endTime: '11:00', timeZone: 'Africa/Cairo', sessionNumber: index + 1 })),
};
const planned = teamsCalendarOccurrences(row).map(item => item.startDateTimeUtc);
const held = planned.filter((_, index) => index !== 4);
const cairoDay = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(value));

describe('pairing the module plan with the Teams calendar by date', () => {
  it('reads one missing session as that session, not as every later one moving', () => {
    const { paired, extra } = pairHeldDates(planned, held, cairoDay);
    expect(paired[4]).toBe('');
    expect(paired.filter((_, index) => index !== 4)).toEqual(held);
    expect(extra).toEqual([]);
  });

  it('still pairs a genuinely moved session with the date Teams holds it on', () => {
    const moved = [...planned];
    moved[6] = '2026-10-16T06:00:00.000Z';
    const { paired, extra } = pairHeldDates(moved, planned, cairoDay);
    expect(paired[6]).toBe(planned[6]);
    expect(extra).toEqual([]);
  });

  it('names what Teams holds that the plan no longer has', () => {
    const { paired, extra } = pairHeldDates(planned.filter((_, index) => index !== 2), planned, cairoDay);
    expect(paired.every(Boolean)).toBe(true);
    expect(extra).toEqual([planned[2]]);
  });

  it('marks only 1 Oct as not on Teams, and gives each row its own Teams session', () => {
    const renderActions = vi.fn((index: number, _minutes: number, teamsUtc: string) => <span>{`row ${index}: ${teamsUtc || 'none'}`}</span>);
    render(<ModuleSessionSchedulePreview
      row={{ ...row, plannedStarts: planned, teamsStarts: held, summary: { liveSessionId: 'LIVE-PAIR' } } as never}
      renderActions={renderActions} />);
    expect(screen.getAllByText('Not on the Teams calendar yet — sending adds it.')).toHaveLength(1);
    expect(screen.queryByText(/Teams still holds/)).not.toBeInTheDocument();
    // The 1 Oct row has no Teams session to act on; 8 Oct acts on 8 Oct's, and
    // 5 Nov -- which Teams does hold -- on its own.
    expect(screen.getByText('row 4: none')).toBeInTheDocument();
    expect(screen.getByText(`row 5: ${held[4]}`)).toBeInTheDocument();
    expect(screen.getByText(`row 9: ${held[8]}`)).toBeInTheDocument();
  });

  it('reviews 1 Oct as the one new session and the rest as unchanged', () => {
    const html = calendarReviewHtml({
      title: 'Synthetic module', organizerEmail: 'organizer@example.invalid',
      scheduledOccurrences: planned.map((startDateTimeUtc, index) => ({ sessionNumber: index + 1, startDateTimeUtc, durationMinutes: 120 })),
      previousOccurrences: held.map((scheduled_start, index) => ({ session_number: index + 1, scheduled_start })),
    }, 'Africa/Cairo');
    expect(html.match(/New session — not on the Teams calendar yet/g)).toHaveLength(1);
    expect(html).not.toContain('Previously saved');
    expect(html).not.toContain('Removed from the Teams calendar');
  });
});
