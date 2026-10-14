import { describe, expect, it } from 'vitest';
import { parseTicketDetails } from './ticketDetails';

const SURVEY = [
  'Auto-generated ticket from wellbeing survey.',
  '',
  'Risk Level:   Low',
  'Total Score:   2.54',
  'Trigger Count: 7',
  'Programme:    Example Programme - Oct 2026',
  'Coach:        Default Owner',
  '',
  'Triggered Questions:',
  '• I feel under constant pressure. (Score: 8) [high]',
  '• I feel low or down. (Score: 7) [medium]',
  '• Repeated low answers across the section [pattern]',
].join('\n');

describe('parseTicketDetails', () => {
  it('splits a survey ticket into intro, facts and triggered questions', () => {
    expect(parseTicketDetails(SURVEY)).toEqual({
      intro: ['Auto-generated ticket from wellbeing survey.'],
      facts: [
        { label: 'Risk Level', value: 'Low' },
        { label: 'Total Score', value: '2.54' },
        { label: 'Trigger Count', value: '7' },
        { label: 'Programme', value: 'Example Programme - Oct 2026' },
        { label: 'Coach', value: 'Default Owner' },
      ],
      questions: [
        { text: 'I feel under constant pressure.', score: '8', severity: 'high' },
        { text: 'I feel low or down.', score: '7', severity: 'medium' },
        { text: 'Repeated low answers across the section', score: null, severity: 'pattern' },
      ],
      other: [],
    });
  });

  it('leaves free-text tickets to be shown exactly as written', () => {
    expect(parseTicketDetails('The learner asked for a call back.\nThey prefer mornings.')).toBeNull();
    expect(parseTicketDetails('')).toBeNull();
  });

  it('keeps unrecognised lines instead of dropping them', () => {
    const parsed = parseTicketDetails('Risk Level: High\nSee attached letter.\nTriggered Questions:\nNo bullet here');
    expect(parsed?.facts).toEqual([{ label: 'Risk Level', value: 'High' }]);
    expect(parsed?.other).toEqual(['See attached letter.', 'No bullet here']);
  });
});
