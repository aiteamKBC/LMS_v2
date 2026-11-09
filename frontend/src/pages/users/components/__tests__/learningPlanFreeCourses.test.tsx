import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningPlanModal } from '../LearningPlanModal';
import { fetchLearningPlan, saveLearningPlan, type LearningPlanResponse } from '@/api/learningPlan';

vi.mock('@/api/learningPlan', async () => ({
  ...await vi.importActual<typeof import('@/api/learningPlan')>('@/api/learningPlan'),
  fetchLearningPlan: vi.fn(), saveLearningPlan: vi.fn(),
}));
vi.mock('@/lib/curriculumApi', () => ({ fetchFreeProgrammeModules: vi.fn(async () => []) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn() }) }));

const ordinary = { moduleId: 'M1', moduleTitle: 'Programme module', hours: 10, groupName: 'Group', programmeId: 'P1', programmeName: 'Programme' };
const standalone = { ...ordinary, moduleId: 'M2', moduleTitle: 'Standalone skills', hours: 6, groupName: '', programmeId: '', programmeName: '' };
function fixture(assigned = true): LearningPlanResponse {
  return {
    learner: { id: '7', name: 'Synthetic learner', programme: 'Programme', programmeId: 'P1', cohort: 'Cohort', group: 'Group', programmeStatus: 'Delivery' },
    plan: assigned ? [ordinary, standalone] : [ordinary], preset: [ordinary], available: assigned ? [] : [standalone],
    standaloneCourses: [{ freeCourseId: 'FC-1', moduleId: 'M2', courseName: 'Standalone skills' }],
    freeCourses: [], saved: true, programmes: [], totals: {
      moduleCount: assigned ? 2 : 1, moduleHours: assigned ? 16 : 10,
      meetingCount: 0, meetingHours: 0, totalHours: assigned ? 16 : 10,
    },
  };
}
const renderPlan = (props = {}) => render(<LearningPlanModal learnerId="7" learnerName="Synthetic learner" onClose={vi.fn()} {...props} />);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchLearningPlan).mockResolvedValue(fixture());
  vi.mocked(saveLearningPlan).mockResolvedValue(fixture());
});

describe('Learning plan free-course assignments', () => {
  it('shows assigned builder courses in the free-course section and counts hours once', async () => {
    renderPlan();
    const section = within(await screen.findByRole('region', { name: 'Assigned free courses' }));
    expect(section.getByText('Standalone skills')).toBeVisible();
    expect(section.getByText('6h')).toBeVisible();
    expect(screen.getByText((_content, element) => element?.tagName === 'SPAN' && element.textContent === '2 modules · 16h total')).toBeVisible();
    expect(screen.queryByText(/Extras.*no hours/)).not.toBeInTheDocument();
  });

  it('adds a standalone course through the normal modules payload', async () => {
    vi.mocked(fetchLearningPlan).mockResolvedValue(fixture(false));
    renderPlan();
    const select = await screen.findByLabelText('Free course to add');
    fireEvent.change(select, { target: { value: 'FC-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add free course' }));
    expect(screen.getByText((_content, element) => element?.tagName === 'SPAN' && element.textContent === '2 modules · 16h total')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save learning plan' }));
    await waitFor(() => expect(saveLearningPlan).toHaveBeenCalledWith('7', ['M1', 'M2'], []));
  });

  it('removes the same assignment from the plan and preserves unrelated modules', async () => {
    renderPlan();
    const section = within(await screen.findByRole('region', { name: 'Assigned free courses' }));
    fireEvent.click(section.getByRole('button', { name: 'Remove Standalone skills' }));
    expect(screen.queryByText('Standalone skills', { selector: 'td' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save learning plan' }));
    await waitFor(() => expect(saveLearningPlan).toHaveBeenCalledWith('7', ['M1'], []));
  });

  it('keeps an active learner removal confirmation for standalone courses', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPlan({ hasStarted: true });
    const section = within(await screen.findByRole('region', { name: 'Assigned free courses' }));
    fireEvent.click(section.getByRole('button', { name: 'Remove Standalone skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save learning plan' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Standalone skills'));
    expect(saveLearningPlan).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('shows courses in read-only mode without assignment controls', async () => {
    renderPlan({ readOnly: true });
    const section = within(await screen.findByRole('region', { name: 'Assigned free courses' }));
    expect(section.getByText('Standalone skills')).toBeVisible();
    expect(section.queryByRole('button')).not.toBeInTheDocument();
    expect(section.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('preserves a legacy assignment until it also exists in the normal plan', async () => {
    const data = fixture(false);
    data.freeCourses = [{ freeCourseId: 'FC-1', courseName: 'Standalone skills', addedAt: '2026-01-01T00:00:00Z' }];
    vi.mocked(fetchLearningPlan).mockResolvedValue(data);
    renderPlan({ readOnly: true });
    const section = within(await screen.findByRole('region', { name: 'Assigned free courses' }));
    expect(section.getByText('Standalone skills')).toBeVisible();
  });
});
