import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import * as api from '@/api/migratedReviewTemplates';
import ReviewTemplatesPage from '../page';
import { definitionCounts } from '../templateDisplay';
import { CurriculumLibraryHub } from '../../hubs/page';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/feature/WorkspaceHeroBanner', () => ({ WorkspaceHeroBanner: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/hooks/useCurriculumProgrammes', () => ({ useCurriculumProgrammes: () => ({ programmes: [{ id: 'P1', sourceId: 'PROG-ME-L4', name: 'Marketing Executive Level 4' }], loading: false, error: null }) }));
vi.mock('@/hooks/useCurriculumData', () => ({ useCurriculumData: () => ({ data: {}, loading: false, error: null }) }));
vi.mock('@/api/migratedReviewTemplates', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/migratedReviewTemplates')>(),
  listMigratedTemplates: vi.fn(), getMigratedTemplate: vi.fn(), importMigratedTemplate: vi.fn(),
  createMigratedOverride: vi.fn(), updateMigratedTemplate: vi.fn(), resetMigratedOverride: vi.fn(),
  previewMigratedTemplate: vi.fn(), previewMigratedDefinition: vi.fn(),
}));

const definition: api.MigratedDefinition = { sections: [{ key: 'review', title: 'Progress discussion', order: 0, fields: [
  { key: 'question', title: 'What progress have you made?', aptemType: 13, order: 0, mandatory: false },
] }] };
const globalTemplate: api.TemplateDetail = { id: 1, scope: 'GLOBAL', programme_key: '', review_family: 'PR', name: 'Global PR form', is_active: true,
  updated_at: '2026-10-03T10:00:00Z', source_metadata: { sourceReviewId: 3, aptemReviewId: '17733' }, fingerprint: 'abc123', definition };
const override: api.TemplateDetail = { ...globalTemplate, id: 2, scope: 'PROGRAMME', programme_key: 'id:PROG-ME-L4', name: 'Local PR form', source_metadata: { copiedFromTemplateId: 1 } };
const preview: api.TemplatePreview = { readOnly: true, sections: [{ id: 'review', title: 'Progress discussion', estimatedMinutes: 0, displayOrder: 0, enabled: true,
  fields: [{ id: 'question', title: 'What progress have you made?', fieldType: 'text_multiline', required: false, displayOrder: 0, configuration: {} }] }] };
