/**
 * When a learner reaches Gateway.
 *
 * The bug: a learner whose one module was complete was shown "Gateway ready"
 * with the Gateway step lit, while their cohort's gateway date was still a year
 * out. Gateway is a scheduled point in the programme — the practical period
 * runs to the cohort's end date — not something finishing the modules early
 * unlocks.
 */
import { describe, expect, it } from 'vitest';
import { gatewayIsOpen } from '../page';

const day = (iso: string) => new Date(`${iso}T12:00:00`);

describe('gatewayIsOpen', () => {
  it('is shut while the cohort is still in its practical period', () => {
    // The reported case: cohort ends 2027-08-02, today is 2026-08-30.
    expect(gatewayIsOpen('2027-08-02', day('2026-08-30'))).toBe(false);
  });

  it('opens on the cohort gateway date itself, not the day after', () => {
    expect(gatewayIsOpen('2027-08-02', day('2027-08-02'))).toBe(true);
  });

  it('stays open once the date has passed', () => {
    expect(gatewayIsOpen('2027-08-02', day('2027-08-03'))).toBe(true);
    expect(gatewayIsOpen('2027-08-02', day('2028-01-01'))).toBe(true);
  });

  it('does not hold a learner back on a date we do not have', () => {
    // No cohort on file, or a cohort with no end date: the modules being
    // complete is then all there is to go on, which is the old behaviour.
    for (const missing of ['', '   ', null, undefined]) {
      expect(gatewayIsOpen(missing, day('2026-08-30'))).toBe(true);
    }
  });

  it('reads a full timestamp as its calendar day', () => {
    expect(gatewayIsOpen('2027-08-02T00:00:00Z', day('2027-08-02'))).toBe(true);
    expect(gatewayIsOpen('2027-08-02T00:00:00Z', day('2027-08-01'))).toBe(false);
  });

  it('compares in the reader’s own timezone rather than UTC', () => {
    // A date is a date: someone in NZ on the morning of the gateway date should
    // not be told to wait because it is still the previous day in UTC.
    const localMorning = new Date(2027, 7, 2, 9, 0, 0); // 2 Aug 2027, 09:00 local
    expect(gatewayIsOpen('2027-08-02', localMorning)).toBe(true);
  });
});
