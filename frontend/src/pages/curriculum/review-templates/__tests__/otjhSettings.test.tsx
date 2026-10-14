import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TemplateEditor } from '../TemplateEditor';
import { updateMigratedTemplate, type TemplateDetail } from '@/api/migratedReviewTemplates';

vi.mock('@/api/migratedReviewTemplates', async original => ({
  ...await original<typeof import('@/api/migratedReviewTemplates')>(),
  updateMigratedTemplate: vi.fn(), previewMigratedDefinition: vi.fn(),
}));
const template: TemplateDetail = { id: 1, scope: 'GLOBAL', programme_key: '', review_family: 'MCM',
  name: 'Synthetic MCM', is_active: true, updated_at: 'version', source_metadata: {}, fingerprint: 'test',
  expected_otjh: 1.5, counts_towards_otjh: false,
  definition: { sections: [{ key: 's', title: 'Discussion', order: 0, fields: [] }] } };
beforeEach(() => vi.resetAllMocks());
function mount(data = template) {
  render(<TemplateEditor template={data} programmeName="Synthetic programme" onClose={vi.fn()} onSaved={vi.fn()} />);
}

describe('Aptem template OTJ hours', () => {
  it.each(['GLOBAL', 'PROGRAMME'] as const)('saves hours and the flag for a %s template', async scope => {
    const data = { ...template, scope, programme_key: scope === 'GLOBAL' ? '' : 'id:P1' };
    mount(data);
    expect(screen.getByLabelText('Expected OTJH (hours)')).toHaveValue(1.5);
    expect(screen.getByText(/OTJ hour changes apply only to reviews that have not started/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Expected OTJH (hours)'), { target: { value: '2.25' } });
    fireEvent.click(screen.getByRole('checkbox', { name: "Counts towards learner's total OTJH" }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(data, {
      name: data.name, definition: data.definition, expected_otjh: 2.25, counts_towards_otjh: true,
    }));
  });
  it('turns counting off without clearing the configured hours', async () => {
    mount({ ...template, counts_towards_otjh: true });
    fireEvent.click(screen.getByRole('checkbox', { name: "Counts towards learner's total OTJH" }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(updateMigratedTemplate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      expected_otjh: 1.5, counts_towards_otjh: false,
    })));
  });
  it.each(['-1', '', '1.001', '1000000'])('rejects invalid hours %s without saving', value => {
    mount();
    fireEvent.change(screen.getByLabelText('Expected OTJH (hours)'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Expected OTJH must be zero or a positive number');
    expect(updateMigratedTemplate).not.toHaveBeenCalled();
  });
  it('keeps edited hours after a save failure', async () => {
    vi.mocked(updateMigratedTemplate).mockRejectedValue(new Error('Reload before saving.'));
    mount();
    fireEvent.change(screen.getByLabelText('Expected OTJH (hours)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving.');
    expect(screen.getByLabelText('Expected OTJH (hours)')).toHaveValue(2);
  });
});
