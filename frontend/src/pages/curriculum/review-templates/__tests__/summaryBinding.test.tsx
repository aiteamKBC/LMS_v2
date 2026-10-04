import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateEditor } from '../TemplateEditor';
import { previewMigratedDefinition, updateMigratedTemplate, FAMILY_LABELS, MIGRATED_FAMILIES, type MigratedField, type TemplateDetail, type TemplatePreview } from '@/api/migratedReviewTemplates';

vi.mock('@/api/migratedReviewTemplates', async original => ({
  ...await original<typeof import('@/api/migratedReviewTemplates')>(),
  updateMigratedTemplate: vi.fn(), previewMigratedDefinition: vi.fn(),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

const field = (key: string, aptemType = 13): MigratedField => ({ key, title: key, order: 0, aptemType });
function template(scope: 'GLOBAL' | 'PROGRAMME', fields: MigratedField[]): TemplateDetail {
  return { id: 1, scope, programme_key: scope === 'GLOBAL' ? '' : 'id:P1', review_family: 'PR', name: 'Synthetic',
    is_active: true, updated_at: 'version', source_metadata: {}, fingerprint: 'test',
    definition: { sections: [{ key: 'one', title: 'Discussion', order: 0, fields }] } };
}
function mount(data: TemplateDetail) {
  return render(<TemplateEditor template={data} programmeName="Programme" onClose={vi.fn()} onSaved={vi.fn()} />);
}

describe('migrated summary field purpose', () => {
  it.each([
    ['GLOBAL', 1], ['GLOBAL', 13], ['PROGRAMME', 1], ['PROGRAMME', 13],
  ] as const)('saves explicit metadata for %s type %s', async (scope, kind) => {
    const data = template(scope, [field('summary', 1), field('long')]);
    mount(data);
    const choices = screen.getAllByRole('checkbox', { name: 'Use as AI Meeting Summary' });
    expect(choices).toHaveLength(2);
    const selected = kind === 1 ? 0 : 1;
    fireEvent.click(choices[selected]);
    expect(choices[1 - selected]).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, expect.objectContaining({
      definition: { sections: [{ ...data.definition.sections[0], fields: data.definition.sections[0].fields.map((item, index) => index === selected ? { ...item, semanticKey: 'meeting_summary' } : item) }] },
    })));
    expect(data.definition.sections[0].fields[selected].semanticKey).toBeUndefined();
  });

  it('shows the selection copied into a Custom template and prevents a second mapping across sections', () => {
    const data = template('PROGRAMME', [{ ...field('bound'), semanticKey: 'meeting_summary' }]);
    data.definition.sections.push({ key: 'two', title: 'Other', order: 1, fields: [field('other')] });
    mount(data);
    const [bound, other] = screen.getAllByRole('checkbox', { name: 'Use as AI Meeting Summary' });
    expect(bound).toBeChecked();
    expect(other).toBeDisabled();
    fireEvent.click(bound);
    expect(other).toBeEnabled();
    fireEvent.click(other);
    expect(bound).toBeDisabled();
    expect(other).toBeChecked();
  });

  it('does not offer the purpose on invalid types or conditional descendants', () => {
    mount(template('GLOBAL', [2, 4, 5, 6, 11, 99].map(kind => ({ ...field(`type-${kind}`, kind),
      ...(kind === 6 ? { ifTrue: [field('nested')] } : {}),
    }))));
    expect(screen.queryByRole('checkbox', { name: 'Use as AI Meeting Summary' })).not.toBeInTheDocument();
  });

  it('removes the purpose when a mapped field becomes an ineligible type', async () => {
    const data = template('GLOBAL', [{ ...field('bound'), semanticKey: 'meeting_summary' }]);
    mount(data);
    fireEvent.change(screen.getByLabelText('Field type'), { target: { value: '4' } });
    expect(window.confirm).toHaveBeenCalledWith('Changing this field type will turn off Use as AI Meeting Summary. The question will remain in the template. Continue?');
    expect(screen.queryByRole('checkbox', { name: 'Use as AI Meeting Summary' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalled());
    const saved = vi.mocked(updateMigratedTemplate).mock.calls[0][1].definition!;
    expect(JSON.parse(JSON.stringify(saved)).sections[0].fields[0]).not.toHaveProperty('semanticKey');
    expect(saved.sections[0].fields[0]).toMatchObject({ key: 'bound', title: 'bound', aptemType: 4 });
  });

  it('retains the type and binding when the type-change warning is cancelled', () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    mount(template('GLOBAL', [{ ...field('bound'), semanticKey: 'meeting_summary' }]));
    fireEvent.change(screen.getByLabelText('Field type'), { target: { value: '2' } });
    expect(screen.getByLabelText('Field type')).toHaveValue('13');
    expect(screen.getByRole('checkbox', { name: 'Use as AI Meeting Summary' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
  });

  it('keeps the binding when switching between supported text types', async () => {
    mount(template('GLOBAL', [{ ...field('bound'), semanticKey: 'meeting_summary' }]));
    fireEvent.change(screen.getByLabelText('Field type'), { target: { value: '1' } });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Use as AI Meeting Summary' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalled());
    expect(vi.mocked(updateMigratedTemplate).mock.calls[0][1].definition!.sections[0].fields[0]).toMatchObject({ aptemType: 1, semanticKey: 'meeting_summary' });
  });

  it('unchecks only the binding and leaves the ordinary question intact', async () => {
    const question = { ...field('recap'), title: 'Meeting Summary', mandatory: false, description: 'Keep help text', semanticKey: 'meeting_summary' as const };
    mount(template('GLOBAL', [question]));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use as AI Meeting Summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalled());
    const saved = JSON.parse(JSON.stringify(vi.mocked(updateMigratedTemplate).mock.calls[0][1].definition!));
    expect(saved.sections[0].fields).toEqual([{ key: 'recap', title: 'Meeting Summary', order: 0, aptemType: 13, mandatory: false, description: 'Keep help text' }]);
  });

  it('deletes the selected question only after confirmation and frees the binding choice', async () => {
    const data = template('GLOBAL', [{ ...field('bound'), semanticKey: 'meeting_summary' }, field('keep')]);
    mount(data);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove question' })[0]);
    expect(window.confirm).toHaveBeenCalledWith('Remove this question and its conditional questions?');
    expect(screen.getByLabelText('Question label')).toHaveValue('keep');
    expect(screen.getByRole('checkbox', { name: 'Use as AI Meeting Summary' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalled());
    expect(vi.mocked(updateMigratedTemplate).mock.calls[0][1].definition!.sections[0].fields).toEqual([field('keep')]);
    expect(data.definition.sections[0].fields).toHaveLength(2);
  });

  it.each(MIGRATED_FAMILIES)('identifies the Standard %s context and explains snapshot preservation', family => {
    const data = { ...template('GLOBAL', [field('plain')]), review_family: family };
    mount(data);
    const dialog = screen.getByRole('dialog', { name: 'Editing Standard Template' });
    expect(within(dialog).getByText(FAMILY_LABELS[family], { exact: true })).toBeVisible();
    expect(within(dialog).getByText('Changes apply to future or uninitialised migrated reviews using this Standard Template. Reviews already started keep their saved version.')).toBeVisible();
    expect(within(dialog).queryByText('Programme', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Use as AI Meeting Summary' })).not.toBeChecked();
  });

  it('identifies the Custom programme and family separately from Standard templates', () => {
    const data = template('PROGRAMME', [field('plain')]);
    render(<TemplateEditor template={data} programmeName="Marketing Executive Level 4" onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Editing Custom Template' });
    expect(within(dialog).getByText('Marketing Executive Level 4')).toBeVisible();
    expect(within(dialog).getByText('PR', { exact: true })).toBeVisible();
    expect(within(dialog).getByText('This programme-specific copy can be edited independently. Reviews already started keep their saved version.')).toBeVisible();
    expect(within(dialog).queryByText(/Changes apply to future or uninitialised/)).not.toBeInTheDocument();
  });

  it('preserves an ordinary unbound template on save', async () => {
    const data = template('GLOBAL', [field('plain')]);
    mount(data);
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Renamed form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, { name: 'Renamed form', definition: data.definition }));
  });

  it('adds an optional multiline summary, persists the wire payload, reloads and previews without AI', async () => {
    const client = await vi.importActual<typeof import('@/api/migratedReviewTemplates')>('@/api/migratedReviewTemplates');
    let stored = template('GLOBAL', [field('ordinary')]);
    const writes: Record<string, unknown>[] = [];
    const previewOf = (definition: TemplateDetail['definition']): TemplatePreview => ({ readOnly: true, sections: definition.sections.map(section => ({
      id: section.key, title: section.title, displayOrder: section.order, estimatedMinutes: 0, enabled: true,
      fields: section.fields.map(question => ({ id: question.key, title: question.title, fieldType: 'text_multiline', required: !!question.mandatory, displayOrder: question.order,
        configuration: { migrated: true, ...(question.semanticKey ? { semanticKey: question.semanticKey } : {}) } })),
    })) });
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://example.invalid');
      const method = init?.method || 'GET';
      if (method === 'GET' && url.searchParams.has('programme_key')) return Response.json({ templates: [], resolutions: [], can_manage: true, csrf_token: 'synthetic-csrf' });
      if (url.pathname.endsWith('/1/') && method === 'GET') return Response.json(stored);
      if (url.pathname.endsWith('/1/') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body));
        writes.push(body);
        expect(init?.headers).toMatchObject({ 'X-CSRFToken': 'synthetic-csrf' });
        expect(body.updated_at).toBe(stored.updated_at);
        stored = { ...stored, name: body.name, definition: body.definition, updated_at: 'new-version' };
        return Response.json(stored);
      }
      if (url.pathname.endsWith('/preview/') && method === 'POST') return Response.json(previewOf(JSON.parse(String(init?.body)).definition));
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', transport);
    vi.mocked(updateMigratedTemplate).mockImplementation(client.updateMigratedTemplate);
    vi.mocked(previewMigratedDefinition).mockImplementation(client.previewMigratedDefinition);
    const onSaved = vi.fn();
    const editor = render(<TemplateEditor template={await client.getMigratedTemplate(1)} programmeName="Programme" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    const question = within(screen.getByRole('group', { name: 'Question 2' }));
    expect(question.getByLabelText('Field type')).toHaveValue('13');
    expect(question.getByRole('option', { name: 'Text Multiline' })).toHaveProperty('selected', true);
    expect(question.getByRole('checkbox', { name: 'Required' })).not.toBeChecked();
    expect(question.getByRole('checkbox', { name: 'Use as AI Meeting Summary' })).not.toBeChecked();
    fireEvent.change(question.getByLabelText('Question label'), { target: { value: 'Meeting Summary' } });
    fireEvent.click(question.getByRole('checkbox', { name: 'Use as AI Meeting Summary' }));
    expect(question.getByRole('checkbox', { name: 'Required' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(writes).toHaveLength(1);
    expect(stored.definition.sections[0].fields[1]).toMatchObject({ title: 'Meeting Summary', aptemType: 13, mandatory: false, semanticKey: 'meeting_summary' });
    editor.unmount();
    mount(await client.getMigratedTemplate(1));
    expect(screen.getAllByRole('checkbox', { name: 'Use as AI Meeting Summary' })[1]).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const summary = await screen.findByRole('textbox', { name: 'Meeting Summary' });
    expect(summary.tagName).toBe('TEXTAREA');
    expect(summary).toBeEnabled();
    fireEvent.change(summary, { target: { value: 'Local preview only' } });
    expect(summary).toHaveValue('Local preview only');
    expect(writes).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Check Session|Generate/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/semanticKey|system_binding|AI_SUMMARY/)).not.toBeInTheDocument();
    expect(stored.definition.sections[0].fields[1]).not.toHaveProperty('answer');
  });
});
