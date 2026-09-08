import { describe, expect, it } from 'vitest';

import { formatReportedTime, reportedTimeMinutes } from './reportedTime';

describe('learner-reported OTJ time', () => {
  it('treats a bare 60 as 60 minutes', () => {
    expect(reportedTimeMinutes('60')).toBe(60);
    expect(formatReportedTime('60')).toBe('1h');
  });

  it('treats small bare values as hours', () => {
    expect(reportedTimeMinutes('2')).toBe(120);
    expect(formatReportedTime('2')).toBe('2h');
  });

  it('formats mixed hour and minute input', () => {
    expect(reportedTimeMinutes('1h 30m')).toBe(90);
    expect(formatReportedTime('1h 30m')).toBe('1h 30m');
  });
});
