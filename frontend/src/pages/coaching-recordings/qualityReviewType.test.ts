import { describe, expect, it } from 'vitest';
import { suggestQualityType } from './qualityReviewType';

describe('quality form suggestions from titles', () => {
  it.each([
    ['Monthly Coaching Meeting – Test', 'MCM'], ['Monthly Coaching Review', 'MCM'],
    ['MCR catch-up', 'MCM'], ['Test - MCM', 'MCM'], ['Progress Review with coach', 'PR'],
    ['BR - legacy spelling', 'PR'], ['PR with coach', 'PR'], ['inter EPA', ''],
    ['Programming workshop', ''], ['Monthly coaching meeting / Progress Review', 'PR'],
  ])('suggests %s as %s without changing the title', (title, expected) => {
    expect(suggestQualityType(title)).toBe(expected);
  });
});
