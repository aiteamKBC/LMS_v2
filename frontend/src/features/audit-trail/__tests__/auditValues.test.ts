import { describe, expect, it } from 'vitest';
import { auditFieldLabel, auditFieldValueLabel, auditIdList, auditIdListInfo, auditValueLabel } from '../activityTime';

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

  it('salvages the whole ids out of a list the log cut short', () => {
    // The last id was severed mid-way and has no closing quote, so it is left
    // out rather than named from half of itself.
    const info = auditIdListInfo('["APTEM-GROUP-1", "APTEM-GROUP-2", "APTEM-GROUP-7a51047');
    expect(info).toEqual({ ids: ['APTEM-GROUP-1', 'APTEM-GROUP-2'], cut: true });
    expect(auditIdListInfo('["APTEM-GROUP-1"]').cut).toBe(false);
  });
});

describe('auditFieldLabel', () => {
  it('reads a link column as the records it links, not as its storage', () => {
    expect(auditFieldLabel('Group ids')).toBe('Groups');
    expect(auditFieldLabel('Module ids')).toBe('Modules');
    expect(auditFieldLabel('Parent id')).toBe('Parent');
    // A label the backend named for itself is left alone.
    expect(auditFieldLabel('Title')).toBe('Title');
    expect(auditFieldLabel('Teams sync state')).toBe('Teams sync state');
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

  it('counts an id that could not be named rather than printing it', () => {
    // A lookup miss is a gap in the lookup, not evidence the record was never
    // in the list, so the side must not read as shorter than what was saved --
    // which is what the count is for. The identifier itself is no use to a
    // reader, so it is not shown; the raw value stays in the tooltip.
    const label = auditFieldValueLabel('Group ids', ['APTEM-GROUP-1', 'APTEM-GROUP-99'], [], 'after', names);
    expect(label).toBe('Feb 2025 · Group A, and 1 more that could not be named');
    expect(label).not.toContain('APTEM-GROUP-99');
  });

  it('names what it can out of a list the log had to cut short', () => {
    // The reported screen: a long link field stored cut off mid-list, so it
    // never closes its bracket, cannot be parsed, and used to be printed raw.
    const cut = '["APTEM-GROUP-1", "APTEM-GROUP-2", "APTEM-GROUP-…';
    const label = auditFieldValueLabel('Group ids', cut, [], 'before', names);
    expect(label).toBe('Feb 2025 · Group A, Feb 2025 · Group B, …');
    expect(label).not.toContain('APTEM-GROUP');
  });

  it('summarises a cut list as a floor when nothing can be named', () => {
    const cut = '["APTEM-GROUP-98", "APTEM-GROUP-99", "APTEM-GROUP-…';
    // "At least", because the ids after the cut were never delivered.
    expect(auditFieldValueLabel('Group ids', cut, [], 'before', new Map()))
      .toBe('At least 2 linked groups');
  });

  it('names a single id standing on its own', () => {
    expect(auditFieldValueLabel('Group id', 'APTEM-GROUP-3', [], 'after', names))
      .toBe('Feb 2025 · Group C');
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
