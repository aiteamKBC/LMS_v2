import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readImportedMeetingEditor, previewImportedMeetingEdit, confirmImportedMeetingEdit,
  previewImportedCalendarUpdate, confirmImportedCalendarUpdate, checkImportedCalendarUpdate,
  connectImportedCalendar, fetchImportedCalendarConnection,
  type CurriculumTeamsMeetingSummary,
} from '@/lib/curriculumApi';
import type { ModuleComponent } from '../../module-builder/moduleAuthoringData';
import type { MeetingRow } from '../useTeamsMeetingsWorkspace';
import { ExternalCalendarPanel } from '../ExternalCalendarPanel';
import { externalCalendarFor } from '../externalCalendar';

vi.mock('@/lib/curriculumApi', () => ({
  readImportedMeetingEditor: vi.fn(), previewImportedMeetingEdit: vi.fn(), confirmImportedMeetingEdit: vi.fn(),
  checkImportedMeetingEdit: vi.fn(), previewImportedCalendarUpdate: vi.fn(), confirmImportedCalendarUpdate: vi.fn(),
  checkImportedCalendarUpdate: vi.fn(), connectImportedCalendar: vi.fn(), fetchImportedCalendarConnection: vi.fn(),
  searchEntraPeople: vi.fn(async () => ({ people: [], hasMore: false })),
}));
vi.mock('../ImportedParticipantsPanel', () => ({ ImportedParticipantsPanel: () => null }));

const originalLink = 'https://teams.microsoft.com/l/meetup-join/original';
const separateLink = 'https://teams.microsoft.com/l/meetup-join/separate-session';
const starts = Array.from({ length: 17 }, (_, i) => new Date(Date.UTC(2030, 8, 6 + i * 7, 11)).toISOString());
const summary = {
  liveSessionId: 'LIVE-1', moduleCatalogueId: 'MOD-1', meetingType: 'linked-external',
  calendarManagement: 'external', joinUrl: originalLink, occurrenceDates: starts.slice(0, 16), timeZone: 'Europe/London',
} as CurriculumTeamsMeetingSummary;
const components: ModuleComponent[] = starts.map((_, i) => ({
  id: `COMP-${i + 1}`, weekId: `WEEK-${i + 1}`, title: `Session ${i + 1}`, type: 'live-session',
  description: '', expectedOtjh: 2, points: 0, reflectionRequired: false, reflectionQuestion: '',
  workplaceEvidenceRequired: false, tutorValidationRequired: false, coachValidationRequired: true, ksbMappings: [],
  settings: {
    teamsMeetingScope: 'main', teamsMeetingType: 'linked-external', teamsLiveSessionId: 'LIVE-1',
    liveSessionUrl: originalLink, ...(i === 4 ? { liveSessionLinkOverride: separateLink } : {}),
  },
}));
const row = {
  catalogueId: 'MOD-1', summary, plannedStarts: starts,
  sessions: starts.map((start, i) => ({ id: `SESSION-${i + 1}`, componentId: `COMP-${i + 1}`,
    componentTitle: `Session ${i + 1}`, date: start.slice(0, 10), startTime: '12:00' })),
} as MeetingRow;
const editable = () => ({ status: 'editable' as const, message: 'Original calendar verified.', sourceToken: 'verified-original',
  organizer: 'organiser@example.invalid', attendees: ['invited@example.invalid'], presenters: [], coOrganizers: [],
  rolesEditable: true, timeZone: 'Europe/London',
  options: { recordAutomatically: true, allowTranscription: true, lobbyBypassSettings: { scope: 'invited' }, meetingSpokenLanguageTag: 'en-GB' },
  sessions: [],
});
const onUpdated = vi.fn(async () => undefined);
const onReattach = vi.fn();