function library(local?: api.MigratedTemplate): api.TemplateLibrary {
  return { templates: [globalTemplate, ...(local ? [local] : [])], can_manage: true,
    resolutions: api.MIGRATED_FAMILIES.map(review_family => ({ review_family, resolved_template_id: review_family === 'PR' ? local?.is_active ? 2 : 1 : null,
      resolved_scope: review_family === 'PR' ? local?.is_active ? 'PROGRAMME' : 'GLOBAL' : null,
      inherited_from_global: review_family === 'PR' && !local?.is_active, programme_override_exists: !!local && review_family === 'PR' })) };
}
function mount() { return render(<MemoryRouter><ReviewTemplatesPage /></MemoryRouter>); }
async function selectProgramme() {
  await screen.findByRole('article', { name: 'Standard PR' });
  fireEvent.change(screen.getByLabelText('Programme'), { target: { value: 'id:PROG-ME-L4' } });
  return screen.findByRole('article', { name: 'Programme PR' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listMigratedTemplates).mockResolvedValue(library());
  vi.mocked(api.getMigratedTemplate).mockResolvedValue(globalTemplate);
  vi.mocked(api.previewMigratedTemplate).mockResolvedValue(preview);
  vi.mocked(api.previewMigratedDefinition).mockResolvedValue(preview);
  vi.mocked(api.updateMigratedTemplate).mockResolvedValue(globalTemplate);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Migrated Review Templates workspace', () => {
  it('adds the Library card with the shared workspace link', () => {
    render(<MemoryRouter><CurriculumLibraryHub /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /Review Templates/ });
    expect(link).toHaveAttribute('href', '/curriculum/library/review-templates');
    expect(within(link).getByText('Open workspace')).toBeInTheDocument();
  });

  it('loads all three global families with missing and active states', async () => {
    mount();
    expect(await screen.findByRole('article', { name: 'Standard PR' })).toHaveTextContent('Active');
    expect(screen.getByRole('article', { name: 'Standard MCM' })).toHaveTextContent('No Standard Template Available');
    expect(screen.getByRole('article', { name: 'Standard PR + Skills Radar' })).toHaveTextContent('No Standard Template Available');
  });

  it('selects a programme by its stable id and displays inheritance', async () => {
    mount(); const card = await selectProgramme();
    expect(api.listMigratedTemplates).toHaveBeenLastCalledWith('id:PROG-ME-L4', expect.any(AbortSignal));
    expect(card).toHaveTextContent('Using Standard Template');
    expect(card).toHaveTextContent('This programme currently uses the standard PR template.');
    expect(screen.getByRole('article', { name: 'Programme PR + Skills Radar' })).toHaveTextContent('No Standard Template Available');
  });

  it('creates an inactive programme override from Global and opens the editor', async () => {
    vi.mocked(api.createMigratedOverride).mockResolvedValue({ ...override, is_active: false });
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Customise for this programme' }));
    expect(await screen.findByRole('dialog', { name: 'Editing Custom Template' })).toBeInTheDocument();
    expect(api.createMigratedOverride).toHaveBeenCalledWith('id:PROG-ME-L4', 'PR', 'PR Custom Template');
    expect(api.updateMigratedTemplate).not.toHaveBeenCalled();
  });

  it('edits an override and saves only its definition and name', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library(override));
    vi.mocked(api.getMigratedTemplate).mockResolvedValue(override);
    mount(); const card = await selectProgramme();
    expect(card).toHaveTextContent('Using Custom Template');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit Custom Template' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Question label'), { target: { value: 'Updated question' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(api.updateMigratedTemplate).toHaveBeenCalledWith(override, expect.objectContaining({ name: override.name,
      definition: expect.objectContaining({ sections: [expect.objectContaining({ fields: [expect.objectContaining({ title: 'Updated question' })] })] }) })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('resets the active override and refreshes inherited state without deleting', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library(override));
    vi.mocked(api.resetMigratedOverride).mockImplementation(async () => {
      vi.mocked(api.listMigratedTemplates).mockResolvedValue(library({ ...override, is_active: false }));
      return library().resolutions[1];
    });
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Use Standard Template' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Use the Standard Template for this programme?' });
    expect(api.resetMigratedOverride).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.resetMigratedOverride).toHaveBeenCalledWith(override));
    expect(await screen.findByText('Custom version saved but not in use')).toBeInTheDocument();
    expect(screen.getByText('Using Standard Template')).toBeInTheDocument();
  });

  it('previews with the shared form renderer without saving or initializing', async () => {
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog', { name: 'Previewing Standard PR Template' });
    expect(within(dialog).getByText('What progress have you made?')).toBeInTheDocument();
    expect(api.previewMigratedTemplate).toHaveBeenCalledWith(1);
    expect(api.updateMigratedTemplate).not.toHaveBeenCalled();
    expect(api.createMigratedOverride).not.toHaveBeenCalled();
  });

  it('shows permission failures without management actions', async () => {
    vi.mocked(api.listMigratedTemplates).mockRejectedValue(new Error('Curriculum access required.'));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Curriculum access required.');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('hides write controls for a read-only response', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue({ ...library(), can_manage: false });
    mount(); await screen.findByRole('article', { name: 'Standard PR' });
    expect(screen.getByText(/Read-only access/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import historical/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
  });

  it('imports only through an explicit historical source and leaves activation separate', async () => {
    vi.mocked(api.importMigratedTemplate).mockResolvedValue({ ...globalTemplate, review_family: 'MCM', is_active: false });
    mount(); const card = await screen.findByRole('article', { name: 'Standard MCM' });
    fireEvent.click(within(card).getByRole('button', { name: 'Import historical form' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import MCM Standard Template' });
    fireEvent.change(within(dialog).getByLabelText('Source internal review ID'), { target: { value: '17' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import draft' }));
    await waitFor(() => expect(api.importMigratedTemplate).toHaveBeenCalledWith('MCM', 17, 'MCM Standard Template'));
    expect(api.updateMigratedTemplate).not.toHaveBeenCalled();
  });

  it('retains unsaved changes after a failed save', async () => {
    vi.mocked(api.updateMigratedTemplate).mockRejectedValue(new Error('This template changed. Reload before saving.'));
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'My unsaved edits' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Reload before saving');
    expect(within(dialog).getByLabelText('Template name')).toHaveValue('My unsaved edits');
  });

  it('separates Standard Templates and Programme Customisation and shows derived counts', async () => {
    mount();
    const card = await screen.findByRole('article', { name: 'Standard PR' });
    expect(screen.getByRole('heading', { name: 'Standard Templates' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Programme Customisation' })).toBeVisible();
    expect(within(card).getByText('Standard Template')).toBeVisible();
    expect(await within(card).findByText('question', { exact: false })).toHaveTextContent('1 question');
    expect(within(card).getByText('section', { exact: false })).toHaveTextContent('1 section');
    expect(card).toHaveTextContent('Updated 03 Oct 2026');
    expect(card).not.toHaveTextContent('abc123');
    expect(card).not.toHaveTextContent('Source review #3');
  });

  it('shows an inactive custom version separately and offers reuse rather than another copy', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library({ ...override, is_active: false }));
    mount(); const card = await selectProgramme();
    expect(card).toHaveTextContent('Using Standard Template');
    expect(card).toHaveTextContent('Custom version saved but not in use');
    expect(card).toHaveTextContent('Saved custom version: Local PR form');
    expect(card).toHaveTextContent('Current template: Standard PR');
    expect(within(card).getByRole('button', { name: 'Preview Standard' })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Edit Custom Version' })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Use Custom Version' })).toBeVisible();
    expect(within(card).queryByRole('button', { name: /Create override|Customise for this programme|Preview inherited/ })).not.toBeInTheDocument();
    expect(api.createMigratedOverride).not.toHaveBeenCalled();
  });

  it('previews the current Standard instead of the inactive custom version', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library({ ...override, is_active: false }));
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Preview Standard' }));
    expect(await screen.findByRole('dialog', { name: 'Previewing Standard PR Template' })).toBeVisible();
    expect(api.previewMigratedTemplate).toHaveBeenCalledWith(globalTemplate.id);
  });

  it('confirms using a saved custom version before calling the existing activation API', async () => {
    const inactive = { ...override, is_active: false };
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library(inactive));
    vi.mocked(api.updateMigratedTemplate).mockImplementation(async () => {
      vi.mocked(api.listMigratedTemplates).mockResolvedValue(library(override));
      return override;
    });
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Use Custom Version' }));
    let dialog = await screen.findByRole('dialog', { name: 'Use this Custom Template for this programme?' });
    expect(dialog).toHaveTextContent('Future or uninitialised migrated reviews will use this custom version.');
    expect(api.updateMigratedTemplate).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.updateMigratedTemplate).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Use Custom Version' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.updateMigratedTemplate).toHaveBeenCalledWith(inactive, { is_active: true }));
    expect(await screen.findByText('Using Custom Template')).toBeVisible();
    expect(api.createMigratedOverride).not.toHaveBeenCalled();
  });

  it('cancels returning to Standard without changing the active custom version', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library(override));
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Use Standard Template' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Existing reviews that already started will keep their saved version.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.resetMigratedOverride).not.toHaveBeenCalled();
    expect(card).toHaveTextContent('Using Custom Template');
  });

  it('keeps the confirmation and current state after a failed switch', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library({ ...override, is_active: false }));
    vi.mocked(api.updateMigratedTemplate).mockRejectedValue(new Error('This version changed. Reload before enabling it.'));
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Use Custom Version' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Reload before enabling');
    expect(card).toHaveTextContent('Using Standard Template');
    expect(screen.queryByText('This programme now uses its Custom Template.')).not.toBeInTheDocument();
  });

  it('identifies the Standard editor and explains the effect of edits without blocking', async () => {
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editing Standard Template' });
    expect(dialog).toHaveTextContent('Changes apply to future or uninitialised migrated reviews using this Standard Template. Reviews already started keep their saved version.');
    expect(within(dialog).getByText('PR', { exact: true })).toBeVisible();
    expect(within(dialog).getByLabelText('Template name')).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('dialog', { name: 'Previewing Standard PR Template' })).toBeVisible();
    expect(api.previewMigratedDefinition).toHaveBeenCalledWith(definition);
    expect(api.updateMigratedTemplate).not.toHaveBeenCalled();
  });

  it('identifies programme and family in both Custom editor and preview', async () => {
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library(override));
    vi.mocked(api.getMigratedTemplate).mockResolvedValue(override);
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit Custom Template' }));
    let dialog = await screen.findByRole('dialog', { name: 'Editing Custom Template' });
    expect(dialog).toHaveTextContent('Marketing Executive Level 4');
    expect(within(dialog).getByText('PR', { exact: true })).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    dialog = await screen.findByRole('dialog', { name: 'Previewing Custom PR Template' });
    expect(dialog).toHaveTextContent('Marketing Executive Level 4');
    expect(api.previewMigratedTemplate).toHaveBeenCalledWith(override.id);
  });

  it('saves an inactive custom version without enabling it', async () => {
    const inactive = { ...override, is_active: false };
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(library(inactive));
    vi.mocked(api.getMigratedTemplate).mockResolvedValue(inactive);
    mount(); const card = await selectProgramme();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit Custom Version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editing Custom Template' });
    expect(dialog).toHaveTextContent('Saving your changes does not enable this version.');
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Revised custom PR' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(api.updateMigratedTemplate).toHaveBeenCalledWith(inactive, { name: 'Revised custom PR', definition }));
    expect(await screen.findByText(/Template saved but not in use/)).toBeVisible();
  });

  it('moves secondary actions and source metadata into More', async () => {
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    expect(within(card).getByRole('button', { name: 'Deactivate' })).not.toBeVisible();
    expect(within(card).getByRole('button', { name: 'Import another form' })).not.toBeVisible();
    fireEvent.click(within(card).getByLabelText('More actions for Standard PR'));
    expect(within(card).getByRole('button', { name: 'Deactivate' })).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'View source details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Standard PR Template details' });
    expect(dialog).toHaveTextContent('Source review ID');
    expect(dialog).toHaveTextContent('17733');
    expect(dialog).toHaveTextContent('abc123');
  });

  it('closes More on Escape and restores keyboard focus to its trigger', async () => {
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    const trigger = within(card).getByLabelText('More actions for Standard PR');
    fireEvent.click(trigger);
    fireEvent.keyDown(within(card).getByRole('button', { name: 'Deactivate' }), { key: 'Escape' });
    expect(within(card).getByRole('button', { name: 'Deactivate' })).not.toBeVisible();
    expect(trigger).toHaveFocus();
  });

  it('deactivates a Standard using the same update API', async () => {
    vi.mocked(api.updateMigratedTemplate).mockImplementation(async () => {
      const result = library(); result.templates = [{ ...globalTemplate, is_active: false }];
      vi.mocked(api.listMigratedTemplates).mockResolvedValue(result);
      return { ...globalTemplate, is_active: false };
    });
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    fireEvent.click(within(card).getByLabelText('More actions for Standard PR'));
    fireEvent.click(within(card).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.updateMigratedTemplate).toHaveBeenCalledWith(globalTemplate, { is_active: false }));
    expect(await within(card).findByText('Not in use')).toBeVisible();
  });

  it('explains importing another form as an inactive new version', async () => {
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    fireEvent.click(within(card).getByLabelText('More actions for Standard PR'));
    fireEvent.click(within(card).getByRole('button', { name: 'Import another form' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import PR Standard Template' });
    expect(dialog).toHaveTextContent('Importing creates a new saved version');
    expect(dialog).toHaveTextContent('The new version is not active.');
    expect(api.importMigratedTemplate).not.toHaveBeenCalled();
    expect(api.updateMigratedTemplate).not.toHaveBeenCalled();
  });

  it('explains why a custom template cannot be created without an active Standard', async () => {
    mount(); await selectProgramme();
    const card = screen.getByRole('article', { name: 'Programme MCM' });
    expect(card).toHaveTextContent('No Standard Template Available');
    expect(within(card).getByRole('button', { name: 'Create Custom Template' })).toBeDisabled();
    expect(card).toHaveTextContent('Import and enable a Standard Template above');
    expect(within(card).queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(api.createMigratedOverride).not.toHaveBeenCalled();
  });

  it('offers a saved custom version when the Standard is unavailable', async () => {
    const result = library({ ...override, is_active: false });
    result.templates = [{ ...override, is_active: false }];
    result.resolutions[1] = { ...result.resolutions[1], resolved_template_id: null, resolved_scope: null, inherited_from_global: false };
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(result);
    mount(); const card = await selectProgramme();
    expect(card).toHaveTextContent('No Standard Template Available');
    expect(within(card).getByRole('button', { name: 'Use Custom Version' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'Edit Custom Version' })).toBeEnabled();
    expect(within(card).queryByRole('button', { name: /Preview|Create Custom Template/ })).not.toBeInTheDocument();
  });

  it('does not offer a switch to a missing Standard from an active Custom', async () => {
    const result = library(override); result.templates = [override];
    vi.mocked(api.listMigratedTemplates).mockResolvedValue(result);
    mount(); const card = await selectProgramme();
    expect(card).toHaveTextContent('Using Custom Template');
    expect(within(card).getByRole('button', { name: 'Use Standard Template' })).toBeDisabled();
    expect(card).toHaveTextContent('Enable a Standard Template above before switching to it.');
  });

  it('counts nested conditional questions without counting headings', () => {
    const field = definition.sections[0].fields[0];
    expect(definitionCounts({ sections: [{ ...definition.sections[0], fields: [
      { ...field, aptemType: 11 }, { ...field, aptemType: 6, ifTrue: [field], ifFalse: [{ ...field, aptemType: 6, ifTrue: [field] }] },
    ] }] })).toEqual({ sections: 1, questions: 4 });
  });

  it('keeps the workspace usable if question counts cannot load', async () => {
    vi.mocked(api.getMigratedTemplate).mockRejectedValue(new Error('Form details unavailable.'));
    mount(); const card = await screen.findByRole('article', { name: 'Standard PR' });
    expect(await within(card).findByText('Question and section counts unavailable.')).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Preview' })).toBeEnabled();
    expect(card).not.toHaveTextContent('0 questions');
  });
});
