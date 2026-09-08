import { expect, it } from 'vitest';
import { coachContact, duration, hours } from './report';

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
