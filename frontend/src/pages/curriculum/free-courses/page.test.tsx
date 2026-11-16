import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import FreeCoursesPage, { FreeCoursesWorkspace } from './page';
import FreeCourseBuilder from '../module-builder/FreeCourseBuilder';
import * as api from '@/lib/curriculumApi';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { fetchWeekTemplates, fetchWeekTemplateDetail, type WeekTemplate } from '@/pages/curriculum/week-builder/weekTemplateData';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/feature/WorkspaceHeroBanner', () => ({ WorkspaceHeroBanner: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({ showCurriculumAlert: vi.fn().mockResolvedValue(undefined), showCurriculumConfirm: vi.fn() }));
vi.mock('@/pages/curriculum/week-builder/weekTemplateData', () => ({ fetchWeekTemplates: vi.fn().mockResolvedValue([]), fetchWeekTemplateDetail: vi.fn(), fetchComponentPointsDefaults: vi.fn().mockResolvedValue({}), uploadWeekComponentResource: vi.fn() }));
vi.mock('../shared/components/weekAuthoringLazy', () => ({ WeekComponentRail: () => null, ComponentEditor: () => null }));
vi.mock('@/lib/curriculumApi', () => ({
  CurriculumApiError: class extends Error { status = 409; },
  fetchFreeCourseAuthoringCatalogue: vi.fn(), fetchFreeCourseAuthoringCatalogueWithDocuments: vi.fn(), fetchFreeCourseAuthoringCourse: vi.fn(),
  createFreeCourseAuthoring: vi.fn(), updateFreeCourseAuthoring: vi.fn(),
  cloneModuleToFreeCourseAuthoring: vi.fn(), createFreeCourseQuiz: vi.fn(), deleteFreeCourseAuthoring: vi.fn(),
  fetchCurriculumProgrammeDetail: vi.fn(), fetchCurriculumProgrammes: vi.fn(), injectFreeCourseIntoGroup: vi.fn(), unlinkFreeCourseQuiz: vi.fn(),
}));

const document = {
  schemaVersion: 1, scope: 'course', revision: 'revision-1',
  course: { courseId: 'FREE-1', courseName: 'Paid course', description: 'Description', coverImageUrl: '', displayOrder: 0, courseType: 'free', isForSale: true, price: '49.99', currency: 'GBP' },
  weeks: [{ freeCourseWeekId: 'W-1', legacyCopiedFromWeekId: null, weekNumber: 1, title: 'First week', summary: 'Keep summary', learningOutcomes: ['Keep outcome'], status: 'active', holidayNoteEnabled: true, holidayNote: 'Keep note', displayOrder: 0,
    components: [{ id: 'C-1', type: 'reading', title: 'Read', description: '', expectedOtjh: 0, points: 0, displayOrder: 0, settings: { readingContent: 'Content' } }],
  }], integrity: {}, policies: {},
} as unknown as api.FreeCourseAuthoringDocument;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('AppIcon', () => null);
  vi.mocked(api.fetchFreeCourseAuthoringCatalogue).mockResolvedValue({ revision: 'catalogue-1', courses: [document.course] } as api.FreeCourseAuthoringCatalogue);
  vi.mocked(api.fetchFreeCourseAuthoringCourse).mockResolvedValue(document);
  vi.mocked(api.fetchFreeCourseAuthoringCatalogueWithDocuments).mockResolvedValue({ revision: 'catalogue-1', courses: [document.course], documents: [document] } as unknown as Awaited<ReturnType<typeof api.fetchFreeCourseAuthoringCatalogueWithDocuments>>);
  vi.mocked(api.updateFreeCourseAuthoring).mockResolvedValue(document);
});

function Address() { return <output data-testid="address">{useLocation().pathname}{useLocation().search}</output>; }
function renderCatalogue(embedded = false) {
  const initial = embedded ? '/curriculum/module-builder?catalogue=free&q=Paid' : '/curriculum/free-courses';
  function Page() {
    const location = useLocation();
    return new URLSearchParams(location.search).has('freeCourse') ? <FreeCourseBuilder courseId="FREE-1" /> : <FreeCoursesWorkspace embedded />;
  }
  return render(<MemoryRouter initialEntries={[initial]}><Routes>
    <Route path="/curriculum/free-courses" element={<FreeCoursesPage />} />
    <Route path="/curriculum/module-builder" element={<Page />} />
  </Routes><Address /></MemoryRouter>);
}
async function edit() {
  renderCatalogue();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Save changes' });
}

