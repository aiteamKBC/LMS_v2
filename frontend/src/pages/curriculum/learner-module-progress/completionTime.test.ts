import { expect, it } from 'vitest';
import { completionEnd } from './completionTime';

it('preserves seconds and elapsed duration across a clock change', () => {
  expect(completionEnd('2026-10-25T00:30:45', 7200)).toEqual({
    start: '2026-10-24T23:30:45.000Z', end: '2026-10-25T01:30:45.000Z',
  });
});

it('keeps missing and repeated-hour input editable without inventing history', () => {
  expect(completionEnd('2026-03-29T01:30:00', 60)).toBeNull();
  expect(completionEnd('2026-10-25T01:30:00', 60)).toBeNull();
  expect(completionEnd('2026-02-30T10:00:00', 60)).toBeNull();
});
