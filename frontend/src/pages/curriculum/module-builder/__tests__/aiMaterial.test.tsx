import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The AI Material dialog, reached from "AI Material" beside "Preview as learner"
 * once a module is open for authoring.
 *
 * Three things are pinned, because each one fails in a way that still looks
 * like it worked:
 *
 * - which URL previews the book. The uploads route renders a PDF itself and
 *   frames an Office document through the Office Online viewer at
 *   `?preview=1`; an EPUB has no viewer at all, so offering one would frame a
 *   blank page instead of offering the download.
 * - that a *replace* re-reads the record it was given back, rather than keeping
 *   the file name it had. Every upload is stored under its own timestamped
 *   path, so a dialog still showing the previous name is pointing at bytes that
 *   no longer exist.
 * - that a failed upload says so and leaves the book that is still there on
 *   screen.
 */

const loadAiMaterial = vi.fn();
const uploadAiMaterial = vi.fn();
const removeAiMaterial = vi.fn();

vi.mock('../moduleAuthoringData', () => ({
  AI_MATERIAL_ACCEPT: '.pdf,.epub,.doc,.docx,.txt,.rtf,.odt',
  loadAiMaterial: (...args: unknown[]) => loadAiMaterial(...args),
  uploadAiMaterial: (...args: unknown[]) => uploadAiMaterial(...args),
  removeAiMaterial: (...args: unknown[]) => removeAiMaterial(...args),
}));

const { AiMaterialModal } = await import('../AiMaterialModal');
const { aiMaterialPreviewUrl, formatMaterialSize } = await import('../aiMaterialPreview');

const record = (fileName = 'handbook.pdf', url = '/curriculum_api/curriculum/uploads/MOD-1/ai-material/handbook-1.pdf') => ({
  fileName,
  storedPath: `curriculum_component_uploads/MOD-1/ai-material/${fileName}`,
  url,
  size: 2_500_000,
  contentType: 'application/pdf',
  uploadedAt: '2026-09-20T09:00:00Z',
});

function open() {
  return render(<AiMaterialModal moduleCatalogueId="MOD-1" moduleTitle="Data Foundations" onClose={() => undefined} />);
}

describe('which URL shows the book', () => {
  it('serves a PDF straight from the uploads route', () => {
    expect(aiMaterialPreviewUrl(record())).toBe('/curriculum_api/curriculum/uploads/MOD-1/ai-material/handbook-1.pdf');
  });

  it('sends a Word document through the Office Online viewer', () => {
    expect(aiMaterialPreviewUrl(record('handbook.docx', '/uploads/handbook.docx'))).toBe('/uploads/handbook.docx?preview=1');
  });

  it('has no viewer for an EPUB, so the dialog offers the download instead', () => {
    expect(aiMaterialPreviewUrl(record('handbook.epub', '/uploads/handbook.epub'))).toBe('');
  });

  it('has nothing to show when no book is uploaded', () => {
    expect(aiMaterialPreviewUrl(null)).toBe('');
  });

  it('states the size in the unit a reader thinks in', () => {
    expect(formatMaterialSize(900)).toBe('900 B');
    expect(formatMaterialSize(2048)).toBe('2 KB');
    expect(formatMaterialSize(2_500_000)).toBe('2.4 MB');
  });
});

