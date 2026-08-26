import { describe, expect, it } from 'vitest';
import { normaliseComponentSettings, validateComponentAuthoring } from './componentAuthoringModel';

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

  it('accepts uploaded podcast resource URLs as valid audio sources', () => {
    const settings = normaliseComponentSettings('podcast', {
      podcastSource: 'Audio File',
      podcastUrl: '/curriculum_api/curriculum/uploads/week-template/show.mp3',
      uploadedFileUrl: '/curriculum_api/curriculum/uploads/week-template/show.mp3',
      uploadedFileName: 'show.mp3',
    });

    const issues = validateComponentAuthoring({
      type: 'podcast',
      title: 'Podcast',
      expectedOtjh: 2,
      points: 10,
      reflectionRequired: false,
      workplaceEvidenceRequired: false,
      settings,
    });

    expect(issues.some(issue => issue.path === 'component.settings.podcastUrl')).toBe(false);
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

  it('accepts uploaded reading resource URLs as valid reading sources', () => {
    const settings = normaliseComponentSettings('reading', {
      readingSource: 'File',
      uploadedFileUrl: '/curriculum_api/curriculum/uploads/week-template/reading.pdf',
      uploadedFileName: 'reading.pdf',
    });

    const issues = validateComponentAuthoring({
      type: 'reading',
      title: 'Reading',
      expectedOtjh: 2,
      points: 10,
      reflectionRequired: false,
      workplaceEvidenceRequired: false,
      settings,
    });

    expect(issues.some(issue => issue.path === 'component.settings.resourceUrl')).toBe(false);
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

  it('preserves Teams meeting details on live-session components', () => {
    const liveSession = normaliseComponentSettings('live-session', {
      liveSessionUrl: 'https://teams.microsoft.com/l/meetup-join/example',
      teamsEventId: 'event-123',
      teamsLiveSessionId: 'LIVE-123',
      teamsOrganizerEmail: 'tutor@example.com',
      teamsAttendees: ['learner1@example.com', 'learner2@example.com'],
      teamsLobbyBypass: 'invited',
      teamsRecording: 'record-transcribe',
      teamsRepeat: 'weekly',
      teamsRepeatOccurrences: 6,
    });

    expect(liveSession.liveSessionUrl).toContain('teams.microsoft.com');
    expect(liveSession.teamsEventId).toBe('event-123');
    expect(liveSession.teamsLiveSessionId).toBe('LIVE-123');
    expect(liveSession.teamsAttendees).toEqual(['learner1@example.com', 'learner2@example.com']);
    expect(liveSession.teamsRepeat).toBe('weekly');
    expect(liveSession.teamsRepeatOccurrences).toBe(6);
  });
});
