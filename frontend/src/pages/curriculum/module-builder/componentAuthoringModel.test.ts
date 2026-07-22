import { describe, expect, it } from 'vitest';
import { normaliseComponentSettings } from './componentAuthoringModel';

describe('normaliseComponentSettings week-template compatibility', () => {
  it('restores a podcast embed imported from Week Builder', () => {
    const settings = normaliseComponentSettings('podcast', {
      podcastSource: 'Embed',
      podcastEmbedCode: '<iframe src="https://open.spotify.com/embed/track/example"></iframe>',
    });

    expect(settings.podcastSource).toBe('Embed');
    expect(settings.embedCode).toContain('open.spotify.com/embed');
  });

  it('recovers compatible fields previously quarantined in legacySettings', () => {
    const settings = normaliseComponentSettings('podcast', {
      podcastSource: 'Embed',
      legacySettings: JSON.stringify({ podcastEmbedCode: '<iframe src="https://example.com/embed"></iframe>' }),
    });

    expect(settings.embedCode).toContain('example.com/embed');
  });

  it('maps Week Builder reading and assignment fields to Module Builder fields', () => {
    const reading = normaliseComponentSettings('reading', {
      readingSource: 'File',
      uploadedFileUrl: '/curriculum_api/curriculum/uploads/week-template/reading.pdf',
    });
    const assignment = normaliseComponentSettings('assignment', {
      assignmentContent: '<p>Complete the project brief.</p>',
      uploadedFileName: 'brief.pdf',
      uploadedFileUrl: '/curriculum_api/curriculum/uploads/week-template/brief.pdf',
    });

    expect(reading.readingSource).toBe('LMS resource');
    expect(reading.resourceUrl).toContain('reading.pdf');
    expect(assignment.assignmentBrief).toContain('project brief');
    expect(assignment.assignmentFileName).toBe('brief.pdf');
    expect(assignment.assignmentFileUrl).toContain('brief.pdf');
  });
});