describe('Programme conversion dates', () => {
  const programmes = [{ id: 'P1', sourceId: 'P1', name: 'Programme one' }];
  const detail = {
    cohorts: [
      { id: 'C1', name: 'Cohort one', startDate: '2026-09-01', endDate: '2027-08-31', practicalEndDate: '2027-05-31',
        groups: [{ id: 'G1', name: 'Group one' }] },
      { id: 'C2', name: 'Cohort two', startDate: '2027-01-01', endDate: '2027-12-31', groups: [{ id: 'G2', name: 'Group two' }] },
    ],
  };
  beforeEach(() => {
    vi.mocked(api.fetchCurriculumProgrammes).mockResolvedValue(programmes as api.CurriculumProgramme[]);
    vi.mocked(api.fetchCurriculumProgrammeDetail).mockResolvedValue(detail as api.CurriculumProgrammeDetail);
    vi.mocked(api.injectFreeCourseIntoGroup).mockReset().mockResolvedValue({ mode: 'clone', programmeId: 'P1',
      programmeName: 'Programme one', cohortId: 'C1', groupId: 'G1', moduleCatalogueId: 'MOD-NEW' });
    vi.mocked(showCurriculumConfirm).mockReset().mockImplementation(async ({ onConfirm }) => { await onConfirm(); return true; });
  });
  async function open(embedded = false) {
    renderCatalogue(embedded);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to programme' }));
    await screen.findByRole('option', { name: 'Programme one' });
    fireEvent.change(screen.getByLabelText('Programme'), { target: { value: 'P1' } });
    await screen.findByRole('option', { name: 'Cohort one' });
    fireEvent.change(screen.getByLabelText('Cohort'), { target: { value: 'C1' } });
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'G1' } });
  }
  function date(label: string, value: string) {
    const input = screen.getByRole('combobox', { name: label });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }

  it.each([false, true])('requires chosen dates and sends them from both catalogue entry points (embedded=%s)', async embedded => {
    await open(embedded);
    expect(screen.getByRole('combobox', { name: 'Start date' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'End date' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add module' })).toBeDisabled();
    date('Start date', '01/10/2026');
    expect(screen.getByRole('button', { name: 'Add module' })).toBeDisabled();
    date('End date', '15/12/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Add module' }));
    await waitFor(() => expect(api.injectFreeCourseIntoGroup).toHaveBeenCalledExactlyOnceWith('FREE-COURSES', {
      courseId: 'FREE-1', mode: 'clone', groupId: 'G1', startDate: '2026-10-01', endDate: '2026-12-15',
    }));
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/curriculum/module-builder?module=MOD-NEW&programme=P1'));
    expect(api.updateFreeCourseAuthoring).not.toHaveBeenCalled();
    expect(api.deleteFreeCourseAuthoring).not.toHaveBeenCalled();
  });

  it('revalidates the finish when the selected start moves past it', async () => {
    await open();
    date('Start date', '01/10/2026'); date('End date', '15/10/2026');
    date('Start date', '01/11/2026');
    expect(screen.getByText('End date must be on or after the start date.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add module' })).toBeDisabled();
    expect(api.injectFreeCourseIntoGroup).not.toHaveBeenCalled();
  });

  it('retains dates when changing cohorts and refuses dates outside the new delivery window', async () => {
    await open();
    date('Start date', '01/10/2026'); date('End date', '15/12/2026');
    fireEvent.change(screen.getByLabelText('Cohort'), { target: { value: 'C2' } });
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'G2' } });
    expect(screen.getByRole('combobox', { name: 'Start date' })).toHaveValue('01/10/2026');
    expect(screen.getByText(/cannot start more than one month before/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add module' })).toBeDisabled();
    date('Start date', '01/12/2026');
    expect(screen.getByRole('button', { name: 'Add module' })).toBeEnabled();
  });

  it('uses the practical end as the date-picker limit', async () => {
    await open(); date('Start date', '01/10/2026'); date('End date', '01/06/2027');
    expect(screen.getByText('Cannot be after 31/05/2027')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add module' })).toBeDisabled();
    date('End date', '31/05/2027');
    expect(screen.getByRole('button', { name: 'Add module' })).toBeEnabled();
  });

  it('preserves chosen dates after a failed save and resets them when reopening', async () => {
    vi.mocked(api.injectFreeCourseIntoGroup).mockRejectedValueOnce(new Error('Destination changed'));
    // The shared confirmation dialog displays errors and returns false after dismissal.
    vi.mocked(showCurriculumConfirm).mockImplementationOnce(async ({ onConfirm }) => {
      try { await onConfirm(); } catch { return false; }
      return true;
    });
    await open(); date('Start date', '01/10/2026'); date('End date', '15/12/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Add module' }));
    await waitFor(() => expect(api.injectFreeCourseIntoGroup).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add module' })).toBeEnabled());
    expect(screen.getByRole('combobox', { name: 'Start date' })).toHaveValue('01/10/2026');
    expect(screen.getByRole('combobox', { name: 'End date' })).toHaveValue('15/12/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Convert to programme' }));
    expect(screen.getByRole('combobox', { name: 'Start date' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'End date' })).toHaveValue('');
  });
});

