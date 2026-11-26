import { expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { standardMonthlyPresentation, STANDARD_PRESENTATION_FORMAT } from './standardMonthlyPresentation';
import { fillEmptyPresentationSlides, slideIssue } from './monthlyPresentation';

it.each([0, 5, 15, 250])('keeps all %i activities visible with continuation slides and original notes', count => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.extraActivities = 'External training account that must stay intact.';
  monthly.claims = [{ code: 'K1', explanation: 'My original understanding.', evidenceIds: ['file'] }];
  monthly.evidence = [{ id: 'file', name: 'My evidence', url: 'https://example.test/work', points: 'Point 1' }];
  const activities = Array.from({ length: count }, (_, i) => ({ kind: 'video', componentId: String(i), at: new Date(Date.UTC(2026, 9, 10, 10, i)).toISOString(), title: `Activity ${i}`, action: 'Completed' }));
  const detail = { name: 'Example learner', activityFeed: [...activities, { title: 'Wrong month', at: '2026-09-10', action: 'Completed' }],
    videoProgress: activities.map(a => ({ componentId: a.componentId, submittedAt: a.at, feedback: `Full original reflection ${a.componentId}.`, ksbs: ['K1'], reportedTime: '15 minutes' })),
  } as unknown as LearnerDetail;
  const before = JSON.stringify({ monthly, detail });
  const slides = standardMonthlyPresentation('Assignment', 'My complete assignment answer.', 'My own learning.', 'My original impact.', monthly, detail, 'Original question');
  expect(slides.length).toBeGreaterThanOrEqual(8);
  const visible = slides.map(s => s.body).join(" ").replace(/\s+/g, " ");
  expect(visible).not.toContain("\u2026");
  for (let i = 0; i < count; i++) expect(visible).toContain(`Full original reflection ${i}.`);
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

it('shows long accounts beyond the former twelve-slide ceiling without losing the final words', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.lmsReflection = 'Full reflection. '.repeat(100) + 'Final reflection marker.';
  const slides = standardMonthlyPresentation('Assignment', 'Complete answer. '.repeat(120) + 'Final answer marker.', 'Learning', '', monthly, {} as LearnerDetail, 'Question');
  expect(slides.length).toBeGreaterThan(12);
  const visible = slides.map(s => s.body).join(" ").replace(/\s+/g, " ");
  const approach = slides.filter(s => s.templateSlide === 3).flatMap(s => s.body.split('\n\n')).filter(card => card.startsWith('My approach\n') || card.startsWith('My approach (continued)\n')).map(card => card.split('\n').slice(1).join(' ')).join(' ').replace(/\s+/g, ' ');
  expect(approach).toBe('Complete answer. '.repeat(120) + 'Final answer marker.');
  expect(visible).toContain("Final reflection marker.");
  expect(visible).not.toContain("\u2026");
  expect(slides.map(s => s.notes).join('\n')).toContain(monthly.lmsReflection);
});


it('includes completed progress missing from the feed and submitted extra activities in the full-month deck', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  const detail = { activityFeed: [], componentProgress: [{ componentId: 'reading', componentTitle: 'October reading', submittedAt: '2026-10-10T10:00:00Z', feedback: 'My completed reading reflection.', ksbs: ['K1'] }] } as unknown as LearnerDetail;
  const extra = { activityId: 'extra', title: 'Workplace training', month: '2026-10', status: 'submitted_for_tutor_review', submittedAt: '2026-11-02', answer: 'Full extra account.', reflection: 'My extra learning.', ksbs: ['S1'], hours: '2', coachFeedback: null, reviewedAt: null, reviewedBy: null };
  const slides = standardMonthlyPresentation('Assignment', 'Answer', 'Learning', '', monthly, detail, 'Question', [extra]);
  const visible = slides.map(s => s.body).join(' ').replace(/\s+/g, ' ');
  for (const text of ['October reading', 'My completed reading reflection.', 'Workplace training', 'My extra learning.', 'S1', '2 claimed hours']) expect(visible).toContain(text);
});

it('fills continuation cards for a large month instead of exhausting the slide budget with empty columns', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.lmsReflection = 'Monthly reflection with a complete account. '.repeat(35);
  const answer = 'I applied the learning to an assignment and reviewed the complete results. '.repeat(210);
  const records = Array.from({ length: 47 }, (_, i) => ({ componentId: `activity-${i}`, componentTitle: `Activity ${i}`, submittedAt: new Date(Date.UTC(2026, 9, 12, 10, i)).toISOString(), feedback: `Complete learning account ${i}. ` + 'Full activity reflection. '.repeat(20) }));
  const slides = standardMonthlyPresentation('Assignment', answer, 'Learning', '', monthly, { componentProgress: records } as unknown as LearnerDetail, 'Question');
  expect(slides.length).toBeLessThanOrEqual(200);
  const continuation = slides.find(s => s.title === 'Applying my learning at work (continued 2)')!;
  expect(continuation.body.split('\n\n')).toHaveLength(3);
  expect(continuation.body.split('\n\n').every(card => card.startsWith('My approach\n'))).toBe(true);
  const approach = slides.filter(s => s.templateSlide === 3).flatMap(s => s.body.split('\n\n')).filter(card => card.startsWith('My approach')).map(card => card.split('\n').slice(1).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
  expect(approach).toBe(answer.trim());
  const visible = slides.map(s => s.body).join(' ').replace(/\s+/g, ' ');
  for (let i = 0; i < 47; i++) expect(visible).toContain(`Complete learning account ${i}.`);
});

it('accepts edited full text above the old highlight limit while retaining the export size bound', () => {
  expect(slideIssue({ title: 'My full account', body: 'Detail '.repeat(600) }, STANDARD_PRESENTATION_FORMAT)).toBe('');
  expect(slideIssue({ title: 'My full account', body: 'x'.repeat(12001) }, STANDARD_PRESENTATION_FORMAT)).toContain('12,000');
});

it('reports the existing deck size bound without truncating or mutating an oversized account', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.lmsReflection = 'Full reflection. '.repeat(6000);
  const before = JSON.stringify(monthly);
  expect(() => standardMonthlyPresentation('Assignment', 'Complete answer. '.repeat(6000), 'Learning', '', monthly, {} as LearnerDetail, 'Question')).toThrow('more than 200 slides');
  expect(JSON.stringify(monthly)).toBe(before);
});
