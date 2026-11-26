import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExistingTeamsSeriesImport } from '../ExistingTeamsSeriesImport';
import { ReplaceTeamsLinksDialog } from '../ReplaceTeamsLinksDialog';
import { previewExistingTeamsSeries, linkExistingTeamsSeries } from '../moduleAuthoringData';
import type { ExistingTeamsSeriesReview, ModuleCatalogueItem, ModuleWeek } from '../moduleAuthoringData';

vi.mock('../moduleAuthoringData', () => ({
  previewExistingTeamsSeries: vi.fn(), linkExistingTeamsSeries: vi.fn(),
}));
const link = 'https://teams.microsoft.com/l/meetup-join/existing';
const module = { catalogueId: 'MOD-1', title: 'Course', weekStructure: [] } as unknown as ModuleCatalogueItem;
const review: ExistingTeamsSeriesReview = {
  previewToken: 'signed-review', organizer: 'synthetic@example.invalid', timeZone: 'Europe/London',
  structureRevision: 'rev-1', matched: 1, unmatched: 1,
  sessions: [
    { componentId: 'C1', weekId: 'W1', title: 'October week', date: '2026-10-23', status: 'matched', holidays: [] },
    { componentId: 'C2', weekId: 'W2', title: 'Holiday week', date: '2026-10-30', status: 'missing', holidays: ['Closure'] },
  ],
};
beforeEach(() => {
  vi.mocked(previewExistingTeamsSeries).mockResolvedValue(review);
  vi.mocked(linkExistingTeamsSeries).mockResolvedValue({ module, matched: 1, unmatched: 1, alreadyLinked: false });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('performs no discovery on mount and reviews real dates before an explicit apply', async () => {
  const user = userEvent.setup();
  const onLinked = vi.fn();
  render(<ExistingTeamsSeriesImport moduleId="MOD-1" link={link} weekIds={['W1', 'W2']} unsaved={false} onBusy={vi.fn()} onLinked={onLinked} />);
  expect(previewExistingTeamsSeries).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Link 1 matched/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Check existing series' }));
  expect(previewExistingTeamsSeries).toHaveBeenCalledWith('MOD-1', { link, weekIds: ['W1', 'W2'], calendarMailbox: '' });
  expect(await screen.findByText('1 matched · 1 need review · Europe/London')).toBeVisible();
  expect(screen.getByText('Holiday in saved plan')).toBeVisible();
  expect(screen.getByText(/Unmatched weeks keep their planned date/)).toBeVisible();
  expect(linkExistingTeamsSeries).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Link 1 matched session' }));
  expect(linkExistingTeamsSeries).toHaveBeenCalledWith('MOD-1', 'signed-review');
  await waitFor(() => expect(onLinked).toHaveBeenCalledWith(module));
});

it('keeps the save reason beside the button and sends nothing for unsaved changes', async () => {
  const user = userEvent.setup();
  render(<ExistingTeamsSeriesImport moduleId="MOD-1" link={link} weekIds={['W1']} unsaved onBusy={vi.fn()} onLinked={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Check existing series' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Save the module first');
  expect(previewExistingTeamsSeries).not.toHaveBeenCalled();
  expect(linkExistingTeamsSeries).not.toHaveBeenCalled();
});

it('displays permission/refusal failures without pretending a pasted URL is a confirmed calendar', async () => {
  vi.mocked(previewExistingTeamsSeries).mockRejectedValue(new Error('Microsoft did not allow reading this series.'));
  const user = userEvent.setup();
  render(<ExistingTeamsSeriesImport moduleId="MOD-1" link={link} weekIds={['W1']} unsaved={false} onBusy={vi.fn()} onLinked={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Check existing series' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft did not allow');
  expect(screen.queryByRole('button', { name: /Link.*matched/ })).toBeNull();
});

it('requires a fresh review after the mailbox is edited', async () => {
  const user = userEvent.setup();
  render(<ExistingTeamsSeriesImport moduleId="MOD-1" link={link} weekIds={['W1']} unsaved={false} onBusy={vi.fn()} onLinked={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Check existing series' }));
  await screen.findByRole('button', { name: 'Link 1 matched session' });
  fireEvent.change(screen.getByLabelText('Calendar mailbox'), { target: { value: 'another@example.invalid' } });
  expect(screen.queryByRole('button', { name: /Link.*matched/ })).toBeNull();
  expect(linkExistingTeamsSeries).not.toHaveBeenCalled();
});

it('selects the main live weeks for the series workflow and keeps manual links as a separate choice', async () => {
  const user = userEvent.setup();
  const weeks = [
    { id: 'W1', weekNumber: 1, title: 'Live', components: [{ type: 'live-session', settings: {} }] },
    { id: 'W2', weekNumber: 2, title: 'Extra', components: [{ type: 'live-session', settings: { teamsMeetingScope: 'additional' } }] },
  ] as unknown as ModuleWeek[];
  render(<ReplaceTeamsLinksDialog moduleId="MOD-1" weeks={weeks} onClose={vi.fn()} onApply={vi.fn()} onSeriesLinked={vi.fn()} />);
  expect(screen.getByRole('radio', { name: 'Existing Teams series' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Week 1' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Week 2' })).not.toBeChecked();
  expect(previewExistingTeamsSeries).not.toHaveBeenCalled();
  await user.click(screen.getByRole('radio', { name: 'Join links only' }));
  expect(screen.getByRole('button', { name: 'Replace 1 link' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Check existing series' })).toBeNull();
});
