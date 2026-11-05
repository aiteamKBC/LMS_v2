import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateEditor } from '../TemplateEditor';
import { TemplateAnswerConflictError, previewMigratedDefinition, updateMigratedTemplate, type MigratedField, type TemplateDetail } from '@/api/migratedReviewTemplates';

vi.mock('@/api/migratedReviewTemplates', async original => ({
  ...await original<typeof import('@/api/migratedReviewTemplates')>(),
  updateMigratedTemplate: vi.fn(), previewMigratedDefinition: vi.fn(),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

const field = (key: string, aptemType = 13): MigratedField => ({ key, title: key, order: 0, aptemType });
function template(fields: MigratedField[] = [field('question')]): TemplateDetail {
  return { id: 1, scope: 'GLOBAL', programme_key: '', review_family: 'PR', name: 'Synthetic',
    is_active: true, updated_at: 'version', source_metadata: {}, fingerprint: 'test',
    definition: { sections: [{ key: 'one', title: 'Discussion', order: 0, fields }] } };
}
const mount = (data = template()) => render(<TemplateEditor template={data} programmeName="Programme" onClose={vi.fn()} onSaved={vi.fn()} />);

/**
 * "Add section" starts a section with no title and one question with no label, which
 * the server refuses as a whole with a single sentence naming neither. That refusal
 * landed at the top of a dialog body that scrolls, so an author working further down
 * saw the dialog stay open with no visible reason and no saved change.
 */
describe('a save the server would refuse', () => {
  it('reports every gap against its own control instead of posting the draft', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(updateMigratedTemplate).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('2 questions or sections need attention');
    expect(screen.getByText('Enter a section title.')).toBeVisible();
    expect(screen.getByText('Enter a question label.')).toBeVisible();
  });

  it('keeps the reason beside the button, not only at the top of the scrolling body', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Question label'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await screen.findByRole('alert');
    // The banner inside the body, the note in the fixed footer, and the field itself.
    expect(screen.getAllByText('Enter a question label.')).toHaveLength(3);
  });

  it('posts the draft once the gaps are filled, and clears the marks as they are', async () => {
    const data = template();
    mount(data);
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(updateMigratedTemplate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Section 2 title/), { target: { value: 'Next steps' } });
    expect(screen.queryByText('Enter a section title.')).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText(/Question label/)[1], { target: { value: 'What is next?' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/need attention before/)).not.toBeInTheDocument();
    expect(screen.queryByText('Enter a question label.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(updateMigratedTemplate).mock.calls[0][1].definition!;
    expect(saved.sections.map(section => section.title)).toEqual(['Discussion', 'Next steps']);
    expect(saved.sections[1].fields[0].title).toBe('What is next?');
  });

  it('names an unusable list question rather than letting the server reject the template', async () => {
    mount(template([field('choice', 5)]));
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(updateMigratedTemplate).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one option.');
  });

  it('guards Preview, which posts the definition to the same validator', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(previewMigratedDefinition).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('need attention');
  });

  it('clears hidden options after confirming List to Text, while cancel preserves the list', async () => {
    const data = template([{ ...field('choice', 5), options: ['One', ''] }]);
    mount(data);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '13' } });
    expect(screen.getByLabelText(/^Options/)).toHaveValue('One\n');
    expect(screen.getByRole('combobox')).toHaveValue('5');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '13' } });
    expect(window.confirm).toHaveBeenLastCalledWith('Changing this type removes its list options. Continue?');
    expect(screen.queryByLabelText(/^Options/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateMigratedTemplate).mock.calls[0][1].definition!.sections[0].fields[0])
      .toMatchObject({ key: 'choice', aptemType: 13, options: [] });
    expect(data.definition.sections[0].fields[0].options).toEqual(['One', '']);
  });

  it.each([
    ['Template name', 255, 'Use at most 255 characters.'],
    ['Section 1 title', 4000, 'Use at most 4,000 characters for this section title.'],
    ['Question label', 4000, 'Use at most 4,000 characters for this question label.'],
    ['Help text', 20000, 'Use at most 20,000 characters for this help text.'],
  ])('shows the %s limit, blocks oversize saves, and clears the error when corrected', async (label, limit, error) => {
    mount();
    const control = screen.getByLabelText(label);
    fireEvent.change(control, { target: { value: 'x'.repeat(limit + 1) } });
    expect(screen.getByText(`${(limit + 1).toLocaleString('en-GB')} / ${limit.toLocaleString('en-GB')} characters`)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(error);
    expect(updateMigratedTemplate).not.toHaveBeenCalled();
    expect(control).toHaveFocus();
    // A non-BMP character counts once, matching server-side Python len().
    fireEvent.change(control, { target: { value: '😀'.repeat(limit) } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledTimes(1));
  });

  it('blocks oversized options in Preview and allows the corrected draft', async () => {
    mount(template([{ ...field('choice', 5), options: ['x'.repeat(4001)] }]));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use at most 4,000 characters per option.');
    expect(previewMigratedDefinition).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Options/), { target: { value: 'Valid option' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    vi.mocked(previewMigratedDefinition).mockResolvedValueOnce({ sections: [], readOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(previewMigratedDefinition).toHaveBeenCalledTimes(1));
  });

  it('permits Preview when only the template name is invalid', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a template name.');
    vi.mocked(previewMigratedDefinition).mockResolvedValueOnce({ sections: [], readOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(previewMigratedDefinition).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('returns from Preview to the conflicting question, preserves draft, and can save after correction', async () => {
    const onSaved = vi.fn();
    render(<TemplateEditor template={template()} programmeName="Programme" onClose={vi.fn()} onSaved={onSaved}/>);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    vi.mocked(previewMigratedDefinition).mockResolvedValueOnce({ sections: [], readOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('Try the form and its conditional questions. Preview answers are not saved.');
    vi.mocked(updateMigratedTemplate).mockRejectedValueOnce(new TemplateAnswerConflictError('Saved answers need the original type.', ['question']));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved answers need the original type.');
    expect(screen.getByRole('combobox')).toHaveValue('2');
    await waitFor(() => expect(screen.getByLabelText(/^Question label/)).toHaveFocus());
    expect(screen.getByText('Keep the type and options used by saved answers, or add a new question.')).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '13' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    vi.mocked(updateMigratedTemplate).mockResolvedValueOnce(template());
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });
});
