import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArchiveSpreadsheetPreview } from './ArchiveSpreadsheetPreview';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows spreadsheet cells and switches to a document inside an archive', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    files: ['Tools.xlsx', 'Notes.txt'], notices: [], documents: [
      { name: 'Tools.xlsx', text: 'Tools', sheets: [{ name: 'Marketing', rows: [['Tool', 'Cost'], ['Analytics', '25']] }] },
      { name: 'Notes.txt', text: 'Original assignment notes' },
    ],
  }) }));
  render(<ArchiveSpreadsheetPreview url="/preview" />);
  expect(await screen.findByRole('table', { name: 'Marketing' })).toHaveTextContent('Analytics');
  fireEvent.change(screen.getByLabelText('Preview file'), { target: { value: '1' } });
  expect(screen.getByText('Original assignment notes')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});
it('shows a recoverable message when the preview request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  render(<ArchiveSpreadsheetPreview url="/preview" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Download the original');
});
