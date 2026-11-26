import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignatureCapture } from './SignatureCapture';

vi.mock('signature_pad', () => ({ default: class {
  drawn = false;
  changed?: () => void;
  listener = () => { this.drawn = true; this.changed?.(); };
  canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.addEventListener('pointerup', this.listener);
  }
  addEventListener(_: string, listener: () => void) { this.changed = listener; }
  removeEventListener() {}
  off() { this.canvas.removeEventListener('pointerup', this.listener); }
  isEmpty() { return !this.drawn; }
  clear() { this.drawn = false; }
  toData() { return this.drawn ? [{ points: [{ x: 10, y: 20, time: 1, pressure: .5 }] }] : []; }
  fromData(data: unknown[]) { this.drawn = data.length > 0; }
  toDataURL() { return 'data:image/png;base64,c2lnbmF0dXJl'; }
} }));
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['signature'], { type: 'image/png' })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('saves a drawing directly after confirmation without a preview step', async () => {
  const save = vi.fn(); render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  expect(screen.queryByRole('button', { name: 'Preview signature' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm and save signature' })).toBeDisabled();
  fireEvent.pointerDown(screen.getByLabelText('Draw your signature'));
  fireEvent.pointerMove(screen.getByLabelText('Draw your signature'));
  fireEvent.pointerUp(screen.getByLabelText('Draw your signature'));
  expect(screen.queryByAltText('Your signature preview')).not.toBeInTheDocument();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: 'Confirm and save signature' });
  expect(confirm).toBeDisabled(); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(confirm);
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), 'draw'));
});

it('previews an uploaded image and requires explicit confirmation', async () => {
  const save = vi.fn(); render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload signature image' }));
  const file = new File(['image'], 'signature.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Upload signature image', { selector: 'input' }), { target: { files: [file] } });
  expect(await screen.findByAltText('Your signature preview')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm and save signature' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  expect(save).toHaveBeenCalledWith(file, 'upload');
});

it('shows no import action before the learner has signed a month', () => {
  render(<SignatureCapture name="Test student" dialogRole="learner" busy={false} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign as learner' }));
  expect(screen.queryByRole('button', { name: 'Import previous signature' })).not.toBeInTheDocument();
});

it('offers import below the month signing button and requires monthly confirmation', async () => {
  const save = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['saved-signature'], { type: 'image/png' }),
  } as Response);
  render(<SignatureCapture name="Test student" dialogRole="learner" busy={false} onSave={save}
    importSignature={{ url: '/saved-signature.png', monthLabel: 'July 2026' }} />);

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Use your signature from July 2026?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Import previous signature' }));

  expect(await screen.findByRole('dialog', { name: 'Learner signature' })).toBeInTheDocument();
  expect(await screen.findByAltText('Your signature preview')).toBeInTheDocument();
  expect(screen.queryByLabelText('Draw your signature')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: 'Confirm and save signature' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(confirm);
  expect(save).toHaveBeenCalledWith(expect.any(Blob), 'import');
});

it('rejects SVG in the upload picker', () => {
  render(<SignatureCapture name="Test student" busy={false} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload signature image' }));
  fireEvent.change(screen.getByLabelText('Upload signature image', { selector: 'input' }), {
    target: { files: [new File(['<svg/>'], 'signature.svg', { type: 'image/svg+xml' })] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a PNG or JPEG image up to 2 MB.');
});

it('keeps a drawing and its confirmation through parent refetch renders', async () => {
  const save = vi.fn();
  const { rerender } = render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  const canvas = screen.getByLabelText('Draw your signature');
  fireEvent.pointerUp(canvas);
  fireEvent.click(screen.getByRole('checkbox'));
  rerender(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  expect(screen.getByLabelText('Draw your signature')).toBe(canvas);
  expect(screen.getByRole('checkbox')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), 'draw'));
});

it('keeps drawing and confirmation when its dialog closes and reopens', async () => {
  const save = vi.fn(); const reset = vi.fn();
  const { rerender } = render(<SignatureCapture name="Test coach" dialogRole="coach" busy={false} onSave={save} onDraftReset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign as coach' }));
  fireEvent.pointerUp(screen.getByLabelText('Draw your signature'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Keep draft and close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
  rerender(<SignatureCapture name="Test coach" dialogRole="coach" busy={false} onSave={save} onDraftReset={reset} saveError="Please review the changed record." />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign as coach' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Please review the changed record.');
  expect(screen.getByRole('button', { name: 'Confirm and save signature' })).toBeEnabled();
  expect(screen.getByRole('checkbox')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), 'draw'));
});

it('requires confirmation again after redrawing or clearing a signature', () => {
  const save = vi.fn(); render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  const canvas = screen.getByLabelText('Draw your signature');
  fireEvent.pointerUp(canvas);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.pointerUp(canvas);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Confirm and save signature' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm and save signature' })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});

it('prevents duplicate saves while creating the drawing image', async () => {
  let finish: (blob: Blob | null) => void;
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => { finish = callback; });
  const save = vi.fn(); render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  fireEvent.pointerUp(screen.getByLabelText('Draw your signature'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
  expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  await act(async () => finish(new Blob(['drawing'], { type: 'image/png' })));
  expect(save).toHaveBeenCalledOnce();
});

it('keeps the drawing for retry if image creation fails', async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback => callback(null));
  const save = vi.fn(); render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  fireEvent.pointerUp(screen.getByLabelText('Draw your signature'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this signature image.');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
});

it('allows drawing after a failed import without saving anything automatically', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
  const save = vi.fn(); render(<SignatureCapture name="Test student" busy={false} onSave={save}
    importSignature={{ url: '/saved-signature.png', monthLabel: 'July 2026' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Import previous signature' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not import your previous signature.');
  expect(screen.getByRole('button', { name: 'Confirm and save signature' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Draw signature' }));
  fireEvent.pointerUp(screen.getByLabelText('Draw your signature'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), 'draw'));
});
