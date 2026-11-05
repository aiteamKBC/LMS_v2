import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import TicketFilePicker from './TicketFilePicker';

afterEach(cleanup);
function Picker() {
  const [files, setFiles] = useState<File[]>([]);
  return <TicketFilePicker files={files} onChange={setFiles} />;
}
it('adds files across selections and removes a file before sending', () => {
  render(<Picker />);
  const input = screen.getByLabelText('Attachments (optional)');
  fireEvent.change(input, { target: { files: [new File(['image'], 'image.png')] } });
  fireEvent.change(input, { target: { files: [new File(['log'], 'error.log')] } });
  expect(screen.getByRole('button', { name: 'Remove image.png' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove image.png' }));
  expect(screen.queryByRole('button', { name: 'Remove image.png' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove error.log' })).toBeInTheDocument();
});
it('rejects unsupported, empty, oversized and excessive files while retaining a valid selection', () => {
  render(<Picker />);
  const input = screen.getByLabelText('Attachments (optional)');
  fireEvent.change(input, { target: { files: [new File(['valid'], 'valid.pdf')] } });
  const big = new File(['x'], 'big.pdf');
  Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
  for (const files of [[new File(['x'], 'app.exe')], [new File([], 'empty.txt')], [big], Array.from({ length: 5 }, (_, i) => new File(['x'], `${i}.txt`))]) {
    fireEvent.change(input, { target: { files } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove valid.pdf' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  }
});
it('shows the selected filename or attachment count and makes files previewable', () => {
  render(<Picker />);
  fireEvent.change(screen.getByLabelText('Attachments (optional)'), {
    target: { files: [new File(['image'], 'image.png'), new File(['log'], 'error.log')] },
  });
  expect(screen.getByText('2 files attached')).toBeInTheDocument();
  expect(screen.getByTitle('Open image.png')).toBeInTheDocument();
  expect(screen.getByTitle('Open error.log')).toBeInTheDocument();
});
it('rejects files beyond the combined size limit', () => {
  render(<Picker />);
  const files = Array.from({ length: 3 }, (_, i) => {
    const file = new File(['x'], `${i}.pdf`);
    Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 });
    return file;
  });
  fireEvent.change(screen.getByLabelText('Attachments (optional)'), { target: { files } });
  expect(screen.getByRole('alert')).toHaveTextContent('25 MB');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
