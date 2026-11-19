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
const standalone = { ...ordinary, moduleId: 'M2', moduleTitle: 'Standalone skills', hours: 6, groupName: '', programmeId: '', programmeName: '', isFreeCourse: true };
function fixture(assigned = true, learnerType: 'commercial' | 'apprenticeship' = 'commercial'): LearningPlanResponse {
  return {
    learner: { id: '7', name: 'Synthetic learner', learnerType, programme: 'Programme', programmeId: 'P1', cohort: 'Cohort', group: 'Group', programmeStatus: 'Delivery' },
    plan: assigned ? [ordinary, standalone] : [ordinary], preset: [ordinary], available: assigned ? [] : [standalone],
    standaloneCourses: [{ freeCourseId: 'FC-1', moduleId: 'M2', courseName: 'Standalone skills' }],
    freeCourses: [], saved: true, programmes: [], totals: {
      moduleCount: 1, moduleHours: 10, freeCourseCount: assigned ? 1 : 0,
      freeCourseHours: assigned ? 6 : 0, plannedFreeCourseHours: assigned && learnerType === 'commercial' ? 6 : 0,
      meetingCount: 0, meetingHours: 0, totalHours: assigned && learnerType === 'commercial' ? 16 : 10,
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
    expect(screen.getByText((_content, element) => element?.tagName === 'SPAN' && element.textContent === '1 module · 1 free course · 16h total')).toBeVisible();
    expect(screen.queryByText('Standalone skills', { selector: 'td' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Extras.*no hours/)).not.toBeInTheDocument();
  });

  it('adds a standalone course through the normal modules payload', async () => {
    vi.mocked(fetchLearningPlan).mockResolvedValue(fixture(false));
    renderPlan();
    const select = await screen.findByLabelText('Free course to add');
    fireEvent.change(select, { target: { value: 'FC-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add free course' }));
    expect(screen.getByText((_content, element) => element?.tagName === 'SPAN' && element.textContent === '1 module · 1 free course · 16h total')).toBeVisible();
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

  it('keeps apprenticeship free courses before Meetings and outside planned hours', async () => {
    const data = fixture(true, 'apprenticeship');
    data.meetings = [{ reviewTemplateId: 'R1', name: 'Review', recurrenceLabel: 'Monthly',
      hoursEach: 2, occurrences: 1, hours: 2, startDate: '', endDate: '' }];
    vi.mocked(fetchLearningPlan).mockResolvedValue(data);
    renderPlan();
    const section = await screen.findByRole('region', { name: 'Assigned free courses' });
    expect(within(section).getByText('6h')).toBeVisible();
    expect(within(section).getByText(/excluded from planned hours/)).toBeVisible();
    expect(screen.queryByText('Standalone skills', { selector: 'td' })).not.toBeInTheDocument();
    expect(section.compareDocumentPosition(screen.getByRole('heading', { name: 'Meetings' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText((_content, element) => element?.tagName === 'SPAN' && element.textContent === '1 module · 1 free course · 1 meeting · 12h total')).toBeVisible();
  });

  it('adding an apprenticeship free course saves its assignment without increasing planned hours', async () => {
    vi.mocked(fetchLearningPlan).mockResolvedValue(fixture(false, 'apprenticeship'));
    renderPlan();
    fireEvent.change(await screen.findByLabelText('Free course to add'), { target: { value: 'FC-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add free course' }));
    expect(screen.getByText((_content, element) => element?.tagName === 'SPAN' && element.textContent === '1 module · 1 free course · 10h total')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save learning plan' }));
    await waitFor(() => expect(saveLearningPlan).toHaveBeenCalledWith('7', ['M1', 'M2'], []));
  });

  it('resetting group modules retains independently assigned courses', async () => {
    const data = fixture(true, 'apprenticeship');
    data.plan.push({ ...ordinary, moduleId: 'M3', moduleTitle: 'Extra programme module' });
    vi.mocked(fetchLearningPlan).mockResolvedValue(data);
    renderPlan();
    fireEvent.click(await screen.findByRole('button', { name: 'Reset to group default' }));
    expect(within(screen.getByRole('region', { name: 'Assigned free courses' })).getByText('Standalone skills')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save learning plan' }));
    await waitFor(() => expect(saveLearningPlan).toHaveBeenCalledWith('7', ['M1', 'M2'], []));
  });

  it('keeps standalone courses out of the core module picker', async () => {
    vi.mocked(fetchLearningPlan).mockResolvedValue(fixture(false, 'apprenticeship'));
    renderPlan();
    fireEvent.click(await screen.findByRole('button', { name: /Add a module/ }));
    expect(screen.queryByRole('button', { name: /Standalone skills/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Standalone skills' })).toBeInTheDocument();
  });
});
