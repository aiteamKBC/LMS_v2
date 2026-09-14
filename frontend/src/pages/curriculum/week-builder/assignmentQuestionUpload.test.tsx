import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ComponentEditor } from './page';

vi.mock('../module-builder/RichTextEditor', () => ({ RichTextDraft: () => <div>Question editor</div> }));

afterEach(cleanup);
it('uploads the assignment question using the supplied module uploader and preserves the written question', async () => {
  const onChange = vi.fn();
  const file = new File(['question'], 'brief.pdf', { type: 'application/pdf' });
  const uploaded = { fileName: 'brief.pdf', url: '/curriculum_api/curriculum/uploads/brief.pdf', size: 8, contentType: 'application/pdf' };
  const uploadResource = vi.fn().mockResolvedValue({ file: uploaded });
  const component = { id: 'A1', type: 'assignment', title: 'Assignment', description: '', settings: { assignmentContent: '<p>Read the question.</p>' }, expectedOtjh: 2, points: 25, groupIds: [] } as unknown as ComponentProps<typeof ComponentEditor>['component'];
  const { container } = render(<ComponentEditor component={component} onChange={onChange} onBack={vi.fn()} groupOptions={[]} weekScope={{} as ComponentProps<typeof ComponentEditor>['weekScope']} uploadResource={uploadResource} />);
  expect(screen.getByText('Assignment question file (optional)')).toBeVisible();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ settings: { assignmentContent: '<p>Read the question.</p>', uploadedFileName: 'brief.pdf', uploadedFileUrl: uploaded.url, uploadedFileSize: 8, uploadedFileContentType: 'application/pdf', assignmentFileName: 'brief.pdf', assignmentFileUrl: uploaded.url } }));
  expect(uploadResource).toHaveBeenCalledWith('A1', file, 'assignment');
});


it('moves focus to the selected component without stealing it while editing', () => {
  const component = { id: 'A1', type: 'assignment', title: 'Assignment', description: '', settings: {}, expectedOtjh: 2, points: 25, groupIds: [] } as unknown as ComponentProps<typeof ComponentEditor>['component'];
  const props = { onChange: vi.fn(), onBack: vi.fn(), groupOptions: [], weekScope: {} as ComponentProps<typeof ComponentEditor>['weekScope'] };
  const view = render(<ComponentEditor {...props} component={component} />);
  expect(screen.getByRole('region', { name: 'Component editor' })).toHaveFocus();
  const title = screen.getByDisplayValue('Assignment');
  title.focus();
  view.rerender(<ComponentEditor {...props} component={{ ...component, title: 'Updated assignment' }} />);
  expect(title).toHaveFocus();
  view.rerender(<ComponentEditor {...props} component={{ ...component, id: 'A2' }} />);
  expect(screen.getByRole('region', { name: 'Component editor' })).toHaveFocus();
});
