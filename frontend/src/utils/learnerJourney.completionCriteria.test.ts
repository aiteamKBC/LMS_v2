import { describe, expect, it } from 'vitest';
import { componentCriteria, type JourneyComponent } from './learnerJourney';

function component(type: string, weight: number, mappings = 1): JourneyComponent {
  return {
    title: 'Activity',
    expectedOtjh: 2,
    type,
    ksbWeightTotal: weight,
    ksbMappingCount: mappings,
  };
}

describe('componentCriteria', () => {
  it('does not block normal activities when KSB weight is below 100', () => {
    expect(componentCriteria(component('live_session', 80, 2), 0)).toEqual({
      gated: false,
      evidenceRequired: false,
      evidenceMet: true,
      met: true,
    });
  });

  it('still requires approved evidence for assignments', () => {
    expect(componentCriteria(component('assignment', 0, 0), 0).met).toBe(false);
    expect(componentCriteria(component('assignment', 0, 0), 1).met).toBe(true);
  });
});