function open(currentRow = row, currentComponents = components) {
  const calendar = externalCalendarFor(currentRow.summary, currentComponents)!;
  return render(<ExternalCalendarPanel key={currentRow.catalogueId} calendar={calendar} row={currentRow}
    onUpdated={onUpdated} onReattach={onReattach} busy={false} disabled={false} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readImportedMeetingEditor).mockResolvedValue(editable());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('an imported calendar with one separate component link', () => {
  it('keeps the original editor reachable while refusing whole-module reattachment', async () => {
    const before = structuredClone(components);
    open();
    expect(screen.queryByRole('button', { name: 'Reattach saved Teams data' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Teams calendar update' })).toBeVisible();
    expect(readImportedMeetingEditor).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Edit existing Teams meeting' }));
    expect(await screen.findByRole('combobox', { name: 'Attendees' })).toBeVisible();
    expect(readImportedMeetingEditor).toHaveBeenCalledExactlyOnceWith('LIVE-1');
    expect(screen.getByRole('button', { name: 'Remove invited@example.invalid' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save without notifying' })).toBeEnabled();
    expect(screen.getAllByRole('link', { name: 'Open existing meeting' }).map(link => link.getAttribute('href')))
      .toEqual([originalLink, separateLink]);
    expect(components).toEqual(before);
    expect(onReattach).not.toHaveBeenCalled();
    expect(previewImportedMeetingEdit).not.toHaveBeenCalled();
    expect(confirmImportedMeetingEdit).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('does not turn all 17 sessions amber because one link differs', () => {
    open();
    expect(screen.getAllByText('Matches saved Teams date')).toHaveLength(15);
    // One override and one newly planned date are still unconfirmed.
    expect(screen.getAllByText('Awaiting calendar confirmation')).toHaveLength(2);
    expect(screen.getByText('2 planned sessions still need calendar confirmation.')).toBeVisible();
  });

  it('does not confirm a session without its component identity when links conflict', () => {
    open({ ...row, sessions: row.sessions.map(session => ({ ...session, componentId: undefined })) });
    expect(screen.queryByText('Matches saved Teams date')).not.toBeInTheDocument();
    expect(screen.getAllByText('Awaiting calendar confirmation')).toHaveLength(17);
  });

  it('offers the existing group-calendar connection directly from the blocked editor', async () => {
    vi.mocked(readImportedMeetingEditor).mockResolvedValueOnce({ status: 'blocked', code: 'attendee_copy_only',
      message: 'Connect the original group calendar.', connectionRequired: true, connectionKind: 'group' });
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Edit existing Teams meeting' }));
    expect(await screen.findByRole('button', { name: 'Connect Microsoft calendar' })).toBeEnabled();
    expect(screen.queryByRole('combobox', { name: 'Attendees' })).not.toBeInTheDocument();
    expect(previewImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('reconnects the editor without automatically reviewing or updating the conflicted schedule', async () => {
    vi.mocked(readImportedMeetingEditor).mockResolvedValueOnce({ status: 'blocked',
      message: 'Connect the original group calendar.', connectionRequired: true, connectionKind: 'group' });
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({ status: 'blocked', code: 'different_main_links',
      message: 'Resolve the session calendar choice.', addedSessions: [], connectionKind: 'user' });
    vi.mocked(connectImportedCalendar).mockResolvedValue({ authorizationUrl: 'https://login.microsoftonline.com/test/authorize',
      callbackOrigin: 'https://lms.example.invalid' });
    vi.mocked(fetchImportedCalendarConnection).mockResolvedValue({ connected: true });
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Edit existing Teams meeting' }));
    await screen.findByRole('button', { name: 'Connect Microsoft calendar' });
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    await screen.findByText('Resolve the session calendar choice.');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Microsoft calendar' }));
    await waitFor(() => expect(connectImportedCalendar).toHaveBeenCalledExactlyOnceWith('LIVE-1', 'group'));
    await act(async () => { window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://lms.example.invalid', source: popup,
      data: { type: 'lms:teams-calendar-connected', ok: true, liveSessionId: 'LIVE-1' },
    })); });
    await waitFor(() => expect(fetchImportedCalendarConnection).toHaveBeenCalledExactlyOnceWith('LIVE-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect Microsoft calendar' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Edit existing Teams meeting' }));
    expect(await screen.findByRole('combobox', { name: 'Attendees' })).toBeVisible();
    expect(previewImportedCalendarUpdate).toHaveBeenCalledOnce();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(confirmImportedMeetingEdit).not.toHaveBeenCalled();
    expect(checkImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('does not offer the imported editor for an unrelated override on an LMS-owned calendar', () => {
    open({ ...row, summary: { ...summary, meetingType: 'live-session', calendarManagement: 'lms' } },
      components.map(component => ({ ...component, settings: { ...component.settings, teamsMeetingType: 'live-session' } })));
    expect(screen.queryByRole('button', { name: 'Edit existing Teams meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Teams calendar update' })).not.toBeInTheDocument();
    expect(readImportedMeetingEditor).not.toHaveBeenCalled();
  });
});
