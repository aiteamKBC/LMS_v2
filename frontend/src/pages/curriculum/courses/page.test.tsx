import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFreeProgrammeModules, saveFreeProgrammeModules, type FreeProgrammeModule } from '@/lib/curriculumApi';
import { fetchWeekTemplates } from '../week-builder/weekTemplateData';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import CoursesPage from './page';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({ showCurriculumAlert: vi.fn(), showCurriculumConfirm: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({
  fetchFreeProgrammeModules: vi.fn(), saveFreeProgrammeModules: vi.fn(),
  fetchCurriculumProgrammes: vi.fn(), fetchCurriculumProgrammeDetail: vi.fn(),
  importModuleToFreeCourses: vi.fn(), injectFreeCourseIntoGroup: vi.fn(),
}));
vi.mock('../week-builder/weekTemplateData', () => ({ fetchWeekTemplates: vi.fn(), fetchWeekTemplateDetail: vi.fn() }));

const week = (id: string, overrides: Partial<FreeProgrammeModule> = {}): FreeProgrammeModule => ({
  id, courseId: 'F', courseName: 'Open learning', title: 'Open learning', description: 'A free course',
  weekId: `W-${id}`, weekNumber: 1, weekTitle: 'Introduction', displayOrder: 0, componentCount: 1, totalOtjh: 2,
  components: [{ id: `P-${id}`, weekId: `W-${id}`, displayOrder: 0, type: 'reading', title: 'Written guidance', description: 'Stored description',
    expectedOtjh: 2, points: 10, reflectionRequired: true, workplaceEvidenceRequired: false, tutorValidationRequired: false,
    settings: { readingContent: '<p>Stored guidance</p>', version: '3.2' } }], ...overrides,
});
const modules = [week('F1'), week('F2', { weekNumber: 2, weekTitle: 'Free course practice' }),
  week('A1', { courseId: 'A', courseType: 'apprentices', courseName: 'Workplace learning', title: 'Workplace learning', description: 'Independent Apprentices course', weekTitle: 'Evidence workshop' })];

function Location() { return <output aria-label="Current URL">{useLocation().search}</output>; }
function show(url = '/curriculum/courses') { return render(<MemoryRouter initialEntries={[url]}><CoursesPage /><Location /></MemoryRouter>); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchFreeProgrammeModules).mockResolvedValue(modules);
  vi.mocked(fetchWeekTemplates).mockResolvedValue([]);
});
afterEach(cleanup);

describe('Curriculum Courses', () => {
  it('groups persisted weeks, defaults legacy courses to Free and combines URL filters with search', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('article', { name: 'Workplace learning' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(within(screen.getByRole('article', { name: 'Open learning' })).getByText('Free course')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apprentices 1' }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('?type=apprentices');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.type(screen.getByRole('searchbox'), 'EVIDENCE');
    expect(screen.getByRole('article', { name: 'Workplace learning' })).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'unknown course');
    expect(screen.getByText('No courses match your filters')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(saveFreeProgrammeModules).not.toHaveBeenCalled();
  });

  it('opens directly on Apprentices and defaults new courses to the selected independent type', async () => {
    const user = userEvent.setup();
    show('/curriculum/courses?type=apprentices');
    await screen.findByRole('article', { name: 'Workplace learning' });
    expect(screen.queryByRole('article', { name: 'Open learning' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add course' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add course' }));
    expect(dialog.getByRole('combobox', { name: 'Course type' })).toHaveValue('apprentices');
    expect(dialog.getByRole('button', { name: 'Create course' })).toBeDisabled();
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Course type' }), 'free');
    expect(dialog.getByRole('combobox', { name: 'Course type' })).toHaveValue('free');
  });

  it('saves an edited category while retaining other courses and component settings', async () => {
    const user = userEvent.setup();
    vi.mocked(saveFreeProgrammeModules).mockResolvedValue({ saved: true, programmeId: 'FREE-COURSES', modules });
    show();
    const card = await screen.findByRole('article', { name: 'Workplace learning' });
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit course' }));
    expect(dialog.getByRole('combobox', { name: 'Course type' })).toHaveValue('apprentices');
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Course type' }), 'free');
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveFreeProgrammeModules).toHaveBeenCalledTimes(1));
    const [programmeId, payload] = vi.mocked(saveFreeProgrammeModules).mock.calls[0];
    expect(programmeId).toBe('FREE-COURSES');
    expect(payload.modules).toHaveLength(3);
    expect(payload.modules?.filter(module => module.courseId === 'F').map(module => module.courseType)).toEqual(['free', 'free']);
    expect(payload.modules?.find(module => module.courseId === 'A')).toMatchObject({ courseType: 'free', courseName: 'Workplace learning',
      components: [expect.objectContaining({ expectedOtjh: 2, points: 10, reflectionRequired: true, settings: expect.objectContaining({ readingContent: '<p>Stored guidance</p>', version: '3.2' }) })] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the draft and category when saving fails', async () => {
    const user = userEvent.setup();
    vi.mocked(saveFreeProgrammeModules).mockRejectedValue(new Error('Synthetic save refused'));
    show();
    const card = await screen.findByRole('article', { name: 'Workplace learning' });
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(showCurriculumAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not save course', text: 'Synthetic save refused' })));
    expect(screen.getByRole('dialog', { name: 'Edit course' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Course type' })).toHaveValue('apprentices');
  });

  it('reports load failure without enabling destructive replacement and can retry', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFreeProgrammeModules).mockRejectedValueOnce(new Error('Synthetic connection error'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic connection error');
    expect(screen.getByRole('button', { name: 'Add course' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import from a programme' })).toBeDisabled();
    expect(screen.queryByText('No courses created yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('article', { name: 'Workplace learning' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add course' })).toBeEnabled();
  });
});
