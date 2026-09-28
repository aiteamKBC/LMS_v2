import { describe, expect, it } from 'vitest';
import { emptyTeamsCalendarForm, teamsUpdateChanges, type TeamsCalendarForm } from '../createCalendarForm';
import { savedEmails } from '../useTeamsMeetingsWorkspace';

// The invitation fields opened empty because the calendar's saved lists
// arrived as JSON text rather than as lists.
describe('savedEmails', () => {
  it('reads a list stored as JSON text', () => {
    expect(savedEmails('["tutor@example.invalid","co@example.invalid"]')).toEqual(['tutor@example.invalid', 'co@example.invalid']);
  });

  it('reads a list, and plain text', () => {
    expect(savedEmails(['one@example.invalid'])).toEqual(['one@example.invalid']);
    expect(savedEmails('one@example.invalid, two@example.invalid')).toEqual(['one@example.invalid', 'two@example.invalid']);
  });

  it('falls back to the displayed summary when the saved column holds nobody', () => {
    expect(savedEmails(null, ['shown@example.invalid'])).toEqual(['shown@example.invalid']);
    expect(savedEmails('[]', ['shown@example.invalid'])).toEqual(['shown@example.invalid']);
  });
});

// What the Update form sends for an existing calendar: only what was changed,
// so an untouched field keeps the value Teams already has.
const saved: TeamsCalendarForm = {
  ...emptyTeamsCalendarForm(),
  organizerEmail: 'organizer@example.invalid',
  recording: 'record-transcribe', lobbyBypass: 'invited', spokenLanguage: 'en-GB',
  presenters: 'tutor@example.invalid',
  coOrganizers: 'coordinator@example.invalid',
  attendees: 'one@example.invalid\ntwo@example.invalid',
};

describe('teamsUpdateChanges', () => {
  it('sends nothing but the dates when nothing was edited', () => {
    expect(teamsUpdateChanges({ ...saved }, saved)).toEqual({ fields: {}, addedPeople: [] });
  });

  it('ignores order and letter case in a list that holds the same people', () => {
    const form = { ...saved, attendees: 'TWO@example.invalid\none@example.invalid' };
    expect(teamsUpdateChanges(form, saved).fields).toEqual({});
  });

  it('sends only the changed list and option, and names only the new person', () => {
    const form = { ...saved, presenters: 'tutor@example.invalid\nguest@example.invalid', spokenLanguage: 'ar-EG' };
    expect(teamsUpdateChanges(form, saved)).toEqual({
      fields: { presenters: ['tutor@example.invalid', 'guest@example.invalid'], spokenLanguage: 'ar-EG' },
      addedPeople: ['guest@example.invalid'],
    });
  });

  it('does not treat a role change as someone new', () => {
    const form = { ...saved, attendees: 'one@example.invalid', presenters: 'tutor@example.invalid\ntwo@example.invalid' };
    expect(teamsUpdateChanges(form, saved).addedPeople).toEqual([]);
  });

  it('sends an emptied list, so removing everyone is saved', () => {
    expect(teamsUpdateChanges({ ...saved, coOrganizers: '' }, saved).fields).toEqual({ coOrganizers: [] });
  });

  it('never counts the organizer as added', () => {
    expect(teamsUpdateChanges({ ...saved, attendees: `${saved.attendees}\norganizer@example.invalid` }, saved).addedPeople).toEqual([]);
  });
});
