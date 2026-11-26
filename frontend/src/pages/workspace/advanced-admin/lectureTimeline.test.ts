import { describe, expect, it } from 'vitest';
import type { AdvancedAdminAttendance, AdvancedAdminQuality } from '@/api/advancedAdmin';
import { lectureTimeline } from './lectureTimeline';

const attendance = (sessionId: string, title: string): AdvancedAdminAttendance => ({
  sessionId, date: '2026-09-10', title, module: 'Module', status: 'present',
});
const quality = (sessionId: string, subject: string, source: 'tutor' | 'lecture'): AdvancedAdminQuality => ({
  sessionId, subject, source, date: '2026-09-10', trainer: '', rating: 4,
  comments: null, judgement: null, module: null,
});

describe('learner lecture and quality timeline', () => {
  it('joins by session identity, then a unique lecture title on the same day', () => {
    const result = lectureTimeline([attendance('a', 'Planning'), attendance('b', 'Delivery')], [
      quality('a', 'Other title', 'tutor'), quality('different-id', 'Delivery', 'lecture'),
    ]);
    expect(result[0].lectures[0].tutor).toHaveLength(1);
    expect(result[0].lectures[1].lecture).toHaveLength(1);
    expect(result[0].unmatched).toHaveLength(0);
  });

  it('does not guess when several lectures share the date and the report has no unique match', () => {
    const result = lectureTimeline([attendance('a', 'Planning'), attendance('b', 'Delivery')], [
      quality('unknown', 'Different subject', 'tutor'),
    ]);
    expect(result[0].lectures.every(item => item.tutor.length === 0)).toBe(true);
    expect(result[0].unmatched).toHaveLength(1);
  });
});
