import { describe, expect, it } from 'vitest';
import { componentLooksUnedited, componentTypeDescription, firstValidationMessage, normaliseComponentSettings, validateComponentAuthoring, validateModuleAuthoringStructure } from './componentAuthoringModel';
import { createEmptyComponent } from './moduleAuthoringData';

describe('normaliseComponentSettings week-template compatibility', () => {
  it('identifies every invalid component by week and title in the save message', () => {
    const assignment = (title: string) => ({
      type: 'assignment' as const,
      title,
      expectedOtjh: 2,
      points: 25,
      reflectionRequired: false,
      workplaceEvidenceRequired: false,
      settings: normaliseComponentSettings('assignment', { assignmentContent: '', contentStatus: 'Ready for QA' }),
    });
    const issues = validateModuleAuthoringStructure({
      title: 'Module 1',
      weekStructure: [{ title: 'Week 4', components: [assignment('Assignment 1'), assignment('Assignment 2')] }],
    });

    expect(firstValidationMessage(issues)).toContain('Week 4 / Assignment 1');
    expect(firstValidationMessage(issues)).toContain('Week 4 / Assignment 2');
    expect(firstValidationMessage(issues)).not.toContain('more issue');
  });

  it('allows an incomplete assignment question to be saved while it is a draft', () => {
    const issues = validateComponentAuthoring({
      type: 'assignment',
      title: 'Assignment draft',
      expectedOtjh: 2,
      points: 25,
      reflectionRequired: false,
      workplaceEvidenceRequired: false,
      settings: normaliseComponentSettings('assignment', { assignmentContent: '', contentStatus: 'Draft' }),
    });

    expect(issues.some(issue => issue.message.includes('assignment question'))).toBe(false);
  });

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

  it('keeps occurrence identity and shifted calendar metadata through repeated saves', () => {
    const tracking = { teamsOccurrenceId: 'OCC-2', teamsSessionNumber: 2, teamsOnlineMeetingId: 'MEETING-2',
      teamsMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/shifted', teamsWebLink: 'https://outlook.office.com/calendar/item/example',
      teamsStartDateTimeUtc: '2026-10-29T09:00:00Z', teamsDurationMinutes: 90, sessionDay: 'Thursday', sessionRescheduled: true };
    const saved = normaliseComponentSettings('live-session', { ...tracking, teamsLiveSessionId: 'SERIES-1',
      teamsPresenters: ['tutor@example.invalid'], teamsCoOrganizers: ['staff@example.invalid'] });
    expect(normaliseComponentSettings('live-session', saved)).toMatchObject(tracking);
    expect(saved.teamsPresenters).toEqual(['tutor@example.invalid']);
    expect(saved.teamsCoOrganizers).toEqual(['staff@example.invalid']);
    expect(validateComponentAuthoring({ title: 'Lesson', type: 'live-session', expectedOtjh: 1.5, points: 10,
      reflectionRequired: false, workplaceEvidenceRequired: false, settings: saved })).toEqual([]);
  });

  it('preserves an explicit occurrence clear instead of restoring legacy values', () => {
    const settings = normaliseComponentSettings('live-session', { teamsOccurrenceId: '', teamsSessionNumber: '',
      legacySettings: JSON.stringify({ teamsOccurrenceId: 'OLD', teamsSessionNumber: 3 }) });
    expect(settings.teamsOccurrenceId).toBe('');
    expect(settings.teamsSessionNumber).toBe('');
    expect(normaliseComponentSettings('live-session', {})).not.toHaveProperty('teamsSessionNumber');
  });
});

