import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { loadRecordingsLibrary, recordingDownloadUrl, type RecordingsLibrary } from '@/api/sessionResults';
import CurriculumRecordingsPage from '../page';

/**
 * The page is read only: it narrows what the server filed Programme -> Cohort
 * -> Group -> Module -> Week, and every level shows every recording under the
 * choice so far. Play/download go to the existing staff file route. What
 * matters is that each choice keeps exactly the recordings beneath it, that
 * draft and archived programmes stay out unless asked for, and that a
 * recording without a saved copy says so instead of offering a failing link.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/SessionRecordingPlayer', () => ({
  SessionRecordingPlayer: ({ label }: { label: string }) => <div data-testid="player">{label}</div>,
}));

vi.mock('@/api/sessionResults', async () => {
  const actual = await vi.importActual<typeof import('@/api/sessionResults')>('@/api/sessionResults');
  return { ...actual, loadRecordingsLibrary: vi.fn() };
});

const STATUS = { ready: 'available', pending: 'verificationRequired', failed: 'missingAzureFile' } as const;
const recording = (id: string, sessionNumber: number, state: 'ready' | 'pending' | 'failed' = 'ready', duplicateCount = 0) => ({
  id, seriesId: 'SERIES-1', sessionNumber, startsAt: '2026-09-07T08:00:00Z', recordedAt: '2026-09-07T08:02:00Z',
  endsAt: null, state, status: STATUS[state], duplicateCount, hiddenFromLearners: false,
});

type Delivery = RecordingsLibrary['deliveries'][number];
const delivery = (moduleId: string, title: string, programme: string, cohort: string, group: string,
  weeks: Delivery['weeks'], programmeActive = true, extra: Partial<Delivery> = {}): Delivery => ({
  moduleId, title, programme, programmeActive, archived: false, cohort, group, weeks, attention: [],
  recordingCount: weeks.reduce((sum, week) => sum + week.recordings.length, 0), ...extra,
});

const library: RecordingsLibrary = {
  recordingCount: 5,
  attentionChecked: true,
  deliveries: [
    delivery('MOD-A', 'Data Analysis', 'Level 4 Data', 'Sep 26', 'Group A', [
      { weekId: 'W1', weekNumber: 1, title: 'Intro', recordings: [recording('REC-1', 1)] },
      { weekId: null, weekNumber: null, title: '', recordings: [recording('REC-2', 5, 'pending')] },
    ]),
    delivery('MOD-B', 'Data Analysis', 'Level 4 Data', 'Sep 26', 'Group B', [
      { weekId: 'W9', weekNumber: 3, title: 'Cleaning', recordings: [recording('REC-3', 3)] },
    ]),
    delivery('MOD-P', 'Project Management', 'Level 4 Data', 'Jan 27', 'Group P', [
      { weekId: 'WP', weekNumber: 2, title: 'Planning', recordings: [recording('REC-4', 2)] },
    ]),
    delivery('MOD-X', 'Retired Module', 'Old Programme', 'Jan 24', 'Group X', [
      { weekId: 'WX', weekNumber: 1, title: 'Gone', recordings: [recording('REC-5', 1)] },
    ], false),
  ],
};

const renderPage = () => render(<MemoryRouter><CurriculumRecordingsPage /></MemoryRouter>);

async function choose(user: ReturnType<typeof userEvent.setup>, level: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: level }));
  await user.click(await screen.findByRole('option', { name: option }));
}

const weekButton = (name: RegExp) => screen.queryByRole('button', { name });

describe('Session recordings page', () => {
  beforeEach(() => {
    vi.mocked(loadRecordingsLibrary).mockReset().mockResolvedValue(library);
  });

  it('shows every recording of the active programmes until something is chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('4 recordings in 3 group modules')).toBeInTheDocument();
    expect(weekButton(/Week 1 · Intro/)).toBeInTheDocument();
    expect(weekButton(/Week 3 · Cleaning/)).toBeInTheDocument();
    expect(weekButton(/Week 2 · Planning/)).toBeInTheDocument();
    expect(weekButton(/Week 1 · Gone/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Include draft and archived' }));
    expect(weekButton(/Week 1 · Gone/)).toBeInTheDocument();
    expect(screen.getByText(/Programme is draft or archived/)).toBeInTheDocument();
  });

  it('narrows to everything under the chosen programme, then cohort', async () => {
    const user = userEvent.setup();
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({
      ...library, deliveries: library.deliveries.map(item => ({ ...item, programmeActive: true })),
    });
    renderPage();
    await screen.findByText('5 recordings in 4 group modules');
    await choose(user, 'Programme', 'Level 4 Data (4)');
    expect(screen.getByText('4 recordings in 3 group modules')).toBeInTheDocument();
    expect(weekButton(/Week 1 · Gone/)).not.toBeInTheDocument();

    await choose(user, 'Cohort', 'Jan 27 (1)');
    expect(screen.getByText('1 recording in 1 group module')).toBeInTheDocument();
    expect(weekButton(/Week 2 · Planning/)).toBeInTheDocument();
    expect(weekButton(/Week 1 · Intro/)).not.toBeInTheDocument();
  });

  it('narrows group, then module, then opens the chosen week with play and download', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 recordings in 3 group modules');
    expect(screen.getByRole('combobox', { name: 'Week' })).toBeDisabled();

    await choose(user, 'Group', 'Group A (2)');
    expect(weekButton(/Week 3 · Cleaning/)).not.toBeInTheDocument();
    await choose(user, 'Module', 'Data Analysis (2)');
    await choose(user, 'Week', 'Week 1 · Intro (1)');
    expect(weekButton(/Not matched to a week/)).not.toBeInTheDocument();

    const download = screen.getByRole('link', { name: 'Download' });
    expect(download).toHaveAttribute('href', recordingDownloadUrl('SERIES-1', 'REC-1'));
    expect(download.getAttribute('href')).toContain('download=1');
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByTestId('player')).toHaveTextContent('Session 1');
  });

  it('clears the lower levels when a higher one changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 recordings in 3 group modules');
    await choose(user, 'Group', 'Group B (1)');
    expect(screen.getByText('1 recording in 1 group module')).toBeInTheDocument();
    await choose(user, 'Cohort', 'Sep 26 (3)');
    expect(screen.getByText('3 recordings in 2 group modules')).toBeInTheDocument();
  });

  it('says why an unmatched or unsaved recording cannot be downloaded yet', async () => {
    const user = userEvent.setup();
    renderPage();
    const week = await screen.findByRole('button', { name: /Not matched to a week/ });
    await user.click(week);
    const panel = week.closest('li') as HTMLElement;
    expect(within(panel).getByText(/no live session in the course structure is linked/)).toBeInTheDocument();
    expect(within(panel).getByRole('status')).toHaveTextContent('no saved copy is confirmed yet');
    expect(within(panel).queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('keeps a deleted module\'s recordings out until asked for, then lists them read only and apart from active counts', async () => {
    const user = userEvent.setup();
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({
      ...library,
      deliveries: [...library.deliveries, delivery('MOD-OLD', 'Deleted Module', 'Level 4 Data', 'Sep 26', 'Group Old', [
        { weekId: 'WO', weekNumber: 4, title: 'Kept', recordings: [recording('REC-OLD', 4)] },
      ], true, { archived: true })],
    });
    renderPage();
    await screen.findByText('4 recordings in 3 group modules');
    expect(weekButton(/Week 4 · Kept/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    expect(screen.queryByRole('option', { name: /Archived/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Available (3)' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('checkbox', { name: 'Include draft and archived' }));
    expect(screen.getByText(/Archived \/ Deleted module/)).toBeInTheDocument();
    expect(screen.getByText(/Read only\. This module was deleted/)).toBeInTheDocument();
    await choose(user, 'Status', 'Archived (1)');
    expect(screen.getByText('1 recording in 1 group module')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Week 4 · Kept/ }));
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', recordingDownloadUrl('SERIES-1', 'REC-OLD'));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('lists past sessions to check with the reason, and filters by status', async () => {
    const user = userEvent.setup();
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({
      ...library,
      deliveries: library.deliveries.map(item => item.moduleId !== 'MOD-B' ? item : {
        ...item,
        attention: [{
          occurrenceId: 'OCC-9', weekId: 'W10', weekNumber: 4, weekTitle: 'Modelling', sessionNumber: 4,
          startsAt: '2026-09-28T08:00:00Z', status: 'missingSync' as const,
          reason: 'The last results synchronization for this meeting did not complete, so a recording may not have been collected.',
        }],
      }),
    });
    renderPage();
    expect(await screen.findByText('4 recordings in 3 group modules · 1 session to check')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Sessions to check' });
    expect(within(list).getByText(/Week 4 · Modelling/)).toBeInTheDocument();
    expect(within(list).getByText('Missing sync')).toBeInTheDocument();
    expect(within(list).getByText(/did not complete/)).toBeInTheDocument();

    await choose(user, 'Status', 'Missing sync (1)');
    expect(screen.getByText('0 recordings in 0 group modules · 1 session to check')).toBeInTheDocument();
    expect(weekButton(/Week 3 · Cleaning/)).not.toBeInTheDocument();

    await choose(user, 'Status', 'Verification required (1)');
    expect(screen.queryByRole('region', { name: 'Sessions to check' })).not.toBeInTheDocument();
    expect(weekButton(/Not matched to a week/)).toBeInTheDocument();
  });

  it('shows a recording Graph listed twice once, and says a failed copy is missing from storage', async () => {
    const user = userEvent.setup();
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({
      ...library,
      deliveries: [delivery('MOD-A', 'Data Analysis', 'Level 4 Data', 'Sep 26', 'Group A', [
        { weekId: 'W1', weekNumber: 1, title: 'Intro', recordings: [recording('REC-1', 1, 'ready', 1), recording('REC-F', 2, 'failed')] },
      ])],
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Week 1 · Intro/ }));
    expect(screen.getByText(/1 identical copy is also stored and not shown/)).toBeInTheDocument();
    expect(screen.getByText('Missing Azure file')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saving a copy of this recording to storage failed');
    expect(screen.getAllByRole('link', { name: 'Download' })).toHaveLength(1);
  });

  it('still lists recordings when the session check could not be loaded', async () => {
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, attentionChecked: false });
    renderPage();
    expect(await screen.findByText(/could not be loaded\. Every saved recording is still listed/)).toBeInTheDocument();
    expect(screen.getByText('4 recordings in 3 group modules')).toBeInTheDocument();
  });

  it('shows the load error with a retry', async () => {
    vi.mocked(loadRecordingsLibrary).mockRejectedValueOnce(new Error('Saved results are temporarily unavailable.'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Saved results are temporarily unavailable.')).toBeInTheDocument());
  });

});
