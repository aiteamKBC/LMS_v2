import { expect, it } from 'vitest';
import { coachContact, duration, hours, previousMonthSignature } from './report';
import type { MonthState } from './api';

it('formats hours as rounded minutes without invented seconds or a 60-minute remainder', () => {
  expect(duration('1.999')).toBe('2h 00m');
  expect(duration('0')).toBe('0h 00m');
  expect(duration('6.579')).toBe('6h 35m');
  expect(duration(null)).toBe('—');
  expect(duration('invalid')).toBe('—');
  expect(duration(-1)).toBe('—');
  expect(hours(31)).toBe('31.00');
  expect(hours(null)).toBe('—');
});

it('does not invent a coach contact address', () => { expect(coachContact()).toBeUndefined(); });

it('imports the latest earlier signature for the current role, never from a later month', () => {
  const base: MonthState = { month: '2026-05', status: 'complete', row_count: 1, planned_hours: 1, actual_hours: 1,
    not_accepted_hours: 0, student_signature: null, coach_signature: null, pending_revisions: 0, can_complete: false, source_finalization: null };
  const learner = { url: '/learner.png', signed_at: '2026-09-09', signer_name: 'Learner' };
  const coach = { ...learner, url: '/coach.png', signer_name: 'Coach' };
  const months: MonthState[] = [
    { ...base, month: '2026-08', student_signature: { ...learner, url: '/future.png' } },
    { ...base, month: '2026-06', coach_signature: coach },
    { ...base, student_signature: learner },
    { ...base, month: '2026-07', student_signature: { ...learner, url: '/current.png' } },
  ];
  expect(previousMonthSignature(months, '2026-07', 'learner')).toEqual({ url: '/learner.png', monthLabel: 'May 2026' });
  expect(previousMonthSignature(months, '2026-07', 'coach')).toEqual({ url: '/coach.png', monthLabel: 'June 2026' });
  expect(previousMonthSignature(months, '2026-08', 'learner')).toEqual({ url: '/current.png', monthLabel: 'July 2026' });
  expect(previousMonthSignature(months, '2026-05', 'learner')).toBeUndefined();
  expect(previousMonthSignature(months, '2026-06', 'coach')).toBeUndefined();
});
