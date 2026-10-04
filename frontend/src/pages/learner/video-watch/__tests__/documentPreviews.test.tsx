import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComponentBody, InlineAttachmentPreview } from '../page';

vi.mock('@/components/feature/SlideDeckViewer', () => ({
  SlideDeckViewer: ({ src }: { src: string }) => <div data-testid="deck" data-src={src}>Document pages</div>,
}));

function reading(contentHtml: string, resourceUrl?: string) {
  return render(<ComponentBody component={{ componentId: 'READ-1', type: 'reading', contentHtml, resourceUrl } as never}
    contentKind="reading" parsed={null} title="Study material" onDuration={vi.fn()} onProgress={vi.fn()}
    onPlayingChange={vi.fn()} onEnded={vi.fn()} onUnsupported={vi.fn()} />);
}

describe('documents alongside reading text', () => {
  it('falls back to the browser when an external PDF blocks cross-origin fetching', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<InlineAttachmentPreview url="https://files.example.test/book.pdf" title="Course book" />);
    expect(await screen.findByTitle('Course book')).toHaveAttribute('src', 'https://files.example.test/book.pdf');
    expect(request).toHaveBeenCalledOnce();
    request.mockRestore();
  });

  it.each(['pdf', 'pptx'])('shows an uploaded %s and the accompanying text together', extension => {
    reading('<p>Read this guidance before opening the file.</p>', `/curriculum_api/curriculum/uploads/book.${extension}`);
    expect(screen.getByText('Read this guidance before opening the file.')).toBeVisible();
    expect(screen.getByTestId('deck')).toHaveAttribute('data-src', expect.stringContaining(`book.${extension}`));
  });

  it('offers lazy previews for PDF and PowerPoint links inside the text', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    reading('<p>Reference materials</p><a href="https://files.example.com/book.pdf">Course book</a><a href="/curriculum_api/curriculum/uploads/slides.pptx">Course slides</a>');
    expect(screen.queryByTitle('Course book')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview file: Course book' }));
    expect(await screen.findByTitle('Course book')).toHaveAttribute('src', 'https://files.example.com/book.pdf');
    expect(screen.getByText('Reference materials')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preview file: Course slides' }));
    expect(screen.getByTestId('deck')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide preview: Course book' }));
    expect(screen.queryByTitle('Course book')).not.toBeInTheDocument();
    request.mockRestore();
  });

  it('keeps a real missing-file error visible rather than bypassing it', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    render(<InlineAttachmentPreview url="https://files.example.test/missing.pdf" title="Missing book" />);
    expect(await screen.findByText('File request failed (404)')).toBeVisible();
    expect(screen.queryByTitle('Missing book')).not.toBeInTheDocument();
    request.mockRestore();
  });
});
