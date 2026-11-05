import { describe, expect, it } from 'vitest';
import { originalCoachingReportUrl } from './originalCoachingReport';

describe('Original Coaching Session report links', () => {
  it('uses the source session identity and real tab routes, without LMS tokens', () => {
    expect(originalCoachingReportUrl('a'.repeat(32))).toBe(`https://coachingsessions.kentbusinesscollege.net/sessions/${'a'.repeat(32)}?tab=ai_report`);
    expect(originalCoachingReportUrl('a'.repeat(32), 'transcript')).toContain('?tab=transcript');
  });
  it.each([undefined, null, '', 'modern-session-uuid', '../other', 'https://foreign.invalid', 'a'.repeat(32) + '?token=x'])('withholds invalid or unrelated source identity %s', id => {
    expect(originalCoachingReportUrl(id)).toBeNull();
  });
});
