import { expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { monthlyPresentation, slideIssue, fillEmptyPresentationSlides } from './monthlyPresentation';
it('includes every selected-month activity and its saved feedback, without previous-month activities', () => {
  const monthly = emptyMonthlyAssignment([], '2026-09');
  monthly.extraActivities = 'Mentoring outside the LMS';
  const detail = { activityFeed: [
    { title: 'Video A', at: '2026-09-12', kind: 'video', componentId: 'a', action: 'Completed' },
    { title: 'Reading B', at: '2026-09-13', kind: 'component', componentId: 'b', action: 'Completed' },
    { title: 'Previous month', at: '2026-08-12', kind: 'video', componentId: 'c', action: 'Completed' }],
    videoProgress: [{ submittedAt: '2026-09-12', componentId: 'a', feedback: 'My detailed video reflection', ksbs: ['K1'] }],
    componentProgress: [] } as unknown as LearnerDetail;
  const slides = monthlyPresentation('Assignment', 'My answer', 'Learning', 'Impact', monthly, detail, 'Question');
  expect(slides.some(s => s.title === 'Video A' && s.body.includes('My detailed video reflection'))).toBe(true);
  expect(slides.some(s => s.title === 'Reading B')).toBe(true);
  expect(slides.some(s => s.title === 'Previous month')).toBe(false);
  expect(slides.some(s => s.body.includes('Mentoring outside the LMS'))).toBe(true);
});

it('identifies empty and oversized slide content before export', () => {
  expect(slideIssue({ title: 'Title', body: '   ' })).toContain('Add content');
  expect(slideIssue({ title: '', body: 'Body' })).toContain('title');
  expect(slideIssue({ title: 'Title', body: 'x'.repeat(12001) })).toContain('12,000');
  expect(slideIssue({ title: 'Title', body: 'Body' })).toBe('');
});

it('fills empty saved sections and preserves edited slides, invalidating the reviewed export', () => {
  const monthly = emptyMonthlyAssignment([], '2026-09');
  monthly.lmsReflection = 'My LMS reflection'; monthly.actionPlan = 'My future plan'; monthly.jobImpact = 'Improved planning';
  monthly.slides = [{ title: 'Full-month reflection', body: '  ' }, { title: 'Impact and employer benefit', body: 'My edited slide' }, { title: 'Action plan and EPA', body: '' }, { title: 'Custom slide', body: '' }];
  monthly.presentationReviewed = true; monthly.presentationToken = 'old-export';
  const updated = fillEmptyPresentationSlides(monthly, '', '');
  expect(updated.slides[0].body).toContain('My LMS reflection');
  expect(updated.slides[1].body).toBe('My edited slide');
  expect(updated.slides[2].body).toContain('My future plan');
  expect(updated.slides[3].body).toBe('');
  expect(updated.presentationReviewed).toBe(false); expect(updated.presentationToken).toBe('');
  expect(fillEmptyPresentationSlides(updated, '', '')).toBe(updated);
});
it('leaves unavailable source content empty and preserves long content in continuation slides', () => {
  const monthly = emptyMonthlyAssignment([], '2026-09');
  monthly.slides = [{ title: 'Full-month reflection', body: '' }];
  expect(fillEmptyPresentationSlides(monthly, '', '')).toBe(monthly);
  monthly.lmsReflection = 'x'.repeat(15000);
  const updated = fillEmptyPresentationSlides(monthly, '', '');
  expect(updated.slides).toHaveLength(2);
  expect(updated.slides.map(s => s.body).join('')).toBe('LMS reflection\n' + monthly.lmsReflection);
});
