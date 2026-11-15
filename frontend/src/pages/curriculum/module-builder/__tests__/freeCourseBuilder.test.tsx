import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as api from '@/lib/curriculumApi';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import FreeCourseBuilder from '../FreeCourseBuilder';
import { freeCourseReturnTo, freeCourseSaveInput, newFreeCourseWeek } from '../freeCourseBuilderData';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({ showCurriculumConfirm: vi.fn(), showCurriculumAlert: vi.fn() }));
vi.mock('../RichTextEditor', () => ({ RichTextDraft: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => <label>{label}<textarea value={value} onChange={event => onChange(event.target.value)} /></label> }));
vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()),
  fetchFreeCourseAuthoringCourse: vi.fn(), updateFreeCourseAuthoring: vi.fn(),
  createFreeCourseQuiz: vi.fn(), unlinkFreeCourseQuiz: vi.fn(),
}));
vi.mock('../../week-builder/weekTemplateData', async original => ({
  ...(await original<typeof import('../../week-builder/weekTemplateData')>()),
  fetchComponentPointsDefaults: vi.fn(async () => ({ reading: 5 })),
}));

function course(): api.FreeCourseAuthoringDocument {
  return {
    schemaVersion: 'free-course-authoring.v1', scope: 'course', revision: 'fcv1:first',
    course: { courseId: 'FREE-1', courseName: 'Independent course', description: 'Keep course description', coverImageUrl: '/cover.png', displayOrder: 4, courseType: 'free', isForSale: false, price: null, currency: 'GBP' },
    weeks: [{ freeCourseWeekId: 'W-1', legacyCopiedFromWeekId: 'TEMPLATE-7', weekNumber: 1, title: 'First week', summary: 'Keep summary', learningOutcomes: { outcome: 'Keep original shape' }, status: 'active', holidayNoteEnabled: true, holidayNote: 'Keep holiday', displayOrder: 0,
      components: [{ id: 'C-1', freeCourseWeekId: 'W-1', type: 'reading', title: 'Read introduction', description: 'Keep description', expectedOtjh: 0, points: 5, reflectionRequired: false, workplaceEvidenceRequired: false, tutorValidationRequired: false, displayOrder: 0, settings: { readingContent: '<p>Original reading</p>', readingSource: 'Written in LMS', resourceUrl: '/original.pdf', customSetting: { keep: true } } }],
    }], integrity: { status: 'ok', issues: [], legacyQuizReferenceCount: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchFreeCourseAuthoringCourse).mockResolvedValue(course());
  vi.mocked(api.updateFreeCourseAuthoring).mockResolvedValue(course());
  // Every authoring call in these tests must use a mock; never contact an LMS.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
});
afterEach(() => vi.unstubAllGlobals());
function open() { return render(<MemoryRouter initialEntries={['/curriculum/module-builder?freeCourse=FREE-1']}><FreeCourseBuilder courseId="FREE-1" /></MemoryRouter>); }