describe('Free Course library loading', () => {
  it.each([false, true])('opens Module Builder from the catalogue (embedded=%s) and returns to its search', async embedded => {
    renderCatalogue(embedded);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByRole('button', { name: 'Save changes' });
    const address = screen.getByTestId('address').textContent || '';
    expect(address).toContain('/curriculum/module-builder?freeCourse=FREE-1');
    expect(api.fetchFreeCourseAuthoringCourse).toHaveBeenCalledWith('FREE-1', expect.anything());
    expect(api.updateFreeCourseAuthoring).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to free courses' }));
    expect(screen.getByTestId('address')).toHaveTextContent(embedded ? '/curriculum/module-builder?catalogue=free&q=Paid' : '/curriculum/free-courses');
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
  it('loads the catalogue and every course in one request', async () => {
    render(<MemoryRouter><FreeCoursesPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(api.fetchFreeCourseAuthoringCatalogueWithDocuments).toHaveBeenCalledTimes(1);
    expect(api.fetchFreeCourseAuthoringCourse).not.toHaveBeenCalled();
  });

  it('falls back to per-course reads when the backend returns no documents', async () => {
    vi.mocked(api.fetchFreeCourseAuthoringCatalogueWithDocuments).mockResolvedValueOnce({ revision: 'catalogue-1', courses: [document.course] } as unknown as Awaited<ReturnType<typeof api.fetchFreeCourseAuthoringCatalogueWithDocuments>>);
    render(<MemoryRouter><FreeCoursesPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(api.fetchFreeCourseAuthoringCourse).toHaveBeenCalledWith('FREE-1', expect.anything());
  });
});

describe('Revision-aware Free Course pricing', () => {
  it('creates using catalogue revision, new client identities and sale metadata', async () => {
    const template = { id: 'TEMPLATE-1', title: 'Template', name: 'Template', components: document.weeks[0].components, componentCount: 1 } as unknown as WeekTemplate;
    vi.mocked(fetchWeekTemplates).mockResolvedValueOnce([template]);
    vi.mocked(fetchWeekTemplateDetail).mockResolvedValueOnce(template);
    vi.mocked(api.createFreeCourseAuthoring).mockResolvedValueOnce(document);
    render(<MemoryRouter><FreeCoursesPage /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(screen.getByRole('button', { name: 'Add free course' }));
    fireEvent.change(screen.getByPlaceholderText('Name this free course'), { target: { value: 'New course' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add week' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create free course' })).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Available for sale'));
    fireEvent.change(screen.getByPlaceholderText('e.g. 49.99'), { target: { value: '19.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create free course' }));
    await waitFor(() => expect(api.createFreeCourseAuthoring).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 'catalogue-1', clientId: expect.any(String),
      course: expect.objectContaining({ courseName: 'New course', isForSale: true, price: '19.99', currency: 'GBP' }),
      weeks: [expect.objectContaining({ clientId: expect.any(String), components: [expect.objectContaining({ clientId: expect.any(String) })] })],
    }), expect.any(String)));
    expect(api.updateFreeCourseAuthoring).not.toHaveBeenCalled();
  });
  it('loads stored pricing and saves it with stable identities and week metadata', async () => {
    await edit();
    expect(screen.getByLabelText('Available for sale')).toBeChecked();
    expect(screen.getByPlaceholderText('e.g. 49.99')).toHaveValue('49.99');
    fireEvent.change(screen.getByPlaceholderText('e.g. 49.99'), { target: { value: '59.95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateFreeCourseAuthoring).toHaveBeenCalledWith('FREE-1', expect.objectContaining({
      expectedRevision: 'revision-1', deletedWeekIds: [], deletedComponentIds: [],
      course: expect.objectContaining({ isForSale: true, price: '59.95', currency: 'GBP' }),
      weeks: [expect.objectContaining({ freeCourseWeekId: 'W-1', summary: 'Keep summary', learningOutcomes: ['Keep outcome'], holidayNote: 'Keep note', components: [expect.objectContaining({ id: 'C-1' })] })],
    })));
    expect(api.createFreeCourseAuthoring).not.toHaveBeenCalled();
  });

  it('clears price explicitly when sale is disabled', async () => {
    await edit();
    fireEvent.click(screen.getByLabelText('Available for sale'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateFreeCourseAuthoring).toHaveBeenCalledWith('FREE-1', expect.objectContaining({ course: expect.objectContaining({ isForSale: false, price: null, currency: 'GBP' }) })));
  });

  it.each(['0', '-1', '1.234', '100000000', 'abc'])('blocks invalid sale price %s', async price => {
    await edit();
    fireEvent.change(screen.getByPlaceholderText('e.g. 49.99'), { target: { value: price } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.updateFreeCourseAuthoring).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a GBP price');
  });

  it('keeps the draft and surfaces revision conflicts', async () => {
    await edit();
    vi.mocked(api.updateFreeCourseAuthoring).mockRejectedValueOnce(new api.CurriculumApiError('Changed', 409, '/authoring/'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This Free Course changed');
    expect(screen.getByPlaceholderText('Name this free course')).toHaveValue('Paid course');
  });
});
