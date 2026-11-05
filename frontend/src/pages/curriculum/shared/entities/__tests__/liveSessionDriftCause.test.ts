import { describe, expect, it } from 'vitest';
import { liveSessionDriftCause } from '../liveSessionDriftCause';

describe('liveSessionDriftCause', () => {
  it('names a changed delivery day', () => {
    // 4 Sept 2026 is a Friday, 6 Sept a Sunday.
    const cause = liveSessionDriftCause({ storedDate: '2026-09-04', weekDates: ['2026-09-06'] });
    expect(cause?.short).toBe('Day changed Friday → Sunday');
    expect(cause?.sentence).toMatch(/from Friday to Sunday/);
  });

  it('names both when the day changed and the run moved a month', () => {
    // Friday 4 Sept stored; the moved start date puts week 1 on Sunday 4 Oct.
    const cause = liveSessionDriftCause({ storedDate: '2026-09-04', weekDates: ['2026-10-04'] });
    expect(cause?.short).toBe('Date and day changed Friday → Sunday');
    expect(cause?.sentence).toMatch(/new start date/);
  });

  it('calls a same-weekday move a moved week, in weeks', () => {
    const cause = liveSessionDriftCause({ storedDate: '2026-09-04', weekDates: ['2026-09-18'] });
    expect(cause?.short).toBe('Week moved 2 weeks later');
    expect(cause?.sentence).toMatch(/start date changed/);
  });

  it('treats a stored day still in a two-day week as a moved week, not a new day', () => {
    // Stored Friday 4 Sept; the week now runs Monday 14 + Friday 18 Sept.
    const cause = liveSessionDriftCause({ storedDate: '2026-09-04', weekDates: ['2026-09-14', '2026-09-18'] });
    expect(cause?.short).toBe('Week moved 2 weeks later');
  });

  it('says nothing about dates it cannot read', () => {
    expect(liveSessionDriftCause({ storedDate: '', weekDates: ['2026-09-06'] })).toBeNull();
  });
});