describe('componentLooksUnedited', () => {
  const fresh = (type: Parameters<typeof createEmptyComponent>[1], index = 3) => createEmptyComponent('week-1', type, index);

  it('marks a component nobody has opened yet', () => {
    expect(componentLooksUnedited(fresh('video'))).toBe(true);
    expect(componentLooksUnedited(fresh('live-session'))).toBe(true);
    // Points are stamped from the programme's points rules on creation, so a
    // number the definition does not carry is not an author's edit.
    expect(componentLooksUnedited({ ...fresh('reading'), points: 45 })).toBe(true);
  });

  it('clears the hint as soon as anything is authored', () => {
    expect(componentLooksUnedited({ ...fresh('video'), title: 'Cost of poor quality' })).toBe(false);
    expect(componentLooksUnedited({ ...fresh('video'), description: 'Watch before the session' })).toBe(false);
    expect(componentLooksUnedited({ ...fresh('video'), expectedOtjh: 1.5 })).toBe(false);
    expect(componentLooksUnedited({ ...fresh('reading'), ksbMappings: [{ id: 'k1', code: 'K1' }] as never })).toBe(false);
    const booked = fresh('live-session');
    expect(componentLooksUnedited({ ...booked, settings: { ...booked.settings, teamsMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/example' } })).toBe(false);
  });

  it('ignores the date the scheduling planner stamps onto every live session, not something an author typed', () => {
    // applyModuleWeekSessionPlan stamps these the moment the module's session
    // plan loads -- which can be right after adding a live session, since a
    // new one changes the module's session count and re-triggers the fetch.
    // Neither editor has a control that writes them directly.
    const dated = fresh('live-session');
    expect(componentLooksUnedited({
      ...dated,
      settings: {
        ...dated.settings,
        sessionDate: '2026-10-23', sessionDay: 'Friday', sessionTime: '09:00',
        sessionDateTimeUtc: '2026-10-23T09:00:00Z', teamsStartDateTimeUtc: '2026-10-23T09:00:00Z',
        // The same planner pass re-derives the duration alongside the date
        // and overwrites whatever was there, with its own tracking mirror --
        // neither is a control an author has typed into.
        durationMinutes: 90, teamsDurationMinutes: 90, sessionRescheduled: true,
      },
    })).toBe(true);
  });

  it('still catches a real duration edit -- on every OTHER type, where it is authored, not planner-owned', () => {
    expect(componentLooksUnedited({ ...fresh('video'), settings: { ...fresh('video').settings, durationMinutes: 25 } })).toBe(false);
    expect(componentLooksUnedited({ ...fresh('podcast'), settings: { ...fresh('podcast').settings, durationMinutes: 45 } })).toBe(false);
  });

  it('recognises the week builder rail\'s own auto title, not just the definition\'s', () => {
    // The shared week rail titles a new `video` component "Recorded Session N"
    // (weekTypeLabel's override), not "Video N" (the definition's own label).
    // A caller passing that label must still see it as untouched.
    const video = { ...fresh('video'), title: 'Recorded Session 1' };
    expect(componentLooksUnedited(video)).toBe(false);
    expect(componentLooksUnedited(video, 'Recorded Session')).toBe(true);
    // The definition's own label still counts as untouched even when a caller
    // supplies an override — the module builder's own convention is not broken.
    expect(componentLooksUnedited({ ...fresh('video'), title: 'Video 3' }, 'Recorded Session')).toBe(true);
  });

  it('ignores the group assignment the app self-heals on the first open, not on an edit', () => {
    // AssignedGroupsSection stamps the component's locked delivery group into
    // selectedGroupKeys/selectedGroupNames the moment its editor mounts --
    // before the author has touched anything -- so this alone must not clear
    // the hint. placedCopy* is written on a DIFFERENT component when this one
    // is placed as a copy, same story.
    const quiz = fresh('quiz');
    expect(componentLooksUnedited({
      ...quiz,
      settings: { ...quiz.settings, selectedGroupKeys: ['group-1'], selectedGroupNames: ['Cohort A'] },
    })).toBe(true);
    expect(componentLooksUnedited({
      ...quiz,
      settings: { ...quiz.settings, placedCopyGroupKeys: ['group-2'], placedCopyModuleCatalogueIds: ['MOD-1'], placedCopyWeekIds: ['week-9'], placedCopyComponentIds: ['comp-9'] },
    })).toBe(true);
    // A real assignment change on top still clears it.
    expect(componentLooksUnedited({
      ...quiz,
      settings: { ...quiz.settings, selectedGroupKeys: ['group-1'], linkedQuizId: 'quiz-42' },
    })).toBe(false);
  });

  it('recognises the module builder\'s own boilerplate description, not just an empty one', () => {
    // ModuleWeekPanel's own "Add component" button (createNamedComponent, in
    // module-builder/page.tsx) stamps this type blurb straight into
    // `description` on creation -- the week rail's inline "Add component"
    // leaves it empty instead. Whichever button made it, nobody has typed
    // anything into it yet.
    const stamped = { ...fresh('live-session'), description: componentTypeDescription('live-session') };
    expect(componentLooksUnedited(stamped)).toBe(true);
    // A genuinely authored description -- even one that happens to start the
    // same way -- still clears the hint.
    expect(componentLooksUnedited({ ...stamped, description: `${componentTypeDescription('live-session')} — covers weeks 1-3 induction` })).toBe(false);
  });

  it('survives the recalculation every add triggers, not just the raw defaults', () => {
    // `normaliseComponentSettings` (run by `recalculateModule` right after any
    // add, from either button) rewrites a couple of default values to their
    // canonical name on the very first pass: podcast's 'External URL' becomes
    // 'External Link', reading's 'Written in LMS' becomes 'Text'. A component
    // that has been through that rewrite once -- which every component has,
    // by the time it renders -- must still read as untouched.
    const podcast = fresh('podcast');
    const recalculatedPodcast = { ...podcast, settings: normaliseComponentSettings('podcast', podcast.settings) };
    expect(recalculatedPodcast.settings.podcastSource).toBe('External Link');
    expect(componentLooksUnedited(recalculatedPodcast)).toBe(true);

    const reading = fresh('reading');
    const recalculatedReading = { ...reading, settings: normaliseComponentSettings('reading', reading.settings) };
    expect(recalculatedReading.settings.readingSource).toBe('Text');
    expect(componentLooksUnedited(recalculatedReading)).toBe(true);

    // A real choice on top of the same recalculation still clears the hint.
    expect(componentLooksUnedited({ ...recalculatedPodcast, settings: { ...recalculatedPodcast.settings, podcastUrl: 'https://example.invalid/ep1' } })).toBe(false);
  });
});
