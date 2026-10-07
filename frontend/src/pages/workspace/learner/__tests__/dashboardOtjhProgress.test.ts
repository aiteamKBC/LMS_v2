import { describe, expect, it } from 'vitest';
import { dashboardOtjhProgress } from '../dashboardOtjhProgress';

describe('dashboard OTJH progress', () => {
  it('uses the existing target-to-date instead of the whole-programme plan', () => {
    expect(dashboardOtjhProgress(193.77, '220.50')).toEqual({ target: 220.5, percent: 88 });
  });

  it('caps a learner ahead of target at the coach display maximum', () => {
    expect(dashboardOtjhProgress(193.77, '123.87')).toEqual({ target: 123.87, percent: 100 });
  });

  it('does not invent progress when target-to-date is unavailable', () => {
    expect(dashboardOtjhProgress(193.77, undefined)).toEqual({ target: null, percent: null });
  });
});
