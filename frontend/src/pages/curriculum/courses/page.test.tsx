import type { ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurriculumProgrammes, fetchFreeProgrammeModules, saveFreeProgrammeModules, type FreeProgrammeModule } from '@/lib/curriculumApi';
import { fetchWeekTemplateDetail, fetchWeekTemplates, type WeekTemplate } from '../week-builder/weekTemplateData';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
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
  vi.mocked(saveFreeProgrammeModules).mockReset();
  vi.mocked(fetchFreeProgrammeModules).mockResolvedValue(modules);
  vi.mocked(fetchWeekTemplates).mockResolvedValue([]);
  vi.mocked(fetchWeekTemplateDetail).mockReset();
  vi.mocked(fetchCurriculumProgrammes).mockResolvedValue([]);
});
afterEach(cleanup);

describe('Curriculum Courses', () => {
  it('creates a course from searched weeks with optional details retained when collapsed', async () => {
    const user = userEvent.setup();
    const templates = ['Alpha', 'Beta'].map((title, index): WeekTemplate => ({
      id: `T${index}`, title: `${title} week`, summary: `${title} learning`, learningOutcomes: [], courseType: 'free',
      programmeId: '', programmeName: '', moduleCatalogueId: '', groupId: '', groupName: '', status: 'draft', ksbMappings: [],
      totalOtjh: 2, points: 10, componentCount: 1, author: '',
      components: [{ ...modules[0].components[0], id: `PART-${index}`, weekId: `T${index}`, type: 'reading', reflectionQuestion: '', coachValidationRequired: true, ksbMappings: [], settings: { readingContent: '<p>Stored guidance</p>', version: '3.2' } }],
    }));
    vi.mocked(fetchWeekTemplates).mockResolvedValue(templates);
    vi.mocked(fetchWeekTemplateDetail).mockImplementation(async id => templates.find(template => template.id === id)!);
    vi.mocked(saveFreeProgrammeModules).mockResolvedValue({ saved: true, programmeId: 'FREE-COURSES', modules });
    show('/curriculum/courses?type=apprentices');
    await screen.findByRole('article', { name: 'Workplace learning' });
    await user.click(screen.getByRole('button', { name: 'Add course' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add course' }));
    expect(dialog.getByRole('textbox', { name: 'Course name' })).toHaveFocus();
    expect(dialog.getByLabelText('Description')).not.toBeVisible();
    await user.paste('New workplace course');
    expect(dialog.getByRole('button', { name: 'Create course' })).toBeDisabled();
    for (const name of ['Alpha', 'Beta']) {
      await user.clear(dialog.getByRole('searchbox', { name: 'Search week templates' }));
      await user.type(dialog.getByRole('searchbox', { name: 'Search week templates' }), name);
      await user.click(within(dialog.getByRole('group', { name: `${name} week` })).getByRole('button', { name: 'Add week' }));
      await waitFor(() => expect(within(dialog.getByRole('group', { name: `${name} week` })).getByRole('button', { name: 'Remove week' })).toBeEnabled());
    }
    expect(dialog.getByText('2 weeks', { exact: true })).toBeInTheDocument();
    await user.type(dialog.getByRole('searchbox', { name: 'Search week templates' }), 'not found');
    expect(dialog.getByText('No weeks match your search.')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Create course' })).toBeEnabled();
    await user.click(dialog.getByText('Description & cover image'));
    await user.click(dialog.getByRole('textbox', { name: 'Description' }));
    await user.paste('Course description');
    await user.click(dialog.getByRole('textbox', { name: 'Cover image URL' }));
    await user.paste('https://example.test/cover.png');
    await user.click(dialog.getByText('Description & cover image'));
    expect(dialog.getByLabelText('Description')).toHaveValue('Course description');
    await user.click(dialog.getByRole('button', { name: 'Create course' }));
    await waitFor(() => expect(saveFreeProgrammeModules).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveFreeProgrammeModules).mock.calls[0][1];
    const created = payload.modules.filter(module => module.courseName === 'New workplace course');
    expect(created).toHaveLength(2);
    expect(created.map(module => module.weekId)).toEqual(['T0', 'T1']);
    expect(created.every(module => module.courseType === 'apprentices' && module.description === 'Course description' && module.coverImageUrl === 'https://example.test/cover.png')).toBe(true);
    expect(created[0].components?.[0]).toMatchObject({ expectedOtjh: 2, points: 10, reflectionRequired: true, settings: expect.objectContaining({ readingContent: '<p>Stored guidance</p>', version: '3.2' }) });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps a pending save open and restores keyboard focus after completing it', async () => {
    const user = userEvent.setup();
    let finish: (response: Awaited<ReturnType<typeof saveFreeProgrammeModules>>) => void = () => {};
    vi.mocked(saveFreeProgrammeModules).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    show();
    const card = await screen.findByRole('article', { name: 'Workplace learning' });
    const editButton = within(card).getByRole('button', { name: 'Edit' });
    await user.click(editButton);
    const dialog = within(screen.getByRole('dialog', { name: 'Edit course' }));
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    expect(dialog.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Close wizard' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Edit course' })).toBeInTheDocument();
    await act(async () => finish({ saved: true, programmeId: 'FREE-COURSES', modules }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(editButton).toHaveFocus();
    expect(saveFreeProgrammeModules).toHaveBeenCalledTimes(1);
  });

  it('switches between cards and table without losing combined filters or fetching again', async () => {
    const user = userEvent.setup();
    show('/curriculum/courses?type=free');
    await screen.findByRole('article', { name: 'Open learning' });
    await user.type(screen.getByRole('searchbox'), 'practice');
    const views = within(screen.getByRole('group', { name: 'Course view' }));
    expect(views.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(views.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Courses' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByRole('rowheader')).toHaveTextContent('Open learning');
    expect(within(table).getByRole('cell', { name: 'Free' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '4h' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('?type=free&view=table');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apprentices 1' }));
    expect(screen.getByText('No courses match your filters')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    expect(within(screen.getByRole('table')).getByRole('rowheader')).toHaveTextContent('Workplace learning');
    await user.click(views.getByRole('button', { name: 'Cards' }));
    expect(screen.getByRole('article', { name: 'Workplace learning' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('?type=apprentices');
    expect(fetchFreeProgrammeModules).toHaveBeenCalledTimes(1);
    expect(saveFreeProgrammeModules).not.toHaveBeenCalled();
  });

  it('opens a bookmarked table with the same edit, delete confirmation and convert workflows', async () => {
    const user = userEvent.setup();
    show('/curriculum/courses?view=table&type=apprentices');
    const table = within(await screen.findByRole('table', { name: 'Courses' }));
    expect(table.getAllByRole('row')).toHaveLength(2);
    expect(table.getByRole('cell', { name: 'Apprentices' })).toBeInTheDocument();
    await user.click(table.getByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit course' }));
    expect(dialog.getByRole('textbox', { name: 'Course name' })).toHaveValue('Workplace learning');
    expect(dialog.getByRole('combobox', { name: 'Course type' })).toHaveValue('apprentices');
    await user.click(dialog.getByRole('button', { name: 'Close wizard' }));
    await user.click(table.getByRole('button', { name: 'Delete Workplace learning' }));
    expect(showCurriculumConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete course?', text: '"Workplace learning" and its 1 week will be removed.' }));
    expect(saveFreeProgrammeModules).not.toHaveBeenCalled();
    await user.click(table.getByRole('button', { name: 'Convert to programme' }));
    expect(screen.getByRole('heading', { name: 'Convert to programme' })).toBeInTheDocument();
    expect(screen.getByText('Turn “Workplace learning” into a real, enrolable programme module.')).toBeInTheDocument();
    await waitFor(() => expect(fetchCurriculumProgrammes).toHaveBeenCalled());
    expect(saveFreeProgrammeModules).not.toHaveBeenCalled();
  });

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
