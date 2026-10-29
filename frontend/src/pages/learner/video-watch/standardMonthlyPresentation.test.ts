import { expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { standardMonthlyPresentation, STANDARD_PRESENTATION_FORMAT } from './standardMonthlyPresentation';
import { fillEmptyPresentationSlides, slideIssue } from './monthlyPresentation';

it.each([[0, 8], [5, 9], [15, 10], [250, 12]])('generates %i activities in exactly %i template slides with full notes', (count, expected) => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.extraActivities = 'External training account that must stay intact.';
  monthly.claims = [{ code: 'K1', explanation: 'My original understanding.', evidenceIds: ['file'] }];
  monthly.evidence = [{ id: 'file', name: 'My evidence', url: 'https://example.test/work', points: 'Point 1' }];
  const activities = Array.from({ length: count }, (_, i) => ({ kind: 'video', componentId: String(i), at: `2026-10-10T10:00:${i}Z`, title: `Activity ${i}`, action: 'Completed' }));
  const detail = { name: 'Example learner', activityFeed: [...activities, { title: 'Wrong month', at: '2026-09-10', action: 'Completed' }],
    videoProgress: activities.map(a => ({ componentId: a.componentId, submittedAt: a.at, feedback: `Full original reflection ${a.componentId}.`, ksbs: ['K1'], reportedTime: '15 minutes' })),
  } as unknown as LearnerDetail;
  const before = JSON.stringify({ monthly, detail });
  const slides = standardMonthlyPresentation('Assignment', 'My complete assignment answer.', 'My own learning.', 'My original impact.', monthly, detail, 'Original question');
  expect(slides).toHaveLength(expected);
  expect(slides[0].templateSlide).toBe(1);
  expect(slides.at(-1)?.templateSlide).toBe(7);
  expect(slides.every(s => !slideIssue(s, STANDARD_PRESENTATION_FORMAT))).toBe(true);
  const notes = slides.map(s => s.notes).join('\n');
  for (let i = 0; i < count; i++) expect(notes).toContain(`Full original reflection ${i}.`);
  for (const text of ['My complete assignment answer.', monthly.extraActivities, monthly.claims[0].explanation, monthly.evidence[0].url]) expect(notes).toContain(text);
  expect(notes).not.toContain('Wrong month');
  expect(JSON.stringify({ monthly, detail })).toBe(before);
});

it('never converts a saved standard deck or refills deliberately cleared manual text', () => {
  const monthly = { ...emptyMonthlyAssignment([], '2026-10'), presentationFormat: STANDARD_PRESENTATION_FORMAT, slides: [{ title: 'My edit', body: '', notes: 'My original account', templateSlide: 2 }] };
  expect(fillEmptyPresentationSlides(monthly, 'New learning', 'New impact')).toBe(monthly);
  expect(slideIssue(monthly.slides[0], STANDARD_PRESENTATION_FORMAT)).toContain('Add content');
});

it('retains full long accounts in notes within the twelve-slide generation ceiling', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.lmsReflection = 'Full reflection. '.repeat(3000);
  const slides = standardMonthlyPresentation('Assignment', 'Complete answer. '.repeat(2500), 'Learning', '', monthly, {} as LearnerDetail, 'Question');
  expect(slides).toHaveLength(12);
  expect(slides.map(s => s.notes).join('\n')).toContain(monthly.lmsReflection);
});
