import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentEditor } from '@/pages/curriculum/shared/components/weekAuthoring';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { ModuleComponentDrawer } from '../ModuleComponentDrawer';
import { createEmptyComponent, createEmptyWeek, createLegacyLocalModule, type ModuleCatalogueItem, type ModuleComponent, type ModuleComponentType } from '../moduleAuthoringData';

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({ showCurriculumConfirm: vi.fn(async () => undefined), showCurriculumAlert: vi.fn() }));
const save = vi.fn();
const closed = vi.fn();
const types: ModuleComponentType[] = ['live-session', 'video', 'reading', 'podcast', 'powerpoint', 'quiz', 'assignment'];

function fixture(type: ModuleComponentType, scoped = true) {
  const module = createLegacyLocalModule({ programme: 'QA Programme', title: 'QA Module', description: '', weeks: 1, status: 'draft' });
  module.catalogueId = 'MODULE-QA'; module.id = 'MODULE-QA'; module.programmeId = 'PROGRAMME-QA';
  if (scoped) { module.cohortId = 'COHORT-QA'; module.groupId = 'GROUP-QA'; }
  const week = createEmptyWeek(module.id, 1); week.id = 'WEEK-QA'; week.title = 'Week title with a separate pending edit';
  const component = createEmptyComponent(week.id, type, 1);
  component.id = 'COMPONENT-QA'; component.sourceId = 'SOURCE-QA'; component.title = 'Same title'; component.description = 'Saved description';
  component.settings = { ...component.settings, version: '2.4', selectedGroupKeys: ['GROUP-QA'], selectedGroupNames: ['QA group'] };
  week.components = [component, { ...component, id: 'SIBLING-QA', sourceId: 'OTHER-SOURCE', settings: { ...component.settings, version: '3.7' } }];
  module.weekStructure = [week, { ...createEmptyWeek(module.id, 2), id: 'OTHER-WEEK', components: [{ ...component, id: 'OTHER-COMPONENT' }] }];
  return module;
}

