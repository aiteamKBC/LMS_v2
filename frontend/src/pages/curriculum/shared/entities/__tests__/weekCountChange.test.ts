import { describe, expect, it } from 'vitest';
import { predictWeekCountChange, weekCountChangeText, weekHoldsAuthoredContent } from '../weekCountChange';

/** Mirrors resize_authoring_week_structure_preserving_content in curriculum_api/views.py. */
const shell = (weekNumber: number) => ({ weekNumber, title: `Week ${weekNumber}`, components: [] });
const authored = (weekNumber: number) => ({ ...shell(weekNumber), summary: 'Something taught' });

describe('week count change before a Module settings save', () => {
  it('treats a default "Week N" shell as empty and anything else as authored', () => {
    expect(weekHoldsAuthoredContent(shell(3))).toBe(false);
    expect(weekHoldsAuthoredContent(authored(3))).toBe(true);
    expect(weekHoldsAuthoredContent({ weekNumber: 3, title: 'Intro to data' })).toBe(true);
  });

  it('says nothing when the count stays the same', () => {
    expect(predictWeekCountChange([shell(1), shell(2)], 2)).toBeNull();
  });

  it('names the empty trailing weeks a shrink removes, and why', () => {
    const weeks = [authored(1), ...Array.from({ length: 10 }, (_, index) => shell(index + 2))];
    const change = predictWeekCountChange(weeks, 9)!;

    expect(change).toMatchObject({ before: 11, after: 9, removed: [10, 11], added: 0 });
    expect(weekCountChangeText(change, false))
      .toBe("Saving will make this module 9 weeks instead of 11, because this module's saved week count is 9, but it holds 11 weeks. Weeks 10 to 11 are empty and will be removed.");
  });

  it('stops at a week with content, as the server does', () => {
    const change = predictWeekCountChange([shell(1), authored(2), shell(3), shell(4)], 1)!;

    expect(change).toMatchObject({ before: 4, after: 2, removed: [3, 4] });
    expect(weekCountChangeText(change, true)).toMatch(/because you set Weeks to 1\..*stops at 2 because Week 2 has content/);
  });

  it('never removes a week with content even when nothing else can go', () => {
    expect(predictWeekCountChange([shell(1), authored(2)], 1)).toBeNull();
  });

  it('says how many empty weeks a growth adds', () => {
    const change = predictWeekCountChange([shell(1)], 3)!;

    expect(change).toMatchObject({ before: 1, after: 3, added: 2 });
    expect(weekCountChangeText(change, true)).toMatch(/3 weeks instead of 1, because you set Weeks to 3\. 2 empty weeks will be added at the end\./);
  });
});
