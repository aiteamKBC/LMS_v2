import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleCatalogueItem } from '../moduleAuthoringData';

const readModuleTeamsMeeting = vi.fn();
const probeModuleTeamsAttachment = vi.fn();
const restoreModuleTeamsMeeting = vi.fn();

vi.mock('../moduleAuthoringData', async importOriginal => ({
  ...(await importOriginal<typeof import('../moduleAuthoringData')>()),
  readModuleTeamsMeeting: (...args: unknown[]) => readModuleTeamsMeeting(...args),
  probeModuleTeamsAttachment: (...args: unknown[]) => probeModuleTeamsAttachment(...args),
  restoreModuleTeamsMeeting: (...args: unknown[]) => restoreModuleTeamsMeeting(...args),
}));

import { RestoreTeamsDataDialog } from '../RestoreTeamsDataDialog';

const module = { catalogueId: 'MOD-RESTORE', title: 'Risk workshop' } as ModuleCatalogueItem;
const saved = {
  verificationPending: false,
  module: {
    ...module,
    sessionsNumber: 2,
    weeks: 2,
    weekStructure: [
      { id: 'W1', components: [{ type: 'live-session', title: 'Kick-off and expectations' }] },
      { id: 'W2', components: [{ type: 'live-session', title: 'Stakeholder mapping workshop' }] },
    ],
  },
  meeting: { organizerEmail: 'tutor@example.com' },
  calendar: {
    title: 'Risk workshop · Teams calendar',
    seriesMode: 'shared',
    occurrences: [
      { sessionNumber: 1, startDateTimeUtc: '2026-09-15T09:00:00Z', durationMinutes: 60, joinUrl: 'https://teams.example/1', eventId: 'EVENT-1' },
      { sessionNumber: 2, startDateTimeUtc: '2026-09-22T09:00:00Z', durationMinutes: 60, joinUrl: 'https://teams.example/2', eventId: 'EVENT-2' },
    ],
  },
};

describe('RestoreTeamsDataDialog', () => {
  beforeEach(() => {
    readModuleTeamsMeeting.mockReset().mockResolvedValue(saved);
    probeModuleTeamsAttachment.mockReset().mockResolvedValue(1);
    restoreModuleTeamsMeeting.mockReset().mockResolvedValue({
      restored: true,
      updatedComponents: 2,
      createdComponents: 1,
      meeting: {},
      module: { ...module, weekStructure: [] },
    });
  });

  it('reviews the saved calendar and restores it in place', async () => {
    const onClose = vi.fn();
    const onRestored = vi.fn();
    render(<RestoreTeamsDataDialog module={module} onClose={onClose} onRestored={onRestored} />);

    expect(await screen.findByText('Risk workshop · Teams calendar')).toBeInTheDocument();
    expect(screen.getByText(/1 week will receive a live-session component/)).toBeInTheDocument();
    expect(screen.getByText('Kick-off and expectations')).toBeInTheDocument();
    expect(screen.getByText('Stakeholder mapping workshop')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Saved Teams sessions' })).toHaveClass('grid-cols-1');
    await userEvent.click(screen.getByRole('button', { name: 'Restore Teams data here' }));

    await waitFor(() => expect(restoreModuleTeamsMeeting).toHaveBeenCalledWith('MOD-RESTORE', { createMissingComponents: true }));
    expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ catalogueId: 'MOD-RESTORE' }));
    expect(await screen.findByText('Teams data is back in this module')).toBeInTheDocument();
  });

  it('protects unsaved builder changes by disabling the restore action', async () => {
    render(<RestoreTeamsDataDialog module={module} unsavedChanges onClose={vi.fn()} onRestored={vi.fn()} />);

    const action = await screen.findByRole('button', { name: 'Restore Teams data here' });
    expect(action).toBeDisabled();
    expect(screen.getByText(/Save your module changes before restoring/)).toBeInTheDocument();
    expect(restoreModuleTeamsMeeting).not.toHaveBeenCalled();
  });
});
