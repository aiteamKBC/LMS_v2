import { describe, expect, it } from 'vitest';
import { absenceReportHealth, countLearnerAbsenceReports } from './attendanceOverview';

describe('attendance overview absence report summaries', () => {
  const learner = { id: '42', learner: 'Aya Khater', email: 'Aya@example.com' };

  it('matches by learner id first and honours the selected date range', () => {
    const reports = [
      { learnerId: '42', learner: 'Changed name', email: 'other@example.com', sessionDate: '2026-09-02' },
      { learnerId: '42', learner: 'Aya Khater', email: 'aya@example.com', sessionDate: '2026-08-20' },
      { learnerId: '7', learner: 'Aya Khater', email: 'aya@example.com', sessionDate: '2026-09-03' },
    ];

    expect(countLearnerAbsenceReports(reports, learner, '2026-09-01', '2026-09-30')).toBe(1);
  });

  it('falls back to email or name when the report has no learner id', () => {
    const reports = [
      { learner: 'Different name', email: 'AYA@EXAMPLE.COM' },
      { learner: '  aya khater  ' },
    ];

    expect(countLearnerAbsenceReports(reports, learner)).toBe(2);
  });

  it('maps report coverage to complete, partial and missing states', () => {
    expect(absenceReportHealth(0, 0)).toBe('complete');
    expect(absenceReportHealth(2, 2)).toBe('complete');
    expect(absenceReportHealth(1, 2)).toBe('partial');
    expect(absenceReportHealth(0, 2)).toBe('missing');
    expect(absenceReportHealth(0, null)).toBe('unknown');
  });
});
