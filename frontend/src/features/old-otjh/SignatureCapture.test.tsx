import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

it('requires drawing, preview and confirmation before saving', async () => {
  const save = vi.fn(); render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  expect(screen.getByRole('button', { name: 'Preview signature' })).toBeDisabled();
  fireEvent.pointerDown(screen.getByLabelText('Draw your signature'));
  fireEvent.pointerMove(screen.getByLabelText('Draw your signature'));
  fireEvent.pointerUp(screen.getByLabelText('Draw your signature'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview signature' }));
  expect(await screen.findByAltText('Your signature preview')).toBeInTheDocument();
  const confirm = screen.getByRole('button', { name: 'Confirm and save signature' });
  expect(confirm).toBeDisabled(); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(confirm);
  expect(save).toHaveBeenCalledWith(expect.any(Blob), 'draw');
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

it('imports a previously confirmed signature and still requires monthly confirmation', async () => {
  const save = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['saved-signature'], { type: 'image/png' }),
  } as Response);
  render(<SignatureCapture name="Test student" dialogRole="learner" busy={false} onSave={save}
    importSignature={{ url: '/saved-signature.png', monthLabel: 'July 2026' }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Sign as learner' }));
  fireEvent.click(screen.getByRole('button', { name: 'Import previous signature' }));

  expect(await screen.findByAltText('Your signature preview')).toBeInTheDocument();
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

it('keeps an unfinished drawing and its preview through parent refetch renders', () => {
  const save = vi.fn();
  const { rerender } = render(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  const canvas = screen.getByLabelText('Draw your signature');
  fireEvent.pointerUp(canvas);
  rerender(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  expect(screen.getByLabelText('Draw your signature')).toBe(canvas);
  expect(screen.getByRole('button', { name: 'Preview signature' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview signature' }));
  rerender(<SignatureCapture name="Test student" busy={false} onSave={save} />);
  expect(screen.getByAltText('Your signature preview')).toBeInTheDocument();
});

it('keeps drawing, preview and confirmation when its dialog closes and reopens', () => {
  const save = vi.fn(); const reset = vi.fn();
  const { rerender } = render(<SignatureCapture name="Test coach" dialogRole="coach" busy={false} onSave={save} onDraftReset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign as coach' }));
  fireEvent.pointerUp(screen.getByLabelText('Draw your signature'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview signature' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Keep draft and close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
  rerender(<SignatureCapture name="Test coach" dialogRole="coach" busy={false} onSave={save} onDraftReset={reset} saveError="Please review the changed record." />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign as coach' }));
  expect(screen.getByAltText('Your signature preview')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Please review the changed record.');
  expect(screen.getByRole('button', { name: 'Preview signature' })).toBeEnabled();
  expect(screen.getByRole('checkbox')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save signature' }));
  expect(save).toHaveBeenCalledWith(expect.any(Blob), 'draw');
});
