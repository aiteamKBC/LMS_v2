import { expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { standardMonthlyPresentation, STANDARD_PRESENTATION_FORMAT } from './standardMonthlyPresentation';
import { fillEmptyPresentationSlides, slideIssue } from './monthlyPresentation';

it.each([0, 5, 15, 250])('keeps eight review slides and preserves all %i activity accounts in notes', count => {
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
  expect(slides).toHaveLength(8);
  const visible = slides.map(s => s.body).join(" ").replace(/\s+/g, " ");
  if (count) expect(visible).toContain(`${count} completed or submitted activities`);
  expect(visible).not.toContain('Wrong month');
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

it('keeps long answers and reflections intact in notes without adding review slides', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.lmsReflection = 'Full reflection. '.repeat(100) + 'Final reflection marker.';
  const slides = standardMonthlyPresentation('Assignment', 'Complete answer. '.repeat(120) + 'Final answer marker.', 'Learning', '', monthly, {} as LearnerDetail, 'Question');
  expect(slides).toHaveLength(8);
  const visible = slides.map(s => s.body).join(" ").replace(/\s+/g, " ");
  expect(visible).toContain('Complete answer.');
  expect(visible).toContain('\u2026');
  expect(visible).not.toContain('Final answer marker.');
  expect(slides[2].notes).toContain('Complete answer. '.repeat(120) + 'Final answer marker.');
  expect(slides.map(s => s.notes).join('\n')).toContain(monthly.lmsReflection);
});


it('includes completed progress missing from the feed and submitted extra activities in the full-month deck', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  const detail = { activityFeed: [], componentProgress: [{ componentId: 'reading', componentTitle: 'October reading', submittedAt: '2026-10-10T10:00:00Z', feedback: 'My completed reading reflection.', ksbs: ['K1'] }] } as unknown as LearnerDetail;
  const extra = { activityId: 'extra', title: 'Workplace training', month: '2026-10', status: 'submitted_for_tutor_review', submittedAt: '2026-11-02', answer: 'Full extra account.', reflection: 'My extra learning.', ksbs: ['S1'], hours: '2', coachFeedback: null, reviewedAt: null, reviewedBy: null };
  const slides = standardMonthlyPresentation('Assignment', 'Answer', 'Learning', '', monthly, detail, 'Question', [extra]);
  expect(slides).toHaveLength(8);
  const notes = slides.map(s => s.notes).join('\n');
  for (const text of ['October reading', 'My completed reading reflection.', 'Workplace training', 'My extra learning.', 'S1', '2 claimed hours']) expect(notes).toContain(text);
});

it('keeps a large month concise while retaining every original activity and answer', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.lmsReflection = 'Monthly reflection with a complete account. '.repeat(35);
  const answer = 'I applied the learning to an assignment and reviewed the complete results. '.repeat(210);
  const records = Array.from({ length: 47 }, (_, i) => ({ componentId: `activity-${i}`, componentTitle: `Activity ${i}`, submittedAt: new Date(Date.UTC(2026, 9, 12, 10, i)).toISOString(), feedback: `Complete learning account ${i}. ` + 'Full activity reflection. '.repeat(20) }));
  const slides = standardMonthlyPresentation('Assignment', answer, 'Learning', '', monthly, { componentProgress: records } as unknown as LearnerDetail, 'Question');
  expect(slides).toHaveLength(8);
  expect(slides[2].body.split('\n\n')).toHaveLength(3);
  expect(slides[2].notes).toContain(answer);
  const notes = slides.map(s => s.notes).join('\n');
  expect(notes).toContain(monthly.lmsReflection);
  for (const record of records) expect(notes).toContain(record.feedback);
  for (const slide of slides.slice(1)) {
    for (const card of slide.body.split('\n\n')) expect(card.split('\n').length).toBeLessThanOrEqual(8);
  }
});

it('accepts edited full text above the old highlight limit while retaining the export size bound', () => {
  expect(slideIssue({ title: 'My full account', body: 'Detail '.repeat(600) }, STANDARD_PRESENTATION_FORMAT)).toBe('');
  expect(slideIssue({ title: 'My full account', body: 'x'.repeat(12001) }, STANDARD_PRESENTATION_FORMAT)).toContain('12,000');
});

it('retains accounts that previously needed more than 200 slides without mutating answers', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  monthly.lmsReflection = 'Full reflection. '.repeat(6000);
  const before = JSON.stringify(monthly);
  const answer = 'Complete answer. '.repeat(6000);
  const slides = standardMonthlyPresentation('Assignment', answer, 'Learning', '', monthly, {} as LearnerDetail, 'Question');
  expect(slides).toHaveLength(8);
  expect(slides[2].notes).toContain(answer);
  expect(slides.at(-1)?.notes).toContain(monthly.lmsReflection);
  expect(JSON.stringify(monthly)).toBe(before);
});

it('rejects oversized notes without silently losing detail or modifying an existing deck', () => {
  const monthly = { ...emptyMonthlyAssignment([], '2026-10'), slides: [{ title: 'Saved', body: 'My edit' }] };
  const before = JSON.stringify(monthly);
  expect(() => standardMonthlyPresentation('Assignment', 'x'.repeat(2000001), '', '', monthly, {} as LearnerDetail, 'Question')).toThrow('speaker-notes limit');
  expect(JSON.stringify(monthly)).toBe(before);
});

it('bounds long identifiers and multiline excerpts while keeping their complete source in notes', () => {
  const monthly = emptyMonthlyAssignment([], '2026-10');
  const answer = 'https://example.test/' + 'a'.repeat(3000);
  const slides = standardMonthlyPresentation('Long title '.repeat(40), answer, '\n\nLearning\n'.repeat(100), '', monthly, { name: 'Long name '.repeat(30) } as LearnerDetail, 'Question');
  expect(slides).toHaveLength(8);
  expect(slides[2].notes).toContain(answer);
  for (const slide of slides) {
    const maxWidth = slide.templateSlide === 1 ? 32 : slide.templateSlide === 3 ? 20 : slide.templateSlide === 5 ? 23 : slide.templateSlide === 7 ? 36 : 24;
    for (const card of slide.body.split('\n\n')) {
      for (const line of card.split('\n').slice(1)) expect(line.length).toBeLessThanOrEqual(maxWidth);
    }
  }
});
