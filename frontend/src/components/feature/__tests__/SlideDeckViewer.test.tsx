/**
 * The in-house slide viewer.
 *
 * It exists because an uploaded deck had no inline preview at all: the page
 * handed the file to Microsoft's Office Online viewer, which can only render
 * what it can download from the public internet, so every learner on a private
 * or local deployment got Microsoft's own "An error occurred" page.
 *
 * What is pinned here is the contract the learner sees — the deck's own text
 * appears, paging works, and a deck the server cannot render degrades to the
 * caller's fallback instead of an empty frame. Pixel fidelity is the backend
 * renderer's job (curriculum_api/tests_pptx_slides.py).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SlideDeck } from '@/api/slideDeck';

const fetchSlideDeck = vi.fn();
vi.mock('@/api/slideDeck', () => ({ fetchSlideDeck: (...args: unknown[]) => fetchSlideDeck(...args) }));

const { SlideDeckViewer } = await import('../SlideDeckViewer');

function textShape(text: string) {
  return {
    kind: 'text' as const,
    x: 10, y: 20, w: 300, h: 80,
    path: null, radius: null,
    fill: null, line: null, lineWidthPx: null, rotation: null,
    defaultTextColor: '#111111',
    valign: 'top' as const,
    paragraphs: [{
      align: 'left' as const, level: 0, bullet: null, lineSpacing: null, lineHeightPx: null,
      runs: [{ text, sizePx: 24, bold: false, italic: false, underline: false, color: null, font: null }],
    }],
  };
}

function deck(...titles: string[]): SlideDeck {
  return {
    slideWidthPx: 1280,
    slideHeightPx: 720,
    slideCount: titles.length,
    slides: titles.map((title, index) => ({
      number: index + 1,
      layout: 'Blank',
      background: { color: '#ffffff' },
      shapes: [textShape(title)],
      notes: index === 0 ? 'Say hello' : '',
    })),
  };
}

const fallback = (reason: string) => <p>fallback: {reason}</p>;

describe('SlideDeckViewer', () => {
  beforeEach(() => {
    fetchSlideDeck.mockReset();
  });

  it('shows the first slide and asks the server for the authored path', async () => {
    fetchSlideDeck.mockResolvedValue(deck('Slide one', 'Slide two'));
    render(<SlideDeckViewer src="/curriculum_api/curriculum/uploads/m/c/deck.pptx" title="Deck" fallback={fallback} />);

    expect(await screen.findByText('Slide one')).toBeInTheDocument();
    expect(fetchSlideDeck).toHaveBeenCalledWith('/curriculum_api/curriculum/uploads/m/c/deck.pptx', expect.anything());
    expect(screen.getByText(/Slide 1 of 2/)).toBeInTheDocument();
  });

  it('pages forward and back, and stops at the ends', async () => {
    fetchSlideDeck.mockResolvedValue(deck('Slide one', 'Slide two'));
    render(<SlideDeckViewer src="/deck.pptx" title="Deck" fallback={fallback} />);
    await screen.findByText('Slide one');

    expect(screen.getByLabelText('Previous slide')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Next slide'));
    expect(screen.getByText('Slide two')).toBeInTheDocument();
    expect(screen.getByLabelText('Next slide')).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Previous slide'));
    expect(screen.getByText('Slide one')).toBeInTheDocument();
  });

  it('jumps straight to a slide from the number strip', async () => {
    fetchSlideDeck.mockResolvedValue(deck('One', 'Two', 'Three'));
    render(<SlideDeckViewer src="/deck.pptx" title="Deck" fallback={fallback} />);
    await screen.findByText('One');

    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.getByText(/Slide 3 of 3/)).toBeInTheDocument();
  });

  it('reveals the speaker notes for the slide that has them', async () => {
    fetchSlideDeck.mockResolvedValue(deck('One', 'Two'));
    render(<SlideDeckViewer src="/deck.pptx" title="Deck" fallback={fallback} />);
    await screen.findByText('One');

    expect(screen.queryByText('Say hello')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Speaker notes/ }));
    expect(screen.getByText('Say hello')).toBeInTheDocument();
  });

  it('warns that the slides are a saved copy when the upload has gone', async () => {
    // The backend serves the surviving render when the .pptx has vanished from
    // MEDIA_ROOT; the open/download links beside the viewer stay broken, so the
    // learner has to be told why.
    fetchSlideDeck.mockResolvedValue({ ...deck('One'), sourceMissing: true });
    render(<SlideDeckViewer src="/deck.pptx" title="Deck" fallback={fallback} />);

    expect(await screen.findByText(/saved copy/)).toBeInTheDocument();
  });

  it('says nothing about a saved copy for a deck whose file is present', async () => {
    fetchSlideDeck.mockResolvedValue(deck('One'));
    render(<SlideDeckViewer src="/deck.pptx" title="Deck" fallback={fallback} />);
    await screen.findByText('One');

    expect(screen.queryByText(/saved copy/)).not.toBeInTheDocument();
  });

  it('falls back with the server’s explanation when the deck cannot be rendered', async () => {
    fetchSlideDeck.mockRejectedValue(new Error('The slide deck file is not on the server any more.'));
    render(<SlideDeckViewer src="/deck.pptx" title="Deck" fallback={fallback} />);

    expect(await screen.findByText(/not on the server any more/)).toBeInTheDocument();
  });

  it('falls back rather than showing an empty stage for a deck with no slides', async () => {
    fetchSlideDeck.mockResolvedValue(deck());
    render(<SlideDeckViewer src="/deck.pptx" title="Deck" fallback={fallback} />);

    expect(await screen.findByText(/no slides to show/)).toBeInTheDocument();
  });
});
