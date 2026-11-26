import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumHoliday, CurriculumProgramme } from '@/lib/curriculumApi';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { CohortFormDrawer } from '../forms';

/**
 * Typed answers are not thrown away silently. Closing a drawer that holds unsaved
 * answers — Cancel, the header cross, the backdrop or Escape — has to ask first,
 * and an untouched drawer must still close on the first click.
 */

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', () => ({
  createCurriculumCohort: vi.fn(async () => ({})),
  updateCurriculumCohort: vi.fn(async () => ({})),
  createCurriculumGroup: vi.fn(async () => ({})),
  updateCurriculumGroup: vi.fn(async () => ({})),
  createCurriculumProgramme: vi.fn(async () => ({})),
  updateCurriculumProgramme: vi.fn(async () => ({})),
  previewCohortEndDate: vi.fn(async () => ({
    endDate: '2027-08-31',
    practicalEndDate: '2027-08-31',
    calculatedEndDate: '2027-08-31',
    apprenticeshipEndDate: '2027-11-30',
    warnings: [],
  })),
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst', level: '4' },
] as CurriculumProgramme[];

const holidays: CurriculumHoliday[] = [];

const confirmMock = vi.mocked(showCurriculumConfirm);

function renderDrawer(onClose = vi.fn()) {
  render(
    <CohortFormDrawer
      open
      programmes={programmes}
      holidays={holidays}
      onClose={onClose}
      onSaved={vi.fn(async () => undefined)}
    />,
  );
  return onClose;
}

describe('drawer unsaved-changes guard', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(false);
  });

  it('closes an untouched drawer without asking', async () => {
    const onClose = renderDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before throwing away an answer, and keeps the drawer open until the user says so', async () => {
    const onClose = renderDrawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. September 2026'), 'September 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0][0].confirmButtonText).toBe('Discard changes');
    // Cancelling the dialog is the default, so the answers survive.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once the discard is confirmed', async () => {
    // The real dialog runs onConfirm when the user picks "Discard changes".
    confirmMock.mockImplementation(async options => {
      await options.onConfirm();
      return true;
    });
    const onClose = renderDrawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. September 2026'), 'September 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guards the header cross and the backdrop too, not just Cancel', async () => {
    const onClose = renderDrawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. September 2026'), 'September 2026');

    const cross = document.querySelector('.workspace-drawer-header button') as HTMLElement;
    await userEvent.click(cross);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(document.querySelector('.workspace-drawer-backdrop') as HTMLElement);
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not treat a selection the user put back as an unsaved change', async () => {
    const onClose = renderDrawer();
    const nameField = screen.getByPlaceholderText('e.g. September 2026');
    await userEvent.type(nameField, 'September 2026');
    await userEvent.clear(nameField);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
