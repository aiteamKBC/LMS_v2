import { describe, expect, it } from 'vitest';
import { getOtjhGapStatus, otjhProgressAsOfToday, targetHoursAsOfToday } from './format';

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

describe('targetHoursAsOfToday', () => {
  const today = new Date(2026, 5, 15);

  it('returns zero before the programme starts', () => {
    expect(targetHoursAsOfToday(120, '20 Jun 2026', '20 Jun 2027', today)).toBe(0);
  });

  it('returns the full training-plan total on or after the planned end date', () => {
    expect(targetHoursAsOfToday(120, '20 Jun 2025', '14 Jun 2026', today)).toBe(120);
    expect(targetHoursAsOfToday(120, '20 Jun 2025', '15 Jun 2026', today)).toBe(120);
  });

  it('prorates the total by elapsed programme days while in progress', () => {
    expect(targetHoursAsOfToday(120, '01 Jun 2026', '01 Jul 2026', today)).toBe(56);
  });

  it('returns unavailable when the source dates or total are missing', () => {
    expect(targetHoursAsOfToday(120, '--', '01 Jul 2026', today)).toBeNull();
    expect(targetHoursAsOfToday(0, '01 Jun 2026', '01 Jul 2026', today)).toBeNull();
  });
});

describe('otjhProgressAsOfToday', () => {
  it('consumes authoritative scalars without recalculating percentage, shortfall or status', () => {
    const source = { otjhCompleted: 100, otjhTarget: 999, otjhPlanned: 999,
      otjhTargetAsOfToday: 200, otjhShortfallHours: 100, otjhProgressAsOfToday: 12.34,
      otjhDeltaHours: -100, otjhRagStatus: 'on-track' as const,
      status: 'at-risk', otjhStatus: 'at-risk' };
    const result = otjhProgressAsOfToday(source);
    expect(result).toEqual({ actualHours: 100, targetHours: 200, gapHours: 100,
      percent: 12.34, deltaHours: -100, status: 'on-track' });
  });

  it('preserves authoritative nulls instead of reconstructing unavailable data from legacy fields', () => {
    expect(otjhProgressAsOfToday({ otjhCompleted: 40, otjhTarget: 999, otjhPlanned: 120,
      startDate: '01 Jun 2026', plannedEndDate: '01 Jul 2026',
      otjhTargetAsOfToday: null, otjhProgressAsOfToday: null,
      otjhShortfallHours: null, otjhDeltaHours: null, otjhRagStatus: 'unavailable',
    }, new Date(2026, 5, 15))).toEqual({ actualHours: 40, targetHours: null, percent: null,
      gapHours: null, deltaHours: null, status: 'unavailable' });
  });

  it('uses the API-owned target and RAG contract when it is present', () => {
    const result = otjhProgressAsOfToday({
      otjhCompleted: 40,
      otjhTarget: 999,
      otjhPlanned: 120,
      otjhTargetAsOfToday: 56,
      otjhProgressAsOfToday: 71.43,
      otjhShortfallHours: 16,
      otjhDeltaHours: -16,
      otjhRagStatus: 'on-track',
      startDate: '01 Jun 2026',
      plannedEndDate: '01 Jul 2026',
    }, new Date(2026, 5, 15));

    expect(result).toEqual({
      actualHours: 40,
      targetHours: 56,
      percent: 71.43,
      gapHours: 16,
      deltaHours: -16,
      status: 'on-track',
    });
  });

  it('uses the paced target for both the percentage and the RAG status', () => {
    const result = otjhProgressAsOfToday({
      otjhCompleted: 40,
      otjhTarget: 999,
      otjhPlanned: 120,
      startDate: '01 Jun 2026',
      plannedEndDate: '01 Jul 2026',
    }, new Date(2026, 5, 15));

    expect(result.targetHours).toBe(56);
    expect(result.percent).toBeCloseTo((40 / 56) * 100);
    expect(result.deltaHours).toBe(-16);
    expect(result.status).toBe('on-track');
  });

  it('falls back to the API target when the programme window is unavailable', () => {
    expect(otjhProgressAsOfToday({ otjhCompleted: 70, otjhTarget: 90 }).targetHours).toBe(90);
  });
});
