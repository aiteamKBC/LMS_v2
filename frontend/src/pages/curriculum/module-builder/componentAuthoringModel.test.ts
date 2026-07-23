import { describe, expect, it } from 'vitest';
import { normaliseComponentSettings } from './componentAuthoringModel';

describe('normaliseComponentSettings week-template compatibility', () => {
  it('restores a podcast embed imported from Week Builder and keeps both keys', () => {
    const settings = normaliseComponentSettings('podcast', {
      podcastSource: 'Embed',
      podcastEmbedCode: '<iframe src="https://open.spotify.com/embed/track/example"></iframe>',
    });

    expect(settings.podcastSource).toBe('Embed');
    // Module vocabulary key (learner/backend consumers) …
    expect(settings.embedCode).toContain('open.spotify.com/embed');
    // … and the Week Builder key the live editor reads back stays populated.
    expect(settings.podcastEmbedCode).toContain('open.spotify.com/embed');
  });

  it('recovers compatible fields previously quarantined in legacySettings', () => {
    const settings = normaliseComponentSettings('podcast', {
      podcastSource: 'Embed',
      legacySettings: JSON.stringify({ podcastEmbedCode: '<iframe src="https://example.com/embed"></iframe>' }),
    });

    expect(settings.embedCode).toContain('example.com/embed');
    expect(settings.podcastEmbedCode).toContain('example.com/embed');
  });

  it('translates the old Module podcast source value forward to the Week Builder value', () => {
    const settings = normaliseComponentSettings('podcast', {
      podcastSource: 'Device upload',
      uploadedFileUrl: '/curriculum_api/curriculum/uploads/week-template/show.mp3',
    });

    expect(settings.podcastSource).toBe('Audio File');
    expect(settings.podcastUrl).toContain('show.mp3');
  });

  it('keeps reading in the Week Builder vocabulary while mirroring the resource URL', () => {
    const reading = normaliseComponentSettings('reading', {
      readingSource: 'File',
      uploadedFileUrl: '/curriculum_api/curriculum/uploads/week-template/reading.pdf',
      uploadedFileName: 'reading.pdf',
    });

    // Week Builder editor reads readingSource === 'File' and uploadedFile* …
    expect(reading.readingSource).toBe('File');
    expect(reading.uploadedFileUrl).toContain('reading.pdf');
    expect(reading.uploadedFileName).toBe('reading.pdf');
    // … the older Module vocabulary (resourceUrl) stays populated too.
    expect(reading.resourceUrl).toContain('reading.pdf');
  });

  it('maps assignment fields both ways so either editor sees them', () => {
    const assignment = normaliseComponentSettings('assignment', {
      assignmentContent: '<p>Complete the project brief.</p>',
      uploadedFileName: 'brief.pdf',
      uploadedFileUrl: '/curriculum_api/curriculum/uploads/week-template/brief.pdf',
    });

    expect(assignment.assignmentContent).toContain('project brief');
    expect(assignment.assignmentBrief).toContain('project brief');
    expect(assignment.assignmentFileName).toBe('brief.pdf');
    expect(assignment.uploadedFileName).toBe('brief.pdf');
    expect(assignment.assignmentFileUrl).toContain('brief.pdf');
    expect(assignment.uploadedFileUrl).toContain('brief.pdf');
  });

  it('preserves assigned groups on any component type', () => {
    const reading = normaliseComponentSettings('reading', {
      selectedGroupKeys: ['group-1', 'group-2'],
      selectedGroupNames: ['Cohort A', 'Cohort B'],
    });

    expect(reading.selectedGroupKeys).toEqual(['group-1', 'group-2']);
    expect(reading.selectedGroupNames).toEqual(['Cohort A', 'Cohort B']);
  });

  it('preserves the quiz checkpoint flag stored on the component', () => {
    const quiz = normaliseComponentSettings('quiz', {
      linkedQuizId: 'quiz-123',
      quizAssessmentType: 'checkpoint',
    });

    expect(quiz.linkedQuizId).toBe('quiz-123');
    expect(quiz.quizAssessmentType).toBe('checkpoint');
  });
});
