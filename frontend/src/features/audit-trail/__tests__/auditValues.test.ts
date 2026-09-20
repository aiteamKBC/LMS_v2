import { describe, expect, it } from 'vitest';
import { auditFieldValueLabel, auditIdList, auditValueLabel } from '../activityTime';

/**
 * How a saved value is written out.
 *
 * The case that matters is a link field: a revision stores the ids the row
 * held, and the reader wants the records. Summarising a list as a count reads
 * as if nothing happened when both sides happen to be the same length, which is
 * the common shape of a swap — one group out, one group in.
 */

const names = new Map([
  ['aptem-group-1', 'Feb 2025 · Group A'],
  ['aptem-group-2', 'Feb 2025 · Group B'],
  ['aptem-group-3', 'Feb 2025 · Group C'],
]);

describe('auditIdList', () => {
  it('reads a list whether it was stored as JSON text or as an array', () => {
    expect(auditIdList('["APTEM-GROUP-1","APTEM-GROUP-2"]')).toEqual(['APTEM-GROUP-1', 'APTEM-GROUP-2']);
    expect(auditIdList(['APTEM-GROUP-1'])).toEqual(['APTEM-GROUP-1']);
    expect(auditIdList('not a list')).toEqual([]);
  });
});

describe('auditFieldValueLabel', () => {
  it('names the groups a cohort was linked to', () => {
    const label = auditFieldValueLabel('Group ids', ['APTEM-GROUP-1', 'APTEM-GROUP-2'], [], 'before', names);
    expect(label).toBe('Feb 2025 · Group A, Feb 2025 · Group B');
  });

  it('never renders two different lists as the same text', () => {
    // The reported failure: one group swapped for another, both sides shown as
    // "2 linked groups", with "1 field changed" above them.
    const fields = [{ label: 'Group ids', before: ['APTEM-GROUP-1', 'APTEM-GROUP-2'], after: ['APTEM-GROUP-1', 'APTEM-GROUP-3'] }];
    const before = auditFieldValueLabel('Group ids', fields[0].before, fields, 'before', names);
    const after = auditFieldValueLabel('Group ids', fields[0].after, fields, 'after', names);
    expect(before).not.toBe(after);
    expect(after).toContain('Feb 2025 · Group C');
  });

  it('keeps an id that could not be named rather than dropping it', () => {
    // A lookup miss is a gap in the lookup, not evidence the record was never
    // in the list. Dropping it would make the side shorter than what was saved.
    const label = auditFieldValueLabel('Group ids', ['APTEM-GROUP-1', 'APTEM-GROUP-99'], [], 'after', names);
    expect(label).toBe('Feb 2025 · Group A, APTEM-GROUP-99');
  });

  it('prefers the names the save recorded itself over the lookup', () => {
    const fields = [
      { label: 'Group ids', after: ['APTEM-GROUP-1'] },
      { label: 'Group names', after: ['Whatever the row said'] },
    ];
    expect(auditFieldValueLabel('Group ids', fields[0].after, fields, 'after', names))
      .toBe('Whatever the row said');
  });

  it('falls back to the readable summary when nothing can be named', () => {
    const label = auditFieldValueLabel('Group ids', ['APTEM-GROUP-98', 'APTEM-GROUP-99'], [], 'after', new Map());
    expect(label).toBe(auditValueLabel(['APTEM-GROUP-98', 'APTEM-GROUP-99']));
  });
});
