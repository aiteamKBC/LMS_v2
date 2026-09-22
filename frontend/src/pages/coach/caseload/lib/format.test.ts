import { describe, expect, it } from 'vitest';
import { getOtjhGapStatus } from './format';

describe('getOtjhGapStatus', () => {
  it.each([
    [535, 'at-risk'],
    [536, 'need-attention'],
    [555, 'need-attention'],
    [556, 'on-track'],
    [576, 'on-track'],
    [600, 'on-track'],
  ])('classifies target 576 and actual %s as %s', (actual, status) => {
    const result = getOtjhGapStatus(actual, 576);
    expect(result.available).toBe(true);
    expect(result.status).toBe(status);
    expect(result.gapHours).toBe(Math.max(576 - actual, 0));
  });

  it.each([
    [null, 576],
    [535, null],
    [535, 0],
    [535, -1],
  ])('marks actual %s and target %s unavailable', (actual, target) => {
    expect(getOtjhGapStatus(actual, target)).toEqual({
      gapHours: null,
      status: 'unavailable',
      available: false,
    });
  });
});
