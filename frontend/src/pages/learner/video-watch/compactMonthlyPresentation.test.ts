import { expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { compactMonthlyPresentation, COMPACT_PRESENTATION_FORMAT } from './compactMonthlyPresentation';
import { fillEmptyPresentationSlides, slideIssue } from './monthlyPresentation';

it.each([0, 1, 250])('generates 17 slides for %i activities and retains every full source in notes', count => {
  const monthly = emptyMonthlyAssignment(['K1'], '2026-10');
  const full = Array.from({ length: 200 }, (_, i) => `Learning detail ${i}.`).join(' ');
  Object.assign(monthly, { understood: full, gainedSkills: full, lmsReflection: full, extraActivities: 'External mentoring detail', integratedReflection: full, careerImpact: full, jobImpact: full, employerImpact: full, actionPlan: full, epaPreparedness: full,
    evidence: [{ id: 'one', name: 'My work', points: 'Answer point 1', url: 'https://example.test/work' }],
    claims: [{ code: 'K1', explanation: full, evidenceIds: ['one'] }] });
  const activities = Array.from({ length: count }, (_, i) => ({ title: `Activity ${i}`, at: `2026-10-10T10:00:${i}Z`, kind: 'video', componentId: String(i), action: 'Completed' }));
  const detail = { activityFeed: [...activities, { title: 'Wrong month', at: '2026-09-10', kind: 'video' }],
    videoProgress: activities.map(a => ({ componentId: a.componentId, submittedAt: a.at, reportedTime: '13 minutes', ksbs: ['K1'], feedback: `Original reflection ${a.componentId} ${full}` })),
  } as unknown as LearnerDetail;
  const before = JSON.stringify({ monthly, detail });
  const slides = compactMonthlyPresentation('Assignment', full, full, full, monthly, detail, 'Original question');
  expect(slides).toHaveLength(17);
  expect(slides.every(s => !slideIssue(s, COMPACT_PRESENTATION_FORMAT))).toBe(true);
  const notes = slides.map(s => s.notes).join('\n');
  for (const activity of activities) expect(notes).toContain(`Original reflection ${activity.componentId} ${full}`);
  expect(notes).toContain(full);
  expect(notes).toContain('External mentoring detail');
  expect(notes).toContain('https://example.test/work');
  expect(notes).toContain('Supporting evidence: My work');
  expect(notes).not.toContain('Wrong month');
  expect(JSON.stringify({ monthly, detail })).toBe(before);
});

it('marks missing source as not recorded and never claims achievements', () => {
  const slides = compactMonthlyPresentation('Assignment', '', '', '', emptyMonthlyAssignment([], '2026-10'), {} as LearnerDetail, '');
  expect(slides[7].body).toBe('No LMS activities recorded for this month.');
  expect(slides[9].body).toBe('No KSB claims recorded.');
  expect(slides[16].body).toContain('Not recorded');
});

it('preserves compact manual edits, including deliberately cleared highlights, without rebuilding from notes', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  Object.assign(monthly, { presentationFormat: COMPACT_PRESENTATION_FORMAT, presentationReviewed: true, presentationToken: 'old', slides: [
    { title: 'My custom slide', body: 'Edited highlights', notes: 'Original source' },
    { title: 'What I learned', body: '', notes: 'Saved full account of my learning.' },
  ] });
  const result = fillEmptyPresentationSlides(monthly, 'New external answer', '');
  expect(result.slides[0]).toEqual(monthly.slides[0]);
  expect(result).toBe(monthly);
  expect(result.slides[1].body).toBe('');
  expect(slideIssue(result.slides[1], COMPACT_PRESENTATION_FORMAT)).toContain('Add content');
});

it('requests readable compact highlights while retaining the legacy content limit', () => {
  const long = { title: 'Title', body: 'a'.repeat(601) };
  expect(slideIssue(long, COMPACT_PRESENTATION_FORMAT)).toContain('speaker notes');
  expect(slideIssue(long)).toBe('');
  expect(slideIssue({ title: 'a'.repeat(81), body: 'Body' }, COMPACT_PRESENTATION_FORMAT)).toContain('80 characters');
});
