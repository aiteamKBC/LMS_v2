import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupPlacementPanel } from '../PlaceComponentDrawer';
import { loadCurriculumScope } from '../weekTemplateData';

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => true),
}));

vi.mock('../weekTemplateData', async importOriginal => {
  const original = await importOriginal<typeof import('../weekTemplateData')>();
  return { ...original, loadCurriculumScope: vi.fn() };
});

const moduleRow = (name: string, programmeId = 'PROG-FINAL') => ({
  id: `MOD-${name}`,
  moduleCatalogueId: `MOD-${name}`,
  sourceId: `SRC-${name}`,
  name,
  programme: 'Final Test',
  programmeId,
  group: 'Aya Group',
  groupId: 'GROUP-AYA',
  weeks: 2,
});

const component = {
  id: 'COMP-1',
  weekId: 'WEEK-1',
  type: 'reading',
  title: 'Reading',
  description: '',
  expectedOtjh: 1,
  points: 0,
  reflectionRequired: false,
  reflectionQuestion: '',
  workplaceEvidenceRequired: false,
  tutorValidationRequired: false,
  coachValidationRequired: true,
  ksbMappings: [],
  settings: {},
} as never;

describe('GroupPlacementPanel module list', () => {
  beforeEach(() => {
    vi.mocked(loadCurriculumScope).mockResolvedValue({
      programmes: [], cohorts: [], groups: [],
      modules: [moduleRow('Aya test 2 copy'), moduleRow('Aya test 2')],
    } as never);
  });

  it('revalidates the scope and includes every module in the selected group', async () => {
    render(
      <GroupPlacementPanel
        component={component}
        groupId="GROUP-AYA"
        groupName="Aya Group"
        programmeId="PROG-FINAL"
        onClose={() => undefined}
        onPlaced={() => undefined}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Aya test 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aya test 2 copy' })).toBeInTheDocument();
    await waitFor(() => expect(loadCurriculumScope).toHaveBeenCalledWith({ force: true }));
  });
});
