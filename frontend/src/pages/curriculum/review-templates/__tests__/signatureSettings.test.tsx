import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateEditor } from '../TemplateEditor';
import { updateMigratedTemplate, type MigratedFamily, type TemplateDetail } from '@/api/migratedReviewTemplates';

vi.mock('@/api/migratedReviewTemplates', async original => ({
  ...await original<typeof import('@/api/migratedReviewTemplates')>(),
  updateMigratedTemplate: vi.fn(),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.resetAllMocks(); });

function template(family: MigratedFamily, scope: 'GLOBAL' | 'PROGRAMME' = 'GLOBAL'): TemplateDetail {
  return { id: 1, scope, programme_key: scope === 'GLOBAL' ? '' : 'id:synthetic', review_family: family,
    name: 'Synthetic template', is_active: true, updated_at: 'version', source_metadata: {}, fingerprint: 'test',
    definition: { sections: [{ key: 'one', title: 'Discussion', order: 0,
      fields: [{ key: 'answer', title: 'Question', order: 0, aptemType: 13, respondentRoles: ['participant'] }] }] } };
}
const mount = (data: TemplateDetail, onClose = vi.fn()) => render(
  <TemplateEditor template={data} programmeName="Synthetic programme" onClose={onClose} onSaved={vi.fn()} />,
);
const choices = () => within(screen.getByRole('group', { name: 'Signatures required from' }));

describe('Aptem template signature settings', () => {
  it.each(['MCM', 'PR', 'PR_SKILLS_RADAR'] as const)('shows the existing %s defaults without dirtying the form', family => {
    mount(template(family));
    expect(choices().getByRole('checkbox', { name: 'Coach' })).toBeChecked();
    expect(choices().getByRole('checkbox', { name: 'Learner' })).toBeChecked();
    expect((choices().getByRole('checkbox', { name: 'Employer' }) as HTMLInputElement).checked).toBe(family !== 'MCM');
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
  });

  it.each(['GLOBAL', 'PROGRAMME'] as const)('saves %s choices independently of who can answer', async scope => {
    const data = template('MCM', scope);
    mount(data);
    fireEvent.click(choices().getByRole('checkbox', { name: 'Employer' }));
    fireEvent.click(choices().getByRole('checkbox', { name: 'Learner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, {
      name: data.name, definition: { ...data.definition, signatures: { advisor: true, participant: false, employer: true } },
    }));
    expect(data.definition.signatures).toBeUndefined();
  });

  it('restores an explicit empty selection and retains it on unrelated edits', async () => {
    const data = template('PR');
    data.definition.signatures = { advisor: false, participant: false, employer: false };
    mount(data);
    for (const input of choices().getAllByRole('checkbox')) expect(input).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, { name: 'Renamed', definition: data.definition }));
  });

  it('permits removing every signature as in Native templates', async () => {
    const data = template('PR_SKILLS_RADAR');
    mount(data);
    for (const input of choices().getAllByRole('checkbox')) fireEvent.click(input);
    expect(screen.getByText(/If none are selected/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, expect.objectContaining({
      definition: { ...data.definition, signatures: { advisor: false, participant: false, employer: false } },
    })));
  });

  it('protects unsaved changes and retains choices after a rejected save', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(updateMigratedTemplate).mockRejectedValue(new Error('Reload before saving.'));
    const onClose = vi.fn();
    mount(template('MCM'), onClose);
    fireEvent.click(choices().getByRole('checkbox', { name: 'Coach' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved template changes?');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving.');
    expect(choices().getByRole('checkbox', { name: 'Coach' })).not.toBeChecked();
  });

  it('defaults PSP to no signatures and saves the selected roles', async () => {
    const data = template('PSP');
    mount(data);
    for (const input of choices().getAllByRole('checkbox')) expect(input).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
    expect(screen.getByText(/No signatures are required by default/)).toBeVisible();
    fireEvent.click(choices().getByRole('checkbox', { name: 'Coach' }));
    fireEvent.click(choices().getByRole('checkbox', { name: 'Employer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, {
      name: data.name, definition: { ...data.definition, signatures: { advisor: true, participant: false, employer: true } },
    }));
  });

  it('loads PSP saved choices and can return it to completion without signatures', async () => {
    const data = template('PSP');
    data.definition.signatures = { advisor: false, participant: true, employer: false };
    mount(data);
    expect(choices().getByRole('checkbox', { name: 'Learner' })).toBeChecked();
    fireEvent.click(choices().getByRole('checkbox', { name: 'Learner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, {
      name: data.name, definition: { ...data.definition, signatures: { advisor: false, participant: false, employer: false } },
    }));
  });
});