function Harness({ type = 'video', scoped = true }: { type?: ModuleComponentType; scoped?: boolean }) {
  const [module, setModule] = useState(() => fixture(type, scoped));
  const [baseline, setBaseline] = useState(module.weekStructure[0].components[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const week = module.weekStructure[0], component = week.components[0];
  const update = (patch: Partial<ModuleComponent>) => setModule(current => ({ ...current, weekStructure: current.weekStructure.map(item => item.id === week.id ? { ...item, components: item.components.map(part => part.id === component.id ? { ...part, ...patch } : part) } : item) }));
  return <><output data-testid="module-state">{JSON.stringify(module)}</output>{open && <ModuleComponentDrawer module={module} week={week} component={component} savedComponent={baseline} saving={saving} moduleDirty error={error} locked={false} onChange={update} onDiscard={restored => update(restored)} onClose={() => { closed(); setOpen(false); }} onSave={async () => {
    setSaving(true); setError(null);
    try { await save(module); setBaseline(component); } catch { setError('The save was refused. Your edits are still here.'); } finally { setSaving(false); }
  }} mappings={<label>Mapping note<input value={String(component.settings.ksbEvidenceNotes || '')} onChange={event => update({ settings: { ...component.settings, ksbEvidenceNotes: event.target.value } })} /></label>}>
    <ComponentEditor component={component} onChange={update} onBack={vi.fn()} groupOptions={[]} weekScope={{ courseType: 'paid', programmeId: module.programmeId, programmeName: module.programmeName, moduleName: module.title }} moduleId={module.catalogueId} />
  </ModuleComponentDrawer>}</>;
}
const state = () => JSON.parse(screen.getByTestId('module-state').textContent || '{}') as ModuleCatalogueItem;
const open = (type: ModuleComponentType = 'video', scoped = true) => render(<MemoryRouter><Harness type={type} scoped={scoped} /></MemoryRouter>);

describe('Module component editing drawer', () => {
  beforeEach(() => {
    save.mockReset().mockResolvedValue(undefined); closed.mockClear(); vi.mocked(showCurriculumConfirm).mockClear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } }));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(types)('edits %s by identity without changing namesakes, other weeks or hidden settings', async type => {
    const user = userEvent.setup(); open(type);
    const before = state(); const dialog = screen.getByRole('dialog');
    const title = within(dialog).getByLabelText('Title', { exact: true });
    await user.clear(title); await user.type(title, 'Changed component');
    await user.click(within(dialog).getByRole('tab', { name: 'Delivery' }));
    await user.click(within(dialog).getByRole('tab', { name: 'Quality & History' }));
    await user.click(within(dialog).getByRole('tab', { name: 'Content' }));
    expect(title).toHaveValue('Changed component');
    const current = state();
    expect(current.weekStructure[0].components[0]).toEqual({ ...before.weekStructure[0].components[0], title: 'Changed component' });
    expect(current.weekStructure[0].components[1]).toEqual(before.weekStructure[0].components[1]);
    expect(current.weekStructure[1]).toEqual(before.weekStructure[1]);
    expect(save).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: expect.stringMatching(/POST|PATCH|DELETE/) }));
  });

  it('discards only this component and preserves pending week edits and source IDs', async () => {
    const user = userEvent.setup(); open('reading');
    const before = state();
    await user.type(screen.getByLabelText('Description', { exact: true }), ' edited');
    await user.click(screen.getByRole('tab', { name: 'KSB Mapping' }));
    await user.type(screen.getByLabelText('Mapping note'), 'Draft mapping');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(state()).toEqual(before);
    expect(state().weekStructure[0].title).toContain('separate pending edit');
    expect(screen.getByLabelText('Description', { exact: true })).toHaveValue('Saved description');
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps a dirty drawer open on cancelled confirmation and resets only the selected component on confirmed close', async () => {
    const user = userEvent.setup(); open(); const before = state();
    await user.type(screen.getByLabelText('Title', { exact: true }), ' changed');
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(showCurriculumConfirm).toHaveBeenCalledOnce(); expect(closed).not.toHaveBeenCalled();
    const confirmation = vi.mocked(showCurriculumConfirm).mock.calls[0][0];
    await confirmation.onConfirm();
    await waitFor(() => expect(closed).toHaveBeenCalledOnce()); expect(state()).toEqual(before);
  });

  it('allows a clean drawer to close without a confirmation', async () => {
    open(); await userEvent.setup().keyboard('{Escape}');
    expect(closed).toHaveBeenCalledOnce(); expect(showCurriculumConfirm).not.toHaveBeenCalled();
  });

  it('retains fields from other tabs, fractional hours and fixed points in the module save', async () => {
    const user = userEvent.setup(); open(); const before = state();
    await user.click(screen.getByRole('tab', { name: 'Delivery' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Expected OTJH hours' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Expected OTJH hours' }), '2');
    await user.clear(screen.getByRole('spinbutton', { name: 'Expected OTJH minutes' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Expected OTJH minutes' }), '30');
    await user.click(screen.getByRole('tab', { name: 'KSB Mapping' }));
    await user.type(screen.getByLabelText('Mapping note'), 'Retain this field');
    await user.click(screen.getByRole('tab', { name: 'Content' }));
    await user.type(screen.getByLabelText('Title', { exact: true }), ' edited');
    await user.click(screen.getByRole('button', { name: 'Save component' }));
    const sent = save.mock.calls[0][0] as ModuleCatalogueItem;
    expect(sent.weekStructure[0].components[0]).toMatchObject({ expectedOtjh: 2.5, points: before.weekStructure[0].components[0].points, settings: { version: '2.4', selectedGroupKeys: ['GROUP-QA'], ksbEvidenceNotes: 'Retain this field' } });
    expect(screen.getByText('No component changes', { exact: true })).toBeInTheDocument();
    expect(sent.weekStructure[0].components[1]).toEqual(before.weekStructure[0].components[1]);
  });

  it('prevents duplicate saves and keeps rejected changes with error feedback', async () => {
    const user = userEvent.setup(); let reject: (error: Error) => void = () => undefined;
    save.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    open(); await user.type(screen.getByLabelText('Title', { exact: true }), ' pending');
    const button = screen.getByRole('button', { name: 'Save component' }); await user.dblClick(button);
    expect(save).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByLabelText('Title', { exact: true })).toBeDisabled();
    reject(new Error('409')); await screen.findByRole('alert');
    expect(screen.getByLabelText('Title', { exact: true })).toHaveValue('Same title pending');
    expect(screen.getByText('Unsaved component changes', { exact: true })).toBeInTheDocument();
  });

  it.each([true, false])('labels scope and uses keyboard navigation without changing ownership (scoped=%s)', async scoped => {
    const user = userEvent.setup(); open('video', scoped);
    expect(screen.getByText(scoped ? 'Scoped module content' : 'Reusable source content', { exact: true })).toBeInTheDocument();
    screen.getByRole('tab', { name: 'Content' }).focus(); await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Delivery' })).toHaveAttribute('aria-selected', 'true');
    expect(state().weekStructure[0].components[0].sourceId).toBe('SOURCE-QA');
    expect(save).not.toHaveBeenCalled();
  });
});