describe('Free Course in Module Builder', () => {
  it('opens a direct Module Builder link using the Free Course ID without loading the module catalogue', async () => {
    const { default: ModuleBuilder } = await import('../page');
    render(<MemoryRouter initialEntries={['/curriculum/module-builder?freeCourse=FREE-1']}><ModuleBuilder /></MemoryRouter>);
    expect(await screen.findByLabelText('Course name')).toHaveValue('Independent course');
    expect(api.fetchFreeCourseAuthoringCourse).toHaveBeenCalledWith('FREE-1', expect.anything());
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('opens the shared component editor and saves its content to the same canonical course', async () => {
    open();
    await userEvent.click(await screen.findByText('Read introduction'));
    const editor = await screen.findByRole('region', { name: 'Component editor' });
    expect(within(editor).getByLabelText('Component content')).toHaveValue('<p>Original reading</p>');
    expect(within(editor).queryByText('Expected OTJH hours')).not.toBeInTheDocument();
    expect(within(editor).queryByText('Coach validation')).not.toBeInTheDocument();
    expect(within(editor).queryByRole('combobox', { name: 'Assigned groups programme' })).not.toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText('Component content'), { target: { value: '<p>Updated reading</p>' } });
    fireEvent.change(within(editor).getByLabelText('Description'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateFreeCourseAuthoring).toHaveBeenCalledWith('FREE-1', expect.objectContaining({
      expectedRevision: 'fcv1:first', deletedWeekIds: [], deletedComponentIds: [],
      course: expect.objectContaining({ courseName: 'Independent course', coverImageUrl: '/cover.png', courseType: 'free' }),
      weeks: [expect.objectContaining({ freeCourseWeekId: 'W-1', legacyCopiedFromWeekId: 'TEMPLATE-7', summary: 'Keep summary', learningOutcomes: { outcome: 'Keep original shape' }, holidayNote: 'Keep holiday',
        components: [expect.objectContaining({ id: 'C-1', description: '', settings: expect.objectContaining({ readingContent: '<p>Updated reading</p>', resourceUrl: '/original.pdf', customSetting: { keep: true } }) })],
      })],
    })));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps the draft on failed saves and guards Back and closing the browser', async () => {
    vi.mocked(api.updateFreeCourseAuthoring).mockRejectedValueOnce(new Error('Save unavailable'));
    open();
    fireEvent.change(await screen.findByLabelText('Course name'), { target: { value: 'Changed name' } });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.getByLabelText('Course name')).toHaveValue('Changed name');
    await userEvent.click(screen.getByRole('button', { name: 'Back to free courses' }));
    expect(showCurriculumConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard unsaved changes?' }));
  });

  it('saves a new video without requesting a catalogue reorder or catalogue revision', async () => {
    const document = course();
    vi.mocked(api.updateFreeCourseAuthoring).mockImplementation(async (_id, input) => {
      const patch = input as ReturnType<typeof freeCourseSaveInput>;
      // The API requires a catalogue revision whenever a course reorder is requested.
      if ('displayOrder' in patch.course && !input.expectedCatalogueRevision) {
        throw new api.CurriculumApiError('expectedCatalogueRevision is required.', 428, '/authoring/');
      }
      const saved = structuredClone(document);
      saved.revision = 'fcv1:saved';
      saved.weeks[0].components.push({ ...patch.weeks[0].components[1], id: 'C-2' });
      return saved;
    });
    open();
    await screen.findByLabelText('Course name');
    await userEvent.click(await screen.findByRole('button', { name: 'Add component' }, { timeout: 10000 }));
    await userEvent.click(screen.getByRole('button', { name: /^Video/i }));
    const editor = await screen.findByRole('region', { name: 'Component editor' });
    fireEvent.change(within(editor).getByLabelText('Video URL'), { target: { value: 'https://www.youtube.com/watch?v=example' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Free course saved')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const input = vi.mocked(api.updateFreeCourseAuthoring).mock.calls[0][1] as ReturnType<typeof freeCourseSaveInput>;
    expect(input.expectedRevision).toBe(document.revision);
    expect(input).not.toHaveProperty('expectedCatalogueRevision');
    expect(input.course).not.toHaveProperty('displayOrder');
    expect(input.course).not.toHaveProperty('courseId');
    expect(input.weeks[0].components[1]).toMatchObject({
      type: 'video', clientId: expect.any(String), displayOrder: 1,
      settings: expect.objectContaining({ videoUrl: 'https://www.youtube.com/watch?v=example' }),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('reports a missing course and retries reading without creating a module', async () => {
    vi.mocked(api.fetchFreeCourseAuthoringCourse).mockRejectedValueOnce(new Error('Free Course not found.'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Free Course not found.');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Course name')).toHaveValue('Independent course');
    expect(api.updateFreeCourseAuthoring).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('adds self-study activities through the shared rail and saves new identities as client IDs', async () => {
    open();
    await screen.findByLabelText('Course name');
    await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.queryByRole('button', { name: /^Live Teams Session|^Live session/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reading material/i }));
    await screen.findByRole('region', { name: 'Component editor' });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateFreeCourseAuthoring).toHaveBeenCalled());
    const input = vi.mocked(api.updateFreeCourseAuthoring).mock.calls[0][1] as ReturnType<typeof freeCourseSaveInput>;
    expect(input.weeks[0].components[0].id).toBe('C-1');
    expect(input.weeks[0].components[1]).toMatchObject({ id: undefined, clientId: expect.any(String), expectedOtjh: 0, type: 'reading' });
  });

  it('uses the canonical quiz editor and never reads the programme quiz catalogue', async () => {
    const document = course();
    document.weeks[0].components[0] = { ...document.weeks[0].components[0], type: 'quiz', title: 'Knowledge check', settings: { linkedQuizId: 7, manualUnlock: true } };
    vi.mocked(api.fetchFreeCourseAuthoringCourse).mockResolvedValue(document);
    open();
    await userEvent.click(await screen.findByText('Knowledge check'));
    expect(await screen.findByRole('button', { name: 'Edit quiz' })).toBeInTheDocument();
    expect(screen.getByLabelText('Manual unlock')).toBeChecked();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(api.createFreeCourseQuiz).not.toHaveBeenCalled();
  });
});

it('saves explicit deletions, preserves existing ownership and keeps newly added weeks independent', () => {
  const original = course();
  const draft = structuredClone(original);
  draft.weeks = [newFreeCourseWeek(0)];
  const input = freeCourseSaveInput(original, draft);
  expect(input.deletedWeekIds).toEqual(['W-1']);
  expect(input.deletedComponentIds).toEqual(['C-1']);
  expect(input.weeks[0]).toMatchObject({ freeCourseWeekId: undefined, clientId: expect.any(String), legacyCopiedFromWeekId: null });
  expect(original).toEqual(course());
});

it('restricts return links to catalogue screens', () => {
  expect(freeCourseReturnTo('https://elsewhere.example')).toBe('/curriculum/module-builder?catalogue=free');
  expect(freeCourseReturnTo('/curriculum/module-builder?freeCourse=OTHER&q=Reading&catalogue=free')).toBe('/curriculum/module-builder?q=Reading&catalogue=free');
});
