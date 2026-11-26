import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WeekTemplateImportModal } from '../WeekTemplateImportModal';
import { appendWeekTemplateCopies } from '../weekTemplateImport';
import { createEmptyComponent, createLocalModuleDraft, recalculateModule, type KsbMapping } from '../moduleAuthoringData';
import { fetchWeekTemplateDetail, fetchWeekTemplates, type WeekTemplate } from '../../week-builder/weekTemplateData';

vi.mock('../../week-builder/weekTemplateData', () => ({
  fetchWeekTemplates: vi.fn(), fetchWeekTemplateDetail: vi.fn(),
  filterWeekTemplatesForScope: (templates: WeekTemplate[]) => templates,
}));

function template(): WeekTemplate {
  const mapping: KsbMapping = { id: 'MAP-SOURCE', ksbId: 'K1', code: 'K1', description: 'Knowledge', type: 'main', weight: 100, weightClass: 'hard' };
  return {
    id: 'TEMPLATE-1', title: 'PCP Week', summary: 'Weekly topic', learningOutcomes: ['First outcome'],
    courseType: 'paid', programmeId: 'PROG-1', programmeName: 'Programme', moduleCatalogueId: '',
    groupId: '', groupName: '', status: 'draft', author: 'Author', totalOtjh: 2, points: 10,
    componentCount: 1, ksbMappings: [mapping], components: [{
      ...createEmptyComponent('SOURCE-WEEK', 'reading', 1), title: 'Read the chapter', expectedOtjh: 2, points: 10,
      ksbMappings: [mapping], settings: { readingContent: 'Original content', selectedGroupKeys: ['source-group'] },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchWeekTemplates).mockResolvedValue([template()]);
  vi.mocked(fetchWeekTemplateDetail).mockResolvedValue(template());
});

describe('Adding multiple weeks from a template', () => {
  it('filters templates by week number, title, or component count', async () => {
    vi.mocked(fetchWeekTemplates).mockResolvedValue([
      { ...template(), id: 'TEMPLATE-12', title: 'MSP Week 12: Designing outcomes', componentCount: 11 },
      { ...template(), id: 'TEMPLATE-8', title: 'MSP Week 08: Knowledge', componentCount: 8 },
    ]);
    render(<WeekTemplateImportModal scope={{ programmeId: '', programmeName: '' }} onClose={vi.fn()} onImport={vi.fn()}/>);

    const search = await screen.findByRole('searchbox', { name: 'Search week templates' });
    fireEvent.change(search, { target: { value: 'week 12' } });
    expect(screen.getByRole('button', { name: /MSP Week 12/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MSP Week 08/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '8' } });
    expect(screen.getByRole('button', { name: /MSP Week 08/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MSP Week 12/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'not found' } });
    expect(screen.getByText('No week templates match that search.')).toBeInTheDocument();
  });

  it('uses the quantity selected with the stepper when importing', async () => {
    const onImport = vi.fn();
    render(<WeekTemplateImportModal scope={{ programmeId: 'PROG-1', programmeName: 'Programme' }} onClose={vi.fn()} onImport={onImport}/>);
    expect(screen.getByRole('spinbutton', { name: 'Number of weeks' })).toHaveValue(1);
    expect(screen.getByRole('button', { name: 'Decrease number of weeks' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Increase number of weeks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase number of weeks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease number of weeks' }));
    fireEvent.click(await screen.findByRole('button', { name: /PCP Week/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ id: 'TEMPLATE-1' }), 2));
    expect(fetchWeekTemplateDetail).toHaveBeenCalledTimes(1);
  });

  it('accepts a typed count and adds independent copies while preserving existing weeks', async () => {
    const source = template();
    vi.mocked(fetchWeekTemplateDetail).mockResolvedValue(source);
    const original = createLocalModuleDraft({ title: 'Module', programme: 'Programme', description: '', weeks: 2, status: 'draft' });
    let result = original;
    const onImport = vi.fn((picked: WeekTemplate, count: number) => { result = recalculateModule(appendWeekTemplateCopies(original, picked, count)); });
    render(<WeekTemplateImportModal scope={{ programmeId: '', programmeName: '' }} onClose={vi.fn()} onImport={onImport}/>);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of weeks' }), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: /PCP Week/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    expect(result.weeks).toBe(6);
    expect(result.weekStructure.slice(0, 2).map(week => week.id)).toEqual(original.weekStructure.map(week => week.id));
    const added = result.weekStructure.slice(2);
    expect(added.map(week => week.weekNumber)).toEqual([3, 4, 5, 6]);
    expect(new Set(added.map(week => week.id)).size).toBe(4);
    expect(new Set(added.map(week => week.components[0].id)).size).toBe(4);
    expect(new Set(added.flatMap(week => [...week.ksbMappings, ...week.components[0].ksbMappings]).map(mapping => mapping.id)).size).toBe(8);
    expect(added.every(week => week.components[0].weekId === week.id)).toBe(true);
    expect(result.totalOtjh).toBe(8);
    expect(added[0].components[0].settings.selectedGroupKeys).toBeUndefined();
    added[0].learningOutcomes.push('Changed in one copy');
    added[0].components[0].settings.readingContent = 'Changed';
    expect(added[1].learningOutcomes).toEqual(['First outcome']);
    expect(added[1].components[0].settings.readingContent).toBe('Original content');
    expect(source.components[0].settings.readingContent).toBe('Original content');
  });

  it.each(['', '0', '-1', '2.5'])('does not import an invalid quantity (%s)', async value => {
    const onImport = vi.fn();
    render(<WeekTemplateImportModal scope={{ programmeId: '', programmeName: '' }} onClose={vi.fn()} onImport={onImport}/>);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of weeks' }), { target: { value } });
    const pick = await screen.findByRole('button', { name: /PCP Week/ });
    expect(pick).toBeDisabled();
    fireEvent.click(pick);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('keeps the quantity after a fetch failure and lets the user retry', async () => {
    vi.mocked(fetchWeekTemplateDetail).mockRejectedValueOnce(new Error('Template unavailable.')).mockResolvedValueOnce(template());
    const onImport = vi.fn();
    render(<WeekTemplateImportModal scope={{ programmeId: '', programmeName: '' }} onClose={vi.fn()} onImport={onImport}/>);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of weeks' }), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: /PCP Week/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Template unavailable.');
    expect(screen.getByRole('spinbutton')).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: /PCP Week/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.anything(), 3));
  });

  it('does not append a batch if the modal unmounts while its template is loading', async () => {
    let resolve!: (value: WeekTemplate) => void;
    vi.mocked(fetchWeekTemplateDetail).mockReturnValue(new Promise(done => { resolve = done; }));
    const onImport = vi.fn();
    const view = render(<WeekTemplateImportModal scope={{ programmeId: '', programmeName: '' }} onClose={vi.fn()} onImport={onImport}/>);
    fireEvent.click(await screen.findByRole('button', { name: /PCP Week/ }));
    view.unmount();
    resolve(template());
    await Promise.resolve();
    expect(onImport).not.toHaveBeenCalled();
  });
});
