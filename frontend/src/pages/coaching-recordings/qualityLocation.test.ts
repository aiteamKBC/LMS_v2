import { describe, expect, it } from 'vitest';
import { readQualityLocation, writeQualityLocation } from './qualityLocation';
const id = '11111111-1111-4111-8111-111111111111';
describe('saved quality review links', () => {
  it('round trips filters and the UUID without signed credentials or form contents', () => {
    const filters = { start: '2026-10-01', end: '2026-10-24', timeZone: 'America/New_York', coachEmail: 'coach@example.invalid', status: 'draft', search: 'Synthetic', reviewType: 'PR', pdf: 'available' };
    const params = writeQualityLocation(filters, id);
    expect(readQualityLocation(params)).toEqual({ filters, review: id, invalidReview: false });
    expect(params.has('reference')).toBe(false); expect(params.has('form')).toBe(false);
  });
  it('validates IDs, dates, status and remote time zones', () => {
    const value = readQualityLocation(new URLSearchParams('review=some-title&from=2026-02-31&to=2026-10-24&zone=invalid-zone&status=bad'));
    expect(value.invalidReview).toBe(true); expect(value.review).toBe('');
    expect(value.filters.start).toBe('2026-09-24'); expect(value.filters.end).toBe('2026-10-24');
    expect(value.filters.timeZone).not.toBe('invalid-zone'); expect(value.filters.status).toBe('completed');
  });
  it('keeps All status distinct from the default Completed filter', () => {
    const value = readQualityLocation(new URLSearchParams('status=all&review='+id.toUpperCase()));
    expect(value.filters.status).toBe(''); expect(value.review).toBe(id);
    expect(writeQualityLocation(value.filters).get('status')).toBe('all');
    expect(writeQualityLocation(value.filters).has('review')).toBe(false);
  });
});
