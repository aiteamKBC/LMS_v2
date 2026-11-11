import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import FreeCoursesPage from './page';
import * as api from '@/lib/curriculumApi';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { fetchWeekTemplates, fetchWeekTemplateDetail, type WeekTemplate } from '@/pages/curriculum/week-builder/weekTemplateData';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/feature/WorkspaceHeroBanner', () => ({ WorkspaceHeroBanner: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({ showCurriculumAlert: vi.fn().mockResolvedValue(undefined), showCurriculumConfirm: vi.fn() }));
vi.mock('@/pages/curriculum/week-builder/weekTemplateData', () => ({ fetchWeekTemplates: vi.fn().mockResolvedValue([]), fetchWeekTemplateDetail: vi.fn() }));
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

async function edit() {
  render(<MemoryRouter><FreeCoursesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
}

describe('Free Course library loading', () => {
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
    expect(showCurriculumAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check the course price' }));
  });

  it('keeps the draft and surfaces revision conflicts', async () => {
    await edit();
    vi.mocked(api.updateFreeCourseAuthoring).mockRejectedValueOnce(new api.CurriculumApiError('Changed', 409, '/authoring/'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(showCurriculumAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'This Free Course changed' })));
    expect(screen.getByPlaceholderText('Name this free course')).toHaveValue('Paid course');
  });
});
