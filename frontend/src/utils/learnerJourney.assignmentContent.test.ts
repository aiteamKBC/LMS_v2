import { describe, expect, it } from 'vitest';
import { hasComponentContent, type JourneyComponent } from './learnerJourney';

const assignment: JourneyComponent = {
  componentId: 'empty-assignment', title: 'Assignment 22', type: 'assignment',
  expectedOtjh: 7, reflectionRequired: false,
  reflectionQuestion: 'What did you learn? How will you apply this at work? Which KSBs did this develop?',
};

describe('assignment content from live builder rows', () => {
  it('does not mistake the default follow-up reflection for an assignment brief', () => {
    expect(hasComponentContent(assignment)).toBe(false);
    expect(hasComponentContent({ ...assignment, reflectionRequired: true })).toBe(false);
  });
  it.each([
    { assignmentBrief: 'Evaluate the campaign against its agreed objectives.' },
    { assignmentBriefHtml: '<p>Evaluate the campaign.</p>' },
    { resourceUrl: '/curriculum_api/curriculum/uploads/assignment-templates/ME.docx' },
  ])('accepts an authored task or attached workbook: %j', content => {
    expect(hasComponentContent({ ...assignment, ...content })).toBe(true);
  });
  it('keeps standalone reflection activities available', () => {
    expect(hasComponentContent({ ...assignment, type: 'reflection' })).toBe(true);
  });
  it('does not open an unlinked quiz placeholder as a reflection', () => {
    expect(hasComponentContent({ ...assignment, type: 'quiz' })).toBe(false);
    expect(hasComponentContent({ ...assignment, type: 'quiz', isQuiz: true, quizMeta: { quizId: 1, questions: 2, duration: null, timeUnit: null } })).toBe(true);
  });
});