describe('the AI Material dialog', () => {
  beforeEach(() => {
    loadAiMaterial.mockReset();
    uploadAiMaterial.mockReset();
    removeAiMaterial.mockReset();
  });

  it('offers an upload when the module has no book yet', async () => {
    loadAiMaterial.mockResolvedValue({ moduleCatalogueId: 'MOD-1', hasMaterial: false, material: null });
    open();
    expect(await screen.findByText('No book uploaded yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload book/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace book/ })).not.toBeInTheDocument();
  });

  it('uploads a chosen book and then offers to replace and preview it', async () => {
    loadAiMaterial.mockResolvedValue({ moduleCatalogueId: 'MOD-1', hasMaterial: false, material: null });
    uploadAiMaterial.mockResolvedValue({ moduleCatalogueId: 'MOD-1', hasMaterial: true, material: record(), uploaded: true, replaced: false });
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByText('No book uploaded yet');

    await user.upload(container.querySelector('input[type="file"]')!, new File(['%PDF'], 'handbook.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText('Uploaded handbook.pdf.')).toBeInTheDocument();
    expect(uploadAiMaterial).toHaveBeenCalledWith('MOD-1', expect.any(File));
    expect(screen.getByRole('button', { name: /Replace book/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview book/ })).toBeInTheDocument();
  });

  it('shows the replacement the server recorded, not the file that was there', async () => {
    loadAiMaterial.mockResolvedValue({ moduleCatalogueId: 'MOD-1', hasMaterial: true, material: record('first.pdf') });
    uploadAiMaterial.mockResolvedValue({
      moduleCatalogueId: 'MOD-1', hasMaterial: true, uploaded: true, replaced: true,
      material: record('second.pdf', '/curriculum_api/curriculum/uploads/MOD-1/ai-material/second-2.pdf'),
    });
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByText('first.pdf');

    await user.upload(container.querySelector('input[type="file"]')!, new File(['%PDF'], 'second.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText('Replaced with second.pdf.')).toBeInTheDocument();
    expect(screen.getByText('second.pdf')).toBeInTheDocument();
    expect(screen.queryByText('first.pdf')).not.toBeInTheDocument();

    // And the viewer points at the new bytes.
    await user.click(screen.getByRole('button', { name: /Preview book/ }));
    expect(screen.getByTitle('second.pdf preview')).toHaveAttribute(
      'src', '/curriculum_api/curriculum/uploads/MOD-1/ai-material/second-2.pdf',
    );
  });

  it('reports a failed upload and leaves the book that is still there', async () => {
    loadAiMaterial.mockResolvedValue({ moduleCatalogueId: 'MOD-1', hasMaterial: true, material: record('first.pdf') });
    uploadAiMaterial.mockRejectedValue(new Error('The file upload is taking too long. It was stopped so you can retry.'));
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByText('first.pdf');

    await user.upload(container.querySelector('input[type="file"]')!, new File(['%PDF'], 'second.pdf', { type: 'application/pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('taking too long');
    expect(screen.getByText('first.pdf')).toBeInTheDocument();
  });

  it('offers a download, and no viewer, for a format no browser reads', async () => {
    loadAiMaterial.mockResolvedValue({
      moduleCatalogueId: 'MOD-1', hasMaterial: true,
      material: record('handbook.epub', '/curriculum_api/curriculum/uploads/MOD-1/ai-material/handbook.epub'),
    });
    open();
    expect(await screen.findByRole('link', { name: /Download book/ })).toHaveAttribute(
      'href', '/curriculum_api/curriculum/uploads/MOD-1/ai-material/handbook.epub',
    );
    expect(screen.queryByRole('button', { name: /Preview book/ })).not.toBeInTheDocument();
    expect(screen.getByText(/no in-browser reader/)).toBeInTheDocument();
  });

  it('removes the book and returns to the empty state', async () => {
    loadAiMaterial.mockResolvedValue({ moduleCatalogueId: 'MOD-1', hasMaterial: true, material: record() });
    removeAiMaterial.mockResolvedValue({ moduleCatalogueId: 'MOD-1', hasMaterial: false, material: null, removed: true });
    const user = userEvent.setup();
    open();
    await screen.findByText('handbook.pdf');

    await user.click(screen.getByRole('button', { name: /Remove book/ }));

    await waitFor(() => expect(screen.getByText('No book uploaded yet')).toBeInTheDocument());
    expect(removeAiMaterial).toHaveBeenCalledWith('MOD-1');
  });
});
